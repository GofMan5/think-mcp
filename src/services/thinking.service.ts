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
import type {
  ThoughtInput,
  ThoughtRecord,
  ThinkingResult,
  ThoughtExtension,
  QuickExtension,
  DeadEnd,
  RecallInput,
  RecallResult,
  RuntimeThinkState,
  PathConnectivityResult,
  // v4.0.0 - Burst Thinking
  SubmitSessionInput,
  SubmitSessionResult,
} from '../types/thought.types.js';
import type { SaveInsightInput } from './insights.service.js';
import {
  getThinkMcpDataFile,
  migrateLegacyFile,
} from '../utils/storage-paths.js';

// Import constants from dedicated modules
import {
  MAX_DEAD_ENDS,
  SESSION_TTL_HOURS,
  SESSION_FILE_NAME,
  RECENT_WEIGHT_MULTIPLIER,
  RECENT_THOUGHTS_COUNT,
} from '../constants/index.js';

// Import visualization service
import { VisualizationService } from './visualization.service.js';

// Import validation service
import { ValidationService } from './validation.service.js';

// Import stagnation service
import { StagnationService } from './stagnation.service.js';

// Import consolidate service
import { ConsolidateService } from './consolidate.service.js';

// Import recall service
import { RecallService } from './recall.service.js';

// Import export service
import { ExportService } from './export.service.js';

// Import burst service
import { BurstService } from './burst.service.js';

// Import coaching service
import { CoachingService } from './coaching.service.js';

// Import insights service (v4.1.0)
import { InsightsService } from './insights.service.js';

// Import nudge service (v4.6.0)
import { NudgeService } from './nudge.service.js';
import { RuntimeStateService } from './runtime-state.service.js';

// Session file path (relative to module directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LEGACY_SESSION_FILE = join(__dirname, '..', '..', SESSION_FILE_NAME);
const SESSION_FILE = getThinkMcpDataFile(SESSION_FILE_NAME);

export class ThinkingService {
  private thoughtHistory: ThoughtRecord[] = [];
  private branches: Map<string, ThoughtRecord[]> = new Map();
  private lastThoughtNumber = 0;
  /** Session goal for focus retention (v2.10.0) */
  private sessionGoal: string | undefined;
  /** Current session ID for isolation (v2.11.0) */
  private currentSessionId: string = '';
  /** Shared runtime scope ID for cross-tool coordination */
  private currentScopeId: string = '';

  /** Dead ends - paths that were rejected (v3.3.0) */
  private deadEnds: DeadEnd[] = [];

  /** Visualization service for ASCII tree and Mermaid generation */
  private visualizationService = new VisualizationService();

  /** Validation service for sequence and path validation */
  private validationService = new ValidationService();

  /** Stagnation service for detecting repetitive thinking */
  private stagnationService = new StagnationService();

  /** Consolidate service for meta-cognitive audit */
  private consolidateService = new ConsolidateService();

  /** Recall service for fuzzy search */
  private recallService = new RecallService();

  /** Coaching service for proactive advice */
  private coachingService = new CoachingService();

  /** Export service for session reports */
  private exportService = new ExportService();

  /** Burst service for session validation */
  private burstService = new BurstService();

  /** Insights service for cross-session learning (v4.1.0) */
  private insightsService = new InsightsService();

  /** Nudge service for proactive micro-prompts (v4.6.0) */
  private nudgeService = new NudgeService();

  constructor(private readonly runtimeState?: RuntimeStateService) {}

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

  getRuntimeBootstrapState(): RuntimeThinkState | undefined {
    if (this.thoughtHistory.length === 0) return undefined;
    return {
      history: JSON.parse(JSON.stringify(this.thoughtHistory)) as ThoughtRecord[],
      branches: JSON.parse(JSON.stringify(Array.from(this.branches.entries()))) as [string, ThoughtRecord[]][],
      lastThoughtNumber: this.lastThoughtNumber,
      goal: this.sessionGoal,
      currentSessionId: this.currentSessionId || undefined,
      currentScopeId: this.currentScopeId || undefined,
      deadEnds: JSON.parse(JSON.stringify(this.deadEnds)) as DeadEnd[],
    };
  }

  private getRuntimeStateView(): RuntimeThinkState | undefined {
    if (this.thoughtHistory.length === 0) return undefined;
    return {
      history: this.thoughtHistory,
      branches: Array.from(this.branches.entries()),
      lastThoughtNumber: this.lastThoughtNumber,
      goal: this.sessionGoal,
      currentSessionId: this.currentSessionId || undefined,
      currentScopeId: this.currentScopeId || undefined,
      deadEnds: this.deadEnds,
    };
  }

  restoreRuntimeScope(scopeId: string | undefined, thinkState?: RuntimeThinkState): void {
    this.reset();
    this.currentScopeId = scopeId ?? thinkState?.currentScopeId ?? '';
    if (!thinkState) {
      this.invalidateFuseIndex();
      return;
    }

    this.thoughtHistory = JSON.parse(JSON.stringify(thinkState.history ?? [])) as ThoughtRecord[];
    this.branches = new Map(JSON.parse(JSON.stringify(thinkState.branches ?? [])) as [string, ThoughtRecord[]][]);
    this.lastThoughtNumber = thinkState.lastThoughtNumber ?? 0;
    this.sessionGoal = thinkState.goal;
    this.currentSessionId = thinkState.currentSessionId ?? '';
    this.deadEnds = JSON.parse(JSON.stringify(thinkState.deadEnds ?? [])) as DeadEnd[];
    this.invalidateFuseIndex();
  }

  getThoughtsForScope(scopeId?: string): ThoughtRecord[] {
    if (!scopeId) {
      return [...this.getCurrentSessionThoughts()];
    }

    if (scopeId === this.currentScopeId && this.thoughtHistory.length > 0) {
      return [...this.getCurrentSessionThoughts()];
    }

    const runtimeThinkState = this.runtimeState?.getThinkState(scopeId);
    return runtimeThinkState?.history ? [...runtimeThinkState.history] : [];
  }

  private syncRuntimeScope(): void {
    if (!this.runtimeState || !this.currentScopeId) return;
    const snapshot = this.getRuntimeStateView();
    if (!snapshot) return;
    this.runtimeState.upsertThinkState(this.currentScopeId, snapshot);
  }

  private resolveScopeForNewThinkSession(scopeId: string | undefined, goal?: string): string | undefined {
    if (!this.runtimeState) {
      return scopeId;
    }

    if (scopeId) {
      if (!this.runtimeState.hasScope(scopeId)) {
        return undefined;
      }
      this.runtimeState.activateScope(scopeId);
      return scopeId;
    }

    return this.runtimeState.createScope(goal);
  }

  private thoughtError(input: ThoughtInput, message: string | undefined, showTree = false): ThinkingResult {
    return {
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: true,
      thoughtTree: showTree ? this.generateAsciiTree() : '',
      isError: true,
      errorMessage: message,
      warning: message,
      scopeId: this.currentScopeId || undefined,
    };
  }

  /** Append a mirrored cycle thought to its scope without replacing an existing think snapshot. */
  processThoughtInScope(input: ThoughtInput, scopeId: string): ThinkingResult {
    const targetState = this.runtimeState?.getThinkState(scopeId);
    if (!targetState?.history.length) {
      return this.processThought({ ...input, scopeId: input.thoughtNumber === 1 ? scopeId : undefined });
    }

    if (this.currentScopeId !== scopeId) {
      this.restoreRuntimeScope(scopeId, targetState);
    }
    const lastMainlineThought = this.getCurrentSessionThoughts().reduce(
      (last, thought) => thought.isRevision || thought.branchFromThought
        ? last
        : Math.max(last, thought.thoughtNumber),
      this.lastThoughtNumber
    );
    const thoughtNumber = input.isRevision && lastMainlineThought > 0
      ? lastMainlineThought
      : lastMainlineThought + 1;

    return this.processThought({
      ...input,
      thoughtNumber,
      totalThoughts: Math.max(input.totalThoughts, thoughtNumber),
      goal: undefined,
      scopeId: undefined,
      revisesThought: input.isRevision
        ? input.revisesThought ?? lastMainlineThought
        : input.revisesThought,
    });
  }

  /**
   * Process a thought with validation and context echoing
   * Implements Strict Logic Mode with hard duplicate rejection
   */
  processThought(input: ThoughtInput): ThinkingResult {
    if (input.scopeId && input.thoughtNumber !== 1) {
      return this.thoughtError(input, '[ERR_SCOPE_INPUT] scopeId is accepted only on thoughtNumber=1.');
    }

    // Auto-adjust totalThoughts if exceeded
    if (input.thoughtNumber > input.totalThoughts) {
      input = { ...input, totalThoughts: input.thoughtNumber };
    }
    const shouldShowTree = input.showTree === true;
    const isNewSession = input.thoughtNumber === 1 && !input.isRevision;

    // EMPTY THOUGHT VALIDATION - reject meaningless input
    if (!input.thought || !input.thought.trim()) {
      return this.thoughtError(input, '[ERR_EMPTY_THOUGHT] Empty thought. Provide meaningful content.', shouldShowTree);
    }

    if (input.scopeId && this.runtimeState && !this.runtimeState.hasScope(input.scopeId)) {
      return this.thoughtError(input, `[ERR_SCOPE_NOT_FOUND] Unknown scopeId: ${input.scopeId}`, shouldShowTree);
    }

    const sessionThoughts = isNewSession ? [] : this.getCurrentSessionThoughts();
    const lastThoughtNumber = isNewSession ? 0 : this.lastThoughtNumber;

    // HARD DUPLICATE REJECTION - reject before adding to history
    const duplicateError = this.validationService.checkDuplicateStrict(input, sessionThoughts);
    if (duplicateError) {
      return this.thoughtError(input, duplicateError, shouldShowTree);
    }

    // BRANCH VALIDATION - reject if branchFromThought references non-existent thought
    const branchError = this.validationService.validateBranchSource(input, sessionThoughts);
    if (branchError) {
      return this.thoughtError(input, branchError, shouldShowTree);
    }

    // Validate sequence (includes shallow/circular revision check)
    const validation = this.validationService.validateSequence(input, sessionThoughts, lastThoughtNumber);
    
    // HARD REJECTION for invalid sequence/revision validation failures
    if (!validation.valid) {
      return this.thoughtError(input, validation.warning, shouldShowTree);
    }

    // Commit a new session only after every rejecting validation has passed.
    if (isNewSession) {
      if (this.thoughtHistory.length > 0) {
        console.error('🔄 New session detected (thought #1), clearing previous state...');
        this.reset();
      }
      this.currentScopeId = this.resolveScopeForNewThinkSession(input.scopeId, input.goal) ?? '';
      this.currentSessionId = new Date().toISOString();
      console.error(`🆔 New session ID: ${this.currentSessionId}`);
    } else if (!this.currentScopeId) {
      this.currentScopeId = this.runtimeState?.getActiveScopeId() ?? '';
    }

    // SESSION GOAL (v2.10.0) - Save goal from first thought
    if (input.goal && input.thoughtNumber === 1) {
      this.sessionGoal = input.goal;
      console.error(`🎯 Session goal set: ${input.goal.substring(0, 50)}...`);
    }

    // Check for stagnation before adding new thought
    const stagnationWarning = this.detectStagnation(input.thought);

    // Create record with timestamp and sessionId (v2.11.0)
    const record: ThoughtRecord = {
      ...input,
      timestamp: Date.now(),
      sessionId: this.currentSessionId,
      metadata: { source: 'think' },
    };

    this.thoughtHistory.push(record);
    // Revisions and branches do not advance the mainline sequence counter.
    if (!input.isRevision && !input.branchFromThought) {
      this.lastThoughtNumber = input.thoughtNumber;
    }

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

    // Combine warnings
    const warning = [validation.warning, stagnationWarning].filter(Boolean).join('\n');

    // QUICK EXTENSION (v3.1.0) - Process inline extension if provided
    if (input.quickExtension) {
      this.processQuickExtension(input.thoughtNumber, input.quickExtension);
    }

    this.syncRuntimeScope();

    // LATERAL THINKING TRIGGER - check for overly linear thinking
    // v5.0.1: Pass isFinishing flag to show subSteps check only at end
    let systemAdvice = this.checkLateralThinking(!input.nextThoughtNeeded);

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

    // v4.6.0: Generate nudge only if no other warnings/advice (avoid noise)
    const shouldSkipNudge = !!(warning || systemAdvice);
    const nudge = this.nudgeService.generateNudge(input, this.getCurrentSessionThoughts(), shouldSkipNudge);

    return {
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: input.nextThoughtNeeded,
      thoughtTree: shouldShowTree ? this.generateAsciiTree() : '',
      warning: warning || undefined,
      averageConfidence: this.calculateAverageConfidence(),
      systemAdvice,
      sessionGoal: this.sessionGoal,
      nudge,
      scopeId: this.currentScopeId || undefined,
    };
  }

  /**
   * LATERAL THINKING TRIGGER with escalating pressure
   * Delegates to CoachingService
   * @param isFinishing - True if nextThoughtNeeded=false (v5.0.1)
   */
  private checkLateralThinking(isFinishing: boolean = false): string | undefined {
    return this.coachingService.checkLateralThinking(this.getCurrentSessionThoughts(), this.branches, isFinishing);
  }

  /**
   * PROACTIVE COACH - Analyzes thought content and recommends strategic lenses
   * Delegates to CoachingService
   */
  private generateProactiveCoachAdvice(sessionThoughts: ThoughtRecord[]): string | undefined {
    return this.coachingService.generateProactiveCoachAdvice(sessionThoughts);
  }

  /**
   * Add advice with cooldown - prevents spam of same advice
   * Delegates to CoachingService
   */
  private addAdviceWithCooldown(advice: string, nudges: string[]): boolean {
    return this.coachingService.addAdviceWithCooldown(advice, nudges);
  }

  /**
   * PROACTIVE NUDGES - Enhanced coaching based on current thought
   * Delegates to CoachingService
   */
  private generateProactiveNudges(input: ThoughtInput): string | undefined {
    return this.coachingService.generateProactiveNudges(input, this.getCurrentSessionThoughts());
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

    this.syncRuntimeScope();
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
   * PRE-CONSOLIDATION AUDIT - Quality gate before finishing session
   * Delegates to CoachingService
   */
  private performPreConsolidationAudit(): string | undefined {
    return this.coachingService.performPreConsolidationAudit(this.getCurrentSessionThoughts());
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
   * Delegates to VisualizationService
   */
  private generateAsciiTree(): string {
    return this.visualizationService.generateAsciiTree(
      this.getCurrentSessionThoughts(),
      this.branches
    );
  }

  /**
   * Generate Mermaid.js graph visualization (current session only)
   * Delegates to VisualizationService
   */
  private generateMermaid(): string {
    return this.visualizationService.generateMermaid(
      this.getCurrentSessionThoughts(),
      this.branches,
      this.thoughtHistory,
      this.getCurrentSessionStartIndex()
    );
  }

  /**
   * Detect stagnation - repeated similar thoughts with improved detection
   * Delegates to StagnationService
   */
  private detectStagnation(newThought: string): string | undefined {
    return this.stagnationService.detectStagnation(newThought, this.thoughtHistory);
  }

  /**
   * Validate path connectivity - ensure thoughts in winningPath are logically connected
   * Delegates to ValidationService
   */
  private validatePathConnectivity(winningPath: number[]): PathConnectivityResult {
    return this.validationService.validatePathConnectivity(winningPath, this.getCurrentSessionThoughts());
  }

  /**
   * Migrate legacy root-level session file to runtime data directory.
   */
  private async migrateLegacySessionIfNeeded(): Promise<void> {
    const migrated = await migrateLegacyFile(LEGACY_SESSION_FILE, SESSION_FILE);
    if (migrated) {
      console.error(`📦 Migrated legacy session file to ${SESSION_FILE}`);
    }
  }

  /**
   * Load the old thought_session.json once so runtime_state.json can import it.
   * Validates JSON structure to prevent corrupted state
   * v3.2.0: Added TTL check - auto-reset if session older than 24h
   */
  async loadSession(): Promise<boolean> {
    try {
      await this.migrateLegacySessionIfNeeded();
      // v3.2.0: Check session TTL before loading
      const stats = await fs.stat(SESSION_FILE);
      const hoursOld = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      if (hoursOld > SESSION_TTL_HOURS) {
        console.error(`⏰ Session expired (${Math.round(hoursOld)}h old > ${SESSION_TTL_HOURS}h TTL), auto-resetting...`);
        await this.clearLegacySession();
        return false;
      }

      const content = await fs.readFile(SESSION_FILE, 'utf-8');
      const data = JSON.parse(content);
      const schemaVersion = Number(data.schemaVersion ?? 1);

      // Validate JSON structure before using
      if (!data || !Array.isArray(data.history) || !Array.isArray(data.branches)) {
        throw new Error('Invalid session structure');
      }

      this.thoughtHistory = data.history as ThoughtRecord[];
      this.branches = new Map(data.branches);
      this.lastThoughtNumber = data.lastThoughtNumber ?? 0;
      this.sessionGoal = data.goal; // v2.10.0 - restore goal
      this.currentSessionId = data.currentSessionId ?? ''; // v2.11.0 - restore sessionId
      this.currentScopeId = data.currentScopeId ?? '';
      this.deadEnds = data.deadEnds ?? []; // v3.3.0 - restore dead ends

      const deadEndsInfo = this.deadEnds.length > 0 ? `, ${this.deadEnds.length} dead ends` : '';
      console.error(`📂 Restored session v${schemaVersion} from ${data.savedAt} (${this.thoughtHistory.length} thoughts${deadEndsInfo}${this.currentSessionId ? `, session: ${this.currentSessionId.substring(0, 10)}...` : ''})`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('No previous session found, starting fresh');
        return false;
      }
      throw error;
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
    this.currentScopeId = '';
    this.coachingService.reset(); // Clear coach cooldown (v3.2.0)
    this.deadEnds = []; // Clear dead ends (v3.3.0)
    // v4.7.1: Clear word cache to prevent stale data across sessions
    import('../utils/text-analysis.js').then(m => m.clearWordCache());
  }

  /**
   * Remove the legacy store only after runtime_state initialization succeeds.
   */
  async clearLegacySession(): Promise<void> {
    for (const file of new Set([SESSION_FILE, LEGACY_SESSION_FILE])) {
      try {
        await fs.unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Failed to remove legacy session file ${file}:`, error);
        }
      }
    }
  }

  /**
   * Consolidate and verify the thinking process (meta-cognitive audit)
   * Delegates to ConsolidateService
   */
  consolidate(input: import('../types/thought.types.js').ConsolidateInput): import('../types/thought.types.js').ConsolidateResult {
    return this.consolidateService.consolidate(
      input,
      this.getCurrentSessionThoughts(),
      (path, reason) => this.recordDeadEnd(path, reason),
      // v4.1.0: Save insight on successful consolidation
      (path, summary) => {
        this.saveInsight({
          path,
          summary,
          goal: this.sessionGoal,
          avgConfidence: this.calculateAverageConfidence(),
          sessionLength: this.getCurrentSessionThoughts().length,
          source: 'think',
          sessionId: this.currentSessionId || undefined,
          scopeId: this.currentScopeId || undefined,
        }).catch(err => console.error('Failed to save insight:', err));
      }
    );
  }

  /**
   * Reset current session and clear persistence
   * Returns info about what was cleared
   */
  async resetSession(scopeId?: string): Promise<{ clearedThoughts: number; clearedBranches: number; scopeId?: string }> {
    const targetScopeId = scopeId ?? (this.currentScopeId || this.runtimeState?.getActiveScopeId());
    const targetsCurrentScope = !targetScopeId || targetScopeId === this.currentScopeId;
    const storedState = targetsCurrentScope || !targetScopeId
      ? undefined
      : this.runtimeState?.getThinkState(targetScopeId);
    const clearedThoughts = storedState?.history.length ?? (targetsCurrentScope ? this.thoughtHistory.length : 0);
    const clearedBranches = storedState?.branches.length ?? (targetsCurrentScope ? this.branches.size : 0);

    if (targetsCurrentScope) this.reset();
    this.runtimeState?.clearThinkState(targetScopeId);
    await this.runtimeState?.flush();

    console.error(`🧹 Session reset: cleared ${clearedThoughts} thoughts, ${clearedBranches} branches`);

    return { clearedThoughts, clearedBranches, scopeId: targetScopeId };
  }

  /**
   * Export current session as Markdown report (v2.10.0)
   * Delegates to ExportService
   */
  exportSession(options: { format?: 'markdown' | 'json'; includeMermaid?: boolean } = {}): string {
    const includeMermaid = options.includeMermaid ?? true;
    return this.exportService.export(
      {
        thoughts: this.getCurrentSessionThoughts(),
        branches: this.branches,
        deadEnds: this.getDeadEnds(),
        sessionGoal: this.sessionGoal,
        averageConfidence: this.calculateAverageConfidence(),
        mermaidDiagram: includeMermaid ? this.generateMermaid() : undefined,
      },
      { ...options, includeMermaid }
    );
  }

  // ============================================
  // v4.0.0 - Burst Thinking Edition
  // ============================================

  /**
   * SUBMIT THINKING SESSION (v4.0.0) - Burst Thinking
   * Delegates validation to BurstService, commits results to state
   */
  submitSession(input: SubmitSessionInput): SubmitSessionResult {
    const { goal, thoughts, consolidation, showTree = false, scopeId } = input;

    // Validate using BurstService
    const validation = this.burstService.validate(goal, thoughts, consolidation);

    if (!validation.passed || !validation.sortedThoughts) {
      console.error(`🚫 Burst session REJECTED: ${validation.errors.length} errors`);
      return {
        status: 'rejected',
        sessionId: '',
        thoughtsProcessed: 0,
        validation: { passed: false, errors: validation.errors, warnings: validation.warnings },
        metrics: validation.metrics,
        errorMessage: validation.errors.join('; '),
        scopeId: this.currentScopeId || undefined,
      };
    }

    if (scopeId && this.runtimeState && !this.runtimeState.hasScope(scopeId)) {
      return {
        status: 'rejected',
        sessionId: '',
        thoughtsProcessed: 0,
        validation: { passed: false, errors: [`[ERR_SCOPE_NOT_FOUND] Unknown scopeId: ${scopeId}`], warnings: [] },
        metrics: validation.metrics,
        errorMessage: `[ERR_SCOPE_NOT_FOUND] Unknown scopeId: ${scopeId}`,
      };
    }

    // === Commit Session ===
    this.reset();
    this.currentScopeId = this.resolveScopeForNewThinkSession(scopeId, goal) ?? '';
    this.currentSessionId = new Date().toISOString();
    this.sessionGoal = goal;

    // Convert and add thoughts to history
    for (const t of validation.sortedThoughts) {
      const record = this.burstService.toThoughtRecord(t, thoughts.length, this.currentSessionId);
      record.metadata = { ...(record.metadata ?? {}), source: 'think' };
      this.thoughtHistory.push(record);
      this.lastThoughtNumber = Math.max(this.lastThoughtNumber, t.thoughtNumber);

      // Handle branches
      if (t.branchFromThought && t.branchId) {
        const branchHistory = this.branches.get(t.branchId) ?? [];
        branchHistory.push(record);
        this.branches.set(t.branchId, branchHistory);
      }
    }

    this.invalidateFuseIndex();
    this.syncRuntimeScope();
    
    // v5.0.1: Minimal system advice - only real issues
    let systemAdvice: string | undefined;
    if (validation.warnings.length > 0) {
      systemAdvice = `⚠️ ${validation.warnings.join('; ')}`;
    }

    // v5.0.2: Auto-save insight if consolidation with verdict='ready'
    if (consolidation?.verdict === 'ready') {
      this.saveInsight({
        path: consolidation.winningPath,
        summary: consolidation.summary,
        goal,
        avgConfidence: validation.metrics.avgConfidence,
        sessionLength: thoughts.length,
        source: 'think',
        sessionId: this.currentSessionId || undefined,
        scopeId: this.currentScopeId || undefined,
      }).catch(err => console.error('Failed to save insight:', err));
      systemAdvice = (systemAdvice ? systemAdvice + ' | ' : '') + '💾 Insight saved';
    }

    console.error(`✅ Burst: ${thoughts.length}t, session=${this.currentSessionId.substring(0, 10)}...`);

    // v4.6.0: Generate nudge for batch (only if no systemAdvice)
    const hasAlternatives = thoughts.some(t => t.alternatives && t.alternatives.length > 0);
    const hasBlockers = thoughts.some(t => t.extensions?.some(e => e.impact === 'blocker'));
    const nudge = !systemAdvice 
      ? this.nudgeService.generateBatchNudge(
          validation.metrics.avgConfidence,
          thoughts.length,
          hasAlternatives,
          hasBlockers
        )
      : undefined;

    return {
      status: 'accepted',
      sessionId: this.currentSessionId,
      thoughtsProcessed: thoughts.length,
      validation: { passed: true, errors: [], warnings: validation.warnings },
      metrics: validation.metrics,
      // v5.0.1: Tree is lazy - generated only when requested via showTree param
      thoughtTree: showTree ? this.generateAsciiTree() : undefined,
      systemAdvice,
      nudge,
      scopeId: this.currentScopeId || undefined,
    };
  }

  // ============================================
  // v3.4.0 - Recall Edition: Fuzzy Search
  // ============================================

  /**
   * Mark Fuse index as dirty (needs rebuild)
   * Delegates to RecallService
   */
  private invalidateFuseIndex(): void {
    this.recallService.invalidateIndex();
  }

  /**
   * RECALL THOUGHT - Fuzzy search through thought history
   * Delegates to RecallService
   */
  recallThought(input: RecallInput, thoughtsOverride?: ThoughtRecord[]): RecallResult {
    // Recall can aggregate dynamic sources (e.g. cycle sessions), so rebuild the index against
    // the exact thought set used for this query instead of reusing stale cached state.
    this.recallService.invalidateIndex();
    const thoughts = thoughtsOverride
      ? [...thoughtsOverride]
      : input.scope === 'current'
        ? [...this.getCurrentSessionThoughts()]
        : [...this.thoughtHistory];
    return this.recallService.recallThought(input, thoughts);
  }

  // ============================================
  // v4.1.0 - Insights Edition: Cross-Session Learning
  // ============================================

  /**
   * Search past insights for relevant solutions
   * Delegates to InsightsService
   */
  async recallInsights(query: string, limit = 3): Promise<import('./insights.service.js').InsightsSearchResult> {
    return this.insightsService.search(query, limit);
  }

  /**
   * Save an insight so other tool modes can reuse the same insights store.
   */
  async saveInsight(input: SaveInsightInput): Promise<void> {
    await this.insightsService.saveWinningPath(input);
  }

  /**
   * Load insights on service initialization
   */
  async loadInsights(): Promise<void> {
    await this.insightsService.load();
  }
}
