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


// ============================================
// v4.7.0 - Logic Analysis Edition
// ============================================

/** Analysis depth for think_logic */
export type LogicDepth = 'quick' | 'standard' | 'deep';

/** Focus areas for think_logic */
export type LogicFocus = 'security' | 'performance' | 'reliability' | 'ux' | 'architecture' | 'data-flow';

/** Severity levels for identified cracks */
export type CrackSeverity = 'blocker' | 'high' | 'medium' | 'low';

/** Priority levels for action items */
export type ActionPriority = 'P0' | 'P1' | 'P2' | 'P3';

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
  /** Show chain map section */
  showChain?: boolean;
  /** Show cracks section */
  showCracks?: boolean;
  /** Show luxury standard section */
  showStandard?: boolean;
  /** Show action items section */
  showActions?: boolean;
}

/** Single step in the logic chain */
export interface LogicChainStep {
  /** Step number in sequence */
  step: number;
  /** Step name/title */
  name: string;
  /** What happens at this step */
  description: string;
  /** Components/systems involved */
  components?: string[];
  /** Data transformations */
  dataFlow?: string;
}

/** Identified crack/weakness in the logic */
export interface LogicCrack {
  /** Unique identifier */
  id: string;
  /** Severity level */
  severity: CrackSeverity;
  /** Which chain step this affects */
  affectsStep?: number;
  /** Category of the crack */
  category: string;
  /** Description of the issue */
  description: string;
  /** Potential impact if not addressed */
  impact: string;
  /** Related focus area */
  focus?: LogicFocus;
  /** Possible root causes (v4.8.0 - WHY analysis) */
  possibleCauses?: string[];
  /** Debug steps to investigate (v4.8.0) */
  debugSteps?: string[];
  /** Stack-specific if detected from tech stack */
  fromStack?: string;
}

/** Luxury standard benchmark item */
export interface LogicStandard {
  /** Standard category */
  category: string;
  /** What the standard requires */
  requirement: string;
  /** Current state assessment */
  currentState: 'met' | 'partial' | 'missing' | 'unknown';
  /** Gap description if not fully met */
  gap?: string;
}

/** Action item for improvement */
export interface LogicActionItem {
  /** Unique identifier */
  id: string;
  /** Priority level */
  priority: ActionPriority;
  /** Action title */
  title: string;
  /** Detailed description */
  description: string;
  /** Which crack this addresses */
  addressesCrack?: string;
  /** Estimated effort */
  effort?: 'trivial' | 'small' | 'medium' | 'large';
}

/** Result from think_logic tool - v5.0.0 Methodology Edition */
export interface LogicAnalysisResult {
  /** Analysis status */
  status: 'success' | 'error';
  /** Target that was analyzed */
  target: string;
  /** Depth used */
  depth: LogicDepth;
  /** Focus areas applied */
  focus: LogicFocus[];
  /** Tech stacks applied */
  stack?: TechStack[];
  /** Generated methodology for AI to follow */
  methodology?: LogicMethodology;
  /** Warnings during analysis */
  warnings: string[];
  /** Error message if status is error */
  errorMessage?: string;
}

/** Single section in the methodology */
export interface MethodologySection {
  /** Section title with emoji */
  title: string;
  /** Purpose of this phase */
  purpose: string;
  /** Instructions/questions for AI to follow */
  content: string[];
}

/** Methodology structure - instructions for AI, not analysis results */
export interface LogicMethodology {
  /** Task description */
  task: string;
  /** Methodology sections (phases) */
  sections: MethodologySection[];
  /** Stack-specific reminders (optional) */
  stackReminders?: string[];
}

