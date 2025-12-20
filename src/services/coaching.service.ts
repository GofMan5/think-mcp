/**
 * CoachingService - Proactive coaching and lateral thinking triggers
 * Stateful service - owns recentAdvices for cooldown tracking
 */

import type { ThoughtInput, ThoughtRecord } from '../types/thought.types.js';
import {
  LINEAR_THINKING_THRESHOLD,
  ESCALATING_PRESSURE_INTERVAL,
  MAX_THOUGHTS_BUDGET,
  POLISH_THRESHOLD_CONFIDENCE,
  INNOVATION_THRESHOLD_THOUGHTS,
  DEPTH_METRIC_SIMPLE,
  DEPTH_METRIC_MEDIUM,
  DEPTH_METRIC_COMPLEX,
  MIN_THOUGHT_LENGTH,
  LOW_CONFIDENCE_THRESHOLD,
  NO_CRITIQUE_THRESHOLD,
  COACH_COOLDOWN_COUNT,
  SMART_PRUNING_THRESHOLD,
  NEAR_LIMIT_CONFIDENCE_THRESHOLD,
  MIN_ENTROPY_THRESHOLD,
} from '../constants/index.js';
import { OPTIMIZATION_TRIGGERS, UNCERTAINTY_TRIGGERS } from '../constants/index.js';
import { calculateWordEntropy } from '../utils/index.js';

export class CoachingService {
  /** Coach cooldown - track recent advices to prevent spam */
  private recentAdvices: string[] = [];

  /**
   * Reset coaching state (call on session reset)
   */
  reset(): void {
    this.recentAdvices = [];
  }

  /**
   * Add advice with cooldown - prevents spam of same advice
   * Returns true if advice was added, false if on cooldown
   */
  addAdviceWithCooldown(advice: string, nudges: string[]): boolean {
    const adviceKey = advice.substring(0, 30);
    if (this.recentAdvices.includes(adviceKey)) {
      return false;
    }
    nudges.push(advice);
    this.recentAdvices.push(adviceKey);
    if (this.recentAdvices.length > COACH_COOLDOWN_COUNT) {
      this.recentAdvices.shift();
    }
    return true;
  }

  /**
   * LATERAL THINKING TRIGGER with escalating pressure
   * @param sessionThoughts - Current session thoughts
   * @param branches - Map of branch ID to branch thoughts
   * @param isFinishing - True if nextThoughtNeeded=false (v5.0.1)
   */
  checkLateralThinking(
    sessionThoughts: ThoughtRecord[],
    branches: Map<string, ThoughtRecord[]>,
    isFinishing: boolean = false
  ): string | undefined {
    const thoughtCount = sessionThoughts.length;
    const advices: string[] = [];

    // Self-checklist: remind about subSteps ONLY when finishing session (v5.0.1)
    if (isFinishing && thoughtCount >= 2) {
      const prevThought = sessionThoughts[thoughtCount - 2];
      if (prevThought.subSteps && prevThought.subSteps.length > 0) {
        advices.push(
          `📋 SELF-CHECK: Previous thought #${prevThought.thoughtNumber} had ${prevThought.subSteps.length} sub-steps: [${prevThought.subSteps.join(', ')}]. Did you complete them all?`
        );
      }
    }

    // Check for forgotten branches
    if (branches.size > 0 && thoughtCount > 3) {
      const recentThoughts = sessionThoughts.slice(-3);
      const recentBranchIds = new Set(recentThoughts.filter((t) => t.branchId).map((t) => t.branchId));

      for (const branchId of branches.keys()) {
        if (!recentBranchIds.has(branchId)) {
          advices.push(
            `🌿 FORGOTTEN BRANCH: You have an open branch "${branchId}" that hasn't been touched in 3+ thoughts. Consider integrating it into your solution or explicitly closing it via consolidate.`
          );
          break;
        }
      }
    }

    // Check for declining entropy
    if (thoughtCount >= 3) {
      const recentThoughts = sessionThoughts.slice(-3);
      const entropies = recentThoughts.map((t) => calculateWordEntropy(t.thought));
      const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
      const isDecreasing = entropies[2] < entropies[1] && entropies[1] < entropies[0];

      if (avgEntropy < MIN_ENTROPY_THRESHOLD || (isDecreasing && entropies[2] < 0.3)) {
        advices.push(
          `📉 ENTROPY DECLINING: Your recent thoughts show decreasing vocabulary diversity (avg: ${avgEntropy.toFixed(2)}). This may indicate repetitive thinking. Try expressing your reasoning with different words or explore a new angle.`
        );
      }
    }

    // Linear thinking check
    if (thoughtCount >= LINEAR_THINKING_THRESHOLD) {
      const hasExtensions = sessionThoughts.some((t) => t.extensions && t.extensions.length > 0);
      const hasBranches = sessionThoughts.some((t) => t.branchFromThought !== undefined);

      if (!hasExtensions && !hasBranches) {
        const pressureLevel =
          Math.floor((thoughtCount - LINEAR_THINKING_THRESHOLD) / ESCALATING_PRESSURE_INTERVAL) + 1;

        if (pressureLevel === 1) {
          advices.push(
            '💡 LATERAL THINKING: Your reasoning appears too linear. Consider using extend_thought with "critique" or create a branch.'
          );
        } else if (pressureLevel === 2) {
          advices.push(
            '⚠️ LATERAL WARNING: Still no branches or critiques. STRONGLY consider using extend_thought with "assumption_testing".'
          );
        } else {
          advices.push(
            `🚨 CRITICAL: ${thoughtCount} thoughts with ZERO lateral exploration. STOP and critique your approach.`
          );
        }
      }
    }

    // Complexity Budget
    if (thoughtCount >= MAX_THOUGHTS_BUDGET) {
      const overBudget = thoughtCount - MAX_THOUGHTS_BUDGET;
      if (overBudget === 0) {
        advices.push(
          `💰 COMPLEXITY BUDGET: You've reached ${MAX_THOUGHTS_BUDGET} thoughts. Consider calling consolidate_and_verify to synthesize your reasoning.`
        );
      } else if (overBudget <= 3) {
        advices.push(
          `⚠️ OVER BUDGET: ${thoughtCount} thoughts without consolidation. Time to wrap up - call consolidate_and_verify NOW.`
        );
      } else {
        advices.push(
          `🚨 ANALYSIS PARALYSIS: ${thoughtCount} thoughts is excessive. STOP adding thoughts and call consolidate_and_verify immediately!`
        );
      }
    }

    // Proactive coach advice
    const coachAdvice = this.generateProactiveCoachAdvice(sessionThoughts);
    if (coachAdvice) {
      advices.push(coachAdvice);
    }

    return advices.length > 0 ? advices.join('\n') : undefined;
  }

  /**
   * PROACTIVE COACH - Analyzes thought content and recommends strategic lenses
   * v5.0.1: Returns undefined if confidence >= 8 (no need for coaching)
   */
  generateProactiveCoachAdvice(sessionThoughts: ThoughtRecord[]): string | undefined {
    if (sessionThoughts.length === 0) return undefined;

    const lastThought = sessionThoughts[sessionThoughts.length - 1];
    
    // v5.0.1: Skip coaching if high confidence - user knows what they're doing
    if (lastThought.confidence && lastThought.confidence >= 8) {
      return undefined;
    }
    
    const allContent = sessionThoughts.map((t) => t.thought.toLowerCase()).join(' ');
    const lastContent = lastThought.thought.toLowerCase();

    const existingExtensions = new Set<string>();
    sessionThoughts.forEach((t) => {
      t.extensions?.forEach((e) => existingExtensions.add(e.type));
    });

    // OPTIMIZATION recommendation
    if (!existingExtensions.has('optimization')) {
      const hasOptimizationTrigger = OPTIMIZATION_TRIGGERS.some(
        (trigger) => lastContent.includes(trigger) || allContent.includes(trigger)
      );
      if (hasOptimizationTrigger) {
        return '🎯 COACH: Detected optimization opportunity (TODO/tech debt/performance mention). Consider using extend_thought with type "optimization" to analyze Before/After improvements.';
      }
    }

    // ASSUMPTION TESTING recommendation
    if (!existingExtensions.has('assumption_testing')) {
      const uncertaintyCount = UNCERTAINTY_TRIGGERS.filter((trigger) =>
        lastContent.includes(trigger)
      ).length;
      if (uncertaintyCount >= 2) {
        return '🎯 COACH: Detected uncertain language ("maybe", "probably", "I think"). Consider using extend_thought with type "assumption_testing" to validate your hypotheses.';
      }
    }

    // POLISH recommendation
    if (!existingExtensions.has('polish')) {
      const isNearEnd = lastThought.thoughtNumber >= lastThought.totalThoughts - 1;
      const hasHighConfidence =
        lastThought.confidence && lastThought.confidence >= POLISH_THRESHOLD_CONFIDENCE;
      if (isNearEnd && hasHighConfidence) {
        return '🎯 COACH: You\'re near completion with high confidence. Consider using extend_thought with type "polish" to check edge cases, typing, and documentation before finalizing.';
      }
    }

    // INNOVATION recommendation
    if (!existingExtensions.has('innovation') && sessionThoughts.length >= INNOVATION_THRESHOLD_THOUGHTS) {
      const hasBranches = sessionThoughts.some((t) => t.branchFromThought !== undefined);
      if (!hasBranches) {
        return '🎯 COACH: Long session without exploring alternatives. Consider using extend_thought with type "innovation" to find new directions or "white spots" in your solution.';
      }
    }

    return undefined;
  }

  /**
   * PROACTIVE NUDGES - Enhanced coaching based on current thought
   */
  generateProactiveNudges(input: ThoughtInput, sessionThoughts: ThoughtRecord[]): string | undefined {
    const nudges: string[] = [];

    // Short thought detection
    if (input.thought.length < MIN_THOUGHT_LENGTH && input.nextThoughtNeeded) {
      this.addAdviceWithCooldown(
        `⚠️ SHORT THOUGHT: Only ${input.thought.length} chars. Expand with implementation details or potential risks.`,
        nudges
      );
    }

    // Low confidence nudge
    if (input.confidence && input.confidence < LOW_CONFIDENCE_THRESHOLD) {
      this.addAdviceWithCooldown(
        `💡 LOW CONFIDENCE (${input.confidence}/10): Consider using quickExtension with type "critique" or "assumption_testing" to explore why you're uncertain.`,
        nudges
      );
    }

    // Missing critique check
    if (sessionThoughts.length >= NO_CRITIQUE_THRESHOLD) {
      const hasCritique = sessionThoughts.some((t) => t.extensions?.some((e) => e.type === 'critique'));
      if (!hasCritique) {
        this.addAdviceWithCooldown(
          `🧐 NO SELF-CRITIQUE: ${sessionThoughts.length} thoughts without challenging your assumptions. Use quickExtension: {type: "critique", content: "..."} to validate your approach.`,
          nudges
        );
      }
    }

    // Smart pruning reminder
    if (sessionThoughts.length >= SMART_PRUNING_THRESHOLD) {
      this.addAdviceWithCooldown(
        `🧹 LONG SESSION (${sessionThoughts.length} thoughts): Context is being auto-pruned. Consider consolidate_and_verify soon.`,
        nudges
      );
    }

    // Near-limit warning
    if (
      input.thoughtNumber >= input.totalThoughts - 1 &&
      input.confidence &&
      input.confidence < NEAR_LIMIT_CONFIDENCE_THRESHOLD
    ) {
      this.addAdviceWithCooldown(
        `⚠️ NEAR LIMIT: You're at thought ${input.thoughtNumber}/${input.totalThoughts} with low confidence (${input.confidence}/10). Consider increasing totalThoughts or using needsMoreThoughts: true.`,
        nudges
      );
    }

    return nudges.length > 0 ? nudges.join('\n') : undefined;
  }

  /**
   * PRE-CONSOLIDATION AUDIT - Quality gate before finishing session
   */
  performPreConsolidationAudit(sessionThoughts: ThoughtRecord[]): string | undefined {
    if (sessionThoughts.length === 0) return undefined;

    const auditWarnings: string[] = [];

    // SUBSTEPS COMPLETION CHECK
    const allSubSteps: { thoughtNum: number; steps: string[] }[] = [];
    sessionThoughts.forEach((t) => {
      if (t.subSteps && t.subSteps.length > 0) {
        allSubSteps.push({ thoughtNum: t.thoughtNumber, steps: t.subSteps });
      }
    });

    if (allSubSteps.length > 0) {
      const totalSteps = allSubSteps.reduce((sum, s) => sum + s.steps.length, 0);
      const thoughtsWithSteps = allSubSteps.map((s) => `#${s.thoughtNum}`).join(', ');
      auditWarnings.push(
        `📋 SUBSTEPS AUDIT: You defined ${totalSteps} sub-steps in thoughts ${thoughtsWithSteps}. Before finishing, verify all were addressed.`
      );
    }

    // DEPTH METRIC CHECK
    const avgLength =
      sessionThoughts.reduce((sum, t) => sum + t.thought.length, 0) / sessionThoughts.length;
    const thoughtCount = sessionThoughts.length;

    let requiredDepth: number;
    let complexityLevel: string;
    if (thoughtCount <= 5) {
      requiredDepth = DEPTH_METRIC_SIMPLE;
      complexityLevel = 'simple';
    } else if (thoughtCount <= 10) {
      requiredDepth = DEPTH_METRIC_MEDIUM;
      complexityLevel = 'medium';
    } else {
      requiredDepth = DEPTH_METRIC_COMPLEX;
      complexityLevel = 'complex';
    }

    if (avgLength < requiredDepth) {
      auditWarnings.push(
        `🔬 DEPTH AUDIT: Average thought length (${Math.round(avgLength)} chars) is below threshold for ${complexityLevel} tasks (${requiredDepth} chars). Consider adding 'elaboration' extensions for key thoughts.`
      );
    }

    // BLOCKER GATE CHECK
    const unresolvedBlockers: number[] = [];
    sessionThoughts.forEach((t) => {
      if (t.extensions) {
        const hasBlocker = t.extensions.some(
          (e) => e.impact === 'blocker' || (e.impact === 'high' && e.type === 'critique')
        );
        if (hasBlocker) {
          const hasRevision = sessionThoughts.some(
            (rev) => rev.isRevision && rev.revisesThought === t.thoughtNumber
          );
          if (!hasRevision) {
            unresolvedBlockers.push(t.thoughtNumber);
          }
        }
      }
    });

    if (unresolvedBlockers.length > 0) {
      auditWarnings.push(
        `🛑 BLOCKER AUDIT: Thoughts #${unresolvedBlockers.join(', ')} have unresolved critical issues. Create revisions before calling consolidate_and_verify.`
      );
    }

    if (auditWarnings.length > 0) {
      auditWarnings.unshift('⚡ PRE-CONSOLIDATION AUDIT (finishing session):');
      auditWarnings.push(
        '💡 TIP: Address these items or call consolidate_and_verify to formally close the session.'
      );
    }

    return auditWarnings.length > 0 ? auditWarnings.join('\n') : undefined;
  }
}
