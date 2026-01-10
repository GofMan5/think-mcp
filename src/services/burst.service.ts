/**
 * BurstService - Validation and processing for burst thinking sessions
 * Stateless service - validates input and returns prepared data for commit
 */

import type {
  BurstThought,
  BurstConsolidation,
  BurstMetrics,
  ThoughtRecord,
  ThoughtExtension,
} from '../types/thought.types.js';
import { calculateWordEntropy, calculateJaccardSimilarity } from '../utils/index.js';

/** Burst validation limits */
export const BURST_LIMITS = {
  maxThoughts: 30,
  minThoughts: 1,
  maxThoughtLength: 1000,
  minThoughtLength: 50,
  maxStagnationScore: 0.6,
  minAvgEntropy: 0.25,
  minAvgConfidence: 4,
};

/** Validation result from burst service */
export interface BurstValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  metrics: BurstMetrics;
  /** Sorted thoughts ready for commit (only if passed) */
  sortedThoughts?: BurstThought[];
}

export class BurstService {
  /**
   * Validate burst thinking session
   * Returns validation result with prepared data for commit
   */
  validate(
    goal: string,
    thoughts: BurstThought[],
    consolidation?: BurstConsolidation
  ): BurstValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // === PHASE 1: Basic Validation ===
    if (!goal || goal.trim().length < 10) {
      errors.push('Goal is required and must be at least 10 characters');
    }

    if (!thoughts || thoughts.length === 0) {
      errors.push('At least 1 thought is required');
    } else if (thoughts.length > BURST_LIMITS.maxThoughts) {
      errors.push(`Too many thoughts: ${thoughts.length} > ${BURST_LIMITS.maxThoughts} max`);
    }

    // Early exit if basic validation fails
    if (errors.length > 0) {
      return {
        passed: false,
        errors,
        warnings,
        metrics: { avgConfidence: 0, avgEntropy: 0, avgLength: 0, stagnationScore: 0, thoughtCount: 0 },
      };
    }

    // === PHASE 2: Sequence Validation ===
    const sortedThoughts = [...thoughts].sort((a, b) => a.thoughtNumber - b.thoughtNumber);
    for (let i = 0; i < sortedThoughts.length; i++) {
      const expected = i + 1;
      const actual = sortedThoughts[i].thoughtNumber;
      if (actual !== expected && !sortedThoughts[i].isRevision) {
        errors.push(`Sequence break: expected thought #${expected}, got #${actual}`);
        break;
      }
    }

    // Check for duplicate thought numbers (excluding revisions)
    const nonRevisionNumbers = thoughts.filter(t => !t.isRevision).map(t => t.thoughtNumber);
    const duplicates = nonRevisionNumbers.filter((n, i) => nonRevisionNumbers.indexOf(n) !== i);
    if (duplicates.length > 0) {
      errors.push(`Duplicate thought numbers: ${[...new Set(duplicates)].join(', ')}`);
    }

    // === PHASE 3: Content Quality Validation ===
    let totalLength = 0;
    let totalEntropy = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const t of thoughts) {
      if (t.thought.length < BURST_LIMITS.minThoughtLength) {
        errors.push(`#${t.thoughtNumber} too short: ${t.thought.length} < ${BURST_LIMITS.minThoughtLength}`);
      }
      if (t.thought.length > BURST_LIMITS.maxThoughtLength) {
        warnings.push(`#${t.thoughtNumber} truncated: ${t.thought.length} > ${BURST_LIMITS.maxThoughtLength}`);
      }

      totalLength += Math.min(t.thought.length, BURST_LIMITS.maxThoughtLength);
      totalEntropy += calculateWordEntropy(t.thought);

      if (t.confidence !== undefined) {
        totalConfidence += t.confidence;
        confidenceCount++;
      }

      // Validate revision targets
      if (t.isRevision && t.revisesThought !== undefined) {
        const targetExists = thoughts.some(other => other.thoughtNumber === t.revisesThought);
        if (!targetExists) {
          errors.push(`Revision #${t.thoughtNumber} targets non-existent #${t.revisesThought}`);
        }
      }

      // Validate branch sources
      if (t.branchFromThought !== undefined) {
        const sourceExists = thoughts.some(other => other.thoughtNumber === t.branchFromThought);
        if (!sourceExists) {
          errors.push(`Branch #${t.thoughtNumber} from non-existent #${t.branchFromThought}`);
        }
      }
    }

    // === PHASE 4: Stagnation Detection (only if enough thoughts) ===
    let stagnationScore = 0;
    if (thoughts.length >= 3) {  // v5.0.1: Skip for small batches
      let totalSimilarity = 0;
      let comparisons = 0;

      for (let i = 1; i < thoughts.length; i++) {
        const similarity = calculateJaccardSimilarity(thoughts[i].thought, thoughts[i - 1].thought);
        totalSimilarity += similarity;
        comparisons++;
      }

      stagnationScore = comparisons > 0 ? totalSimilarity / comparisons : 0;

      if (stagnationScore > BURST_LIMITS.maxStagnationScore) {
        errors.push(`Stagnation: ${(stagnationScore * 100).toFixed(0)}% similarity > ${BURST_LIMITS.maxStagnationScore * 100}%`);
      }
    }

    // === PHASE 5: Calculate Metrics ===
    const avgLength = thoughts.length > 0 ? totalLength / thoughts.length : 0;
    const avgEntropy = thoughts.length > 0 ? totalEntropy / thoughts.length : 0;
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    // v5.0.1: Skip entropy warning for small batches (< 5 thoughts)
    if (avgEntropy < BURST_LIMITS.minAvgEntropy && thoughts.length >= 5) {
      warnings.push(`Low diversity: ${avgEntropy.toFixed(2)} < ${BURST_LIMITS.minAvgEntropy}`);
    }

    if (avgConfidence < BURST_LIMITS.minAvgConfidence && confidenceCount > 0) {
      warnings.push(`Low confidence: ${avgConfidence.toFixed(1)} < ${BURST_LIMITS.minAvgConfidence}`);
    }

    // === PHASE 6: Consolidation Validation ===
    if (consolidation) {
      this.validateConsolidation(consolidation, thoughts, errors, warnings);
    }

    const metrics: BurstMetrics = {
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      avgEntropy: Math.round(avgEntropy * 100) / 100,
      avgLength: Math.round(avgLength),
      stagnationScore: Math.round(stagnationScore * 100) / 100,
      thoughtCount: thoughts.length,
    };

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      metrics,
      sortedThoughts: errors.length === 0 ? sortedThoughts : undefined,
    };
  }

  /**
   * Validate consolidation data
   */
  private validateConsolidation(
    consolidation: BurstConsolidation,
    thoughts: BurstThought[],
    errors: string[],
    warnings: string[]
  ): void {
    const { winningPath, verdict } = consolidation;

    // Validate path references
    const thoughtNumbers = new Set(thoughts.map(t => t.thoughtNumber));
    const invalidRefs = winningPath.filter(n => !thoughtNumbers.has(n));
    if (invalidRefs.length > 0) {
      errors.push(`Invalid winning path references: ${invalidRefs.join(', ')}`);
    }

    // Validate path connectivity (WARNING, not ERROR)
    if (winningPath.length > 1 && invalidRefs.length === 0) {
      const thoughtMap = new Map(thoughts.map(t => [t.thoughtNumber, t]));
      const pathGaps: string[] = [];

      for (let i = 1; i < winningPath.length; i++) {
        const current = winningPath[i];
        const previous = winningPath[i - 1];
        const currentThought = thoughtMap.get(current);

        if (!currentThought) continue;

        const validPredecessors = new Set<number>([current - 1]);
        if (currentThought.branchFromThought) validPredecessors.add(currentThought.branchFromThought);
        if (currentThought.isRevision && currentThought.revisesThought) {
          validPredecessors.add(currentThought.revisesThought);
          validPredecessors.add(currentThought.revisesThought - 1);
        }

        if (!validPredecessors.has(previous)) {
          pathGaps.push(`#${previous}→#${current}`);
        }
      }

      if (pathGaps.length > 0) {
        warnings.push(`Path gaps: ${pathGaps.join(', ')}. Use branches or include intermediate thoughts.`);
      }
    }

    // Check for unaddressed blockers
    if (verdict === 'ready') {
      for (const num of winningPath) {
        const thought = thoughts.find(t => t.thoughtNumber === num);
        if (thought?.extensions) {
          const hasBlocker = thought.extensions.some(e => e.impact === 'blocker');
          if (hasBlocker) {
            const hasRevision = thoughts.some(t => t.isRevision && t.revisesThought === num);
            if (!hasRevision) {
              errors.push(`Blocker in #${num} unresolved - cannot mark ready`);
            }
          }
        }
      }
    }
  }

  /**
   * Convert BurstThought to ThoughtRecord
   */
  toThoughtRecord(
    t: BurstThought,
    totalThoughts: number,
    sessionId: string
  ): ThoughtRecord {
    return {
      thought: t.thought.substring(0, BURST_LIMITS.maxThoughtLength),
      thoughtNumber: t.thoughtNumber,
      totalThoughts,
      nextThoughtNeeded: t.thoughtNumber < totalThoughts,
      confidence: t.confidence,
      subSteps: t.subSteps,
      alternatives: t.alternatives,
      isRevision: t.isRevision,
      revisesThought: t.revisesThought,
      branchFromThought: t.branchFromThought,
      branchId: t.branchId,
      timestamp: Date.now(),
      sessionId,
      extensions: t.extensions?.map(e => ({
        type: e.type,
        content: e.content,
        impact: e.impact ?? 'medium',
        timestamp: new Date().toISOString(),
      })),
    };
  }
}
