/**
 * ValidationService - Thought sequence and path validation
 * Stateless service - receives data as parameters
 */

import type {
  ThoughtInput,
  ThoughtRecord,
  ValidationResult,
  PathConnectivityResult,
} from '../types/thought.types.js';
import { calculateJaccardSimilarity } from '../utils/index.js';

export class ValidationService {
  /**
   * Validate thought sequence - prevent skipping steps and invalid revisions
   * Also validates revision content is meaningfully different
   * @param input - The thought input to validate
   * @param sessionThoughts - Current session thoughts
   * @param lastThoughtNumber - Last recorded thought number
   */
  validateSequence(
    input: ThoughtInput,
    sessionThoughts: ThoughtRecord[],
    lastThoughtNumber: number
  ): ValidationResult {
    // Validate revision target - can't revise future or non-existent thoughts
    if (input.isRevision && input.revisesThought !== undefined) {
      const targetThought = sessionThoughts.find((t) => t.thoughtNumber === input.revisesThought);

      if (!targetThought) {
        return {
          valid: false,
          warning: `🚫 INVALID REVISION: Cannot revise thought #${input.revisesThought} - it doesn't exist in current session. Available: ${sessionThoughts.map((t) => t.thoughtNumber).join(', ')}`,
        };
      }

      // Check revision is meaningfully different from original
      const similarity = calculateJaccardSimilarity(input.thought, targetThought.thought);
      if (similarity > 0.85) {
        return {
          valid: false,
          warning: `⚠️ SHALLOW REVISION: Your revision is ${Math.round(similarity * 100)}% similar to the original. A meaningful revision should substantially change the content. Rewrite with more significant changes.`,
        };
      }

      // Check for circular revision (revision text similar to even earlier thought)
      const earlierThoughts = sessionThoughts.filter(
        (t) => t.thoughtNumber < input.revisesThought! && !t.isRevision
      );
      for (const earlier of earlierThoughts) {
        const circularSimilarity = calculateJaccardSimilarity(input.thought, earlier.thought);
        if (circularSimilarity > 0.8) {
          return {
            valid: false,
            warning: `🔄 CIRCULAR REVISION DETECTED: Your revision is ${Math.round(circularSimilarity * 100)}% similar to thought #${earlier.thoughtNumber}. You may be going in circles. Try a genuinely new approach.`,
          };
        }
      }
    }

    // Allow revisions and branches to jump in sequence
    if (input.isRevision || input.branchFromThought) {
      return { valid: true };
    }

    // First thought is always valid
    if (lastThoughtNumber === 0) {
      return { valid: true };
    }

    const expectedNext = lastThoughtNumber + 1;
    if (input.thoughtNumber > expectedNext) {
      return {
        valid: false,
        warning: `⚠️ Sequence break detected! Expected step ${expectedNext}, got ${input.thoughtNumber}. Don't skip steps - think through each one.`,
      };
    }

    return { valid: true };
  }

  /**
   * HARD duplicate check - returns error message if duplicate found
   * Used for strict rejection before adding to history
   * @param input - The thought input to check
   * @param sessionThoughts - Current session thoughts
   */
  checkDuplicateStrict(input: ThoughtInput, sessionThoughts: ThoughtRecord[]): string | undefined {
    if (input.isRevision) return undefined; // Revisions are allowed to reuse numbers

    const exists = sessionThoughts.some((t) => t.thoughtNumber === input.thoughtNumber);

    if (exists) {
      return `🚫 REJECTED: Thought #${input.thoughtNumber} already exists in this session. Use isRevision: true to revise it, or extend_thought to add critique/elaboration.`;
    }
    return undefined;
  }

  /**
   * Validate branch source - reject if branchFromThought references non-existent thought
   * @param input - The thought input to validate
   * @param sessionThoughts - Current session thoughts
   */
  validateBranchSource(input: ThoughtInput, sessionThoughts: ThoughtRecord[]): string | undefined {
    if (!input.branchFromThought) return undefined;

    const sourceExists = sessionThoughts.some((t) => t.thoughtNumber === input.branchFromThought);

    if (!sourceExists) {
      return `🚫 INVALID BRANCH: Cannot branch from thought #${input.branchFromThought} - it doesn't exist in current session. Available thoughts: ${sessionThoughts.map((t) => t.thoughtNumber).join(', ') || 'none'}`;
    }
    return undefined;
  }

  /**
   * Validate path connectivity - ensure thoughts in winningPath are logically connected
   * Each thought must be reachable from its predecessor via sequence, branch, or revision
   * @param winningPath - Array of thought numbers in the winning path
   * @param sessionThoughts - Current session thoughts
   */
  validatePathConnectivity(
    winningPath: number[],
    sessionThoughts: ThoughtRecord[]
  ): PathConnectivityResult {
    if (winningPath.length <= 1) return { valid: true };

    const thoughtMap = new Map(sessionThoughts.map((t) => [t.thoughtNumber, t]));

    for (let i = 1; i < winningPath.length; i++) {
      const current = winningPath[i];
      const previous = winningPath[i - 1];
      const currentThought = thoughtMap.get(current);

      if (!currentThought) {
        return { valid: false, error: `Thought #${current} not found`, disconnectedAt: current };
      }

      // Build set of valid predecessors for current thought
      const validPredecessors = new Set<number>();

      // Sequential predecessor (N can follow N-1)
      validPredecessors.add(current - 1);

      // Branch source (if this thought branches from another)
      if (currentThought.branchFromThought) {
        validPredecessors.add(currentThought.branchFromThought);
      }

      // Revision target (revision can follow the thought it revises)
      if (currentThought.isRevision && currentThought.revisesThought) {
        validPredecessors.add(currentThought.revisesThought);
        // Also allow revision to follow the thought BEFORE the one it revises
        validPredecessors.add(currentThought.revisesThought - 1);
      }

      // Special case: if previous thought was revised, current can follow the revision
      const previousThought = thoughtMap.get(previous);
      if (previousThought?.isRevision && previousThought.revisesThought) {
        // Allow next sequential after revision target
        validPredecessors.add(previousThought.revisesThought + 1);
      }

      if (!validPredecessors.has(previous)) {
        return {
          valid: false,
          error: `Path discontinuity: #${current} cannot logically follow #${previous}. Valid predecessors for #${current}: [${Array.from(validPredecessors).sort((a, b) => a - b).join(', ')}]`,
          disconnectedAt: current,
        };
      }
    }

    return { valid: true };
  }
}
