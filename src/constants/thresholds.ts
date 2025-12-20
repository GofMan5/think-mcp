/**
 * Configuration constants for ThinkingService
 * Extracted from thinking.service.ts for modularity
 */

// Session file path constants
export const SESSION_FILE_NAME = 'thought_session.json';

// Context retention
export const RETAIN_FULL_THOUGHTS = 5; // Keep last N thoughts in full detail
export const RECENT_THOUGHTS_COUNT = 3; // Number of recent thoughts to weight higher
export const RECENT_WEIGHT_MULTIPLIER = 2; // Weight multiplier for last 3 thoughts in confidence calc

// Stagnation detection
export const STAGNATION_CHECK_COUNT = 3; // Check last N thoughts for similarity
export const SIMILARITY_THRESHOLD = 50; // Compare first N chars for stagnation
export const MIN_ENTROPY_THRESHOLD = 0.25; // Minimum word entropy before warning
export const JACCARD_STAGNATION_BASE = 0.6; // Base Jaccard threshold (lenient at start)
export const JACCARD_STAGNATION_MAX = 0.85; // Maximum threshold (strict at end)
export const JACCARD_DEPTH_FACTOR = 0.015; // Increase threshold by this per thought

/**
 * Calculate adaptive stagnation threshold based on session depth
 * Early thoughts: more lenient (0.6), later thoughts: stricter (up to 0.85)
 * Formula: threshold = BASE + min(MAX - BASE, thoughtCount * FACTOR)
 * @param thoughtCount - Number of thoughts in current session
 */
export function getStagnationThreshold(thoughtCount: number): number {
  const increase = Math.min(
    JACCARD_STAGNATION_MAX - JACCARD_STAGNATION_BASE,
    thoughtCount * JACCARD_DEPTH_FACTOR
  );
  return JACCARD_STAGNATION_BASE + increase;
}

// Legacy constant for backward compatibility
export const JACCARD_STAGNATION_THRESHOLD = 0.75;

// Lateral thinking triggers
export const LINEAR_THINKING_THRESHOLD = 6; // Thoughts before lateral thinking warning
export const ESCALATING_PRESSURE_INTERVAL = 3; // Every N thoughts, increase pressure
export const MAX_THOUGHTS_BUDGET = 12; // Complexity budget - warn to consolidate after this many thoughts

// Proactive Coach thresholds
export const POLISH_THRESHOLD_CONFIDENCE = 8; // Recommend polish when confidence >= this
export const INNOVATION_THRESHOLD_THOUGHTS = 8; // Recommend innovation after this many thoughts
export const MIN_THOUGHT_LENGTH = 50; // Minimum thought length before warning
export const LOW_CONFIDENCE_THRESHOLD = 5; // Confidence below this triggers advice
export const NO_CRITIQUE_THRESHOLD = 5; // Warn about missing critique after N thoughts

// Pre-Consolidation Audit thresholds
export const DEPTH_METRIC_SIMPLE = 100; // Min avg thought length for simple tasks (<=5 thoughts)
export const DEPTH_METRIC_MEDIUM = 150; // Min avg thought length for medium tasks (6-10 thoughts)
export const DEPTH_METRIC_COMPLEX = 200; // Min avg thought length for complex tasks (11+ thoughts)

// Session management
export const SESSION_TTL_HOURS = 24; // Auto-reset session after this many hours
export const COACH_COOLDOWN_COUNT = 3; // Don't repeat same advice within N thoughts
export const SMART_PRUNING_THRESHOLD = 10; // Start pruning context after N thoughts

// Dead ends tracking
export const MAX_DEAD_ENDS = 20; // Limit dead ends to prevent memory bloat
export const NEAR_LIMIT_CONFIDENCE_THRESHOLD = 6; // Warn if near limit with low confidence

// Recall defaults
export const RECALL_DEFAULT_LIMIT = 3;
export const RECALL_DEFAULT_THRESHOLD = 0.4;
export const RECALL_SNIPPET_CONTEXT = 100; // Characters before/after match for snippet

// Technical short terms whitelist for entropy calculation (not filtered by length)
export const TECHNICAL_SHORT_TERMS = new Set([
  'api', 'ui', 'db', 'id', 'io', 'os', 'ip', 'url', 'css', 'sql', 'xml', 'jwt', 'mcp',
  'cli', 'sdk', 'cdn', 'dns', 'ssh', 'ssl', 'tls', 'http', 'json', 'yaml', 'toml',
]);
