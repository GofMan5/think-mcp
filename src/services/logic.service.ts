/**
 * LogicService - Pure Thinking Methodology Generator
 * Version 5.0.0 - Methodology Edition
 * 
 * PURPOSE: Teach AI HOW to think about code analysis, not WHAT to find.
 * Output is a thinking ALGORITHM that AI applies to specific code.
 * 
 * Philosophy: "Teach to fish, don't give fish"
 * - Not: "Is there N+1 query?" (specific question)
 * - But: "For each data access, ask: is this inside a loop?" (thinking pattern)
 */

import type {
  LogicAnalysisInput,
  LogicAnalysisResult,
  LogicDepth,
  LogicFocus,
  LogicMethodology,
  MethodologySection,
  TechStack,
} from '../types/thought.types.js';

const LOGIC_LIMITS = {
  maxTargetLength: 5000,
  maxContextLength: 3000,
  minTargetLength: 10,
};

/**
 * Core thinking methodology - HOW to analyze, not WHAT to find
 * v5.1.0 - Imperative style (IF/THEN, not prose)
 */
const METHODOLOGY = {
  chainMapping: {
    title: '🔍 PHASE 1: CHAIN MAPPING',
    purpose: 'Trace data/control flow',
    method: [
      '1. IDENTIFY trigger (user action? event? API? schedule?)',
      '2. TRACE each step:',
      '   → What enters?',
      '   → What transforms?',
      '   → What exits?',
      '   → What side effects? (DB, API, state)',
      '3. MAP branches:',
      '   → Error paths (X fails → ?)',
      '   → Edge cases (null, empty, timeout)',
      '   → Async boundaries',
      '4. FIND exit point',
      '5. DRAW: A → B → C → D (include error branches)',
    ],
  },

  crackHunting: {
    title: '💥 PHASE 2: CRACK HUNTING',
    purpose: 'Find break points',
    method: [
      'For EACH step:',
      '',
      'ASSUMPTION:',
      '- What assumptions about input?',
      '- What if violated?',
      '- Validated or trusted?',
      '',
      'FAILURE:',
      '- What can fail? (DB, API, network)',
      '- Handled or propagates?',
      '- Partial failure → inconsistent state?',
      '',
      'CONCURRENCY:',
      '- Called twice simultaneously?',
      '- Shared mutable state?',
      '- Race conditions?',
      '',
      'BOUNDARY:',
      '- Where trusted → untrusted?',
      '- Validated at EVERY boundary?',
      '- Malicious input reach?',
      '',
      'RESOURCE:',
      '- What acquired? (connections, memory, locks)',
      '- Released on ALL paths?',
      '- Can leak/exhaust?',
    ],
  },

  standardBenchmark: {
    title: '✨ PHASE 3: STANDARD BENCHMARK',
    purpose: 'Compare to production standards',
    method: [
      'RELIABILITY:',
      '- Recover from single failure?',
      '- Graceful degradation or crash?',
      '- User-friendly errors?',
      '',
      'OBSERVABILITY:',
      '- Trace request through chain?',
      '- Events logged with context?',
      '- Debug from logs alone?',
      '',
      'CONSISTENCY:',
      '- Data consistent after failure?',
      '- Operations atomic?',
      '- Invalid state possible?',
      '',
      'PERFORMANCE:',
      '- Work done once or repeated?',
      '- Expensive ops minimized?',
      '- Scales or degrades?',
      '',
      'SECURITY:',
      '- Every entry authenticated?',
      '- Sensitive data protected?',
      '- Abuse possible? (injection, DoS)',
    ],
  },

  actionPlanning: {
    title: '🎯 PHASE 4: ACTION PLANNING',
    purpose: 'Document fixes',
    method: [
      'For each crack:',
      '',
      '1. LOCATE: file, function, line',
      '2. CLASSIFY:',
      '   Blocker: unusable, data loss, security',
      '   High: major broken, bad UX',
      '   Medium: edge case fails',
      '   Low: code smell',
      '3. ROOT CAUSE: WHY (not WHAT)',
      '4. FIX: specific change',
      '5. VERIFY: test case',
      '6. PREVENT: lint rule, pattern',
    ],
  },
};


/**
 * Focus-specific thinking prompts
 * Imperative style - questions to ask, not explanations
 */
const FOCUS_PROMPTS: Record<LogicFocus, string[]> = {
  security: [
    'SECURITY:',
    '- Who can reach this? Should they?',
    '- What damage from malicious input?',
    '- What secrets flow through?',
  ],
  performance: [
    'PERFORMANCE:',
    '- How many times per request?',
    '- Big O? Can it explode?',
    '- Cache/skip possible?',
  ],
  reliability: [
    'RELIABILITY:',
    '- Blast radius if fails?',
    '- Partial failure behavior?',
    '- Fallback exists?',
  ],
  ux: [
    'UX:',
    '- What user sees during op?',
    '- How long? Feedback?',
    '- Error recovery possible?',
  ],
  architecture: [
    'ARCHITECTURE:',
    '- Single responsibility?',
    '- Testable in isolation?',
    '- Dependencies explicit?',
  ],
  'data-flow': [
    'DATA-FLOW:',
    '- Shape validated before use?',
    '- Can become stale?',
    '- Single source of truth?',
  ],
};

/**
 * Stack-specific considerations
 * Brief reminders, not exhaustive checklists
 */
const STACK_PROMPTS: Record<TechStack, string[]> = {
  nestjs: ['Remember: Guards for auth, Pipes for validation, Interceptors for transform, Filters for errors'],
  prisma: ['Remember: Use include for relations, $transaction for atomicity, check for N+1 in loops'],
  'ts-rest': ['Remember: Contract is source of truth, types flow from contract, validate with Zod'],
  react: ['Remember: Check useEffect deps, memoize expensive renders, cleanup subscriptions'],
  redis: ['Remember: Set TTL on all keys, invalidate on mutation, handle cache miss'],
  zod: ['Remember: Validate at boundaries, use strict mode, coerce query params'],
  trpc: ['Remember: Context for auth, invalidate queries after mutations, type-safe end-to-end'],
  nextjs: ['Remember: Server vs Client components, revalidation strategy, minimize client JS'],
};

export class LogicService {
  /**
   * Generate thinking methodology for the target
   */
  analyze(input: LogicAnalysisInput): LogicAnalysisResult {
    const warnings: string[] = [];
    
    // Validation
    if (!input.target || input.target.trim().length < LOGIC_LIMITS.minTargetLength) {
      return this.errorResult(`Target must be at least ${LOGIC_LIMITS.minTargetLength} characters`);
    }

    let target = input.target.trim();
    if (target.length > LOGIC_LIMITS.maxTargetLength) {
      target = target.substring(0, LOGIC_LIMITS.maxTargetLength);
      warnings.push(`Target truncated to ${LOGIC_LIMITS.maxTargetLength} chars`);
    }

    const context = input.context?.trim() ?? '';
    const depth: LogicDepth = input.depth ?? 'standard';
    const focus: LogicFocus[] = input.focus ?? [];
    const stack: TechStack[] = input.stack ?? [];

    // Build methodology
    const methodology = this.buildMethodology(target, context, depth, focus, stack);

    return {
      status: 'success',
      target,
      depth,
      focus,
      stack: stack.length > 0 ? stack : undefined,
      methodology,
      warnings,
    };
  }

  private buildMethodology(
    target: string,
    context: string,
    depth: LogicDepth,
    focus: LogicFocus[],
    stack: TechStack[]
  ): LogicMethodology {
    const sections: MethodologySection[] = [];

    // Phase 1: Chain Mapping (always included)
    sections.push({
      title: METHODOLOGY.chainMapping.title,
      purpose: METHODOLOGY.chainMapping.purpose,
      content: METHODOLOGY.chainMapping.method,
    });

    // Phase 2: Crack Hunting
    const crackContent = [...METHODOLOGY.crackHunting.method];
    
    // Add focus-specific prompts
    if (focus.length > 0 && depth !== 'quick') {
      crackContent.push('', '---', '');
      for (const f of focus) {
        if (FOCUS_PROMPTS[f]) {
          crackContent.push(...FOCUS_PROMPTS[f], '');
        }
      }
    }
    
    sections.push({
      title: METHODOLOGY.crackHunting.title,
      purpose: METHODOLOGY.crackHunting.purpose,
      content: crackContent,
    });

    // Phase 3: Standard Benchmark (standard and deep only)
    if (depth !== 'quick') {
      sections.push({
        title: METHODOLOGY.standardBenchmark.title,
        purpose: METHODOLOGY.standardBenchmark.purpose,
        content: METHODOLOGY.standardBenchmark.method,
      });
    }

    // Phase 4: Action Planning (always included)
    sections.push({
      title: METHODOLOGY.actionPlanning.title,
      purpose: METHODOLOGY.actionPlanning.purpose,
      content: METHODOLOGY.actionPlanning.method,
    });

    // Stack reminders (if any)
    let stackReminders: string[] | undefined;
    if (stack.length > 0) {
      stackReminders = [];
      for (const s of stack) {
        if (STACK_PROMPTS[s]) {
          stackReminders.push(...STACK_PROMPTS[s]);
        }
      }
    }

    return {
      task: `Analyze: "${target}"${context ? ` (${context})` : ''}`,
      sections,
      stackReminders,
    };
  }

  private errorResult(message: string): LogicAnalysisResult {
    return {
      status: 'error',
      target: '',
      depth: 'standard',
      focus: [],
      warnings: [],
      errorMessage: message,
    };
  }

  /**
   * Format as markdown for AI consumption
   */
  formatAsMarkdown(result: LogicAnalysisResult): string {
    if (result.status === 'error') {
      return `🚫 ERROR: ${result.errorMessage}`;
    }

    if (!result.methodology) {
      return '🚫 ERROR: No methodology generated';
    }

    const m = result.methodology;
    const lines: string[] = [];

    // Header
    lines.push(`# LOGIC ANALYSIS METHODOLOGY`);
    lines.push(`**Depth:** ${result.depth} | **Focus:** ${result.focus.length > 0 ? result.focus.join(', ') : 'general'}`);
    if (result.stack?.length) {
      lines.push(`**Stack:** ${result.stack.join(', ')}`);
    }
    lines.push('');
    lines.push(`## 📋 TASK`);
    lines.push(m.task);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Sections
    for (const section of m.sections) {
      lines.push(`## ${section.title}`);
      lines.push(`*${section.purpose}*`);
      lines.push('');
      for (const line of section.content) {
        lines.push(line);
      }
      lines.push('');
    }

    // Stack reminders
    if (m.stackReminders && m.stackReminders.length > 0) {
      lines.push('---');
      lines.push('## 🛠️ STACK REMINDERS');
      for (const reminder of m.stackReminders) {
        lines.push(`- ${reminder}`);
      }
    }

    return lines.join('\n');
  }
}
