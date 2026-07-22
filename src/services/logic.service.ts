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

import type { LogicAnalysisInput, LogicFocus, TechStack } from '../types/thought.types.js';

const LOGIC_LIMITS = {
  maxTargetLength: 5000,
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

function appendSection(lines: string[], section: typeof METHODOLOGY[keyof typeof METHODOLOGY], content = section.method): void {
  lines.push(`## ${section.title}`, `*${section.purpose}*`, '', ...content, '');
}

/** Format the public think_logic response without building an intermediate result graph. */
export function formatLogicMethodology(input: LogicAnalysisInput): [text: string, isError: boolean] {
  if (!input.target || input.target.trim().length < LOGIC_LIMITS.minTargetLength) {
    return [`🚫 ERROR: Target must be at least ${LOGIC_LIMITS.minTargetLength} characters`, true];
  }

  const target = input.target.trim().substring(0, LOGIC_LIMITS.maxTargetLength);
  const context = input.context?.trim() ?? '';
  const depth = input.depth ?? 'standard';
  const focus = input.focus ?? [];
  const stack = input.stack ?? [];
  const lines = [
    '# LOGIC ANALYSIS METHODOLOGY',
    `**Depth:** ${depth} | **Focus:** ${focus.length > 0 ? focus.join(', ') : 'general'}`,
  ];

  if (stack.length > 0) lines.push(`**Stack:** ${stack.join(', ')}`);
  lines.push('', '## 📋 TASK', `Analyze: "${target}"${context ? ` (${context})` : ''}`, '', '---', '');

  appendSection(lines, METHODOLOGY.chainMapping);

  const crackContent = [...METHODOLOGY.crackHunting.method];
  if (focus.length > 0 && depth !== 'quick') {
    crackContent.push('', '---', '');
    for (const item of focus) crackContent.push(...FOCUS_PROMPTS[item], '');
  }
  appendSection(lines, METHODOLOGY.crackHunting, crackContent);

  if (depth !== 'quick') appendSection(lines, METHODOLOGY.standardBenchmark);
  appendSection(lines, METHODOLOGY.actionPlanning);

  if (depth === 'deep') {
    lines.push(
      '---',
      '## DEEP EVIDENCE GATE',
      '- For every finding, cite the exact source location and observed behavior.',
      '- Try to disprove the finding with one counterexample or existing safeguard.',
      '- Keep only findings that survive; label anything unverified as a hypothesis.'
    );
  }

  if (stack.length > 0) {
    lines.push('---', '## 🛠️ STACK REMINDERS');
    for (const item of stack) lines.push(...STACK_PROMPTS[item].map((reminder) => `- ${reminder}`));
  }

  return [lines.join('\n'), false];
}
