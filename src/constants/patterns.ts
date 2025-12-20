/**
 * Pattern constants for content analysis
 * Used by CoachingService and StagnationService
 */

// Proactive Coach patterns for lens recommendations (v2.9.1)
export const OPTIMIZATION_TRIGGERS = [
  'todo', 'fixme', 'hack', 'потом', 'позже', 'оптимизировать', 'рефакторинг',
  'медленно', 'память', 'performance', 'slow', 'memory', 'refactor', 'cleanup',
  'технический долг', 'tech debt', 'временное решение', 'workaround',
];

export const UNCERTAINTY_TRIGGERS = [
  'возможно', 'наверное', 'думаю что', 'скорее всего', 'предполагаю',
  'может быть', 'вероятно', 'не уверен', 'perhaps', 'maybe', 'probably',
  'i think', 'i assume', 'might be', 'could be', 'not sure', 'uncertain',
];

// Common filler phrases and stop words to normalize out for stagnation/entropy detection
export const FILLER_PHRASES = [
  // English filler phrases
  'in this step', 'i will', 'let me', 'now i', 'first', 'next', 'then',
  'carefully', 'analyze', 'consider', 'looking at', 'examining', 'reviewing',
  'based on', 'according to', 'as we can see', 'it appears that',
  // English stop words
  'the', 'a', 'an', 'of', 'is', 'to', 'and', 'or', 'but', 'in', 'on', 'at',
  'for', 'with', 'this', 'that', 'it', 'be', 'are', 'was', 'were', 'been',
  // Russian stop words
  'и', 'в', 'на', 'с', 'по', 'к', 'у', 'о', 'из', 'за', 'от', 'до',
  'то', 'что', 'это', 'как', 'для', 'не', 'но', 'да', 'же', 'ли', 'бы',
];
