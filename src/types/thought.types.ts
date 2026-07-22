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
  /** Origin of the thought when aggregating across tool modes */
  source?: 'think' | 'cycle';
}

export interface ThoughtExtension {
  type: ExtensionType;
  content: string;
  impact: ImpactLevel;
  timestamp: string;
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
  /** Runtime scope identifier for cross-tool session coordination */
  scopeId?: string;
  /** Internal identity of a cycle step mirrored into the think history */
  mirroredCycleSessionId?: string;
}

export interface ThoughtRecord extends ThoughtInput {
  timestamp: number;
  extensions?: ThoughtExtension[];
  /** Server-attached metadata for tracking and analysis */
  metadata?: ThoughtMetadata;
  /** Session identifier for isolation (v2.11.0) */
  sessionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  warning?: string;
}

export interface ThinkingResult {
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  /** ASCII tree visualization of thought structure */
  thoughtTree: string;
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
  /** Shared reasoning scope identifier */
  scopeId?: string;
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
  /** Optional explicit reasoning scope */
  scopeId?: string;
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
  /** Which reasoning mode produced the match */
  source?: 'think' | 'cycle';
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
  /** Include ASCII tree in response (default: false) */
  showTree?: boolean;
  /** Runtime scope identifier for cross-tool session coordination */
  scopeId?: string;
}

/** Validation metrics for burst session */
export interface BurstMetrics {
  avgConfidence?: number;
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
  /** Shared reasoning scope identifier */
  scopeId?: string;
}

/** Persisted think state snapshot stored inside runtime scopes */
export interface RuntimeThinkState {
  history: ThoughtRecord[];
  branches: [string, ThoughtRecord[]][];
  lastThoughtNumber: number;
  goal?: string;
  currentSessionId?: string;
  currentScopeId?: string;
  deadEnds?: DeadEnd[];
}

/** Shared runtime scope that coordinates think + cycle sessions */
export interface RuntimeScopeRecord {
  scopeId: string;
  createdAt: number;
  updatedAt: number;
  goal?: string;
  thinkSessionId?: string;
  thinkState?: RuntimeThinkState;
  cycleSessionIds: string[];
}

/** Persisted runtime coordination state */
export interface RuntimeStateData {
  schemaVersion: number;
  activeScopeId?: string;
  scopes: RuntimeScopeRecord[];
  savedAt: string;
}


// ============================================
// v4.7.0 - Logic Analysis Edition
// ============================================

/** Analysis depth for think_logic */
export type LogicDepth = 'quick' | 'standard' | 'deep';

/** Focus areas for think_logic */
export type LogicFocus = 'security' | 'performance' | 'reliability' | 'ux' | 'architecture' | 'data-flow';

/** Supported tech stacks for stack-aware analysis */
export type TechStack = 
  | 'nestjs'      // NestJS: Guards, Pipes, Interceptors, Exception Filters
  | 'prisma'      // Prisma: Transactions, Relations, N+1, Migrations
  | 'ts-rest'     // ts-rest: Contracts, Type inference, Validation
  | 'react'       // React: Hooks, State, Effects, Suspense
  | 'redis'       // Redis: Caching, Pub/Sub, TTL, Invalidation
  | 'zod'         // Zod: Schema validation, Transforms, Refinements
  | 'trpc'        // tRPC: Procedures, Context, Middleware
  | 'nextjs';     // Next.js: SSR, ISR, API Routes, Middleware

/** Input for think_logic tool */
export interface LogicAnalysisInput {
  /** What to analyze (feature, flow, component, system) */
  target: string;
  /** Additional context (tech stack, constraints, requirements) */
  context?: string;
  /** Analysis depth: quick (overview), standard (detailed), deep (exhaustive) */
  depth?: LogicDepth;
  /** Focus areas to prioritize in analysis */
  focus?: LogicFocus[];
  /** Tech stacks to apply stack-specific checks (v4.8.0) */
  stack?: TechStack[];
}

// ============================================
// v5.2.0 - Adaptive Cycle Thinking Edition
// ============================================

/** Actions for think_cycle tool */
export type CycleAction = 'start' | 'step' | 'status' | 'finalize' | 'reset';

/** Backend mode for think_cycle interoperability */
export type CycleBackendMode = 'auto' | 'independent' | 'think';

/** Thought classification used in cycle scoring */
export type CycleThoughtType =
  | 'decompose'
  | 'alternative'
  | 'critique'
  | 'synthesis'
  | 'verification'
  | 'revision';

/** Gate reason codes returned by think_cycle */
export type CycleReasonCode =
  | 'BELOW_REQUIRED_THOUGHTS'
  | 'MISSING_PHASE_DECOMPOSE'
  | 'MISSING_PHASE_ALTERNATIVE'
  | 'MISSING_PHASE_CRITIQUE'
  | 'MISSING_PHASE_SYNTHESIS'
  | 'MISSING_PHASE_VERIFICATION'
  | 'LOW_OVERALL_QUALITY'
  | 'LOW_CRITIQUE_DEPTH'
  | 'LOW_VERIFICATION_DEPTH'
  | 'LOW_DIVERSITY'
  | 'LOW_CONFIDENCE_STABILITY'
  | 'TOO_MANY_SHORT_THOUGHTS'
  | 'CONTRADICTION_SIGNAL'
  | 'CONSTRAINT_CHECK_REQUIRED'
  | 'MAX_LOOPS_REACHED'
  | 'INTEROP_BACKEND_ERROR'
  | 'SESSION_COMPLETED'
  | 'SESSION_NOT_FOUND'
  | 'INVALID_ACTION'
  | 'INVALID_INPUT';

/** Quality metrics reported by think_cycle */
export interface CycleQuality {
  overall: number;
  coverage: number;
  critique: number;
  verification: number;
  diversity: number;
  confidenceStability?: number;
}

/** Loop counters reported by think_cycle */
export interface CycleLoopState {
  current: number;
  max: number;
  required: number;
  remaining: number;
}

/** Gate state reported by think_cycle */
export interface CycleGate {
  passed: boolean;
  reasonCodes: CycleReasonCode[];
}

/** Throughput and quality KPIs for cycle monitoring */
export interface CycleKpi {
  thoughtsPerMinute: number;
  qualityDelta: number;
  stagnationRisk: number;
}

/** Internal phase coverage flags */
export interface CyclePhaseCoverage {
  decompose: boolean;
  alternative: boolean;
  critique: boolean;
  synthesis: boolean;
  verification: boolean;
}

/** Single thought record stored by think_cycle */
export interface CycleThoughtRecord {
  index: number;
  thought: string;
  thoughtType: CycleThoughtType;
  confidence?: number;
  timestamp: number;
}

/** Session model for think_cycle */
export interface CycleSession {
  sessionId: string;
  scopeId?: string;
  goal: string;
  context?: string;
  constraints: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  finalApprovedAnswer?: string;
  insightPending?: boolean;
  maxLoops: number;
  requiredThoughts: number;
  backendMode: CycleBackendMode;
  thoughts: CycleThoughtRecord[];
  phaseCoverage: CyclePhaseCoverage;
  interopFallback: boolean;
}

/** Input for think_cycle tool */
export interface ThinkCycleInput {
  action: CycleAction;
  sessionId?: string;
  scopeId?: string;
  goal?: string;
  context?: string;
  constraints?: string[];
  thought?: string;
  thoughtType?: CycleThoughtType;
  confidence?: number;
  finalAnswer?: string;
  constraintCheck?: string;
  backendMode?: CycleBackendMode;
  maxLoops?: number;
  showTrace?: boolean;
  exportReport?: 'markdown' | 'json';
  includeMermaid?: boolean;
}

/** Output for think_cycle tool */
export interface ThinkCycleResult {
  status: 'in_progress' | 'blocked' | 'ready' | 'completed' | 'error';
  sessionId: string;
  scopeId?: string;
  loop: CycleLoopState;
  quality: CycleQuality;
  kpi: CycleKpi;
  gate: CycleGate;
  requiredMoreThoughts: number;
  nextPrompts: string[];
  shortTrace?: string[];
  finalApprovedAnswer?: string;
  exportedReport?: string;
  interopFallback?: boolean;
  errorMessage?: string;
}

