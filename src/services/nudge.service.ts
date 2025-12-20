/**
 * NudgeService - Proactive micro-prompts for self-reflection
 * Version 1.0.0
 * 
 * Generates short, actionable nudges based on pattern detection.
 * Returns ONE nudge per call (first matching rule wins).
 */

import type { ThoughtRecord, ThoughtInput } from '../types/thought.types.js';

/** Nudge rules in priority order */
const NUDGE_RULES = [
  {
    id: 'blocker_unresolved',
    check: (input: ThoughtInput, history: ThoughtRecord[]): boolean => {
      // Check if any thought has blocker extension without revision
      for (const t of history) {
        if (!t.extensions) continue;
        const hasBlocker = t.extensions.some(e => e.impact === 'blocker');
        if (hasBlocker) {
          const hasRevision = history.some(r => r.isRevision && r.revisesThought === t.thoughtNumber);
          if (!hasRevision) return true;
        }
      }
      return false;
    },
    nudge: 'Blocker unresolved. Address before continuing?',
  },
  {
    id: 'low_confidence',
    check: (input: ThoughtInput): boolean => {
      return (input.confidence ?? 10) < 5;
    },
    nudge: 'Low confidence. Validate assumptions?',
  },
  {
    id: 'no_alternatives',
    check: (_input: ThoughtInput, history: ThoughtRecord[]): boolean => {
      // 3+ thoughts without any alternatives
      if (history.length < 3) return false;
      const recent = history.slice(-3);
      return recent.every(t => !t.alternatives || t.alternatives.length === 0);
    },
    nudge: 'No alternatives explored. Tunnel vision?',
  },
  {
    id: 'complex_no_breakdown',
    check: (input: ThoughtInput, history: ThoughtRecord[]): boolean => {
      // Complex goal (>10 words) but no subSteps in recent thoughts
      if (history.length < 2) return false;
      const goalWords = (input.goal ?? '').split(/\s+/).length;
      if (goalWords < 10) return false;
      const recent = history.slice(-2);
      return recent.every(t => !t.subSteps || t.subSteps.length === 0);
    },
    nudge: 'Complex goal, no breakdown. Decompose?',
  },
];

export class NudgeService {
  /**
   * Generate nudge based on current thought and history
   * Returns undefined if no pattern matches or if shouldSkip is true
   */
  generateNudge(
    input: ThoughtInput,
    history: ThoughtRecord[],
    shouldSkip: boolean = false
  ): string | undefined {
    // Skip if already have warnings/advice (avoid noise)
    if (shouldSkip) return undefined;
    
    // Skip on first thought (not enough context)
    if (history.length === 0) return undefined;

    // Check rules in priority order, return first match
    for (const rule of NUDGE_RULES) {
      if (rule.check(input, history)) {
        return rule.nudge;
      }
    }

    return undefined;
  }

  /**
   * Generate nudge for batch submission
   * Analyzes final state of session
   */
  generateBatchNudge(
    avgConfidence: number,
    thoughtCount: number,
    hasAlternatives: boolean,
    hasBlockers: boolean
  ): string | undefined {
    if (hasBlockers) return 'Unresolved blockers in session.';
    if (avgConfidence < 5) return 'Low avg confidence. Review weak points?';
    if (thoughtCount >= 5 && !hasAlternatives) return 'No alternatives in session. Consider options?';
    return undefined;
  }
}
