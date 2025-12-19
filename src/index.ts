#!/usr/bin/env node
/**
 * Think Module MCP Server
 * Adaptive sequential thinking with official SDK
 * v3.4.0 - Recall Edition (fuzzy search through thought history with Fuse.js)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ThinkingService } from './services/thinking.service.js';

const thinkingService = new ThinkingService();

const server = new McpServer({
  name: 'think-module-server',
  version: '4.0.0',
});

// Adaptive tool description - guidelines, not mandates
const TOOL_DESCRIPTION = `A tool for structured problem-solving through sequential thoughts.

GUIDELINES FOR USAGE:
1. USE THIS for complex, multi-step, or ambiguous problems
2. SKIP THIS for simple fixes, typos, single-file logic updates, or boilerplate
3. If unsure, err on the side of thinking

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Multi-step solutions requiring careful reasoning

🆕 FRACTAL THINKING (v2.8.0):
- subSteps: Add micro-action plan within a thought (e.g., ["Choose DB", "Define schema", "Add indexes"])
- alternatives: Quick comparison of options without creating branches (e.g., ["JWT", "Sessions", "OAuth2"])

🆕 QUICK EXTENSION (v3.1.0):
- quickExtension: Add inline critique/elaboration without switching tools
- Example: quickExtension: {type: "critique", content: "But what about edge case X?"}

The tool returns:
- contextSummary: Last 3 thoughts to maintain focus
- thoughtTree: ASCII visualization with subSteps and alternatives
- warning: Alert if you're skipping steps (don't ignore this!)
- averageConfidence: Your overall confidence across thoughts`;

// Input schema with Zod validation
const inputSchema = {
  thought: z.string().describe('Your current thinking step - be specific and detailed'),
  nextThoughtNeeded: z.boolean().describe('True if more thinking is needed'),
  thoughtNumber: z.number().int().min(1).describe('Current thought number (sequential)'),
  totalThoughts: z.number().int().min(1).describe('Estimated total thoughts needed'),
  isRevision: z.boolean().optional().describe('True if revising previous thinking'),
  revisesThought: z.number().int().min(1).optional().describe('Which thought is being revised'),
  branchFromThought: z.number().int().min(1).optional().describe('Branching point'),
  branchId: z.string().optional().describe('Branch identifier for parallel exploration'),
  needsMoreThoughts: z.boolean().optional().describe('Signal that estimate was too low'),
  confidence: z.number().min(1).max(10).optional().describe('Confidence in this thought (1-10)'),
  subSteps: z.array(z.string()).max(5).optional().describe('Micro-action plan within this thought (max 5 items)'),
  alternatives: z.array(z.string()).max(5).optional().describe('Quick alternatives to compare without branching'),
  goal: z.string().optional().describe('Session goal - set in first thought to maintain focus throughout (v2.10.0)'),
  quickExtension: z.object({
    type: z.enum(['critique', 'elaboration', 'correction', 'alternative_scenario', 'assumption_testing', 'innovation', 'optimization', 'polish']).describe('Extension type'),
    content: z.string().describe('Extension content - be specific'),
    impact: z.enum(['low', 'medium', 'high', 'blocker']).optional().describe('Impact level (default: medium)'),
  }).optional().describe('Quick inline extension - add critique/elaboration without separate tool call (v3.1.0)'),
  showTree: z.boolean().optional().describe('Show ASCII tree in response (v3.2.0) - default false to save tokens'),
};


// Register the sequential thinking tool
server.registerTool(
  'sequentialthinking',
  {
    title: 'Sequential Thinking',
    description: TOOL_DESCRIPTION,
    inputSchema,
  },
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
        needsMoreThoughts: args.needsMoreThoughts as boolean | undefined,
        confidence: args.confidence as number | undefined,
        subSteps: args.subSteps as string[] | undefined,
        alternatives: args.alternatives as string[] | undefined,
        goal: args.goal as string | undefined,
        quickExtension: args.quickExtension as import('./types/thought.types.js').QuickExtension | undefined,
      });

      // Check for hard rejection (duplicate)
      if (result.isError) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.errorMessage}` }],
          isError: true,
        };
      }

      // v3.2.0: Conditional tree - show only when useful to save tokens
      const showTree = args.showTree as boolean | undefined;
      const hasBranches = result.branches.length > 0;
      const isFirstThought = (args.thoughtNumber as number) === 1;
      const isBranching = args.branchFromThought !== undefined;
      const shouldShowTree = showTree || isFirstThought || hasBranches || isBranching;

      // Format response with context echoing
      const responseText = [
        result.sessionGoal ? `🎯 SESSION GOAL: ${result.sessionGoal}\n` : '',
        `Step ${result.thoughtNumber}/${result.totalThoughts}`,
        result.warning ? `\n${result.warning}` : '',
        shouldShowTree 
          ? `\n\n${result.thoughtTree}` 
          : '\n\n(🌲 Tree hidden to save tokens. Use showTree: true to see it)',
        '\n\n📝 Recent Context:',
        ...result.contextSummary.map(
          (s) => `  ${s.thoughtNumber}. ${s.thought}${s.confidence ? ` [conf: ${s.confidence}]` : ''}`
        ),
        result.averageConfidence ? `\n\n📊 Avg Confidence: ${result.averageConfidence}/10` : '',
        result.systemAdvice ? `\n\n${result.systemAdvice}` : '',
        `\n\nBranches: ${hasBranches ? result.branches.join(', ') : 'none'}`,
        `Next thought needed: ${result.nextThoughtNeeded}`,
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Tool execution error:', message);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Extend thought tool description - for vertical/deep thinking
const EXTEND_TOOL_DESCRIPTION = `CRITICAL TOOL for Deep Analysis.
Use this tool ONLY when you need to "zoom in" on a specific previous thought without moving the process forward.
Do NOT use this for the next logical step. Use 'sequentialthinking' for that.

Use this tool to:
1. CRITIQUE: Find flaws in a previous thought (e.g., "Wait, step 3 didn't account for network latency").
2. ELABORATE: Add technical implementation details to a high-level plan.
3. ALTERNATIVES: Propose a "Plan B" for a specific risk identified in a previous thought.
4. CORRECTION: Fix a factual error in a previous step.
5. ASSUMPTION_TESTING: Validate hypotheses and test assumptions made in a thought.

🆕 STRATEGIC LENS (v2.9.0) - Use these for project-level improvements:
6. INNOVATION: Find "white spots", propose new features/directions. MUST include 2-3 concrete proposals.
7. OPTIMIZATION: Focus on performance, memory, code reduction. MUST include "Before vs After" comparison.
8. POLISH: Edge cases, typing, docs, naming consistency, SOLID/DRY. MUST include specific checklist items.

This tool attaches metadata to an existing thought node, making your reasoning richer and safer.`;

// Extend thought input schema
const extendInputSchema = {
  targetThoughtNumber: z.number().int().min(1).describe('The thought number you want to expand or critique.'),
  extensionType: z.enum([
    'critique', 'elaboration', 'correction', 'alternative_scenario', 'assumption_testing',
    // Strategic Lens types (v2.9.0)
    'innovation', 'optimization', 'polish'
  ]).describe('The nature of this extension.'),
  content: z.string().describe('The deep-dive content. Be specific, technical, and rigorous.'),
  impactOnFinalResult: z.enum(['high', 'medium', 'low', 'blocker']).describe('Does this extension change our final answer? If "blocker", we must stop and rethink.'),
};

// Register the extend_thought tool
server.registerTool(
  'extend_thought',
  {
    title: 'Extend Thought',
    description: EXTEND_TOOL_DESCRIPTION,
    inputSchema: extendInputSchema,
  },
  async (args) => {
    try {
      const result = thinkingService.extendThought({
        targetThoughtNumber: args.targetThoughtNumber as number,
        extensionType: args.extensionType as 'critique' | 'elaboration' | 'correction' | 'alternative_scenario',
        content: args.content as string,
        impactOnFinalResult: args.impactOnFinalResult as 'high' | 'medium' | 'low' | 'blocker',
      });

      if (result.status === 'error') {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.errorMessage}` }],
          isError: true,
        };
      }

      const responseText = [
        `🔍 Extended Thought #${args.targetThoughtNumber}`,
        `Type: ${(args.extensionType as string).toUpperCase()}`,
        `Impact: ${args.impactOnFinalResult}`,
        `Target: "${result.targetThought}"`,
        `Total extensions on this thought: ${result.totalExtensionsOnThisThought}`,
        '',
        `📋 ${result.systemAdvice}`,
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Extend thought error:', message);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Consolidate and verify tool description - for meta-cognitive audit
const CONSOLIDATE_TOOL_DESCRIPTION = `CRITICAL FINAL STEP for complex problems.
Use this tool when you believe you have explored enough thoughts to form a conclusion.

This tool performs a 'mental audit' of your thinking process:
1. SYNTHESIZE: Combine your winning path into a coherent logic chain
2. CROSS-CHECK: Verify solution against original requirements
3. FIND CONTRADICTIONS: Look for flaws in your own reasoning

⚠️ MANDATORY: DO NOT provide a final answer to complex problems without calling this tool first.

🆕 v3.1.0: constraintCheck and potentialFlaws are now OPTIONAL for faster consolidation.
Just provide winningPath, summary, and verdict for quick wrap-up.

The tool will:
- Warn if your winning path includes low-confidence thoughts
- Alert if you're ignoring too many of your own thoughts (>60%)
- BLOCK if there are unaddressed BLOCKER extensions
- Give you a clear GO/NO-GO signal

🚫 NEGATIVE CONSTRAINTS (What you MUST NOT do):
- NEVER ignore blocker critiques - if a thought has a blocker extension, your verdict MUST be 'needs_more_work' until you create a revision
- NEVER skip thoughts in winningPath - path must be logically connected (each thought must follow from previous via sequence, branch, or revision)
- NEVER proceed if canProceedToFinalAnswer is false - address ALL issues first

Only proceed to final answer if canProceedToFinalAnswer is true.`;

// Consolidate input schema - constraintCheck and potentialFlaws made optional in v3.1.0
const consolidateInputSchema = {
  winningPath: z.array(z.number().int().min(1)).describe('Sequence of thought numbers that lead to your solution (e.g., [1, 2, 5, 8])'),
  summary: z.string().describe('Concise summary of your final logic chain'),
  constraintCheck: z.string().optional().describe('(Optional) Explain how each original requirement/constraint was addressed'),
  potentialFlaws: z.string().optional().describe('(Optional) Self-criticism: what could still go wrong with this solution?'),
  verdict: z.enum(['ready', 'needs_more_work']).describe('Is your logic solid enough for a final answer?'),
};

// Register the consolidate_and_verify tool
server.registerTool(
  'consolidate_and_verify',
  {
    title: 'Consolidate and Verify',
    description: CONSOLIDATE_TOOL_DESCRIPTION,
    inputSchema: consolidateInputSchema,
  },
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
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.errorMessage}` }],
          isError: true,
        };
      }

      const responseText = [
        '🎯 CONSOLIDATION REPORT',
        '═'.repeat(40),
        '',
        result.evaluation,
        '',
        '📊 Path Analysis:',
        `  • Total thoughts: ${result.pathAnalysis.totalThoughts}`,
        `  • Winning path length: ${result.pathAnalysis.pathLength}`,
        `  • Ignored ratio: ${Math.round(result.pathAnalysis.ignoredRatio * 100)}%`,
        result.pathAnalysis.lowConfidenceInPath.length > 0
          ? `  • Low confidence in path: #${result.pathAnalysis.lowConfidenceInPath.join(', ')}`
          : '  • Low confidence in path: none',
        result.pathAnalysis.unaddressedBlockers.length > 0
          ? `  • Unaddressed blockers: #${result.pathAnalysis.unaddressedBlockers.join(', ')}`
          : '  • Unaddressed blockers: none',
        result.pathAnalysis.unaddressedCritical.length > 0
          ? `  • Unaddressed critical: #${result.pathAnalysis.unaddressedCritical.join(', ')}`
          : '  • Unaddressed critical: none',
        '',
        result.warnings.length > 0 ? '⚠️ Warnings:\n' + result.warnings.map((w) => `  ${w}`).join('\n') : '✓ No warnings',
        '',
        '═'.repeat(40),
        `VERDICT: ${result.canProceedToFinalAnswer ? '✅ PROCEED TO FINAL ANSWER' : '🛑 DO NOT PROCEED - Address issues first'}`,
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Consolidate error:', message);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Reset session tool description
const RESET_TOOL_DESCRIPTION = `Reset the thinking session and start fresh.

Use this tool when:
- Starting a completely NEW problem/task
- The previous thinking chain is no longer relevant
- You want to clear accumulated context from previous tasks

This tool will:
- Clear all recorded thoughts
- Clear all branches
- Delete the persistence file
- Reset the thought counter to 0

⚠️ WARNING: This action is irreversible. All previous thoughts will be lost.
Note: You don't need to call this manually when starting thought #1 - the system auto-resets.

🚫 DO NOT use this tool between steps of the same task!
If you need to explore alternatives, use branchFromThought parameter.
If you need to fix a mistake, use isRevision: true parameter.`;

// Register the reset_session tool
server.registerTool(
  'reset_session',
  {
    title: 'Reset Session',
    description: RESET_TOOL_DESCRIPTION,
    inputSchema: {},
  },
  async () => {
    try {
      const result = await thinkingService.resetSession();

      const responseText = [
        '🧹 SESSION RESET COMPLETE',
        '═'.repeat(30),
        '',
        `Cleared thoughts: ${result.clearedThoughts}`,
        `Cleared branches: ${result.clearedBranches}`,
        '',
        '✅ Ready for new thinking session.',
        'Start with sequentialthinking, thoughtNumber: 1',
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Reset session error:', message);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Export session tool description (v2.10.0)
const EXPORT_TOOL_DESCRIPTION = `Export current thinking session as a Markdown or JSON report.
Use after consolidate_and_verify to save session results for future reference.

The report includes:
- Session goal (if set)
- All thoughts with confidence scores
- Extensions (critiques, elaborations, strategic lens, etc.)
- Sub-steps and alternatives
- Mermaid diagram (optional)

Save the output to .kiro/decisions/ for future sessions.
In next session, use #File to load the saved report and restore context.`;

// Export session input schema
const exportInputSchema = {
  format: z.enum(['markdown', 'json']).optional().default('markdown').describe('Output format'),
  includeMermaid: z.boolean().optional().default(true).describe('Include Mermaid diagram in output'),
};

// Register the export_session tool
server.registerTool(
  'export_session',
  {
    title: 'Export Session',
    description: EXPORT_TOOL_DESCRIPTION,
    inputSchema: exportInputSchema,
  },
  async (args) => {
    try {
      const report = thinkingService.exportSession({
        format: (args.format as 'markdown' | 'json') ?? 'markdown',
        includeMermaid: (args.includeMermaid as boolean) ?? true,
      });

      return {
        content: [{ type: 'text' as const, text: report }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Export session error:', message);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Recall thought tool description (v3.4.0)
const RECALL_TOOL_DESCRIPTION = `Search through thought history using fuzzy matching.
Use this tool when you need to "remember" details from earlier thoughts.

When to use:
- You vaguely remember discussing something but forgot the details
- You need to find a specific decision or reasoning from earlier
- You want to check if you already considered something
- Session is long (10+ thoughts) and you're losing context

Parameters:
- query: What to search for (supports fuzzy matching)
- scope: 'current' (this session only) or 'all' (entire history)
- searchIn: 'thoughts', 'extensions', 'alternatives', or 'all'
- limit: Max results (default: 3)
- threshold: Match strictness 0-1, lower = stricter (default: 0.4)

Returns snippets with context around matches, not full thoughts.
This saves tokens while giving you the information you need.`;

// Recall thought input schema
const recallInputSchema = {
  query: z.string().min(2).describe('Search query - supports fuzzy matching'),
  scope: z.enum(['current', 'all']).optional().default('current').describe('Search scope: current session or all history'),
  searchIn: z.enum(['thoughts', 'extensions', 'alternatives', 'all']).optional().default('all').describe('Where to search'),
  limit: z.number().int().min(1).max(10).optional().default(3).describe('Maximum results to return'),
  threshold: z.number().min(0).max(1).optional().default(0.4).describe('Match threshold (0-1, lower = stricter)'),
};

// Register the recall_thought tool
server.registerTool(
  'recall_thought',
  {
    title: 'Recall Thought',
    description: RECALL_TOOL_DESCRIPTION,
    inputSchema: recallInputSchema,
  },
  async (args) => {
    try {
      const result = thinkingService.recallThought({
        query: args.query as string,
        scope: (args.scope as 'current' | 'all') ?? 'current',
        searchIn: (args.searchIn as 'thoughts' | 'extensions' | 'alternatives' | 'all') ?? 'all',
        limit: (args.limit as number) ?? 3,
        threshold: (args.threshold as number) ?? 0.4,
      });

      if (result.matches.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `🔍 No matches found for "${args.query}" (searched ${result.totalSearched} items)` }],
        };
      }

      const responseText = [
        `🔍 RECALL RESULTS for "${result.query}"`,
        `Found ${result.matches.length} match(es) in ${result.totalSearched} items`,
        '═'.repeat(40),
        '',
        ...result.matches.map((m, idx) => [
          `📌 Match #${idx + 1} (Thought #${m.thoughtNumber})`,
          `   Relevance: ${Math.round((1 - m.relevance) * 100)}%`,
          m.confidence ? `   Confidence: ${m.confidence}/10` : '',
          `   Found in: ${m.matchedIn}${m.extensionType ? ` (${m.extensionType})` : ''}`,
          `   Snippet: "${m.snippet}"`,
          '',
        ].filter(Boolean).join('\n')),
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Recall thought error:', message);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// ============================================
// v4.0.0 - Burst Thinking: submit_thinking_session
// ============================================

const SUBMIT_SESSION_DESCRIPTION = `Submit a complete thinking session in one call (Burst Thinking).

USE THIS when you have a complete reasoning chain ready - reduces N round-trips to 1.

Input:
- goal: Session goal (required, min 10 chars)
- thoughts: Array of 1-30 thoughts with:
  - thoughtNumber: Sequential number
  - thought: Content (min 50 chars, max 1000 chars)
  - confidence: 1-10 (optional)
  - subSteps, alternatives, extensions (optional)
  - isRevision, revisesThought (for revisions)
  - branchFromThought, branchId (for branches)
- consolidation: Optional {winningPath, summary, verdict}

Validation (atomic - all or nothing):
- Sequence check: thought numbers must be sequential
- Stagnation check: Jaccard similarity < 60% between adjacent thoughts
- Entropy check: vocabulary diversity > 0.25
- Depth check: average length > 50 chars
- Connectivity check: winning path must be logically connected

Returns:
- status: 'accepted' or 'rejected'
- sessionId: Unique session identifier
- metrics: avgConfidence, avgEntropy, avgLength, stagnationScore
- validation: {passed, errors, warnings}

⚠️ If rejected, fix ALL errors and resubmit the entire session.`;

// Quick extension schema for burst thoughts
const burstExtensionSchema = z.object({
  type: z.enum(['critique', 'elaboration', 'correction', 'alternative_scenario', 'assumption_testing', 'innovation', 'optimization', 'polish']),
  content: z.string(),
  impact: z.enum(['low', 'medium', 'high', 'blocker']).optional(),
});

// Burst thought schema
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

// Consolidation schema
const burstConsolidationSchema = z.object({
  winningPath: z.array(z.number().int().min(1)),
  summary: z.string(),
  verdict: z.enum(['ready', 'needs_more_work']),
});

// Submit session input schema
const submitSessionSchema = {
  goal: z.string().min(10).describe('Session goal - required for burst thinking'),
  thoughts: z.array(burstThoughtSchema).min(1).max(30).describe('Array of thoughts (1-30)'),
  consolidation: burstConsolidationSchema.optional().describe('Optional consolidation if ready'),
};

// Register submit_thinking_session tool
server.registerTool(
  'submit_thinking_session',
  {
    title: 'Submit Thinking Session (Burst)',
    description: SUBMIT_SESSION_DESCRIPTION,
    inputSchema: submitSessionSchema,
  },
  async (args) => {
    try {
      const result = thinkingService.submitSession({
        goal: args.goal as string,
        thoughts: args.thoughts as import('./types/thought.types.js').BurstThought[],
        consolidation: args.consolidation as import('./types/thought.types.js').BurstConsolidation | undefined,
      });

      if (result.status === 'rejected') {
        return {
          content: [{ type: 'text' as const, text: `🚫 SESSION REJECTED\n\nErrors:\n${result.validation.errors.map(e => `• ${e}`).join('\n')}\n\nFix ALL errors and resubmit.` }],
          isError: true,
        };
      }

      const responseText = [
        '✅ BURST SESSION ACCEPTED',
        '═'.repeat(40),
        '',
        `🎯 Goal: ${args.goal}`,
        `📊 Thoughts processed: ${result.thoughtsProcessed}`,
        `🆔 Session ID: ${result.sessionId.substring(0, 20)}...`,
        '',
        '📈 Metrics:',
        `  • Avg Confidence: ${result.metrics.avgConfidence}/10`,
        `  • Avg Entropy: ${result.metrics.avgEntropy}`,
        `  • Avg Length: ${result.metrics.avgLength} chars`,
        `  • Stagnation Score: ${result.metrics.stagnationScore}`,
        '',
        result.validation.warnings.length > 0 
          ? `⚠️ Warnings:\n${result.validation.warnings.map(w => `  • ${w}`).join('\n')}` 
          : '✓ No warnings',
        '',
        result.thoughtTree ? `${result.thoughtTree}` : '',
        result.systemAdvice ? `\n${result.systemAdvice}` : '',
      ].filter(Boolean).join('\n');

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Submit session error:', message);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Start server with stdio transport
async function main() {
  // Restore previous session if exists
  await thinkingService.loadSession();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Think Module MCP Server v4.0.0 (Burst Thinking Edition) running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
