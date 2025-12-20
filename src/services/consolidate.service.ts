/**
 * ConsolidateService - Meta-cognitive audit for thinking sessions
 * Stateless service - receives data as parameters
 */

import type {
  ThoughtRecord,
  ConsolidateInput,
  ConsolidateResult,
  PathConnectivityResult,
} from '../types/thought.types.js';
import { ValidationService } from './validation.service.js';

export class ConsolidateService {
  private validationService = new ValidationService();

  /**
   * Consolidate and verify the thinking process (meta-cognitive audit)
   * Forces model to synthesize, cross-check, and find contradictions
   * @param input - Consolidation input with winningPath, summary, verdict
   * @param sessionThoughts - Current session thoughts
   * @param onDeadEnd - Callback to record dead end when verdict is needs_more_work
   * @param onSuccess - Callback to save insight when verdict is ready and can proceed (v4.1.0)
   */
  consolidate(
    input: ConsolidateInput,
    sessionThoughts: ThoughtRecord[],
    onDeadEnd?: (path: number[], reason: string) => void,
    onSuccess?: (path: number[], summary: string) => void
  ): ConsolidateResult {
    const { winningPath, verdict } = input;
    const warnings: string[] = [];

    // Validate: must have thoughts to consolidate
    if (sessionThoughts.length === 0) {
      return {
        status: 'error',
        evaluation: 'Cannot consolidate empty thought history.',
        warnings: [],
        canProceedToFinalAnswer: false,
        pathAnalysis: {
          totalThoughts: 0,
          pathLength: 0,
          ignoredRatio: 0,
          lowConfidenceInPath: [],
          unaddressedBlockers: [],
          unaddressedCritical: [],
        },
        errorMessage: 'No thoughts recorded. Use sequentialthinking first.',
      };
    }

    // Validate: winning path must reference existing thoughts in current session
    const existingNumbers = new Set(sessionThoughts.map((t) => t.thoughtNumber));
    const invalidRefs = winningPath.filter((n) => !existingNumbers.has(n));
    if (invalidRefs.length > 0) {
      return {
        status: 'error',
        evaluation: `Invalid thought references in winning path: ${invalidRefs.join(', ')}`,
        warnings: [],
        canProceedToFinalAnswer: false,
        pathAnalysis: {
          totalThoughts: sessionThoughts.length,
          pathLength: winningPath.length,
          ignoredRatio: 0,
          lowConfidenceInPath: [],
          unaddressedBlockers: [],
          unaddressedCritical: [],
        },
        errorMessage: `Thoughts ${invalidRefs.join(', ')} do not exist in current session.`,
      };
    }

    // Validate: path connectivity - thoughts must be logically connected
    const connectivityCheck = this.validationService.validatePathConnectivity(
      winningPath,
      sessionThoughts
    );
    if (!connectivityCheck.valid) {
      warnings.push(`🚫 PATH DISCONTINUITY: ${connectivityCheck.error}`);
    }

    // Find low-confidence thoughts in winning path
    const lowConfidenceInPath = sessionThoughts
      .filter((t) => winningPath.includes(t.thoughtNumber))
      .filter((t) => t.confidence !== undefined && t.confidence < 5)
      .map((t) => t.thoughtNumber);

    if (lowConfidenceInPath.length > 0) {
      warnings.push(
        `⚠️ LOW CONFIDENCE: Your winning path includes thoughts with confidence < 5: #${lowConfidenceInPath.join(', ')}. Are you sure about these steps?`
      );
    }

    // Check ignored thoughts ratio
    const ignoredRatio = 1 - winningPath.length / sessionThoughts.length;
    if (ignoredRatio > 0.6) {
      warnings.push(
        `⚠️ HIGH DISCARD RATE: You are ignoring ${Math.round(ignoredRatio * 100)}% of your thoughts. Ensure you haven't missed important contradictions in discarded branches.`
      );
    }

    // Find unaddressed BLOCKER and HIGH impact critique extensions
    const unaddressedBlockers: number[] = [];
    const unaddressedCritical: number[] = [];

    for (const thought of sessionThoughts) {
      if (thought.extensions) {
        const hasBlocker = thought.extensions.some((e) => e.impact === 'blocker');
        const hasHighCritique = thought.extensions.some(
          (e) => e.impact === 'high' && e.type === 'critique'
        );

        if (winningPath.includes(thought.thoughtNumber)) {
          const hasRevision = sessionThoughts.some(
            (t) => t.isRevision && t.revisesThought === thought.thoughtNumber
          );

          if (hasBlocker && !hasRevision) {
            unaddressedBlockers.push(thought.thoughtNumber);
          }
          if (hasHighCritique && !hasRevision) {
            unaddressedCritical.push(thought.thoughtNumber);
          }
        }
      }
    }

    if (unaddressedBlockers.length > 0) {
      warnings.push(
        `🚫 UNADDRESSED BLOCKERS: Thoughts #${unaddressedBlockers.join(', ')} have BLOCKER extensions but no revisions. You MUST address these before proceeding.`
      );
    }

    if (unaddressedCritical.length > 0) {
      warnings.push(
        `⚠️ UNADDRESSED CRITICAL: Thoughts #${unaddressedCritical.join(', ')} have HIGH impact critiques but no revisions. Address these issues with isRevision: true.`
      );
    }

    // Check for missing revisions in winningPath
    const missingRevisions: number[] = [];
    for (const thought of sessionThoughts) {
      if (!winningPath.includes(thought.thoughtNumber)) continue;
      if (!thought.extensions) continue;

      const hasCritical = thought.extensions.some(
        (e) => (e.impact === 'high' || e.impact === 'blocker') && e.type === 'critique'
      );
      if (!hasCritical) continue;

      const revision = sessionThoughts.find(
        (t) => t.isRevision && t.revisesThought === thought.thoughtNumber
      );
      if (revision && !winningPath.includes(revision.thoughtNumber)) {
        missingRevisions.push(thought.thoughtNumber);
      }
    }

    if (missingRevisions.length > 0) {
      warnings.push(
        `🚫 MISSING REVISIONS IN PATH: Thoughts #${missingRevisions.join(', ')} have critical critiques with revisions, but those revisions are NOT in your winningPath. Include the revision thoughts or remove the flawed originals.`
      );
    }

    // Check for empty or too short winning path
    if (winningPath.length === 0) {
      warnings.push('⚠️ EMPTY PATH: No thoughts selected in winning path. This seems wrong.');
    } else if (winningPath.length < 2 && sessionThoughts.length > 3) {
      warnings.push(
        '⚠️ SUSPICIOUSLY SHORT PATH: Only 1 thought selected from a longer chain. Did you skip important reasoning?'
      );
    }

    // Determine if can proceed
    const hasBlockerWarnings = unaddressedBlockers.length > 0;
    const hasCriticalWarnings = unaddressedCritical.length > 0;
    const hasMissingRevisions = missingRevisions.length > 0;
    const hasPathDiscontinuity = !connectivityCheck.valid;
    const canProceed =
      verdict === 'ready' &&
      !hasBlockerWarnings &&
      !hasCriticalWarnings &&
      !hasMissingRevisions &&
      !hasPathDiscontinuity &&
      warnings.length <= 1;

    // Generate evaluation message
    let evaluation: string;
    if (canProceed) {
      evaluation =
        '✅ SYNTHESIS ACCEPTED: Your reasoning chain is coherent. You may proceed to final answer.';

      // v4.1.0: Save insight via callback on successful consolidation
      if (onSuccess) {
        onSuccess(winningPath, input.summary);
      }
    } else if (verdict === 'needs_more_work') {
      evaluation =
        '🔄 ACKNOWLEDGED: You identified this needs more work. Continue with sequentialthinking or extend_thought.';

      // Record dead end via callback
      if (onDeadEnd) {
        onDeadEnd(winningPath, input.summary);
      }
    } else {
      evaluation = `⚠️ SYNTHESIS REJECTED: ${warnings.length} issue(s) found. Address them before providing final answer.`;
    }

    // Log consolidation
    console.error(
      `🎯 Consolidation: verdict=${verdict}, path=[${winningPath.join(',')}], warnings=${warnings.length}, canProceed=${canProceed}`
    );

    return {
      status: 'success',
      evaluation,
      warnings,
      canProceedToFinalAnswer: canProceed,
      pathAnalysis: {
        totalThoughts: sessionThoughts.length,
        pathLength: winningPath.length,
        ignoredRatio: Math.round(ignoredRatio * 100) / 100,
        lowConfidenceInPath,
        unaddressedBlockers,
        unaddressedCritical,
        disconnectedAt: connectivityCheck.disconnectedAt
          ? [connectivityCheck.disconnectedAt]
          : undefined,
      },
    };
  }
}
