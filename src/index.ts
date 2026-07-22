#!/usr/bin/env node
/**
 * Think Module MCP Server v5.6.0
 * Streamlined thinking tools: 7 tools
 * 
 * v5.6.0: Actionable model guidance + durable cycle finalization
 * v5.5.1: Fixed mojibake text + refreshed README
 * v5.5.0: Added think_cycle + hard quality standard gates
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
 * - think_cycle: Adaptive external reasoning cycle with a hard process gate
 * - think_logic: Deep logical analysis of any task/feature/system
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ThinkingService } from './services/thinking.service.js';
import { CycleService } from './services/cycle.service.js';
import { RuntimeStateService } from './services/runtime-state.service.js';
import { formatLogicMethodology } from './services/logic.service.js';

const runtimeState = new RuntimeStateService();
const thinkingService = new ThinkingService(runtimeState);
const cycleService = new CycleService(thinkingService, runtimeState);

const server = new McpServer({
  name: 'think-module-server',
  version: '5.6.0',
});

// ============================================
// 1. THINK - Single thought with optional inline extension
// ============================================

const THINK_DESCRIPTION = `Add one evolving reasoning step. Use for iterative work, revisions, or branches.

Whole chain ready -> think_batch. Enforced multi-pass gate -> think_cycle. Code-audit checklist -> think_logic.

Returns progress, surfaced guidance, and one next action.`;

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
  }).optional().describe('Inline extension (replaces separate extension tool)'),
  isRevision: z.boolean().optional().describe('Revising previous thought?'),
  revisesThought: z.number().int().min(1).optional().describe('Which thought to revise'),
  branchFromThought: z.number().int().min(1).optional().describe('Branch point'),
  branchId: z.string().optional().describe('Branch identifier'),
  showTree: z.boolean().optional().describe('Show ASCII tree'),
  scopeId: z.string().optional().describe('Shared reasoning scope id (allowed only on thoughtNumber=1)'),
};

server.registerTool('think', { title: 'Think', description: THINK_DESCRIPTION, inputSchema: thinkSchema, annotations: { openWorldHint: false } },
  async (args) => {
    try {
      const result = thinkingService.processThought(args);

      if (result.isError) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.errorMessage}` }], isError: true };
      }

      // Progress bar
      const current = result.thoughtNumber;
      const total = result.totalThoughts;
      const filled = Math.round((current / total) * 10);
      const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      // Status detection
      const guidance = [result.warning, result.systemAdvice].filter((item): item is string => Boolean(item));
      const hasBlocker = guidance.some((item) => /BLOCKER|STAGNATION|CRITICAL|PRE-CONSOLIDATION AUDIT/.test(item));
      const status = hasBlocker ? 'BLOCKED' : guidance.length > 0 ? 'WARNING' : 'OK';
      const nextAction = hasBlocker ? 'revise' : result.nextThoughtNeeded ? 'continue' : 'think_done';

      // Conditional tree - ONLY when explicitly requested
      const showTree = args.showTree === true;

      const text = [
        result.scopeId ? `scope: ${result.scopeId}\n` : '',
        current === 1 && result.sessionGoal ? `🎯 ${result.sessionGoal}\n` : '',
        `[${progressBar}] ${current}/${total}`,
        result.averageConfidence ? ` | conf: ${result.averageConfidence}/10` : '',
        result.warning ? `\n⚠️ ${result.warning}` : '',
        showTree ? `\n\n${result.thoughtTree}` : '',
        result.systemAdvice ? `\n${result.systemAdvice}` : '',
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

const THINK_BATCH_DESCRIPTION = `Submit an already-complete reasoning chain atomically. For exploration use think or think_cycle.

Rejects thoughts under 50 chars or over 60% similarity; warns when average confidence is below 4.`;

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
    winningPath: z.array(z.number().int().min(1)).min(1),
    summary: z.string().min(1),
    verdict: z.enum(['ready', 'needs_more_work']),
  }).optional().describe('Optional consolidation'),
  showTree: z.boolean().optional().describe('Show ASCII tree (default: false)'),
  scopeId: z.string().optional().describe('Shared reasoning scope id'),
};

server.registerTool('think_batch', { title: 'Think Batch', description: THINK_BATCH_DESCRIPTION, inputSchema: thinkBatchSchema, annotations: { openWorldHint: false } },
  async (args) => {
    try {
      const result = thinkingService.submitSession(args);

      if (result.status === 'rejected') {
        return { content: [{ type: 'text' as const, text: `🚫 REJECTED\n${result.validation.errors.map(e => `• ${e}`).join('\n')}` }], isError: true };
      }

      // v5.0.1: Compact output - tree only when requested
      const m = result.metrics;
      const text = [
        '✅ ACCEPTED',
        result.scopeId ? `scope: ${result.scopeId}` : '',
        `🎯 ${args.goal}`,
        `📊 ${result.thoughtsProcessed}t${m.avgConfidence === undefined ? '' : ` | conf:${m.avgConfidence}`} | ent:${m.avgEntropy} stag:${m.stagnationScore}`,
        result.validation.warnings.length > 0 ? `⚠️ ${result.validation.warnings.join('; ')}` : '',
        result.nudge ? `💡 ${result.nudge}` : '',
        args.showTree ? result.thoughtTree : '',
        'next:think_done',
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

const THINK_DONE_DESCRIPTION = `Verify and close a think/think_batch scope before a complex final answer.

For think_cycle use action=finalize. Rejects path gaps or unresolved blockers and returns the next correction.`;

const thinkDoneSchema = {
  winningPath: z.array(z.number().int().min(1)).min(1).describe('Thought numbers leading to solution'),
  summary: z.string().min(1).describe('Final logic summary'),
  verdict: z.enum(['ready', 'needs_more_work']).describe('Ready for answer?'),
  exportReport: z.enum(['markdown', 'json']).optional().describe('Export format (optional)'),
  includeMermaid: z.boolean().optional().describe('Include diagram in export'),
  scopeId: z.string().optional().describe('Explicit think scope id (defaults to active scope)'),
};

server.registerTool('think_done', { title: 'Think Done', description: THINK_DONE_DESCRIPTION, inputSchema: thinkDoneSchema, annotations: { openWorldHint: false } },
  async (args) => {
    try {
      const activeScopeId = runtimeState.getActiveScopeId();
      const targetScopeId = args.scopeId ?? activeScopeId;
      if (args.scopeId && !runtimeState.hasScope(args.scopeId)) {
        return {
          content: [{ type: 'text' as const, text: `scope: ${args.scopeId}\nError: Unknown scopeId: ${args.scopeId}` }],
          isError: true,
        };
      }

      const restoreActiveScope = args.scopeId !== undefined && targetScopeId !== activeScopeId;
      thinkingService.restoreRuntimeScope(
        targetScopeId,
        targetScopeId ? runtimeState.getThinkState(targetScopeId) : undefined
      );

      try {
        const result = thinkingService.consolidate(args);
        const scopeLine = targetScopeId ? `scope: ${targetScopeId}` : '';

        if (result.status === 'error') {
          return {
            content: [{ type: 'text' as const, text: [scopeLine, `Error: ${result.errorMessage}`].filter(Boolean).join('\n') }],
            isError: true,
          };
        }

        const pa = result.pathAnalysis;
        const issues = [
          pa.lowConfidenceInPath.length > 0 ? `lowConf:#${pa.lowConfidenceInPath.join(',')}` : '',
          pa.unaddressedBlockers.length > 0 ? `blockers:#${pa.unaddressedBlockers.join(',')}` : '',
        ].filter(Boolean).join(' | ');

        let text = [
          scopeLine,
          result.canProceedToFinalAnswer ? '✅ READY' : '🛑 BLOCKED',
          `📊 Path: ${pa.pathLength}/${pa.totalThoughts} (${Math.round(pa.ignoredRatio * 100)}% ignored)`,
          issues ? `⚠️ ${issues}` : '',
          '',
          '--- STATUS ---',
          `verdict: ${result.canProceedToFinalAnswer ? 'READY' : 'BLOCKED'}`,
        ].filter(Boolean).join('\n');

        text += '\n' + (result.canProceedToFinalAnswer
          ? 'next: final_answer'
          : [
              ...(result.warnings.length > 0 ? result.warnings.slice(0, 2) : [result.evaluation])
                .map((warning) => `issue: ${warning}`),
              'next: think, then retry think_done',
            ].join('\n'));

        // Export if requested (merged export flow)
        if (args.exportReport) {
          const report = thinkingService.exportSession({
            format: args.exportReport,
            includeMermaid: args.includeMermaid ?? true,
          });
          text += '\n\n--- EXPORT ---\n' + report;
        }

        return { content: [{ type: 'text' as const, text }] };
      } finally {
        if (restoreActiveScope) {
          thinkingService.restoreRuntimeScope(
            activeScopeId,
            activeScopeId ? runtimeState.getThinkState(activeScopeId) : undefined
          );
          if (runtimeState.getActiveScopeId() !== activeScopeId) {
            runtimeState.setActiveScope(activeScopeId);
            await runtimeState.flush();
          }
        }
      }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);


// ============================================
// 4. THINK_RECALL - Unified search (session + insights)
// ============================================

const THINK_RECALL_DESCRIPTION = `Read-only search of an active/explicit scope or saved insights.

Use before repeating work or relying on prior reasoning.`;

const thinkRecallSchema = {
  query: z.string().min(2).describe('Search query (fuzzy matching)'),
  scope: z.enum(['session', 'insights']).optional().default('session').describe('Where to search'),
  searchIn: z.enum(['thoughts', 'extensions', 'alternatives', 'all']).optional().default('all').describe('What to search (session only)'),
  limit: z.number().int().min(1).max(10).optional().default(3).describe('Max results'),
  threshold: z.number().min(0).max(1).optional().default(0.4).describe('Match strictness (lower = stricter)'),
  scopeId: z.string().optional().describe('Explicit scope id (session recall only)'),
};

server.registerTool('think_recall', { title: 'Think Recall', description: THINK_RECALL_DESCRIPTION, inputSchema: thinkRecallSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
  async (args) => {
    try {
      const scope = args.scope ?? 'session';
      const query = args.query;
      const limit = args.limit ?? 3;
      const explicitScopeId = args.scopeId;

      if (scope === 'session' && explicitScopeId && !runtimeState.hasScope(explicitScopeId)) {
        return {
          content: [{ type: 'text' as const, text: `Error: Unknown scopeId: ${explicitScopeId}` }],
          isError: true,
        };
      }

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
        const targetScopeId = explicitScopeId ?? runtimeState.getActiveScopeId();
        const thinkThoughts = targetScopeId
          ? thinkingService.getThoughtsForScope(targetScopeId)
          : thinkingService.getThoughtsForScope();
        const cycleThoughts = targetScopeId
          ? await cycleService.getThoughtsForScope(targetScopeId)
          : [];
        const result = thinkingService.recallThought({
          query,
          scope: 'current',
          searchIn: args.searchIn ?? 'all',
          limit,
          threshold: args.threshold ?? 0.4,
          scopeId: targetScopeId,
        }, [...thinkThoughts, ...cycleThoughts]);

        if (result.matches.length === 0) {
          return { content: [{ type: 'text' as const, text: `🔍 No matches for "${query}" in ${result.totalSearched} items` }] };
        }

        const text = [
          `🔍 RECALL "${query}"`,
          `Found ${result.matches.length}/${result.totalSearched}`,
          '',
          ...result.matches.map((m, i) => {
            const sourceLabel = m.source === 'cycle' ? 'Cycle thought' : 'Thought';
            return [
              `#${i + 1} ${sourceLabel} #${m.thoughtNumber} (${Math.round((1 - m.relevance) * 100)}%)`,
              `  session: ${m.sessionId ?? 'n/a'} | source: ${m.source ?? 'think'}`,
              `  "${m.snippet}"`,
            ].join('\n');
          }),
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

const THINK_RESET_DESCRIPTION = `Clear active scope. Irreversible.

TRIGGER:
- IF new_task_unrelated THEN reset
- IF all_paths_failed THEN reset

DO NOT RESET:
- IF user_says "tweak/fix/expand" THEN continue
- IF mid_execution THEN use branchFromThought instead`;

server.registerTool('think_reset', { title: 'Think Reset', description: THINK_RESET_DESCRIPTION, inputSchema: {}, annotations: { openWorldHint: false } },
  async () => {
    try {
      const activeScopeId = runtimeState.getActiveScopeId();
      const result = await thinkingService.resetSession(activeScopeId);
      const targetScopeId = activeScopeId ?? result.scopeId;
      const clearedCycleSessions = targetScopeId
        ? await cycleService.resetScope(targetScopeId)
        : 0;
      if (targetScopeId) {
        runtimeState.removeScope(targetScopeId);
        await runtimeState.flush();
      }
      const nextScopeId = runtimeState.getActiveScopeId();
      thinkingService.restoreRuntimeScope(
        nextScopeId,
        nextScopeId ? runtimeState.getThinkState(nextScopeId) : undefined
      );
      return {
        content: [{
          type: 'text' as const,
          text: `RESET: ${result.clearedThoughts} thoughts, ${result.clearedBranches} branches, ${clearedCycleSessions} cycle sessions cleared${targetScopeId ? ` (scope ${targetScopeId})` : ''}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// 6. THINK_CYCLE - Adaptive external reasoning loop with hard gate
// ============================================

const THINK_CYCLE_DESCRIPTION = `Run an enforced multi-pass reasoning loop for high-risk or ambiguous work.

Start once, then follow the single returned next step until the gate passes; finish with action=finalize. If start had constraints, include constraintCheck. For ordinary iterative work use think. Do not use think_done for a cycle.

Interop:
- backendMode=auto: mirror to think backend with fallback
- backendMode=think: strict think backend mode (no fallback)
- backendMode=independent: standalone cycle only`;

const thinkCycleSchema = {
  action: z.enum(['start', 'step', 'status', 'finalize', 'reset']).describe('Cycle action'),
  sessionId: z.string().optional().describe('Cycle session id (required except start)'),
  scopeId: z.string().optional().describe('Shared reasoning scope id (start only)'),
  goal: z.string().min(10).optional().describe('Goal for start action'),
  context: z.string().max(3000).optional().describe('Additional context'),
  constraints: z.array(z.string()).max(20).optional().describe('Constraints list'),
  thought: z.string().min(20).optional().describe('Thought content for step action'),
  thoughtType: z.enum(['decompose', 'alternative', 'critique', 'synthesis', 'verification', 'revision']).optional().describe('Optional thought type override'),
  confidence: z.number().min(1).max(10).optional().describe('Confidence for step thought (stability is reported after two scored steps)'),
  finalAnswer: z.string().min(30).optional().describe('Final answer candidate for finalize'),
  constraintCheck: z.string().max(3000).optional().describe('For finalize with constraints: map each constraint to evidence or a verification step'),
  backendMode: z.enum(['auto', 'independent', 'think']).optional().describe('Interop backend mode'),
  maxLoops: z.number().int().min(10).max(30).optional().describe('Loop budget'),
  showTrace: z.boolean().optional().describe('Show expanded trace'),
  exportReport: z.enum(['markdown', 'json']).optional().describe('Export format for finalize'),
  includeMermaid: z.boolean().optional().describe('Include Mermaid diagram in finalize export'),
};

server.registerTool('think_cycle', { title: 'Think Cycle', description: THINK_CYCLE_DESCRIPTION, inputSchema: thinkCycleSchema, annotations: { openWorldHint: false } },
  async (args) => {
    try {
      const result = await cycleService.handle(args);

      const text = JSON.stringify(result);
      return {
        content: [{ type: 'text' as const, text }],
        isError: result.status === 'error',
      };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
    }
  }
);

// ============================================
// 7. THINK_LOGIC - Methodology Generator for Deep Logical Analysis
// ============================================

const THINK_LOGIC_DESCRIPTION = `Return a read-only code-analysis checklist. It does not inspect code, store progress, or produce findings.

Use only when a model needs a methodology; use think or think_cycle to perform the analysis.`;

const thinkLogicSchema = {
  target: z.string().min(10).describe('What to analyze (feature, flow, component, system description)'),
  context: z.string().optional().describe('Additional context (tech stack, constraints, requirements)'),
  depth: z.enum(['quick', 'standard', 'deep']).optional().default('standard').describe('Methodology depth'),
  focus: z.array(z.enum(['security', 'performance', 'reliability', 'ux', 'architecture', 'data-flow'])).optional().describe('Focus areas to prioritize'),
  stack: z.array(z.enum(['nestjs', 'prisma', 'ts-rest', 'react', 'redis', 'zod', 'trpc', 'nextjs'])).optional().describe('Tech stacks for stack-specific checks'),
};

server.registerTool('think_logic', { title: 'Think Logic', description: THINK_LOGIC_DESCRIPTION, inputSchema: thinkLogicSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
  async (args) => {
    try {
      const [text, isError] = formatLogicMethodology(args);
      if (isError) {
        return { content: [{ type: 'text' as const, text }], isError: true };
      }
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
  await cycleService.initialize();
  await runtimeState.initialize({
    currentThinkState: thinkingService.getRuntimeBootstrapState(),
    cycleSessions: cycleService.getSessionsForBootstrap(),
  });
  await thinkingService.clearLegacySession();
  const activeScopeId = runtimeState.getActiveScopeId();
  thinkingService.restoreRuntimeScope(
    activeScopeId,
    activeScopeId ? runtimeState.getThinkState(activeScopeId) : undefined
  );
  await cycleService.reconcileRuntimeScopes();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Think Module MCP Server v5.6.0 running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
