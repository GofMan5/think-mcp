/**
 * StagnationService - Detection of repetitive thinking patterns
 * Stateless service - receives data as parameters
 */

import type { ThoughtRecord } from '../types/thought.types.js';
import {
  STAGNATION_CHECK_COUNT,
  MIN_ENTROPY_THRESHOLD,
  getStagnationThreshold,
} from '../constants/index.js';
import { calculateJaccardSimilarity, calculateWordEntropy } from '../utils/index.js';

export class StagnationService {
  /**
   * Detect stagnation - repeated similar thoughts with improved detection
   * Uses Jaccard similarity and entropy analysis
   * @param newThought - The new thought text to check
   * @param thoughtHistory - Full thought history
   */
  detectStagnation(newThought: string, thoughtHistory: ThoughtRecord[]): string | undefined {
    if (thoughtHistory.length < STAGNATION_CHECK_COUNT) return undefined;

    const recent = thoughtHistory.slice(-STAGNATION_CHECK_COUNT);

    // Jaccard similarity check - more accurate than substring comparison
    // Use adaptive threshold: stricter as session progresses
    const adaptiveThreshold = getStagnationThreshold(thoughtHistory.length);
    const similarities = recent.map((t) => calculateJaccardSimilarity(newThought, t.thought));
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const allHighlySimilar = similarities.every((s) => s >= adaptiveThreshold);

    if (allHighlySimilar && newThought.trim().length > 20) {
      return `🛑 STAGNATION: Last ${STAGNATION_CHECK_COUNT} thoughts ${Math.round(avgSimilarity * 100)}% similar. Different approach needed.`;
    }

    // Entropy check - detect low vocabulary diversity
    const newEntropy = calculateWordEntropy(newThought);
    const avgRecentEntropy =
      recent.reduce((sum, t) => sum + calculateWordEntropy(t.thought), 0) / recent.length;

    if (newEntropy < MIN_ENTROPY_THRESHOLD && avgRecentEntropy < MIN_ENTROPY_THRESHOLD) {
      return `🛑 LOW ENTROPY: Vocabulary repetitive (${newEntropy.toFixed(2)}). Rephrase with different concepts.`;
    }

    // Check for declining confidence
    const recentWithConf = recent.filter((t) => t.confidence !== undefined);
    if (recentWithConf.length >= 3) {
      const isDecreasing = recentWithConf.every((t, i) => {
        if (i === 0) return true;
        return (t.confidence ?? 10) <= (recentWithConf[i - 1].confidence ?? 10);
      });
      const avgRecent =
        recentWithConf.reduce((sum, t) => sum + (t.confidence ?? 0), 0) / recentWithConf.length;

      if (isDecreasing && avgRecent < 5) {
        return `⚠️ CONFIDENCE DROP: Avg ${avgRecent.toFixed(1)}. Use extend_thought:critique`;
      }
    }

    return undefined;
  }
}
