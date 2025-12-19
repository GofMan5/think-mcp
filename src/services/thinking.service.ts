/**
 * ThinkingService - Core logic for sequential thinking with optimizations
 * Version 3.4.0 - Recall Edition
 * Features: Context Echoing, ASCII Tree, Strict Validation, Confidence Scoring,
 *           Smart Pruning, Mermaid Visualization, Stagnation Detection, Persistence,
 *           FS Mutex Lock, Path Connectivity Validation, Entropy-based Detection,
 *           Fractal Thinking (subSteps, alternatives), Complexity Budget,
 *           Strategic Lens (innovation, optimization, polish),
 *           Proactive Coach (smart lens recommendations based on content analysis),
 *           Pre-Consolidation Audit (quality gate before finishing),
 *           Quick Extension (inline critique/elaboration without tool switch),
 *           Enhanced Proactive Coaching (short thought detection, low confidence nudges),
 *           Atomic File Writes (tmp → rename for crash safety),
 *           Session TTL (auto-reset after 24h),
 *           Coach Cooldown (prevent advice spam),
 *           Dead Ends Tracking (remember rejected paths to avoid circular thinking),
 *           MAX_DEAD_ENDS limit (prevent memory bloat),
 *           Near-limit warning (warn when approaching totalThoughts with low confidence),
 *           Fuzzy Search Recall (search through thought history with Fuse.js)
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Fuse from 'fuse.js';
import type {
  ThoughtInput,
  ThoughtRecord,
  ThoughtSummary,
  ThinkingResult,
  ValidationResult,
  ExtendThoughtInput,
  ExtendThoughtResult,
  ThoughtExtension,
  SessionData,
  PathConnectivityResult,
  QuickExtension,
  DeadEnd,
  RecallInput,
  RecallResult,
  RecallMatch,
  RecallScope,
  RecallSearchIn,
} from '../types/thought.types.js';

// Session file path (relative to module directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSION_FILE = join(__dirname, '..', '..', 'thought_session.json');

// Configuration constants
const RETAIN_FULL_THOUGHTS = 5; // Keep last N thoughts in full detail
const STAGNATION_CHECK_COUNT = 3; // Check last N thoughts for similarity
const SIMILARITY_THRESHOLD = 50; // Compare first N chars for stagnation
const RECENT_WEIGHT_MULTIPLIER = 2; // Weight multiplier for last 3 thoughts in confidence calc
const RECENT_THOUGHTS_COUNT = 3; // Number of recent thoughts to weight higher
const MIN_ENTROPY_THRESHOLD = 0.25; // Minimum word entropy before warning
const JACCARD_STAGNATION_THRESHOLD = 0.75; // Jaccard similarity threshold for stagnation detection

// Technical short terms whitelist for entropy calculation (not filtered by length)
const TECHNICAL_SHORT_TERMS = new Set([
  'api', 'ui', 'db', 'id', 'io', 'os', 'ip', 'url', 'css', 'sql', 'xml', 'jwt', 'mcp',
  'cli', 'sdk', 'cdn', 'dns', 'ssh', 'ssl', 'tls', 'http', 'json', 'yaml', 'toml',
]);
const LINEAR_THINKING_THRESHOLD = 6; // Thoughts before lateral thinking warning
const ESCALATING_PRESSURE_INTERVAL = 3; // Every N thoughts, increase pressure
const MAX_THOUGHTS_BUDGET = 12; // Complexity budget - warn to consolidate after this many thoughts

// Proactive Coach patterns for lens recommendations (v2.9.1)
const OPTIMIZATION_TRIGGERS = [
  'todo', 'fixme', 'hack', 'потом', 'позже', 'оптимизировать', 'рефакторинг',
  'медленно', 'память', 'performance', 'slow', 'memory', 'refactor', 'cleanup',
  'технический долг', 'tech debt', 'временное решение', 'workaround',
];

const UNCERTAINTY_TRIGGERS = [
  'возможно', 'наверное', 'думаю что', 'скорее всего', 'предполагаю',
  'может быть', 'вероятно', 'не уверен', 'perhaps', 'maybe', 'probably',
  'i think', 'i assume', 'might be', 'could be', 'not sure', 'uncertain',
];

const POLISH_THRESHOLD_CONFIDENCE = 8; // Recommend polish when confidence >= this
const INNOVATION_THRESHOLD_THOUGHTS = 8; // Recommend innovation after this many thoughts

// Pre-Consolidation Audit thresholds (v2.9.2)
const DEPTH_METRIC_SIMPLE = 100; // Min avg thought length for simple tasks (<=5 thoughts)
const DEPTH_METRIC_MEDIUM = 150; // Min avg thought length for medium tasks (6-10 thoughts)
const DEPTH_METRIC_COMPLEX = 200; // Min avg thought length for complex tasks (11+ thoughts)

// Proactive Coach v3.1.0 - Enhanced nudges
const MIN_THOUGHT_LENGTH = 50; // Minimum thought length before warning
const LOW_CONFIDENCE_THRESHOLD = 5; // Confidence below this triggers advice
const NO_CRITIQUE_THRESHOLD = 5; // Warn about missing critique after N thoughts

// v3.2.0 - Reliability Edition constants
const SESSION_TTL_HOURS = 24; // Auto-reset session after this many hours
const COACH_COOLDOWN_COUNT = 3; // Don't repeat same advice within N thoughts
const SMART_PRUNING_THRESHOLD = 10; // Start pruning context after N thoughts

// v3.3.1 - Bulletproof Edition constants
const MAX_DEAD_ENDS = 20; // Limit dead ends to prevent memory bloat
const NEAR_LIMIT_CONFIDENCE_THRESHOLD = 6; // Warn if near limit with low confidence

// Common filler phrases and stop words to normalize out for stagnation/entropy detection
const FILLER_PHRASES = [
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

// v3.4.0 - Recall Edition constants
const RECALL_DEFAULT_LIMIT = 3;
const RECALL_DEFAULT_THRESHOLD = 0.4;
const RECALL_SNIPPET_CONTEXT = 100; // Characters before/after match for snippet

/** Searchable item for Fuse.js index */
interface FuseSearchItem {
  thoughtNumber: number;
  content: string;
  type: 'thought' | 'extension' | 'alternative' | 'subStep';
  extensionType?: string;
  confidence?: number;
  sessionId?: string;
  originalThought: string;
}

export class ThinkingService {
  private thoughtHistory: ThoughtRecord[] = [];
  private branches: Map<string, ThoughtRecord[]> = new Map();
  private lastThoughtNumber = 0;
  /** Session goal for focus retention (v2.10.0) */
  private sessionGoal: string | undefined;
  /** Current session ID for isolation (v2.11.0) */
  private currentSessionId: string = '';

  /** Promise-based lock for FS operations to prevent race conditions */
  private fsLock: Promise<void> = Promise.resolve();

  /** Coach cooldown - track recent advices to prevent spam (v3.2.0) */
  private recentAdvices: string[] = [];

  /** Dead ends - paths that were rejected (v3.3.0) */
  private deadEnds: DeadEnd[] = [];

  /** Fuse.js instance for fuzzy search (v3.4.0) - lazy initialized */
  private fuseIndex: Fuse<FuseSearchItem> | null = null;
  /** Flag to track if index needs rebuild */
  private fuseIndexDirty = true;

  /**
   * Get the start index of current session (after last thought #1)
   * @deprecated Use getCurrentSessionThoughts() with sessionId filtering instead (v2.11.0)
   */
  private getCurrentSessionStartIndex(): number {
    // Fallback for legacy: find last occurrence of thoughtNumber === 1
    for (let i = this.thoughtHistory.length - 1; i >= 0; i--) {
      if (this.thoughtHistory[i].thoughtNumber === 1 && !this.thoughtHistory[i].isRevision) {
        return i;
      }
    }
    return 0;
  }

  /**
   * Get thoughts from current session only
   * Uses sessionId for reliable isolation (v2.11.0)
   */
  private getCurrentSessionThoughts(): ThoughtRecord[] {
    // Primary: filter by sessionId (v2.11.0)
    if (this.currentSessionId) {
      return this.thoughtHistory.filter(t => t.sessionId === this.currentSessionId);
    }
    // Fallback for legacy sessions without sessionId
    const startIdx = this.getCurrentSessionStartIndex();
    return this.thoughtHistory.slice(startIdx);
  }

  /**
   * Execute FS operation with mutex lock to prevent race conditions
   * Chains operations sequentially - critical for data integrity
   */
  private async withFsLock<T>(operation: () => Promise<T>): Promise<T> {
    const currentLock = this.fsLock;
    let releaseLock: () => void;
    this.fsLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentLock; // Wait for previous operation to complete
      return await operation();
    } finally {
      releaseLock!(); // Release lock for next operation
    }
  }

  /**
   * Process a thought with validation and context echoing
   * Implements Strict Logic Mode with hard duplicate rejection
   */
  processThought(input: ThoughtInput): ThinkingResult {
    // Smart auto-reset: if thoughtNumber=1 and history not empty, start fresh session
    // SYNCHRONOUS reset to avoid race conditions
    if (input.thoughtNumber === 1 && this.thoughtHistory.length > 0 && !input.isRevision) {
      console.error('🔄 New session detected (thought #1), clearing previous state...');
      this.reset(); // Synchronous clear
      // Clear persistence file asynchronously (non-blocking)
      this.clearSession().catch((err) => console.error('Failed to clear session:', err));
    }

    // Generate new sessionId for first thought of session (v2.11.0)
    if (input.thoughtNumber === 1 && !input.isRevision) {
      this.currentSessionId = new Date().toISOString();
      console.error(`🆔 New session ID: ${this.currentSessionId}`);
    }

    // Auto-adjust totalThoughts if exceeded
    if (input.thoughtNumber > input.totalThoughts) {
      input.totalThoughts = input.thoughtNumber;
    }

    // EMPTY THOUGHT VALIDATION - reject meaningless input
    if (!input.thought || !input.thought.trim()) {
      return {
        thoughtNumber: input.thoughtNumber,
        totalThoughts: input.totalThoughts,
        nextThoughtNeeded: true,
        branches: Array.from(this.branches.keys()),
        thoughtHistoryLength: this.thoughtHistory.length,
        contextSummary: this.generateContextSummary(),
        thoughtTree: this.generateAsciiTree(),
        isError: true,
        errorMessage: '🚫 REJECTED: Empty thought. Provide meaningful content.',
        warning: '🚫 REJECTED: Empty thought. Provide meaningful content.',
      };
    }

    // SESSION GOAL (v2.10.0) - Save goal from first thought
    if (input.goal && input.thoughtNumber === 1) {
      this.sessionGoal = input.goal;
      console.error(`🎯 Session goal set: ${input.goal.substring(0, 50)}...`);
    }

    // HARD DUPLICATE REJECTION - reject before adding to history
    const duplicateError = this.checkDuplicateStrict(input);
    if (duplicateError) {
      return {
        thoughtNumber: input.thoughtNumber,
        totalThoughts: input.totalThoughts,
        nextThoughtNeeded: true,
        branches: Array.from(this.branches.keys()),
        thoughtHistoryLength: this.thoughtHistory.length,
        contextSummary: this.generateContextSummary(),
        thoughtTree: this.generateAsciiTree(),
        isError: true,
        errorMessage: duplicateError,
        warning: duplicateError,
      };
    }

    // BRANCH VALIDATION - reject if branchFromThought references non-existent thought
    const branchError = this.validateBranchSource(input);
    if (branchError) {
      return {
        thoughtNumber: input.thoughtNumber,
        totalThoughts: input.totalThoughts,
        nextThoughtNeeded: true,
        branches: Array.from(this.branches.keys()),
        thoughtHistoryLength: this.thoughtHistory.length,
        contextSummary: this.generateContextSummary(),
        thoughtTree: this.generateAsciiTree(),
        isError: true,
        errorMessage: branchError,
        warning: branchError,
      };
    }

    // Validate sequence (includes shallow/circular revision check)
    const validation = this.validateSequence(input);
    
    // HARD REJECTION for invalid revisions (shallow, circular, non-existent target)
    if (!validation.valid && input.isRevision) {
      return {
        thoughtNumber: input.thoughtNumber,
        totalThoughts: input.totalThoughts,
        nextThoughtNeeded: true,
        branches: Array.from(this.branches.keys()),
        thoughtHistoryLength: this.thoughtHistory.length,
        contextSummary: this.generateContextSummary(),
        thoughtTree: this.generateAsciiTree(),
        isError: true,
        errorMessage: validation.warning,
        warning: validation.warning,
      };
    }

    // Check for stagnation before adding new thought
    const stagnationWarning = this.detectStagnation(input.thought);

    // Create record with timestamp and sessionId (v2.11.0)
    const record: ThoughtRecord = {
      ...input,
      timestamp: Date.now(),
      sessionId: this.currentSessionId,
    };

    this.thoughtHistory.push(record);
    this.lastThoughtNumber = input.thoughtNumber;

    // Invalidate Fuse index for recall_thought (v3.4.0)
    this.invalidateFuseIndex();

    // Handle branching
    if (input.branchFromThought && input.branchId) {
      const branchHistory = this.branches.get(input.branchId) ?? [];
      branchHistory.push(record);
      this.branches.set(input.branchId, branchHistory);
    }

    // Log to stderr for debugging
    const prefix = input.isRevision
      ? '🔄 Revision'
      : input.branchFromThought
        ? '🌿 Branch'
        : '💭 Thought';
    const confidenceStr = input.confidence ? ` [conf: ${input.confidence}/10]` : '';
    console.error(
      `${prefix} ${input.thoughtNumber}/${input.totalThoughts}${confidenceStr}: ${input.thought.substring(0, 80)}...`
    );

    // Save session asynchronously (fire and forget)
    this.saveSession().catch((err) => console.error('Failed to save session:', err));

    // Combine warnings
    const warning = [validation.warning, stagnationWarning].filter(Boolean).join('\n');

    // QUICK EXTENSION (v3.1.0) - Process inline extension if provided
    if (input.quickExtension) {
      this.processQuickExtension(input.thoughtNumber, input.quickExtension);
    }

    // LATERAL THINKING TRIGGER - check for overly linear thinking
    let systemAdvice = this.checkLateralThinking();

    // DEAD ENDS CHECK (v3.3.0) - Warn if heading towards rejected path
    const deadEndWarning = this.checkDeadEnds(input.thoughtNumber);
    if (deadEndWarning) {
      systemAdvice = systemAdvice ? `${systemAdvice}\n${deadEndWarning}` : deadEndWarning;
    }

    // PROACTIVE COACH v3.1.0 - Enhanced nudges for thought quality
    const coachNudges = this.generateProactiveNudges(input);
    if (coachNudges) {
      systemAdvice = systemAdvice ? `${systemAdvice}\n${coachNudges}` : coachNudges;
    }

    // PRE-CONSOLIDATION AUDIT (v2.9.2) - Quality gate before finishing
    if (!input.nextThoughtNeeded) {
      const auditAdvice = this.performPreConsolidationAudit();
      if (auditAdvice) {
        systemAdvice = systemAdvice ? `${systemAdvice}\n${auditAdvice}` : auditAdvice;
      }
    }

    return {
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: input.nextThoughtNeeded,
      branches: Array.from(this.branches.keys()),
      thoughtHistoryLength: this.thoughtHistory.length,
      contextSummary: this.generateContextSummary(),
      thoughtTree: this.generateAsciiTree(),
      thoughtTreeMermaid: this.generateMermaid(),
      warning: warning || undefined,
      averageConfidence: this.calculateAverageConfidence(),
      systemAdvice,
      sessionGoal: this.sessionGoal,
    };
  }


  /**
   * Calculate Jaccard similarity (0-1) between two texts
   * Uses word-level comparison after normalization
   * More accurate than substring comparison for stagnation detection
   */
  private calculateJaccardSimilarity(text1: string, text2: string): number {
    const getWords = (text: string): Set<string> => {
      return new Set(
        this.normalizeForComparison(text)
          .split(/\s+/)
          .filter(w => w.length > 2 || TECHNICAL_SHORT_TERMS.has(w.toLowerCase()))
      );
    };
    
    const words1 = getWords(text1);
    const words2 = getWords(text2);
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;
    
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Calculate simple text similarity (0-1) using normalized comparison
   * @deprecated Use calculateJaccardSimilarity for better accuracy
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    return this.calculateJaccardSimilarity(text1, text2);
  }

  /**
   * Validate thought sequence - prevent skipping steps and invalid revisions
   * Also validates revision content is meaningfully different
   */
  private validateSequence(input: ThoughtInput): ValidationResult {
    // Validate revision target - can't revise future or non-existent thoughts
    if (input.isRevision && input.revisesThought !== undefined) {
      const sessionThoughts = this.getCurrentSessionThoughts();
      const targetThought = sessionThoughts.find((t) => t.thoughtNumber === input.revisesThought);
      
      if (!targetThought) {
        return {
          valid: false,
          warning: `🚫 INVALID REVISION: Cannot revise thought #${input.revisesThought} - it doesn't exist in current session. Available: ${sessionThoughts.map((t) => t.thoughtNumber).join(', ')}`,
        };
      }

      // Check revision is meaningfully different from original
      const similarity = this.calculateTextSimilarity(input.thought, targetThought.thought);
      if (similarity > 0.85) {
        return {
          valid: false,
          warning: `⚠️ SHALLOW REVISION: Your revision is ${Math.round(similarity * 100)}% similar to the original. A meaningful revision should substantially change the content. Rewrite with more significant changes.`,
        };
      }

      // Check for circular revision (revision text similar to even earlier thought)
      const earlierThoughts = sessionThoughts.filter(t => 
        t.thoughtNumber < input.revisesThought! && !t.isRevision
      );
      for (const earlier of earlierThoughts) {
        const circularSimilarity = this.calculateTextSimilarity(input.thought, earlier.thought);
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
    if (this.lastThoughtNumber === 0) {
      return { valid: true };
    }

    const expectedNext = this.lastThoughtNumber + 1;
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
   */
  private checkDuplicateStrict(input: ThoughtInput): string | undefined {
    if (input.isRevision) return undefined; // Revisions are allowed to reuse numbers

    const sessionThoughts = this.getCurrentSessionThoughts();
    const exists = sessionThoughts.some((t) => t.thoughtNumber === input.thoughtNumber);

    if (exists) {
      return `🚫 REJECTED: Thought #${input.thoughtNumber} already exists in this session. Use isRevision: true to revise it, or extend_thought to add critique/elaboration.`;
    }
    return undefined;
  }

  /**
   * Validate branch source - reject if branchFromThought references non-existent thought
   */
  private validateBranchSource(input: ThoughtInput): string | undefined {
    if (!input.branchFromThought) return undefined;

    const sessionThoughts = this.getCurrentSessionThoughts();
    const sourceExists = sessionThoughts.some((t) => t.thoughtNumber === input.branchFromThought);

    if (!sourceExists) {
      return `🚫 INVALID BRANCH: Cannot branch from thought #${input.branchFromThought} - it doesn't exist in current session. Available thoughts: ${sessionThoughts.map((t) => t.thoughtNumber).join(', ') || 'none'}`;
    }
    return undefined;
  }

  /**
   * LATERAL THINKING TRIGGER with escalating pressure
   * Warns if thinking is too linear (no branches, no extensions)
   * Also checks for forgotten branches, declining entropy, and subSteps completion
   */
  private checkLateralThinking(): string | undefined {
    const sessionThoughts = this.getCurrentSessionThoughts();
    const thoughtCount = sessionThoughts.length;
    const advices: string[] = [];

    // Self-checklist: remind about subSteps from previous thought
    if (thoughtCount >= 2) {
      const prevThought = sessionThoughts[thoughtCount - 2];
      if (prevThought.subSteps && prevThought.subSteps.length > 0) {
        advices.push(`📋 SELF-CHECK: Previous thought #${prevThought.thoughtNumber} had ${prevThought.subSteps.length} sub-steps: [${prevThought.subSteps.join(', ')}]. Did you complete them all?`);
      }
    }

    // Check for forgotten branches (created but not revisited in last 3 thoughts)
    if (this.branches.size > 0 && thoughtCount > 3) {
      const recentThoughts = sessionThoughts.slice(-3);
      const recentBranchIds = new Set(
        recentThoughts.filter(t => t.branchId).map(t => t.branchId)
      );
      
      for (const branchId of this.branches.keys()) {
        if (!recentBranchIds.has(branchId)) {
          advices.push(`🌿 FORGOTTEN BRANCH: You have an open branch "${branchId}" that hasn't been touched in 3+ thoughts. Consider integrating it into your solution or explicitly closing it via consolidate.`);
          break; // Only warn about one branch at a time
        }
      }
    }

    // Check for declining entropy in recent thoughts
    if (thoughtCount >= 3) {
      const recentThoughts = sessionThoughts.slice(-3);
      const entropies = recentThoughts.map(t => this.calculateWordEntropy(t.thought));
      const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
      const isDecreasing = entropies[2] < entropies[1] && entropies[1] < entropies[0];
      
      if (avgEntropy < MIN_ENTROPY_THRESHOLD || (isDecreasing && entropies[2] < 0.3)) {
        advices.push(`📉 ENTROPY DECLINING: Your recent thoughts show decreasing vocabulary diversity (avg: ${avgEntropy.toFixed(2)}). This may indicate repetitive thinking. Try expressing your reasoning with different words or explore a new angle.`);
      }
    }

    // Only trigger linear thinking check after threshold
    if (thoughtCount >= LINEAR_THINKING_THRESHOLD) {
      const hasExtensions = sessionThoughts.some((t) => t.extensions && t.extensions.length > 0);
      const hasBranches = sessionThoughts.some((t) => t.branchFromThought !== undefined);

      if (!hasExtensions && !hasBranches) {
        const pressureLevel = Math.floor((thoughtCount - LINEAR_THINKING_THRESHOLD) / ESCALATING_PRESSURE_INTERVAL) + 1;
        
        if (pressureLevel === 1) {
          advices.push('💡 LATERAL THINKING: Your reasoning appears too linear. Consider using extend_thought with "critique" or create a branch.');
        } else if (pressureLevel === 2) {
          advices.push('⚠️ LATERAL WARNING: Still no branches or critiques. STRONGLY consider using extend_thought with "assumption_testing".');
        } else {
          advices.push(`🚨 CRITICAL: ${thoughtCount} thoughts with ZERO lateral exploration. STOP and critique your approach.`);
        }
      }
    }

    // Complexity Budget - escalating pressure to consolidate
    if (thoughtCount >= MAX_THOUGHTS_BUDGET) {
      const overBudget = thoughtCount - MAX_THOUGHTS_BUDGET;
      if (overBudget === 0) {
        advices.push(`💰 COMPLEXITY BUDGET: You've reached ${MAX_THOUGHTS_BUDGET} thoughts. Consider calling consolidate_and_verify to synthesize your reasoning.`);
      } else if (overBudget <= 3) {
        advices.push(`⚠️ OVER BUDGET: ${thoughtCount} thoughts without consolidation. Time to wrap up - call consolidate_and_verify NOW.`);
      } else {
        advices.push(`🚨 ANALYSIS PARALYSIS: ${thoughtCount} thoughts is excessive. STOP adding thoughts and call consolidate_and_verify immediately!`);
      }
    }

    // PROACTIVE COACH (v2.9.1) - Smart lens recommendations based on content analysis
    const coachAdvice = this.generateProactiveCoachAdvice(sessionThoughts);
    if (coachAdvice) {
      advices.push(coachAdvice);
    }

    return advices.length > 0 ? advices.join('\n') : undefined;
  }

  /**
   * PROACTIVE COACH (v2.9.1) - Analyzes thought content and recommends strategic lenses
   * Returns coaching advice based on detected patterns
   */
  private generateProactiveCoachAdvice(sessionThoughts: ThoughtRecord[]): string | undefined {
    if (sessionThoughts.length === 0) return undefined;

    const lastThought = sessionThoughts[sessionThoughts.length - 1];
    const allContent = sessionThoughts.map(t => t.thought.toLowerCase()).join(' ');
    const lastContent = lastThought.thought.toLowerCase();

    // Check which extensions already exist in session
    const existingExtensions = new Set<string>();
    sessionThoughts.forEach(t => {
      t.extensions?.forEach(e => existingExtensions.add(e.type));
    });

    // 1. OPTIMIZATION recommendation - detect TODO/FIXME/tech debt patterns
    if (!existingExtensions.has('optimization')) {
      const hasOptimizationTrigger = OPTIMIZATION_TRIGGERS.some(trigger => 
        lastContent.includes(trigger) || allContent.includes(trigger)
      );
      if (hasOptimizationTrigger) {
        return '🎯 COACH: Detected optimization opportunity (TODO/tech debt/performance mention). Consider using extend_thought with type "optimization" to analyze Before/After improvements.';
      }
    }

    // 2. ASSUMPTION TESTING recommendation - detect uncertainty language
    if (!existingExtensions.has('assumption_testing')) {
      const uncertaintyCount = UNCERTAINTY_TRIGGERS.filter(trigger => 
        lastContent.includes(trigger)
      ).length;
      if (uncertaintyCount >= 2) {
        return '🎯 COACH: Detected uncertain language ("maybe", "probably", "I think"). Consider using extend_thought with type "assumption_testing" to validate your hypotheses.';
      }
    }

    // 3. POLISH recommendation - high confidence near end of session
    if (!existingExtensions.has('polish')) {
      const isNearEnd = lastThought.thoughtNumber >= lastThought.totalThoughts - 1;
      const hasHighConfidence = lastThought.confidence && lastThought.confidence >= POLISH_THRESHOLD_CONFIDENCE;
      if (isNearEnd && hasHighConfidence) {
        return '🎯 COACH: You\'re near completion with high confidence. Consider using extend_thought with type "polish" to check edge cases, typing, and documentation before finalizing.';
      }
    }

    // 4. INNOVATION recommendation - long session without innovation
    if (!existingExtensions.has('innovation') && sessionThoughts.length >= INNOVATION_THRESHOLD_THOUGHTS) {
      const hasBranches = sessionThoughts.some(t => t.branchFromThought !== undefined);
      if (!hasBranches) {
        return '🎯 COACH: Long session without exploring alternatives. Consider using extend_thought with type "innovation" to find new directions or "white spots" in your solution.';
      }
    }

    return undefined;
  }

  /**
   * Add advice with cooldown - prevents spam of same advice (v3.2.0)
   * Returns true if advice was added, false if on cooldown
   */
  private addAdviceWithCooldown(advice: string, nudges: string[]): boolean {
    // Extract advice key (first 30 chars) for comparison
    const adviceKey = advice.substring(0, 30);
    if (this.recentAdvices.includes(adviceKey)) {
      return false; // On cooldown, skip this advice
    }
    nudges.push(advice);
    this.recentAdvices.push(adviceKey);
    // Keep only last N advices for cooldown tracking
    if (this.recentAdvices.length > COACH_COOLDOWN_COUNT) {
      this.recentAdvices.shift();
    }
    return true;
  }

  /**
   * PROACTIVE NUDGES (v3.1.0) - Enhanced coaching based on current thought
   * Checks: short thoughts, low confidence, missing critiques
   * v3.2.0: Added cooldown to prevent advice spam
   */
  private generateProactiveNudges(input: ThoughtInput): string | undefined {
    const nudges: string[] = [];

    // 1. Short thought detection
    if (input.thought.length < MIN_THOUGHT_LENGTH && input.nextThoughtNeeded) {
      this.addAdviceWithCooldown(
        `⚠️ SHORT THOUGHT: Only ${input.thought.length} chars. Expand with implementation details or potential risks.`,
        nudges
      );
    }

    // 2. Low confidence nudge
    if (input.confidence && input.confidence < LOW_CONFIDENCE_THRESHOLD) {
      this.addAdviceWithCooldown(
        `💡 LOW CONFIDENCE (${input.confidence}/10): Consider using quickExtension with type "critique" or "assumption_testing" to explore why you're uncertain.`,
        nudges
      );
    }

    // 3. Missing critique check (after N thoughts without any critique)
    const sessionThoughts = this.getCurrentSessionThoughts();
    if (sessionThoughts.length >= NO_CRITIQUE_THRESHOLD) {
      const hasCritique = sessionThoughts.some(t => 
        t.extensions?.some(e => e.type === 'critique')
      );
      if (!hasCritique) {
        this.addAdviceWithCooldown(
          `🧐 NO SELF-CRITIQUE: ${sessionThoughts.length} thoughts without challenging your assumptions. Use quickExtension: {type: "critique", content: "..."} to validate your approach.`,
          nudges
        );
      }
    }

    // 4. Smart pruning reminder (v3.2.0) - when session gets long
    if (sessionThoughts.length >= SMART_PRUNING_THRESHOLD) {
      this.addAdviceWithCooldown(
        `🧹 LONG SESSION (${sessionThoughts.length} thoughts): Context is being auto-pruned. Consider consolidate_and_verify soon.`,
        nudges
      );
    }

    // 5. Near-limit warning (v3.3.1) - warn if near totalThoughts with low confidence
    if (input.thoughtNumber >= input.totalThoughts - 1 && 
        input.confidence && input.confidence < NEAR_LIMIT_CONFIDENCE_THRESHOLD) {
      this.addAdviceWithCooldown(
        `⚠️ NEAR LIMIT: You're at thought ${input.thoughtNumber}/${input.totalThoughts} with low confidence (${input.confidence}/10). Consider increasing totalThoughts or using needsMoreThoughts: true.`,
        nudges
      );
    }

    return nudges.length > 0 ? nudges.join('\n') : undefined;
  }

  /**
   * QUICK EXTENSION (v3.1.0) - Process inline extension without separate tool call
   * Attaches extension to the current thought immediately
   */
  private processQuickExtension(thoughtNumber: number, ext: QuickExtension): void {
    // Find the thought we just added (last in history)
    const targetIdx = this.thoughtHistory.length - 1;
    if (targetIdx < 0) return;

    const target = this.thoughtHistory[targetIdx];
    if (target.thoughtNumber !== thoughtNumber) {
      console.error(`⚠️ QuickExtension mismatch: expected #${thoughtNumber}, found #${target.thoughtNumber}`);
      return;
    }

    // Initialize extensions array if needed
    if (!target.extensions) {
      target.extensions = [];
    }

    // Create and attach extension
    const extension: ThoughtExtension = {
      type: ext.type,
      content: ext.content,
      impact: ext.impact ?? 'medium',
      timestamp: new Date().toISOString(),
    };

    target.extensions.push(extension);

    console.error(
      `🔍 QuickExtension on #${thoughtNumber} [${ext.type.toUpperCase()}]: ${ext.content.substring(0, 40)}...`
    );
  }

  /**
   * DEAD ENDS TRACKING (v3.3.0) - Record a path as rejected
   * Called when consolidate returns needs_more_work
   */
  private recordDeadEnd(path: number[], reason: string): void {
    // Don't record empty paths
    if (path.length === 0) return;

    // Check if this exact path is already recorded
    const pathKey = path.join(',');
    const exists = this.deadEnds.some(de => de.path.join(',') === pathKey);
    if (exists) {
      console.error(`⚠️ Dead end path [${pathKey}] already recorded, skipping`);
      return;
    }

    const deadEnd: DeadEnd = {
      path: [...path],
      reason: reason.substring(0, 200), // Truncate long reasons
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
    };

    // v3.3.1: Limit dead ends to prevent memory bloat
    if (this.deadEnds.length >= MAX_DEAD_ENDS) {
      const removed = this.deadEnds.shift();
      console.error(`🗑️ Dead ends limit reached (${MAX_DEAD_ENDS}), removed oldest: [${removed?.path.join(',')}]`);
    }

    this.deadEnds.push(deadEnd);
    console.error(`💀 Recorded dead end: path=[${pathKey}], reason="${reason.substring(0, 50)}..." (${this.deadEnds.length}/${MAX_DEAD_ENDS})`);

    // Save session to persist dead end
    this.saveSession().catch(err => console.error('Failed to save dead end:', err));
  }

  /**
   * DEAD ENDS CHECK (v3.3.0) - Check if current path matches any dead end
   * Returns warning message if current path is heading towards a known dead end
   */
  private checkDeadEnds(currentThoughtNumber: number): string | undefined {
    if (this.deadEnds.length === 0) return undefined;

    // Build current path from session thoughts
    const sessionThoughts = this.getCurrentSessionThoughts();
    const currentPath = sessionThoughts
      .filter(t => !t.isRevision && t.thoughtNumber <= currentThoughtNumber)
      .map(t => t.thoughtNumber)
      .sort((a, b) => a - b);

    if (currentPath.length === 0) return undefined;

    // Check if current path is a prefix of any dead end
    for (const deadEnd of this.deadEnds) {
      // Only check dead ends from current session
      if (deadEnd.sessionId && deadEnd.sessionId !== this.currentSessionId) continue;

      // Check if current path matches the beginning of a dead end path
      const isPrefix = currentPath.every((num, idx) => deadEnd.path[idx] === num);
      
      if (isPrefix && currentPath.length >= 2) {
        return `💀 DEAD END WARNING: Your current path [${currentPath.join(',')}] matches rejected path [${deadEnd.path.join(',')}]. Reason: "${deadEnd.reason}". Consider a different approach or use isRevision to fix the flaw.`;
      }
    }

    return undefined;
  }

  /**
   * Get dead ends for current session (v3.3.0)
   */
  getDeadEnds(): DeadEnd[] {
    return this.deadEnds.filter(de => 
      !de.sessionId || de.sessionId === this.currentSessionId
    );
  }

  /**
   * PRE-CONSOLIDATION AUDIT (v2.9.2) - Quality gate before finishing session
   * Checks: SubSteps completion, Depth Metric, Blocker Gate
   * Returns audit warnings if issues found
   */
  private performPreConsolidationAudit(): string | undefined {
    const sessionThoughts = this.getCurrentSessionThoughts();
    if (sessionThoughts.length === 0) return undefined;

    const auditWarnings: string[] = [];

    // 1. SUBSTEPS COMPLETION CHECK
    // Count all subSteps defined in session and warn if many were defined
    const allSubSteps: { thoughtNum: number; steps: string[] }[] = [];
    sessionThoughts.forEach(t => {
      if (t.subSteps && t.subSteps.length > 0) {
        allSubSteps.push({ thoughtNum: t.thoughtNumber, steps: t.subSteps });
      }
    });

    if (allSubSteps.length > 0) {
      const totalSteps = allSubSteps.reduce((sum, s) => sum + s.steps.length, 0);
      const thoughtsWithSteps = allSubSteps.map(s => `#${s.thoughtNum}`).join(', ');
      auditWarnings.push(
        `📋 SUBSTEPS AUDIT: You defined ${totalSteps} sub-steps in thoughts ${thoughtsWithSteps}. Before finishing, verify all were addressed.`
      );
    }

    // 2. DEPTH METRIC CHECK
    // Calculate average thought length and compare to complexity threshold
    const avgLength = sessionThoughts.reduce((sum, t) => sum + t.thought.length, 0) / sessionThoughts.length;
    const thoughtCount = sessionThoughts.length;
    
    let requiredDepth: number;
    let complexityLevel: string;
    if (thoughtCount <= 5) {
      requiredDepth = DEPTH_METRIC_SIMPLE;
      complexityLevel = 'simple';
    } else if (thoughtCount <= 10) {
      requiredDepth = DEPTH_METRIC_MEDIUM;
      complexityLevel = 'medium';
    } else {
      requiredDepth = DEPTH_METRIC_COMPLEX;
      complexityLevel = 'complex';
    }

    if (avgLength < requiredDepth) {
      auditWarnings.push(
        `🔬 DEPTH AUDIT: Average thought length (${Math.round(avgLength)} chars) is below threshold for ${complexityLevel} tasks (${requiredDepth} chars). Consider adding 'elaboration' extensions for key thoughts.`
      );
    }

    // 3. BLOCKER GATE CHECK
    // Warn about unresolved blocker/high-impact critiques
    const unresolvedBlockers: number[] = [];
    sessionThoughts.forEach(t => {
      if (t.extensions) {
        const hasBlocker = t.extensions.some(e => 
          e.impact === 'blocker' || (e.impact === 'high' && e.type === 'critique')
        );
        if (hasBlocker) {
          // Check if revision exists
          const hasRevision = sessionThoughts.some(
            rev => rev.isRevision && rev.revisesThought === t.thoughtNumber
          );
          if (!hasRevision) {
            unresolvedBlockers.push(t.thoughtNumber);
          }
        }
      }
    });

    if (unresolvedBlockers.length > 0) {
      auditWarnings.push(
        `🛑 BLOCKER AUDIT: Thoughts #${unresolvedBlockers.join(', ')} have unresolved critical issues. Create revisions before calling consolidate_and_verify.`
      );
    }

    // 4. FINAL RECOMMENDATION
    if (auditWarnings.length > 0) {
      auditWarnings.unshift('⚡ PRE-CONSOLIDATION AUDIT (finishing session):');
      auditWarnings.push('💡 TIP: Address these items or call consolidate_and_verify to formally close the session.');
    }

    return auditWarnings.length > 0 ? auditWarnings.join('\n') : undefined;
  }

  /**
   * Generate summary of last 3 thoughts for context retention (current session only)
   */
  private generateContextSummary(): ThoughtSummary[] {
    const sessionThoughts = this.getCurrentSessionThoughts();
    const lastThoughts = sessionThoughts.slice(-3);
    return lastThoughts.map((t) => ({
      thoughtNumber: t.thoughtNumber,
      thought: t.thought.length > 150 ? t.thought.substring(0, 150) + '...' : t.thought,
      confidence: t.confidence,
    }));
  }

  /**
   * Calculate WEIGHTED average confidence across current session thoughts
   * Last N thoughts get higher weight (declining confidence at end is more critical)
   * PENALTY: If unresolved high/blocker critiques exist, cap confidence at 4/10
   */
  private calculateAverageConfidence(): number | undefined {
    const sessionThoughts = this.getCurrentSessionThoughts();
    const withConfidence = sessionThoughts.filter((t) => t.confidence !== undefined);
    if (withConfidence.length === 0) return undefined;

    // Weighted calculation: last RECENT_THOUGHTS_COUNT get RECENT_WEIGHT_MULTIPLIER weight
    let weightedSum = 0;
    let totalWeight = 0;
    const recentStartIdx = Math.max(0, withConfidence.length - RECENT_THOUGHTS_COUNT);

    withConfidence.forEach((t, idx) => {
      const weight = idx >= recentStartIdx ? RECENT_WEIGHT_MULTIPLIER : 1;
      weightedSum += (t.confidence ?? 0) * weight;
      totalWeight += weight;
    });

    let avgConfidence = Math.round((weightedSum / totalWeight) * 10) / 10;

    // Check for unresolved high/blocker critiques - apply penalty
    const hasUnresolvedCritical = this.hasUnresolvedCriticalExtensions();
    if (hasUnresolvedCritical && avgConfidence > 4) {
      avgConfidence = 4; // Cap at 4/10 if critical issues unresolved
    }

    return avgConfidence;
  }

  /**
   * Check if session has unresolved high/blocker critique extensions
   */
  private hasUnresolvedCriticalExtensions(): boolean {
    const sessionThoughts = this.getCurrentSessionThoughts();

    for (const thought of sessionThoughts) {
      if (thought.extensions) {
        const hasCritical = thought.extensions.some(
          (e) => (e.impact === 'high' || e.impact === 'blocker') && e.type === 'critique'
        );
        if (hasCritical) {
          // Check if there's a revision for this thought
          const hasRevision = sessionThoughts.some(
            (t) => t.isRevision && t.revisesThought === thought.thoughtNumber
          );
          if (!hasRevision) return true;
        }
      }
    }
    return false;
  }

  /**
   * Generate ASCII tree visualization of thought structure (current session only)
   */
  private generateAsciiTree(): string {
    const sessionThoughts = this.getCurrentSessionThoughts();
    if (sessionThoughts.length === 0) return '(empty)';

    const lines: string[] = ['📊 Thought Tree:'];
    const mainThoughts = sessionThoughts.filter(
      (t) => !t.branchFromThought && !t.isRevision
    );

    for (const thought of mainThoughts) {
      const conf = thought.confidence ? ` [${thought.confidence}]` : '';
      const preview = thought.thought.substring(0, 40);
      lines.push(`├── ${thought.thoughtNumber}${conf}: ${preview}...`);

      // Show subSteps (fractal micro-plan)
      if (thought.subSteps && thought.subSteps.length > 0) {
        lines.push(`│   📋 Sub-steps:`);
        thought.subSteps.forEach((step, idx) => {
          lines.push(`│   ${idx === thought.subSteps!.length - 1 ? '└' : '├'}── ${step}`);
        });
      }

      // Show alternatives (quick comparison)
      if (thought.alternatives && thought.alternatives.length > 0) {
        lines.push(`│   ⚖️ Alternatives: [${thought.alternatives.join(' | ')}]`);
      }

      // Show extensions for this thought (vertical thinking)
      if (thought.extensions && thought.extensions.length > 0) {
        for (const ext of thought.extensions) {
          // Strategic Lens icons (v2.9.0)
          const typeIcon = ext.type === 'innovation' ? '💡' 
            : ext.type === 'optimization' ? '⚡' 
            : ext.type === 'polish' ? '✨'
            : ext.impact === 'blocker' ? '🚫' 
            : ext.impact === 'high' ? '⚠️' 
            : '📝';
          lines.push(`│   └── ${typeIcon} [${ext.type.toUpperCase()}]: ${ext.content.substring(0, 30)}...`);
        }
      }

      // Show revisions for this thought (from current session) with (R) indicator
      const revisions = sessionThoughts.filter(
        (t) => t.isRevision && t.revisesThought === thought.thoughtNumber
      );
      for (const rev of revisions) {
        const revConf = rev.confidence ? ` [${rev.confidence}]` : '';
        lines.push(`│   └── 🔄 (R${rev.thoughtNumber})${revConf}: ${rev.thought.substring(0, 25)}...`);
      }

      // Show branches from this thought
      for (const [branchId, branchThoughts] of this.branches) {
        const fromThis = branchThoughts.filter(
          (t) => t.branchFromThought === thought.thoughtNumber
        );
        if (fromThis.length > 0) {
          lines.push(`│   └── 🌿 [${branchId}]: ${fromThis.length} thought(s)`);
        }
      }
    }

    // Replace last ├── with └──
    if (lines.length > 1) {
      const lastIdx = lines.length - 1;
      lines[lastIdx] = lines[lastIdx].replace('├──', '└──');
    }

    return lines.join('\n');
  }

  /**
   * Sanitize text for safe Mermaid.js rendering
   * Escapes special characters that could break diagram syntax
   */
  private sanitizeForMermaid(text: string): string {
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

  /**
   * Generate Mermaid.js graph visualization (current session only)
   * Uses subgraphs for branches and visual intelligence for blockers/revised
   */
  private generateMermaid(): string {
    const sessionThoughts = this.getCurrentSessionThoughts();
    if (sessionThoughts.length === 0) return '';

    const lines: string[] = ['graph TD;'];
    const mainThoughts = sessionThoughts.filter(
      (t) => !t.branchFromThought && !t.isRevision
    );

    // Build set of revised thoughts (thoughts that have been superseded)
    const revisedThoughts = new Set(
      sessionThoughts
        .filter((t) => t.isRevision && t.revisesThought)
        .map((t) => t.revisesThought!)
    );

    // Build set of thoughts with blocker extensions
    const blockerThoughts = new Set(
      sessionThoughts
        .filter((t) => t.extensions?.some((e) => e.impact === 'blocker'))
        .map((t) => t.thoughtNumber)
    );

    // Main flow subgraph
    lines.push('  subgraph MainFlow["🧠 Main Reasoning"]');

    // Add start node
    if (mainThoughts.length > 0) {
      lines.push(`    start((Start)) --> ${mainThoughts[0].thoughtNumber};`);
    }

    // Process each main thought
    for (let i = 0; i < mainThoughts.length; i++) {
      const t = mainThoughts[i];
      const label = this.sanitizeForMermaid(t.thought.substring(0, 25));
      const confLabel = t.confidence ? `<br/>conf:${t.confidence}` : '';
      // Show subSteps count in Mermaid (keep graph clean, details in ASCII)
      const subStepsLabel = t.subSteps && t.subSteps.length > 0 ? `<br/>📋${t.subSteps.length} steps` : '';
      const altsLabel = t.alternatives && t.alternatives.length > 0 ? `<br/>⚖️${t.alternatives.length} alts` : '';

      // Determine style class with priority: blocker > revised > lowConf > highConf > normal
      let styleClass = 'normal';
      if (blockerThoughts.has(t.thoughtNumber)) {
        styleClass = 'blocker';
      } else if (revisedThoughts.has(t.thoughtNumber)) {
        styleClass = 'revised';
      } else if (t.confidence && t.confidence < 5) {
        styleClass = 'lowConf';
      } else if (t.confidence && t.confidence >= 8) {
        styleClass = 'highConf'; // Gold border for high confidence thoughts
      }

      lines.push(`    ${t.thoughtNumber}["#${t.thoughtNumber}: ${label}...${confLabel}${subStepsLabel}${altsLabel}"]:::${styleClass};`);

      // Edge to next thought
      if (i < mainThoughts.length - 1) {
        lines.push(`    ${t.thoughtNumber} --> ${mainThoughts[i + 1].thoughtNumber};`);
      }
    }
    lines.push('  end');

    // Extensions subgraph (if any)
    const hasExtensions = mainThoughts.some((t) => t.extensions && t.extensions.length > 0);
    if (hasExtensions) {
      lines.push('  subgraph Extensions["🔍 Deep Analysis"]');
      for (const t of mainThoughts) {
        if (t.extensions && t.extensions.length > 0) {
          t.extensions.forEach((ext, idx) => {
            const extId = `ext_${t.thoughtNumber}_${idx}`;
            const extLabel = this.sanitizeForMermaid(ext.content.substring(0, 20));
            const extClass = ext.impact === 'blocker' ? 'blocker' : ext.impact === 'high' ? 'highImpact' : 'ext';
            const icon = ext.impact === 'blocker' ? '🚫' : ext.impact === 'high' ? '⚠️' : '📝';
            lines.push(`    ${extId}[/"${icon} ${ext.type}: ${extLabel}..."/]:::${extClass};`);
          });
        }
      }
      lines.push('  end');
      // Connect extensions to main thoughts
      for (const t of mainThoughts) {
        if (t.extensions && t.extensions.length > 0) {
          t.extensions.forEach((_, idx) => {
            const extId = `ext_${t.thoughtNumber}_${idx}`;
            lines.push(`  ${t.thoughtNumber} -.-> ${extId};`);
          });
        }
      }
    }

    // Revisions subgraph (if any)
    const revisions = sessionThoughts.filter((t) => t.isRevision);
    if (revisions.length > 0) {
      lines.push('  subgraph Revisions["🔄 Revisions"]');
      revisions.forEach((rev, idx) => {
        const revId = `rev_${rev.revisesThought}_${idx}`;
        const revLabel = this.sanitizeForMermaid(rev.thought.substring(0, 20));
        lines.push(`    ${revId}["🔄 ${revLabel}..."]:::revision;`);
      });
      lines.push('  end');
      // Connect revisions to targets
      revisions.forEach((rev, idx) => {
        const revId = `rev_${rev.revisesThought}_${idx}`;
        lines.push(`  ${revId} ==> ${rev.revisesThought};`);
      });
    }

    // Branch subgraphs
    for (const [branchId, branchThoughts] of this.branches) {
      const sessionBranchThoughts = branchThoughts.filter((bt) => {
        const sessionStart = this.getCurrentSessionStartIndex();
        return this.thoughtHistory.indexOf(bt) >= sessionStart;
      });

      if (sessionBranchThoughts.length > 0) {
        lines.push(`  subgraph Branch_${branchId}["🌿 Branch: ${branchId}"]`);
        sessionBranchThoughts.forEach((bt, idx) => {
          const branchNodeId = `branch_${branchId}_${idx}`;
          const btLabel = this.sanitizeForMermaid(bt.thought.substring(0, 20));
          lines.push(`    ${branchNodeId}["${btLabel}..."]:::branch;`);
        });
        lines.push('  end');
        // Connect branches to source thoughts
        sessionBranchThoughts.forEach((bt, idx) => {
          if (bt.branchFromThought) {
            const branchNodeId = `branch_${branchId}_${idx}`;
            lines.push(`  ${bt.branchFromThought} -.->|${branchId}| ${branchNodeId};`);
          }
        });
      }
    }

    // Style definitions with visual intelligence
    lines.push('  classDef normal fill:#e1f5fe,stroke:#01579b;');
    lines.push('  classDef highConf fill:#e1f5fe,stroke:#ffd700,stroke-width:3px;'); // Gold border for high confidence
    lines.push('  classDef lowConf fill:#ffecb3,stroke:#ff6f00;');
    lines.push('  classDef blocker fill:#ffcdd2,stroke:#b71c1c,stroke-width:3px;');
    lines.push('  classDef revised fill:#e0e0e0,stroke:#9e9e9e,stroke-dasharray:5 5;');
    lines.push('  classDef highImpact fill:#fff3e0,stroke:#e65100;');
    lines.push('  classDef ext fill:#f3e5f5,stroke:#7b1fa2;');
    lines.push('  classDef revision fill:#e8f5e9,stroke:#2e7d32;');
    lines.push('  classDef branch fill:#e0f2f1,stroke:#00695c;');

    return lines.join('\n');
  }

  /**
   * Normalize text for stagnation comparison
   * Removes common filler phrases and extra whitespace
   */
  private normalizeForComparison(text: string): string {
    let normalized = text.toLowerCase();
    for (const phrase of FILLER_PHRASES) {
      normalized = normalized.replace(new RegExp(phrase, 'gi'), '');
    }
    return normalized.replace(/\s+/g, ' ').trim();
  }

  /**
   * Calculate word entropy (diversity) of text
   * Returns 0-1, higher = more diverse vocabulary
   * Includes technical short terms (api, db, etc.) that would otherwise be filtered
   */
  private calculateWordEntropy(text: string): number {
    const words = text.toLowerCase().split(/\s+/).filter((w) => 
      w.length > 2 || TECHNICAL_SHORT_TERMS.has(w)
    );
    if (words.length === 0) return 0;
    const uniqueWords = new Set(words);
    return uniqueWords.size / words.length;
  }

  /**
   * Detect stagnation - repeated similar thoughts with improved detection
   * Uses normalization and entropy analysis
   */
  private detectStagnation(newThought: string): string | undefined {
    if (this.thoughtHistory.length < STAGNATION_CHECK_COUNT) return undefined;

    const recent = this.thoughtHistory.slice(-STAGNATION_CHECK_COUNT);
    
    // Jaccard similarity check - more accurate than substring comparison
    const similarities = recent.map((t) => this.calculateJaccardSimilarity(newThought, t.thought));
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const allHighlySimilar = similarities.every((s) => s >= JACCARD_STAGNATION_THRESHOLD);

    if (allHighlySimilar && newThought.trim().length > 20) {
      return `🛑 STAGNATION DETECTED: Your last ${STAGNATION_CHECK_COUNT} thoughts are ${Math.round(avgSimilarity * 100)}% similar (Jaccard). FORCE yourself to try a DIFFERENT approach or use 'extend_thought' with 'critique' to analyze why you're stuck.`;
    }

    // Entropy check - detect low vocabulary diversity
    const newEntropy = this.calculateWordEntropy(newThought);
    const avgRecentEntropy = recent.reduce((sum, t) => sum + this.calculateWordEntropy(t.thought), 0) / recent.length;

    if (newEntropy < MIN_ENTROPY_THRESHOLD && avgRecentEntropy < MIN_ENTROPY_THRESHOLD) {
      return `🛑 LOW ENTROPY DETECTED: Your thoughts lack vocabulary diversity (entropy: ${newEntropy.toFixed(2)}). Try expressing your reasoning with different words or explore a completely new angle.`;
    }

    // Check for declining confidence
    const recentWithConf = recent.filter((t) => t.confidence !== undefined);
    if (recentWithConf.length >= 3) {
      const isDecreasing = recentWithConf.every((t, i) => {
        if (i === 0) return true;
        return (t.confidence ?? 10) <= (recentWithConf[i - 1].confidence ?? 10);
      });
      const avgRecent = recentWithConf.reduce((sum, t) => sum + (t.confidence ?? 0), 0) / recentWithConf.length;

      if (isDecreasing && avgRecent < 5) {
        return `⚠️ CONFIDENCE DECLINING: Average confidence dropped to ${avgRecent.toFixed(1)}. Consider using 'extend_thought' to critique your approach.`;
      }
    }

    return undefined;
  }

  /**
   * Validate path connectivity - ensure thoughts in winningPath are logically connected
   * Each thought must be reachable from its predecessor via sequence, branch, or revision
   */
  private validatePathConnectivity(winningPath: number[]): PathConnectivityResult {
    if (winningPath.length <= 1) return { valid: true };

    const sessionThoughts = this.getCurrentSessionThoughts();
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

  /**
   * Extend a thought with deep-dive analysis (vertical thinking)
   * Attaches critique, elaboration, correction, or alternative to existing thought
   * Uses findLastIndex to target the most recent thought with that number (current session)
   */
  extendThought(input: ExtendThoughtInput): ExtendThoughtResult {
    const { targetThoughtNumber, extensionType, content, impactOnFinalResult } = input;

    // Find target thought from the END (most recent first - current session priority)
    let targetIndex = -1;
    for (let i = this.thoughtHistory.length - 1; i >= 0; i--) {
      if (this.thoughtHistory[i].thoughtNumber === targetThoughtNumber) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      return {
        status: 'error',
        systemAdvice: `Thought #${targetThoughtNumber} not found.`,
        errorMessage: `Thought #${targetThoughtNumber} not found in history.`,
      };
    }

    // Validate target is in current session
    const sessionStartIdx = this.getCurrentSessionStartIndex();
    if (targetIndex < sessionStartIdx) {
      return {
        status: 'error',
        systemAdvice: `Thought #${targetThoughtNumber} is from a previous session.`,
        errorMessage: `Thought #${targetThoughtNumber} exists but belongs to a previous session. Only current session thoughts can be extended.`,
      };
    }

    // Initialize extensions array if needed
    if (!this.thoughtHistory[targetIndex].extensions) {
      this.thoughtHistory[targetIndex].extensions = [];
    }

    // Create extension record
    const extension: ThoughtExtension = {
      type: extensionType,
      content,
      impact: impactOnFinalResult,
      timestamp: new Date().toISOString(),
    };

    this.thoughtHistory[targetIndex].extensions!.push(extension);

    // Log to stderr
    console.error(
      `🔍 Deep Dive on #${targetThoughtNumber} [${extensionType.toUpperCase()}]: ${content.substring(0, 50)}...`
    );

    // Generate system advice based on extension type and impact
    let systemAdvice = 'Extension recorded.';
    
    // Strategic Lens specific advice (v2.9.0)
    switch (extensionType) {
      case 'innovation':
        systemAdvice = '💡 INNOVATION recorded. Ensure you proposed 2-3 concrete directions. Consider which aligns best with project goals.';
        break;
      case 'optimization':
        systemAdvice = '⚡ OPTIMIZATION recorded. Did you include "Before vs After" metrics? Quantify the improvement.';
        break;
      case 'polish':
        systemAdvice = '✨ POLISH recorded. Create a checklist of specific items to fix. Track completion in next thoughts.';
        break;
      default:
        // Original logic for other types
        if (impactOnFinalResult === 'blocker' || impactOnFinalResult === 'high') {
          systemAdvice =
            "WARNING: This extension identified a critical issue. You should probably use 'sequentialthinking' with isRevision: true next.";
        }
    }

    return {
      status: 'success',
      targetThought: this.thoughtHistory[targetIndex].thought.substring(0, 100) + '...',
      totalExtensionsOnThisThought: this.thoughtHistory[targetIndex].extensions!.length,
      systemAdvice,
    };
  }

  /**
   * Format full history with extensions for AI context
   */
  formatHistoryForAI(): string {
    return this.thoughtHistory
      .map((t) => {
        let output = `${t.thoughtNumber}. ${t.thought}`;

        // Add extensions with indentation
        if (t.extensions && t.extensions.length > 0) {
          const extText = t.extensions
            .map(
              (e) =>
                `   └── [${e.type.toUpperCase()} - Impact: ${e.impact}]: ${e.content}`
            )
            .join('\n');
          output += `\n${extText}`;
        }

        return output;
      })
      .join('\n');
  }

  /**
   * Format history with smart pruning for long sessions
   * Condenses old thoughts while keeping recent ones in full detail
   */
  formatCondensedHistory(): string {
    if (this.thoughtHistory.length <= RETAIN_FULL_THOUGHTS + 2) {
      return this.formatHistoryForAI(); // Return full history if short
    }

    const oldThoughts = this.thoughtHistory.slice(0, -RETAIN_FULL_THOUGHTS);
    const recentThoughts = this.thoughtHistory.slice(-RETAIN_FULL_THOUGHTS);

    // Generate condensed block for archived thoughts
    const condensedBlock = [
      `📚 ARCHIVED THOUGHTS (1-${oldThoughts.length}):`,
      `[Summary]: Completed ${oldThoughts.length} initial analysis steps.`,
      'Key outcomes:',
      ...oldThoughts.map((t) => {
        const confStr = t.confidence ? ` [conf:${t.confidence}]` : '';
        return `- Step ${t.thoughtNumber}${confStr}: ${t.thought.substring(0, 50)}...`;
      }),
    ].join('\n');

    // Format recent thoughts in full detail
    const recentBlock = recentThoughts
      .map((t) => {
        let output = `${t.thoughtNumber}. ${t.thought}`;
        if (t.extensions && t.extensions.length > 0) {
          const extText = t.extensions
            .map((e) => `   └── [${e.type.toUpperCase()} - Impact: ${e.impact}]: ${e.content}`)
            .join('\n');
          output += `\n${extText}`;
        }
        return output;
      })
      .join('\n\n');

    return `${condensedBlock}\n\n📍 CURRENT FOCUS (Last ${RETAIN_FULL_THOUGHTS} thoughts):\n${recentBlock}`;
  }

  /**
   * Save session state to file for persistence
   * Uses FS lock to prevent race conditions with concurrent calls
   * v3.2.0: Atomic write (tmp → rename) for crash safety
   */
  async saveSession(): Promise<void> {
    return this.withFsLock(async () => {
      const data = {
        history: this.thoughtHistory,
        branches: Array.from(this.branches.entries()),
        lastThoughtNumber: this.lastThoughtNumber,
        savedAt: new Date().toISOString(),
        goal: this.sessionGoal, // v2.10.0 - persist goal
        currentSessionId: this.currentSessionId, // v2.11.0 - persist sessionId
        deadEnds: this.deadEnds, // v3.3.0 - persist dead ends
      };

      const tempFile = `${SESSION_FILE}.tmp`;
      try {
        // v3.2.0: Atomic write - write to temp file first, then rename
        await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempFile, SESSION_FILE);
      } catch (error) {
        console.error('Failed to save session:', error);
        // Clean up temp file if rename failed
        try { await fs.unlink(tempFile); } catch { /* ignore */ }
      }
    });
  }

  /**
   * Load session state from file
   * Call this during initialization to restore previous session
   * Validates JSON structure to prevent corrupted state
   * v3.2.0: Added TTL check - auto-reset if session older than 24h
   */
  async loadSession(): Promise<boolean> {
    try {
      // v3.2.0: Check session TTL before loading
      const stats = await fs.stat(SESSION_FILE);
      const hoursOld = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      if (hoursOld > SESSION_TTL_HOURS) {
        console.error(`⏰ Session expired (${Math.round(hoursOld)}h old > ${SESSION_TTL_HOURS}h TTL), auto-resetting...`);
        await this.clearSession();
        return false;
      }

      const content = await fs.readFile(SESSION_FILE, 'utf-8');
      const data = JSON.parse(content);

      // Validate JSON structure before using
      if (!data || !Array.isArray(data.history) || !Array.isArray(data.branches)) {
        throw new Error('Invalid session structure');
      }

      this.thoughtHistory = data.history as ThoughtRecord[];
      this.branches = new Map(data.branches);
      this.lastThoughtNumber = data.lastThoughtNumber ?? 0;
      this.sessionGoal = data.goal; // v2.10.0 - restore goal
      this.currentSessionId = data.currentSessionId ?? ''; // v2.11.0 - restore sessionId
      this.deadEnds = data.deadEnds ?? []; // v3.3.0 - restore dead ends

      const deadEndsInfo = this.deadEnds.length > 0 ? `, ${this.deadEnds.length} dead ends` : '';
      console.error(`📂 Restored session from ${data.savedAt} (${this.thoughtHistory.length} thoughts${deadEndsInfo}${this.currentSessionId ? `, session: ${this.currentSessionId.substring(0, 10)}...` : ''})`);
      return true;
    } catch (error) {
      // File doesn't exist or is corrupted - start fresh
      console.error('No previous session found or corrupted, starting fresh');
      return false;
    }
  }

  /**
   * Reset thinking state for new session
   */
  reset(): void {
    this.thoughtHistory = [];
    this.branches.clear();
    this.lastThoughtNumber = 0;
    this.sessionGoal = undefined; // Clear goal on reset (v2.10.0)
    this.currentSessionId = ''; // Clear sessionId on reset (v2.11.0)
    this.recentAdvices = []; // Clear coach cooldown (v3.2.0)
    this.deadEnds = []; // Clear dead ends (v3.3.0)
  }

  /**
   * Clear saved session file only (does NOT reset in-memory state)
   * Uses FS lock to prevent race conditions with concurrent calls
   * Note: reset() is called separately in processThought to avoid race condition
   */
  async clearSession(): Promise<void> {
    return this.withFsLock(async () => {
      try {
        await fs.unlink(SESSION_FILE);
        console.error('Session file cleared');
      } catch {
        // File doesn't exist, ignore
      }
      // DO NOT call reset() here - it causes race condition with processThought
      // Memory reset is handled synchronously in processThought before this runs
    });
  }

  /**
   * Consolidate and verify the thinking process (meta-cognitive audit)
   * Forces model to synthesize, cross-check, and find contradictions
   * Works only with current session thoughts
   */
  consolidate(input: import('../types/thought.types.js').ConsolidateInput): import('../types/thought.types.js').ConsolidateResult {
    const { winningPath, verdict } = input;
    const warnings: string[] = [];

    // Get current session thoughts only
    const sessionThoughts = this.getCurrentSessionThoughts();

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
    const connectivityCheck = this.validatePathConnectivity(winningPath);
    if (!connectivityCheck.valid) {
      warnings.push(`🚫 PATH DISCONTINUITY: ${connectivityCheck.error}`);
    }

    // Find low-confidence thoughts in winning path (current session only)
    const lowConfidenceInPath = sessionThoughts
      .filter((t) => winningPath.includes(t.thoughtNumber))
      .filter((t) => t.confidence !== undefined && t.confidence < 5)
      .map((t) => t.thoughtNumber);

    if (lowConfidenceInPath.length > 0) {
      warnings.push(
        `⚠️ LOW CONFIDENCE: Your winning path includes thoughts with confidence < 5: #${lowConfidenceInPath.join(', ')}. Are you sure about these steps?`
      );
    }

    // Check ignored thoughts ratio (current session only)
    const ignoredRatio = 1 - winningPath.length / sessionThoughts.length;
    if (ignoredRatio > 0.6) {
      warnings.push(
        `⚠️ HIGH DISCARD RATE: You are ignoring ${Math.round(ignoredRatio * 100)}% of your thoughts. Ensure you haven't missed important contradictions in discarded branches.`
      );
    }

    // Find unaddressed BLOCKER extensions (current session only)
    const unaddressedBlockers: number[] = [];
    // Find unaddressed HIGH impact critique extensions (current session only)
    const unaddressedCritical: number[] = [];

    for (const thought of sessionThoughts) {
      if (thought.extensions) {
        // Check for BLOCKER impact
        const hasBlocker = thought.extensions.some((e) => e.impact === 'blocker');
        // Check for HIGH impact CRITIQUE specifically
        const hasHighCritique = thought.extensions.some(
          (e) => e.impact === 'high' && e.type === 'critique'
        );

        if (winningPath.includes(thought.thoughtNumber)) {
          // Check if there's a revision addressing this thought in current session
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

    // CRITICAL: Check for missing revisions in winningPath
    // If thought X in path has critical extension AND revision exists, revision MUST be in path too
    const missingRevisions: number[] = [];
    for (const thought of sessionThoughts) {
      if (!winningPath.includes(thought.thoughtNumber)) continue;
      if (!thought.extensions) continue;

      const hasCritical = thought.extensions.some(
        (e) => (e.impact === 'high' || e.impact === 'blocker') && e.type === 'critique'
      );
      if (!hasCritical) continue;

      // Find revision for this thought
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

    // Determine if can proceed - STRICT MODE: block on blockers, critical issues, missing revisions, or path discontinuity
    const hasBlockerWarnings = unaddressedBlockers.length > 0;
    const hasCriticalWarnings = unaddressedCritical.length > 0;
    const hasMissingRevisions = missingRevisions.length > 0;
    const hasPathDiscontinuity = !connectivityCheck.valid;
    const canProceed = verdict === 'ready' && !hasBlockerWarnings && !hasCriticalWarnings && !hasMissingRevisions && !hasPathDiscontinuity && warnings.length <= 1;

    // Generate evaluation message
    let evaluation: string;
    if (canProceed) {
      evaluation = '✅ SYNTHESIS ACCEPTED: Your reasoning chain is coherent. You may proceed to final answer.';
    } else if (verdict === 'needs_more_work') {
      evaluation = '🔄 ACKNOWLEDGED: You identified this needs more work. Continue with sequentialthinking or extend_thought.';
      
      // v3.3.0: Record this path as a dead end
      this.recordDeadEnd(winningPath, input.summary);
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
        disconnectedAt: connectivityCheck.disconnectedAt ? [connectivityCheck.disconnectedAt] : undefined,
      },
    };
  }

  /**
   * Reset current session and clear persistence
   * Returns info about what was cleared
   */
  async resetSession(): Promise<{ clearedThoughts: number; clearedBranches: number }> {
    const clearedThoughts = this.thoughtHistory.length;
    const clearedBranches = this.branches.size;

    this.reset();
    await this.clearSession();

    console.error(`🧹 Session reset: cleared ${clearedThoughts} thoughts, ${clearedBranches} branches`);

    return { clearedThoughts, clearedBranches };
  }

  /**
   * Export current session as Markdown report (v2.10.0)
   * Use after consolidate_and_verify to save session results
   */
  exportSession(options: { format?: 'markdown' | 'json'; includeMermaid?: boolean } = {}): string {
    const { format = 'markdown', includeMermaid = true } = options;
    const session = this.getCurrentSessionThoughts();

    if (session.length === 0) {
      return format === 'json'
        ? JSON.stringify({ error: 'No thoughts recorded in current session' })
        : '# Think Session Report\n\n*No thoughts recorded in current session.*';
    }

    if (format === 'json') {
      return JSON.stringify(
        {
          goal: this.sessionGoal,
          thoughts: session,
          branches: Array.from(this.branches.entries()),
          deadEnds: this.getDeadEnds(), // v3.3.0
          averageConfidence: this.calculateAverageConfidence(),
          exportedAt: new Date().toISOString(),
        },
        null,
        2
      );
    }

    // Markdown format
    const sections: string[] = [
      '# Think Session Report',
      `**Date:** ${new Date().toISOString().split('T')[0]}`,
      '',
    ];

    // Goal section
    if (this.sessionGoal) {
      sections.push(`## 🎯 Goal`, this.sessionGoal, '');
    }

    // Summary section
    const currentDeadEnds = this.getDeadEnds();
    sections.push(
      '## 📊 Summary',
      `- **Total thoughts:** ${session.length}`,
      `- **Branches:** ${this.branches.size}`,
      `- **Dead ends:** ${currentDeadEnds.length}`,
      `- **Average confidence:** ${this.calculateAverageConfidence() ?? 'N/A'}`,
      ''
    );

    // Thoughts section
    sections.push('## 💭 Thoughts', '');
    session.forEach((t) => {
      const confStr = t.confidence ? ` [confidence: ${t.confidence}/10]` : '';
      const revStr = t.isRevision ? ` *(revision of #${t.revisesThought})*` : '';
      const branchStr = t.branchFromThought ? ` *(branch from #${t.branchFromThought})*` : '';

      sections.push(`### Thought #${t.thoughtNumber}${confStr}${revStr}${branchStr}`);
      sections.push(t.thought);

      if (t.subSteps && t.subSteps.length > 0) {
        sections.push('', '**Sub-steps:**');
        t.subSteps.forEach((s) => sections.push(`- ${s}`));
      }

      if (t.alternatives && t.alternatives.length > 0) {
        sections.push('', `**Alternatives considered:** ${t.alternatives.join(' | ')}`);
      }

      if (t.extensions && t.extensions.length > 0) {
        sections.push('', '**Extensions:**');
        t.extensions.forEach((e) => {
          const icon =
            e.type === 'innovation' ? '💡' : e.type === 'optimization' ? '⚡' : e.type === 'polish' ? '✨' : '📝';
          sections.push(`- ${icon} **[${e.type.toUpperCase()}]** (${e.impact}): ${e.content}`);
        });
      }

      sections.push('');
    });

    // Dead Ends section (v3.3.0)
    if (currentDeadEnds.length > 0) {
      sections.push('## 💀 Dead Ends (Rejected Paths)', '');
      currentDeadEnds.forEach((de, idx) => {
        sections.push(`### Dead End #${idx + 1}`);
        sections.push(`- **Path:** [${de.path.join(' → ')}]`);
        sections.push(`- **Reason:** ${de.reason}`);
        sections.push(`- **Recorded:** ${de.timestamp}`);
        sections.push('');
      });
    }

    // Mermaid diagram
    if (includeMermaid) {
      const mermaid = this.generateMermaid();
      if (mermaid) {
        sections.push('## 🔀 Diagram', '', '```mermaid', mermaid, '```', '');
      }
    }

    return sections.join('\n');
  }

  // ============================================
  // v3.4.0 - Recall Edition: Fuzzy Search
  // ============================================

  /**
   * Build searchable items array for Fuse.js index
   * Extracts thoughts, extensions, alternatives, and subSteps
   */
  private buildSearchItems(thoughts: ThoughtRecord[]): FuseSearchItem[] {
    const items: FuseSearchItem[] = [];

    for (const t of thoughts) {
      // Add main thought
      items.push({
        thoughtNumber: t.thoughtNumber,
        content: t.thought,
        type: 'thought',
        confidence: t.confidence,
        sessionId: t.sessionId,
        originalThought: t.thought,
      });

      // Add extensions
      if (t.extensions) {
        for (const ext of t.extensions) {
          items.push({
            thoughtNumber: t.thoughtNumber,
            content: ext.content,
            type: 'extension',
            extensionType: ext.type,
            confidence: t.confidence,
            sessionId: t.sessionId,
            originalThought: t.thought,
          });
        }
      }

      // Add alternatives
      if (t.alternatives) {
        for (const alt of t.alternatives) {
          items.push({
            thoughtNumber: t.thoughtNumber,
            content: alt,
            type: 'alternative',
            confidence: t.confidence,
            sessionId: t.sessionId,
            originalThought: t.thought,
          });
        }
      }

      // Add subSteps
      if (t.subSteps) {
        for (const step of t.subSteps) {
          items.push({
            thoughtNumber: t.thoughtNumber,
            content: step,
            type: 'subStep',
            confidence: t.confidence,
            sessionId: t.sessionId,
            originalThought: t.thought,
          });
        }
      }
    }

    return items;
  }

  /**
   * Initialize or rebuild Fuse.js index
   * Called lazily on first search or when index is dirty
   */
  private rebuildFuseIndex(scope: RecallScope): void {
    const thoughts = scope === 'current' 
      ? this.getCurrentSessionThoughts() 
      : this.thoughtHistory;

    const items = this.buildSearchItems(thoughts);

    this.fuseIndex = new Fuse(items, {
      keys: ['content'],
      threshold: RECALL_DEFAULT_THRESHOLD,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true, // Search entire content, not just beginning
    });

    this.fuseIndexDirty = false;
    console.error(`🔍 Fuse index rebuilt: ${items.length} searchable items from ${thoughts.length} thoughts`);
  }

  /**
   * Mark Fuse index as dirty (needs rebuild)
   * Called after adding new thoughts
   */
  private invalidateFuseIndex(): void {
    this.fuseIndexDirty = true;
  }

  /**
   * Extract snippet with context around the match
   * Returns ~200 chars centered on the match
   */
  private extractSnippet(text: string, query: string): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase().split(/\s+/)[0]; // Use first word for matching
    const idx = lowerText.indexOf(lowerQuery);

    if (idx === -1) {
      // Fuzzy match - return beginning of text
      return text.length > 200 ? text.substring(0, 200) + '...' : text;
    }

    // Extract context window around match
    const start = Math.max(0, idx - RECALL_SNIPPET_CONTEXT);
    const end = Math.min(text.length, idx + lowerQuery.length + RECALL_SNIPPET_CONTEXT);
    
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    
    // Find word boundaries for cleaner snippets
    let snippetStart = start;
    let snippetEnd = end;
    
    if (start > 0) {
      const spaceIdx = text.indexOf(' ', start);
      if (spaceIdx !== -1 && spaceIdx < idx) {
        snippetStart = spaceIdx + 1;
      }
    }
    
    if (end < text.length) {
      const spaceIdx = text.lastIndexOf(' ', end);
      if (spaceIdx !== -1 && spaceIdx > idx) {
        snippetEnd = spaceIdx;
      }
    }

    return prefix + text.substring(snippetStart, snippetEnd).trim() + suffix;
  }

  /**
   * RECALL THOUGHT (v3.4.0) - Fuzzy search through thought history
   * Helps model "remember" details from earlier in the session
   */
  recallThought(input: RecallInput): RecallResult {
    const {
      query,
      scope = 'current',
      searchIn = 'all',
      limit = RECALL_DEFAULT_LIMIT,
      threshold = RECALL_DEFAULT_THRESHOLD,
    } = input;

    // Validate query
    if (!query || query.trim().length < 2) {
      return {
        matches: [],
        totalSearched: 0,
        query,
        searchParams: { scope, searchIn, threshold },
      };
    }

    // Rebuild index if dirty or scope changed
    if (this.fuseIndexDirty || !this.fuseIndex) {
      this.rebuildFuseIndex(scope);
    }

    // Perform search (get more results than needed for filtering)
    const rawResults = this.fuseIndex?.search(query, { limit: limit * 5 }) ?? [];

    // Filter by threshold (Fuse returns score where lower = better match)
    const thresholdFiltered = rawResults.filter(r => (r.score ?? 1) <= threshold);

    // Filter by searchIn parameter
    const filteredResults = thresholdFiltered.filter(r => {
      if (searchIn === 'all') return true;
      if (searchIn === 'thoughts') return r.item.type === 'thought';
      if (searchIn === 'extensions') return r.item.type === 'extension';
      if (searchIn === 'alternatives') return r.item.type === 'alternative' || r.item.type === 'subStep';
      return true;
    });

    // Map to RecallMatch format
    const matches: RecallMatch[] = filteredResults.slice(0, limit).map(r => ({
      thoughtNumber: r.item.thoughtNumber,
      snippet: this.extractSnippet(r.item.content, query),
      thought: r.item.originalThought.length > 300 
        ? r.item.originalThought.substring(0, 300) + '...' 
        : r.item.originalThought,
      confidence: r.item.confidence,
      relevance: r.score ?? 1,
      matchedIn: r.item.type,
      extensionType: r.item.extensionType as import('../types/thought.types.js').ExtensionType | undefined,
      sessionId: r.item.sessionId,
    }));

    // Log search
    console.error(`🔍 Recall search: "${query}" → ${matches.length} matches (searched ${filteredResults.length} items)`);

    return {
      matches,
      totalSearched: rawResults.length,
      query,
      searchParams: { scope, searchIn, threshold },
    };
  }
}
