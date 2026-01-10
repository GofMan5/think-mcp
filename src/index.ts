#!/usr/bin/env node
/**
 * Think Module MCP Server v5.1.0
 * Streamlined thinking tools: 6 tools
 * 
 * v5.1.0: Imperative prompts (IF/THEN style, -55% tokens)
 * v4.7.0: Added think_logic for deep logical analysis
 * v4.6.0: Added NudgeService for proactive micro-prompts
 * 
 * Tools:
 * - think: Add a thought (with quickExtension for inline critique)
 * - think_batch: Submit multiple thoughts at once
 * - think_done: Finish session, verify, optionally export
 * - think_recall: Search session or past insights
 * - think_reset: Clear session
 * - think_logic: Deep logical analysis of any task/feature/system
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ThinkingService } from './services/thinking.service.js';
import type { QuickExtension, BurstThought, BurstConsolidation } from './types/thought.types.js';

const thinkingService = new ThinkingService();

const server = new McpServer({
  name: 'think-module-server',
  version: '5.1.0',
});

// ============================================
// 1. THINK - Single thought with optional inline extension
// ============================================

const THINK_DESCRIPTION = `Add thought to reasoning chain.

Use for: Complex problems, planning, analysis needing revision.

Features: subSteps (max 5), alternatives, quickExtension (inline critique).

Returns: progress bar, confidence, next action hint.`;

const thinkSchema = {
  thought: z.string().describe('Your thinking step'),
  nextThoughtNeeded: z.boolean().describe('More thinking needed?'),
  thoughtNumber: z.number().int().min(1).describe('Current number'),
  totalThoughts: z.number().int().min(1).describe('Estimated total'),
  confidence: z.number().min(1).max(10).optional().describe('Confidence 1-10'),
  subSteps: z.array(z.string()).max(5).optional().describe('Micro-actions (max 5)'),
  alternatives: z.array(z.string()).max(5).optional().describe('Options to compare'),
  goal: z.string().optional().describe('Session goal (set on first thought)'),
  quickExtension: z.object({
    type: z.enum(['critique', 'elaboration', 'correction', 'alternative_scenario', 'assumption_testing', 'innovation', 'optimization', 'polish']),
    content: z.string(),
    impact: z.enum(['low', 'medium', 'high', 'blocker']).optional(),
  }).optional().describe('Inline extension (replaces extend_thought)'),
  isRevision: z.boolean().optional().describe('Revising previous thought?'),
  revisesThought: z.number().int().min(1).optional().describe('Which thought to revise'),
  branchFromThought: z.number().int().min(1).optional().describe('Branch point'),
  branchId: z.string().optional().describe('Branch identifier'),
  showTree: z.boolean().optional().describe('Show ASCII tree'),
};

server.registerTool('think', { title: 'Think', description: THINK_DESCRIPTION, inputSchema: thinkSchema },
  async (args) => {
    try {
      const result = thinkingService.processThought({
        thought: args.thought as string,
        nextThoughtNeeded: args.nextThoughtNeeded as boolean,
        thoughtNumber: args.thoughtNumber as number,
        totalThoughts: args.totalThoughts as number,
        isRevision: args.isRevision as boolean | undefined,
        revisesThought: args.revisesThought as number | undefined,
        branchFromThought: args.branchFromThought as number | undefined,
        branchId: args.branchId as string | undefined,
        confidence: args.confidence as number | undefined,
        subSteps: args.subSteps as string[] | undefined,
        alternatives: args.alternatives as string[] | undefined,
        goal: args.goal as string | undefined,
        quickExtension: args.quickExtension as QuickExtension | undefined,
      });

      if (result.isError) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.errorMessage}` }], isError: true };
      }

      // Progress bar
      const current = result.thoughtNumber;
      const total = result.totalThoughts;
      const filled = Math.round((current / total) * 10);
      const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      // Status detection
      const hasBlocker = result.warning?.includes('BLOCKER') || result.warning?.includes('STAGNATION');
      const status = hasBlocker ? 'BLOCKED' : result.warning ? 'WARNING' : 'OK';
      const nearEnd = current >= total - 1;
      const nextAction = hasBlocker ? 'revise' : nearEnd ? 'think_done' : 'continue';

      // Conditional tree - ONLY when explicitly requested
      const showTree = args.showTree === true;

      // v5.0.1: Show systemAdvice ONLY when there are real issues
      const conf = result.averageConfidence ?? 10;
      const hasRealIssue = status !== 'OK' || conf < 7;
      const showAdvice = hasRealIssue && result.systemAdvice;

      const text = [
        result.sessionGoal ? `🎯 ${result.sessionGoal}\n` : '',
        `[${progressBar}] ${current}/${total}`,
        result.averageConfidence ? ` | conf: ${result.averageConfidence}/10` : '',
        result.warning ? `\n⚠️ ${result.warning}` : '',
        showTree ? `\n\n${result.thoughtTree}` : '',
        showAdvice ? `\n${result.systemAdvice}` : '',
        result.nudge ? `\n💡 ${result.nudge}` : '',
        `\n[${status}|next:${nextAction}]`,
      ].filter(Boolean).join('');

      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// 2. THINK_BATCH - Bulk submit thoughts
// ============================================

const THINK_BATCH_DESCRIPTION = `Burst Thinking - submit complete reasoning chain in one call.

Input: goal (min 10 chars), thoughts [1-30], consolidation (optional).

Constraints:
- IF similarity > 60% THEN reject "Stagnation"
- IF thought < 50 chars THEN reject "Too short"
- IF avg_confidence < 4 THEN warn

Validation: atomic (all or nothing).`;

const burstExtensionSchema = z.object({
  type: z.enum(['critique', 'elaboration', 'correction', 'alternative_scenario', 'assumption_testing', 'innovation', 'optimization', 'polish']),
  content: z.string(),
  impact: z.enum(['low', 'medium', 'high', 'blocker']).optional(),
});

const burstThoughtSchema = z.object({
  thoughtNumber: z.number().int().min(1),
  thought: z.string().min(1),
  confidence: z.number().min(1).max(10).optional(),
  subSteps: z.array(z.string()).max(5).optional(),
  alternatives: z.array(z.string()).max(5).optional(),
  isRevision: z.boolean().optional(),
  revisesThought: z.number().int().min(1).optional(),
  branchFromThought: z.number().int().min(1).optional(),
  branchId: z.string().optional(),
  extensions: z.array(burstExtensionSchema).optional(),
});

const thinkBatchSchema = {
  goal: z.string().min(10).describe('Session goal'),
  thoughts: z.array(burstThoughtSchema).min(1).max(30).describe('Array of thoughts'),
  consolidation: z.object({
    winningPath: z.array(z.number().int().min(1)),
    summary: z.string(),
    verdict: z.enum(['ready', 'needs_more_work']),
  }).optional().describe('Optional consolidation'),
  showTree: z.boolean().optional().describe('Show ASCII tree (default: false)'),
};

server.registerTool('think_batch', { title: 'Think Batch', description: THINK_BATCH_DESCRIPTION, inputSchema: thinkBatchSchema },
  async (args) => {
    try {
      const result = thinkingService.submitSession({
        goal: args.goal as string,
        thoughts: args.thoughts as BurstThought[],
        consolidation: args.consolidation as BurstConsolidation | undefined,
      });

      if (result.status === 'rejected') {
        return { content: [{ type: 'text' as const, text: `🚫 REJECTED\n${result.validation.errors.map(e => `• ${e}`).join('\n')}` }], isError: true };
      }

      // v5.0.1: Compact output - tree only when requested
      const m = result.metrics;
      const text = [
        '✅ ACCEPTED',
        `🎯 ${args.goal}`,
        `📊 ${result.thoughtsProcessed}t | conf:${m.avgConfidence} ent:${m.avgEntropy} stag:${m.stagnationScore}`,
        result.validation.warnings.length > 0 ? `⚠️ ${result.validation.warnings.join('; ')}` : '',
        result.nudge ? `💡 ${result.nudge}` : '',
        args.showTree ? result.thoughtTree : '',
      ].filter(Boolean).join('\n');

      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// 3. THINK_DONE - Consolidate and optionally export
// ============================================

const THINK_DONE_DESCRIPTION = `Finish session with verification.

MANDATORY before final answer on complex problems.

Validation:
- IF path_has_gaps THEN reject
- IF blocker_unresolved THEN reject
- IF confidence < 5 in path THEN warn

Options: exportReport (markdown|json).`;

const thinkDoneSchema = {
  winningPath: z.array(z.number().int().min(1)).describe('Thought numbers leading to solution'),
  summary: z.string().describe('Final logic summary'),
  verdict: z.enum(['ready', 'needs_more_work']).describe('Ready for answer?'),
  constraintCheck: z.string().optional().describe('How constraints were addressed'),
  potentialFlaws: z.string().optional().describe('What could go wrong'),
  exportReport: z.enum(['markdown', 'json']).optional().describe('Export format (optional)'),
  includeMermaid: z.boolean().optional().describe('Include diagram in export'),
};

server.registerTool('think_done', { title: 'Think Done', description: THINK_DONE_DESCRIPTION, inputSchema: thinkDoneSchema },
  async (args) => {
    try {
      const result = thinkingService.consolidate({
        winningPath: args.winningPath as number[],
        summary: args.summary as string,
        constraintCheck: args.constraintCheck as string | undefined,
        potentialFlaws: args.potentialFlaws as string | undefined,
        verdict: args.verdict as 'ready' | 'needs_more_work',
      });

      if (result.status === 'error') {
        return { content: [{ type: 'text' as const, text: `Error: ${result.errorMessage}` }], isError: true };
      }

      const pa = result.pathAnalysis;
      const issues = [
        pa.lowConfidenceInPath.length > 0 ? `lowConf:#${pa.lowConfidenceInPath.join(',')}` : '',
        pa.unaddressedBlockers.length > 0 ? `blockers:#${pa.unaddressedBlockers.join(',')}` : '',
      ].filter(Boolean).join(' | ');

      let text = [
        result.canProceedToFinalAnswer ? '✅ READY' : '🛑 BLOCKED',
        `📊 Path: ${pa.pathLength}/${pa.totalThoughts} (${Math.round(pa.ignoredRatio * 100)}% ignored)`,
        issues ? `⚠️ ${issues}` : '',
        '',
        '--- STATUS ---',
        `verdict: ${result.canProceedToFinalAnswer ? 'READY' : 'BLOCKED'}`,
      ].filter(Boolean).join('\n');

      // Export if requested (merged from export_session)
      if (args.exportReport) {
        const report = thinkingService.exportSession({
          format: args.exportReport as 'markdown' | 'json',
          includeMermaid: (args.includeMermaid as boolean) ?? true,
        });
        text += '\n\n--- EXPORT ---\n' + report;
      }

      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);


// ============================================
// 4. THINK_RECALL - Unified search (session + insights)
// ============================================

const THINK_RECALL_DESCRIPTION = `Search session thoughts or past insights.

Scopes: session (default), insights (cross-session).

Mandatory usage:
- BEFORE complex_task: check insights for past patterns
- IF repeating_logic: check session for dead ends
- IF unsure_about_fact: verify established context`;

const thinkRecallSchema = {
  query: z.string().min(2).describe('Search query (fuzzy matching)'),
  scope: z.enum(['session', 'insights']).optional().default('session').describe('Where to search'),
  searchIn: z.enum(['thoughts', 'extensions', 'alternatives', 'all']).optional().default('all').describe('What to search (session only)'),
  limit: z.number().int().min(1).max(10).optional().default(3).describe('Max results'),
  threshold: z.number().min(0).max(1).optional().default(0.4).describe('Match strictness (lower = stricter)'),
};

server.registerTool('think_recall', { title: 'Think Recall', description: THINK_RECALL_DESCRIPTION, inputSchema: thinkRecallSchema },
  async (args) => {
    try {
      const scope = (args.scope as 'session' | 'insights') ?? 'session';
      const query = args.query as string;
      const limit = (args.limit as number) ?? 3;

      if (scope === 'insights') {
        // Search past insights
        const result = await thinkingService.recallInsights(query, limit);

        if (result.matches.length === 0) {
          const patternsText = result.topPatterns.length > 0
            ? `\n\n📊 Patterns in ${result.totalInsights} insights:\n${result.topPatterns.map(p => `  • ${p.keyword}: ${p.count}`).join('\n')}`
            : '';
          return { content: [{ type: 'text' as const, text: `🔍 No insights for "${query}"${patternsText}` }] };
        }

        const text = [
          `🧠 INSIGHTS for "${query}"`,
          `Found ${result.matches.length}/${result.totalInsights}`,
          '',
          ...result.matches.map((m, i) => [
            `#${i + 1} (${Math.round((1 - m.relevance) * 100)}%)`,
            `  ${m.insight.summary}`,
            `  Keywords: ${m.insight.keywords.join(', ')}`,
          ].join('\n')),
        ].join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } else {
        // Search current session
        const result = thinkingService.recallThought({
          query,
          scope: 'current',
          searchIn: (args.searchIn as 'thoughts' | 'extensions' | 'alternatives' | 'all') ?? 'all',
          limit,
          threshold: (args.threshold as number) ?? 0.4,
        });

        if (result.matches.length === 0) {
          return { content: [{ type: 'text' as const, text: `🔍 No matches for "${query}" in ${result.totalSearched} items` }] };
        }

        const text = [
          `🔍 RECALL "${query}"`,
          `Found ${result.matches.length}/${result.totalSearched}`,
          '',
          ...result.matches.map((m, i) => [
            `#${i + 1} Thought #${m.thoughtNumber} (${Math.round((1 - m.relevance) * 100)}%)`,
            `  "${m.snippet}"`,
          ].join('\n')),
        ].join('\n');

        return { content: [{ type: 'text' as const, text }] };
      }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// 5. THINK_RESET - Clear session
// ============================================

const THINK_RESET_DESCRIPTION = `Clear session. Irreversible.

TRIGGER:
- IF new_task_unrelated THEN reset
- IF all_paths_failed THEN reset

DO NOT RESET:
- IF user_says "tweak/fix/expand" THEN continue
- IF mid_execution THEN use branchFromThought instead`;

server.registerTool('think_reset', { title: 'Think Reset', description: THINK_RESET_DESCRIPTION, inputSchema: {} },
  async () => {
    try {
      const result = await thinkingService.resetSession();
      return {
        content: [{ type: 'text' as const, text: `🧹 RESET: ${result.clearedThoughts} thoughts, ${result.clearedBranches} branches cleared` }],
      };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// 6. THINK_LOGIC - Methodology Generator for Deep Logical Analysis
// ============================================

import { LogicService } from './services/logic.service.js';
import type { LogicDepth, LogicFocus, TechStack } from './types/thought.types.js';

const logicService = new LogicService();

const THINK_LOGIC_DESCRIPTION = `Generate thinking methodology for code analysis.

Output: 4-phase framework (not pre-computed results).
1. CHAIN MAPPING: Trace data flow
2. CRACK HUNTING: Find break points
3. STANDARD BENCHMARK: Compare to production standards
4. ACTION PLANNING: Document fixes

Depth: quick | standard | deep
Focus: security, performance, reliability, ux, architecture, data-flow
Stack: nestjs, prisma, ts-rest, react, redis, zod, trpc, nextjs`;

const thinkLogicSchema = {
  target: z.string().min(10).describe('What to analyze (feature, flow, component, system description)'),
  context: z.string().optional().describe('Additional context (tech stack, constraints, requirements)'),
  depth: z.enum(['quick', 'standard', 'deep']).optional().default('standard').describe('Methodology depth'),
  focus: z.array(z.enum(['security', 'performance', 'reliability', 'ux', 'architecture', 'data-flow'])).optional().describe('Focus areas to prioritize'),
  stack: z.array(z.enum(['nestjs', 'prisma', 'ts-rest', 'react', 'redis', 'zod', 'trpc', 'nextjs'])).optional().describe('Tech stacks for stack-specific checks'),
};

server.registerTool('think_logic', { title: 'Think Logic', description: THINK_LOGIC_DESCRIPTION, inputSchema: thinkLogicSchema },
  async (args) => {
    try {
      const result = logicService.analyze({
        target: args.target as string,
        context: args.context as string | undefined,
        depth: (args.depth as LogicDepth) ?? 'standard',
        focus: args.focus as LogicFocus[] | undefined,
        stack: args.stack as TechStack[] | undefined,
      });

      if (result.status === 'error') {
        return { content: [{ type: 'text' as const, text: `🚫 ERROR: ${result.errorMessage}` }], isError: true };
      }

      const text = logicService.formatAsMarkdown(result);
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// Server startup
// ============================================

async function main() {
  await thinkingService.loadSession();
  await thinkingService.loadInsights();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Think Module MCP Server v5.1.0 running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
