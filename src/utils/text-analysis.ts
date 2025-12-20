/**
 * Text analysis utilities for ThinkingService
 * Pure stateless functions for text processing
 * v4.2.0 - Optimized with precompiled RegExp and word caching
 */

import { FILLER_PHRASES, TECHNICAL_SHORT_TERMS } from '../constants/index.js';

// Precompiled RegExp for filler phrases (O(1) instead of O(n) per call)
const FILLER_PATTERN = new RegExp(
  FILLER_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// Word cache for Jaccard similarity (LRU-style with size limit)
const WORD_CACHE_LIMIT = 50;
const wordCache = new Map<string, Set<string>>();

/**
 * Clear word cache (call on session reset if needed)
 */
export function clearWordCache(): void {
  wordCache.clear();
}

/**
 * Normalize text for stagnation comparison
 * Uses precompiled RegExp for O(n) instead of O(n*m)
 */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(FILLER_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate word entropy (diversity) of text
 * Returns 0-1, higher = more diverse vocabulary
 * Includes technical short terms (api, db, etc.) that would otherwise be filtered
 */
export function calculateWordEntropy(text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter((w) => 
    w.length > 2 || TECHNICAL_SHORT_TERMS.has(w)
  );
  if (words.length === 0) return 0;
  const uniqueWords = new Set(words);
  return uniqueWords.size / words.length;
}

/**
 * Get word set from text with caching
 * Uses LRU-style cache to avoid repeated parsing
 */
function getWordSet(text: string): Set<string> {
  // Check cache first
  const cached = wordCache.get(text);
  if (cached) return cached;

  // Parse words
  const words = new Set(
    normalizeForComparison(text)
      .split(/\s+/)
      .filter(w => w.length > 2 || TECHNICAL_SHORT_TERMS.has(w.toLowerCase()))
  );

  // LRU eviction if cache full
  if (wordCache.size >= WORD_CACHE_LIMIT) {
    const firstKey = wordCache.keys().next().value;
    if (firstKey) wordCache.delete(firstKey);
  }

  wordCache.set(text, words);
  return words;
}

/**
 * Calculate Jaccard similarity (0-1) between two texts
 * Uses cached word sets for repeated comparisons
 */
export function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = getWordSet(text1);
  const words2 = getWordSet(text2);

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return union > 0 ? intersection / union : 0;
}

/**
 * Sanitize text for safe Mermaid.js rendering
 * Escapes special characters that could break diagram syntax
 */
export function sanitizeForMermaid(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/-->/g, '->')
    .replace(/---/g, '--')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\|/g, '¦');
}
