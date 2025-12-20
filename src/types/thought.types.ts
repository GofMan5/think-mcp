/**
 * Type definitions for sequential thinking module
 * Version 3.3.0 - Memory Edition
 */

// Extension types for vertical thinking (deep-dive)
export type ExtensionType = 
  | 'critique' 
  | 'elaboration' 
  | 'correction' 
  | 'alternative_scenario'
  | 'assumption_testing'   // Tests hypotheses and validates assumptions
  // Strategic Lens types (v2.9.0)
  | 'innovation'           // Ideation: find gaps, propose new features/directions
  | 'optimization'         // Performance, memory, code reduction, readability
  | 'polish';              // Edge cases, typing, docs, naming, SOLID/DRY compliance

export type ImpactLevel = 'high' | 'medium' | 'low' | 'blocker';

/** Metadata attached by server for internal tracking */
export interface ThoughtMetadata {
  /** True if thought was auto-corrected by system */
  wasAutoCorrected?: boolean;
  /** Normalized word entropy (0-1, higher = more diverse) */
  normalizedEntropy?: number;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
}

export interface ThoughtExtension {
  type: ExtensionType;
  content: string;
  impact: ImpactLevel;
  timestamp: string;
}

export interface ExtendThoughtInput {
  targetThoughtNumber: number;
  extensionType: ExtensionType;
  content: string;
  impactOnFinalResult: ImpactLevel;
}

export interface ExtendThoughtResult {
  status: 'success' | 'error';
  targetThought?: string;
  totalExtensionsOnThisThought?: number;
  systemAdvice: string;
  errorMessage?: string;
}

export interface ThoughtInput {
  thought: string;
  nextThoughtNeeded: boolean;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  /** Confidence score (1-10) for this thought step */
  confidence?: number;
  /** Micro-steps: detailed action plan within this thought (max 5) */
  subSteps?: string[];
  /** Quick alternatives comparison without creating branches */
  alternatives?: string[];
  /** Session goal - set in first thought to maintain focus (v2.10.0) */
  goal?: string;
  /** Quick extension - add critique/elaboration inline without separate tool call (v3.1.0) */
  quickExtension?: QuickExtension;
  /** Show ASCII tree in response (v3.2.0) - default false to save tokens */
  showTree?: boolean;
}

export interface ThoughtRecord extends ThoughtInput {
  timestamp: number;
  extensions?: ThoughtExtension[];
  /** Server-attached metadata for tracking and analysis */
  metadata?: ThoughtMetadata;
  /** Session identifier for isolation (v2.11.0) */
  sessionId?: string;
}

export interface ThoughtSummary {
  thoughtNumber: number;
  thought: string;
  confidence?: number;
}

export interface ValidationResult {
  valid: boolean;
  warning?: string;
}

export interface ThinkingResult {
  [key: string]: unknown;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  branches: string[];
  thoughtHistoryLength: number;
  /** Summary of last 3 thoughts for context retention */
  contextSummary: ThoughtSummary[];
  /** ASCII tree visualization of thought structure */
  thoughtTree: string;
  /** Mermaid.js graph visualization */
  thoughtTreeMermaid?: string;
  /** Validation warning if sequence was broken */
  warning?: string;
  /** Average confidence across all thoughts */
  averageConfidence?: number;
  /** System advice for improving thinking process */
  systemAdvice?: string;
  /** Error flag - if true, thought was rejected */
  isError?: boolean;
  /** Error message when isError is true */
  errorMessage?: string;
  /** Session goal for focus retention (v2.10.0) */
  sessionGoal?: string;
  /** Proactive micro-prompt for self-reflection (v4.6.0) */
  nudge?: string;
}

/** Session data for persistence */
export interface SessionData {
  history: ThoughtRecord[];
  branches: [string, ThoughtRecord[]][];
  lastThoughtNumber: number;
  savedAt: string;
}

/** Verdict for consolidation */
export type ConsolidateVerdict = 'ready' | 'needs_more_work';

/** Quick extension for inline deep-dive (v3.1.0) */
export interface QuickExtension {
  type: ExtensionType;
  content: string;
  impact?: ImpactLevel; // defaults to 'medium'
}

/** Input for consolidate_and_verify tool */
export interface ConsolidateInput {
  winningPath: number[];
  summary: string;
  // Made optional in v3.1.0 - reduces friction for simple consolidations
  constraintCheck?: string;
  potentialFlaws?: string;
  verdict: ConsolidateVerdict;
}

/** Result from consolidate_and_verify tool */
export interface ConsolidateResult {
  status: 'success' | 'error';
  evaluation: string;
  warnings: string[];
  canProceedToFinalAnswer: boolean;
  pathAnalysis: {
    totalThoughts: number;
    pathLength: number;
    ignoredRatio: number;
    lowConfidenceInPath: number[];
    unaddressedBlockers: number[];
    /** Thoughts with high/blocker critique extensions without revision */
    unaddressedCritical: number[];
    /** Path connectivity issues (disconnected thoughts) */
    disconnectedAt?: number[];
  };
  errorMessage?: string;
}

/** Result of path connectivity validation */
export interface PathConnectivityResult {
  valid: boolean;
  error?: string;
  disconnectedAt?: number;
}


/** Options for export_session tool (v2.10.0) */
export interface ExportSessionOptions {
  format?: 'markdown' | 'json';
  includeMermaid?: boolean;
}

/** Session data extended with goal (v2.10.0) */
export interface SessionDataV2 extends SessionData {
  goal?: string;
  /** Current session ID for isolation (v2.11.0) */
  currentSessionId?: string;
}

/** Dead end - a path that was rejected (v3.3.0) */
export interface DeadEnd {
  /** The path that led to a dead end */
  path: number[];
  /** Reason why this path was rejected */
  reason: string;
  /** When this dead end was recorded */
  timestamp: string;
  /** Session ID for isolation */
  sessionId?: string;
}

/** Session data with dead ends tracking (v3.3.0) */
export interface SessionDataV3 extends SessionDataV2 {
  /** Paths that were rejected and should be avoided */
  deadEnds?: DeadEnd[];
}


// ============================================
// v3.4.0 - Recall Edition
// ============================================

/** Search scope for recall_thought */
export type RecallScope = 'current' | 'all';

/** Content type filter for recall_thought */
export type RecallSearchIn = 'thoughts' | 'extensions' | 'alternatives' | 'all';

/** Input for recall_thought tool (v3.4.0) */
export interface RecallInput {
  /** Search query - supports fuzzy matching */
  query: string;
  /** Search scope: 'current' session or 'all' history */
  scope?: RecallScope;
  /** Where to search: thoughts, extensions, alternatives, or all */
  searchIn?: RecallSearchIn;
  /** Maximum results to return (default: 3) */
  limit?: number;
  /** Fuse.js threshold 0-1, lower = stricter match (default: 0.4) */
  threshold?: number;
}

/** Single match from recall_thought */
export interface RecallMatch {
  /** Thought number where match was found */
  thoughtNumber: number;
  /** Snippet with context around the match */
  snippet: string;
  /** Full thought text (truncated if too long) */
  thought: string;
  /** Confidence score of the original thought */
  confidence?: number;
  /** Relevance score from Fuse.js (0-1, lower = better match) */
  relevance: number;
  /** Where the match was found */
  matchedIn: 'thought' | 'extension' | 'alternative' | 'subStep';
  /** Extension type if matched in extension */
  extensionType?: ExtensionType;
  /** Session ID for context */
  sessionId?: string;
}

/** Result from recall_thought tool */
export interface RecallResult {
  /** Array of matching thoughts with snippets */
  matches: RecallMatch[];
  /** Total thoughts searched */
  totalSearched: number;
  /** Original query */
  query: string;
  /** Search parameters used */
  searchParams: {
    scope: RecallScope;
    searchIn: RecallSearchIn;
    threshold: number;
  };
}


// ============================================
// v4.0.0 - Burst Thinking Edition
// ============================================

// BURST_LIMITS moved to burst.service.ts to avoid duplication (v4.2.0)

/** Single thought in a burst session */
export interface BurstThought {
  thoughtNumber: number;
  thought: string;
  confidence?: number;
  subSteps?: string[];
  alternatives?: string[];
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  extensions?: QuickExtension[];
}

/** Consolidation data for burst session */
export interface BurstConsolidation {
  winningPath: number[];
  summary: string;
  verdict: ConsolidateVerdict;
}

/** Input for submit_thinking_session tool */
export interface SubmitSessionInput {
  /** Session goal - required for burst thinking */
  goal: string;
  /** Array of thoughts (1-30) */
  thoughts: BurstThought[];
  /** Optional consolidation if ready */
  consolidation?: BurstConsolidation;
}

/** Validation metrics for burst session */
export interface BurstMetrics {
  avgConfidence: number;
  avgEntropy: number;
  avgLength: number;
  stagnationScore: number;
  thoughtCount: number;
}

/** Validation result for burst session */
export interface BurstValidation {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/** Result from submit_thinking_session tool */
export interface SubmitSessionResult {
  status: 'accepted' | 'rejected';
  sessionId: string;
  thoughtsProcessed: number;
  validation: BurstValidation;
  metrics: BurstMetrics;
  thoughtTree?: string;
  systemAdvice?: string;
  errorMessage?: string;
  /** Proactive micro-prompt for self-reflection (v4.6.0) */
  nudge?: string;
}


// ============================================
// v4.1.0 - Insights Edition (Cross-Session Learning)
// ============================================

/** Input for recall_insights tool */
export interface RecallInsightsInput {
  /** Search query for finding relevant past solutions */
  query: string;
  /** Maximum results to return (default: 3) */
  limit?: number;
}

/** Result from recall_insights tool */
export interface RecallInsightsResult {
  /** Matching insights from past sessions */
  matches: {
    /** Summary of the past solution */
    summary: string;
    /** Goal that was achieved */
    goal?: string;
    /** Keywords associated with this insight */
    keywords: string[];
    /** When this insight was recorded */
    timestamp: string;
    /** Relevance score (0-1, lower = better match) */
    relevance: number;
  }[];
  /** Total insights in storage */
  totalInsights: number;
  /** Top recurring patterns */
  topPatterns: { keyword: string; count: number }[];
}
