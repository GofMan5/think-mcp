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
 */
const METHODOLOGY = {
  chainMapping: {
    title: '🔍 PHASE 1: CHAIN MAPPING',
    purpose: 'Trace the complete path of data/control flow',
    method: [
      '1. IDENTIFY THE TRIGGER: What initiates this flow? (user action, event, schedule, API call)',
      '2. FOLLOW THE DATA: At each step, ask:',
      '   - What data enters this step?',
      '   - What transformation happens?',
      '   - What data exits to the next step?',
      '   - What side effects occur? (DB write, API call, state change)',
      '3. MAP EVERY BRANCH: Don\'t just trace happy path. Map:',
      '   - Error paths (what happens when X fails?)',
      '   - Edge cases (empty input, null, timeout)',
      '   - Async boundaries (where does sync become async?)',
      '4. FIND THE EXIT: Where does the flow end? What\'s returned/emitted?',
      '5. DRAW IT: Write the chain as: A → B → C → D (include error branches)',
    ],
  },

  crackHunting: {
    title: '💥 PHASE 2: CRACK HUNTING',
    purpose: 'Find where the chain can break',
    method: [
      'For EACH step in your chain, apply these lenses:',
      '',
      '**ASSUMPTION LENS:**',
      '- What assumptions does this step make about input?',
      '- What if those assumptions are violated?',
      '- Is the assumption validated or just trusted?',
      '',
      '**FAILURE LENS:**',
      '- What external dependencies can fail? (DB, API, network, disk)',
      '- What happens to the flow when this step fails?',
      '- Is the failure handled or does it propagate?',
      '- Can partial failure leave inconsistent state?',
      '',
      '**CONCURRENCY LENS:**',
      '- What if this is called twice simultaneously?',
      '- Is there shared mutable state?',
      '- Are there race conditions between read and write?',
      '',
      '**BOUNDARY LENS:**',
      '- Where does trusted become untrusted? (user input, external API)',
      '- Is data validated at EVERY trust boundary?',
      '- Can malicious input reach this step?',
      '',
      '**RESOURCE LENS:**',
      '- What resources are acquired? (connections, memory, locks)',
      '- Are they released on ALL paths? (success, error, timeout)',
      '- Can resources leak or exhaust?',
    ],
  },

  standardBenchmark: {
    title: '✨ PHASE 3: STANDARD BENCHMARK',
    purpose: 'Compare against production-grade requirements',
    method: [
      'For the ENTIRE flow, verify these qualities:',
      '',
      '**RELIABILITY:**',
      '- Can the system recover from any single failure?',
      '- Is there graceful degradation or hard crash?',
      '- Are errors user-friendly or raw stack traces?',
      '',
      '**OBSERVABILITY:**',
      '- Can you trace a request through the entire chain?',
      '- Are important events logged with context?',
      '- Can you debug production issues from logs alone?',
      '',
      '**CONSISTENCY:**',
      '- Is data consistent after any failure scenario?',
      '- Are related operations atomic (all or nothing)?',
      '- Can the system end up in an invalid state?',
      '',
      '**PERFORMANCE:**',
      '- Is work done only once or repeated unnecessarily?',
      '- Are expensive operations (DB, API) minimized?',
      '- Does it scale with load or degrade?',
      '',
      '**SECURITY:**',
      '- Is every entry point authenticated/authorized?',
      '- Is sensitive data protected in transit and at rest?',
      '- Can the flow be abused? (injection, overflow, DoS)',
    ],
  },

  actionPlanning: {
    title: '🎯 PHASE 4: ACTION PLANNING',
    purpose: 'Document and prioritize fixes',
    method: [
      'For each crack found:',
      '',
      '1. **LOCATE**: Exact file, function, line where the crack exists',
      '2. **CLASSIFY**: ',
      '   - Blocker: System unusable, data loss, security breach',
      '   - High: Major feature broken, bad UX, performance issue',
      '   - Medium: Edge case fails, minor inconsistency',
      '   - Low: Code smell, potential future issue',
      '3. **ROOT CAUSE**: WHY does this crack exist? (not just WHAT)',
      '4. **FIX**: Specific code change, not vague "improve error handling"',
      '5. **VERIFY**: How to confirm the fix works (test case, scenario)',
      '6. **PREVENT**: How to prevent similar cracks (lint rule, pattern, review)',
    ],
  },
};


/**
 * Focus-specific thinking prompts
 * These add DEPTH to specific areas, not replace the core methodology
 */
const FOCUS_PROMPTS: Record<LogicFocus, string[]> = {
  security: [
    'SECURITY FOCUS: For each step, ask:',
    '- Who can reach this code? Should they be able to?',
    '- What damage could malicious input cause here?',
    '- What secrets/sensitive data flow through here?',
  ],
  performance: [
    'PERFORMANCE FOCUS: For each step, ask:',
    '- How many times does this execute per request?',
    '- What\'s the Big O complexity? Can it explode?',
    '- Is this work necessary or can it be cached/skipped?',
  ],
  reliability: [
    'RELIABILITY FOCUS: For each step, ask:',
    '- What\'s the blast radius if this fails?',
    '- How does the system behave under partial failure?',
    '- Is there a fallback or graceful degradation?',
  ],
  ux: [
    'UX FOCUS: For each user-facing step, ask:',
    '- What does the user see during this operation?',
    '- How long can this take? Is there feedback?',
    '- What does the user see on error? Can they recover?',
  ],
  architecture: [
    'ARCHITECTURE FOCUS: For the overall design, ask:',
    '- Does each component have ONE clear responsibility?',
    '- Can components be tested in isolation?',
    '- Are dependencies explicit and injectable?',
  ],
  'data-flow': [
    'DATA FLOW FOCUS: For each data transformation, ask:',
    '- Is the data shape validated before use?',
    '- Can data become stale? How is it refreshed?',
    '- Is there a single source of truth?',
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
