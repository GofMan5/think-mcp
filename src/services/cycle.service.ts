import { promises as fs } from 'fs';
import { calculateJaccardSimilarity, calculateWordEntropy } from '../utils/text-analysis.js';
import {
  ensureThinkMcpDataDir,
  getThinkMcpDataFile,
} from '../utils/storage-paths.js';
import { SESSION_TTL_HOURS } from '../constants/index.js';
import { ExportService } from './export.service.js';
import { VisualizationService } from './visualization.service.js';
import { RuntimeStateService } from './runtime-state.service.js';
import type {
  CycleBackendMode,
  CycleGate,
  CycleReasonCode,
  CycleSession,
  CycleThoughtRecord,
  CycleThoughtType,
  ThinkCycleInput,
  ThinkCycleResult,
  ThoughtInput,
  ThoughtRecord,
  ThinkingResult,
} from '../types/thought.types.js';

const CYCLE_FILE_NAME = 'cycle_sessions.json';
const CYCLE_FILE_PATH = getThinkMcpDataFile(CYCLE_FILE_NAME);
const CYCLE_SCHEMA_VERSION = 1;
const CYCLE_DEFAULT_MAX_LOOPS = 20;
const CYCLE_MIN_MAX_LOOPS = 10;
const CYCLE_MAX_MAX_LOOPS = 30;
const CYCLE_REQUIRED_MIN = 10;
const CYCLE_REQUIRED_MAX = 20;
const QUALITY_GATE_THRESHOLD = 0.75;
const TRACE_LONG_LIMIT = 10;
const SHORT_THOUGHT_MIN = 60;
const CONTRADICTION_PATTERN = /contradict|conflict|however|but now|наоборот|противореч|однако|но при этом/i;
const RISK_MARKERS = [
  'security',
  'secure',
  'auth',
  'payment',
  'concurrency',
  'migration',
  'distributed',
  'performance',
  'rollback',
  'безопас',
  'платеж',
  'конкурент',
  'миграц',
  'распредел',
  'производ',
  'откат',
];

interface ThinkCycleBackend {
  processThought(input: ThoughtInput): ThinkingResult;
  processThoughtInScope?: (input: ThoughtInput, scopeId: string) => ThinkingResult;
  saveInsight?: (input: {
    path: number[];
    summary: string;
    goal?: string;
    avgConfidence?: number;
    sessionLength: number;
    source?: 'think' | 'cycle';
    sessionId?: string;
    scopeId?: string;
  }) => Promise<unknown>;
}

interface CycleStore {
  schemaVersion: number;
  sessions: CycleSession[];
  savedAt: string;
}

interface QualityDiagnostics {
  quality: ThinkCycleResult['quality'];
  duplicateRatio: number;
  shortThoughtRatio: number;
  contradictionSignals: number;
}

interface SnapshotOptions {
  expandedTrace: boolean;
  forceStatus?: ThinkCycleResult['status'];
}

const EMPTY_QUALITY: ThinkCycleResult['quality'] = {
  overall: 0,
  coverage: 0,
  critique: 0,
  verification: 0,
  diversity: 0,
};

const EMPTY_KPI: ThinkCycleResult['kpi'] = {
  thoughtsPerMinute: 0,
  qualityDelta: 0,
  stagnationRisk: 0,
};

const EMPTY_LOOP = {
  current: 0,
  max: CYCLE_DEFAULT_MAX_LOOPS,
  required: CYCLE_REQUIRED_MIN,
  remaining: CYCLE_DEFAULT_MAX_LOOPS,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMetric(value: number): number {
  return Math.round(clamp(value, 0, 1) * 1000) / 1000;
}

function createEmptyPhaseCoverage() {
  return {
    decompose: false,
    alternative: false,
    critique: false,
    synthesis: false,
    verification: false,
  };
}

function missingPhaseReasonCode(key: keyof CycleSession['phaseCoverage']): CycleReasonCode {
  switch (key) {
    case 'decompose':
      return 'MISSING_PHASE_DECOMPOSE';
    case 'alternative':
      return 'MISSING_PHASE_ALTERNATIVE';
    case 'critique':
      return 'MISSING_PHASE_CRITIQUE';
    case 'synthesis':
      return 'MISSING_PHASE_SYNTHESIS';
    case 'verification':
      return 'MISSING_PHASE_VERIFICATION';
  }
}

export class CycleService {
  private sessions: Map<string, CycleSession> = new Map();
  private loaded = false;
  private mutationLock: Promise<void> = Promise.resolve();
  private exportService = new ExportService();
  private visualizationService = new VisualizationService();

  constructor(
    private readonly backend?: ThinkCycleBackend,
    private readonly runtimeState?: RuntimeStateService
  ) {}

  async initialize(): Promise<void> {
    await this.loadSessions();
    for (const session of this.sessions.values()) {
      await this.retryPendingInsight(session);
    }
  }

  getSessionsForBootstrap(): CycleSession[] {
    return Array.from(this.sessions.values()).map((session) => ({
      ...session,
      thoughts: session.thoughts.map((thought) => ({ ...thought })),
      phaseCoverage: { ...session.phaseCoverage },
      constraints: [...session.constraints],
    }));
  }

  async reconcileRuntimeScopes(): Promise<void> {
    if (!this.runtimeState) return;
    await this.withMutationLock(async () => {
      await this.loadSessions();

      const activeScopeId = this.runtimeState!.getActiveScopeId();
      const previousScopeIds = new Map<CycleSession, string | undefined>();
      let changed = false;
      for (const session of this.sessions.values()) {
        const runtimeScopeId = this.runtimeState!.getScopeIdByCycleSessionId(session.sessionId);
        if (runtimeScopeId && session.scopeId !== runtimeScopeId) {
          previousScopeIds.set(session, session.scopeId);
          session.scopeId = runtimeScopeId;
          changed = true;
        }
      }

      if (changed) {
        try {
          await this.saveSessions();
        } catch (error) {
          for (const [session, scopeId] of previousScopeIds) {
            session.scopeId = scopeId;
          }
          throw error;
        }
      }

      for (const session of this.sessions.values()) {
        if (session.scopeId) {
          this.runtimeState!.attachCycleSession(
            session.scopeId,
            session.sessionId,
            session.goal,
            session.createdAt,
            session.updatedAt
          );
        }
      }

      if (activeScopeId) {
        this.runtimeState!.activateScope(activeScopeId);
      }
      await this.runtimeState!.flush();
    });
  }

  async getLatestSessionThoughtsForRecall(): Promise<ThoughtRecord[]> {
    return this.withMutationLock(async () => {
      await this.loadSessions();
      this.cleanupExpiredSessions();

      const latestSession = Array.from(this.sessions.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];

      return latestSession ? this.toRecallThoughts(latestSession) : [];
    });
  }

  async getThoughtsForScope(scopeId: string): Promise<ThoughtRecord[]> {
    return this.withMutationLock(async () => {
      await this.loadSessions();
      this.cleanupExpiredSessions();

      return Array.from(this.sessions.values())
        .filter((session) => session.scopeId === scopeId)
        .sort((left, right) => left.createdAt - right.createdAt)
        .flatMap((session) => this.toRecallThoughts(session));
    });
  }

  async resetScope(scopeId: string): Promise<number> {
    return this.withMutationLock(async () => {
      await this.loadSessions();
      const sessionsToDelete = Array.from(this.sessions.values())
        .filter((session) => session.scopeId === scopeId)
        .map((session) => session.sessionId);

      const previousSessions = new Map(this.sessions);
      for (const sessionId of sessionsToDelete) {
        this.sessions.delete(sessionId);
      }

      if (sessionsToDelete.length > 0) {
        try {
          await this.saveSessions();
        } catch (error) {
          this.sessions = previousSessions;
          throw error;
        }
        for (const sessionId of sessionsToDelete) {
          this.runtimeState?.detachCycleSession(sessionId);
        }
        await this.flushRuntimeBestEffort();
      }

      return sessionsToDelete.length;
    });
  }

  async exportSession(
    sessionId: string,
    options: { format?: 'markdown' | 'json'; includeMermaid?: boolean } = {}
  ): Promise<string> {
    await this.loadSessions();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return options.format === 'json'
        ? JSON.stringify({ error: 'Session not found' })
        : '# Think Session Report\n\n*Session not found.*';
    }

    const thoughts = this.toRecallThoughts(session);
    const includeMermaid = options.includeMermaid ?? true;
    const mermaidDiagram = includeMermaid
      ? this.visualizationService.generateMermaid(thoughts, new Map(), thoughts, 0)
      : undefined;

    return this.exportService.export(
      {
        thoughts,
        branches: new Map(),
        deadEnds: [],
        sessionGoal: session.goal,
        averageConfidence: this.computeAverageConfidence(session),
        mermaidDiagram,
      },
      { ...options, includeMermaid }
    );
  }

  async handle(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    return this.withMutationLock(async () => {
      await this.loadSessions();
      this.cleanupExpiredSessions();

      switch (input.action) {
        case 'start':
          return this.startSession(input);
        case 'step':
          return this.addStep(input);
        case 'status':
          return this.getStatus(input);
        case 'finalize':
          return this.finalize(input);
        case 'reset':
          return this.reset(input);
        default:
          return this.errorResult('', 'INVALID_ACTION', 'Unsupported action');
      }
    });
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const currentLock = this.mutationLock;
    let releaseLock: () => void;
    this.mutationLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentLock;
      return await operation();
    } finally {
      releaseLock!();
    }
  }

  private async flushRuntimeBestEffort(): Promise<void> {
    try {
      await this.runtimeState?.flush();
    } catch {
      // Cycle storage is authoritative; RuntimeState keeps dirty data for the next mutation retry.
    }
  }

  private async loadSessions(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(CYCLE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CycleStore>;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
        throw new Error('Invalid cycle store structure');
      }
      if (parsed.schemaVersion !== CYCLE_SCHEMA_VERSION) {
        throw new Error(`Unsupported cycle store schemaVersion: ${String(parsed.schemaVersion)}`);
      }
      if (typeof parsed.savedAt !== 'string') {
        throw new Error('Invalid cycle store savedAt');
      }

      const loadedSessions: CycleSession[] = [];
      const sessionIds = new Set<string>();
      for (const session of parsed.sessions) {
        const normalized = this.normalizeSession(session);
        if (!normalized) {
          throw new Error('Invalid cycle session structure');
        }
        if (sessionIds.has(normalized.sessionId)) {
          throw new Error(`Duplicate cycle session id: ${normalized.sessionId}`);
        }
        sessionIds.add(normalized.sessionId);
        loadedSessions.push(normalized);
      }
      for (const session of loadedSessions) {
        this.sessions.set(session.sessionId, session);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A missing store is the only valid empty-state bootstrap.
    }

    this.cleanupExpiredSessions();
    this.loaded = true;
  }

  private normalizeSession(raw: unknown): CycleSession | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<CycleSession>;
    if (typeof candidate.sessionId !== 'string' || candidate.sessionId.trim().length === 0) return null;
    if (typeof candidate.goal !== 'string' || candidate.goal.trim().length < 10) return null;
    if (!Array.isArray(candidate.thoughts)) return null;
    if (!Array.isArray(candidate.constraints) || candidate.constraints.length > 20) return null;
    if (candidate.constraints.some((constraint) => typeof constraint !== 'string')) return null;
    if (candidate.context !== undefined && typeof candidate.context !== 'string') return null;
    if (candidate.scopeId !== undefined && (
      typeof candidate.scopeId !== 'string' || candidate.scopeId.trim().length === 0
    )) return null;
    if (!Number.isFinite(candidate.createdAt) || !Number.isFinite(candidate.updatedAt)) return null;
    if (candidate.completedAt !== undefined && (
      !Number.isFinite(candidate.completedAt)
      || candidate.completedAt < Number(candidate.createdAt)
      || candidate.completedAt > Number(candidate.updatedAt)
    )) return null;
    if (candidate.completedAt !== undefined) {
      if (typeof candidate.finalApprovedAnswer !== 'string' || candidate.finalApprovedAnswer.trim().length < 30) return null;
      if (typeof candidate.insightPending !== 'boolean') return null;
    } else if (candidate.finalApprovedAnswer !== undefined || candidate.insightPending !== undefined) {
      return null;
    }
    if (!Number.isInteger(candidate.maxLoops)
      || candidate.maxLoops! < CYCLE_MIN_MAX_LOOPS
      || candidate.maxLoops! > CYCLE_MAX_MAX_LOOPS) return null;
    if (!Number.isInteger(candidate.requiredThoughts)
      || candidate.requiredThoughts! < CYCLE_REQUIRED_MIN
      || candidate.requiredThoughts! > CYCLE_REQUIRED_MAX
      || candidate.requiredThoughts! > candidate.maxLoops!) return null;
    if (!this.isBackendMode(candidate.backendMode)) return null;
    if (typeof candidate.interopFallback !== 'boolean') return null;

    const thoughts: CycleThoughtRecord[] = [];
    for (const rawThought of candidate.thoughts as unknown[]) {
      if (!rawThought || typeof rawThought !== 'object') return null;
      const item = rawThought as Partial<CycleThoughtRecord>;
      if (typeof item.thought !== 'string' || item.thought.trim().length === 0) return null;
      if (!Number.isInteger(item.index) || item.index !== thoughts.length + 1) return null;
      if (!this.isCycleThoughtType(item.thoughtType)) return null;
      if (item.confidence !== undefined && (
        typeof item.confidence !== 'number'
        || !Number.isFinite(item.confidence)
        || item.confidence < 1
        || item.confidence > 10
      )) return null;
      if (!Number.isFinite(item.timestamp)) return null;
      thoughts.push({
        index: item.index,
        thought: item.thought,
        thoughtType: item.thoughtType,
        confidence: item.confidence,
        timestamp: Number(item.timestamp),
      });
    }

    const session: CycleSession = {
      sessionId: candidate.sessionId,
      scopeId: candidate.scopeId,
      goal: candidate.goal,
      context: candidate.context,
      constraints: [...candidate.constraints],
      createdAt: Number(candidate.createdAt),
      updatedAt: Number(candidate.updatedAt),
      completedAt: candidate.completedAt === undefined ? undefined : Number(candidate.completedAt),
      finalApprovedAnswer: candidate.finalApprovedAnswer,
      insightPending: candidate.insightPending,
      maxLoops: candidate.maxLoops!,
      requiredThoughts: candidate.requiredThoughts!,
      backendMode: candidate.backendMode,
      thoughts,
      phaseCoverage: createEmptyPhaseCoverage(),
      interopFallback: candidate.interopFallback,
    };

    session.phaseCoverage = this.computePhaseCoverage(session.thoughts);
    return session;
  }

  private async saveSessions(): Promise<void> {
    await ensureThinkMcpDataDir();

    const data: CycleStore = {
      schemaVersion: CYCLE_SCHEMA_VERSION,
      sessions: Array.from(this.sessions.values()),
      savedAt: new Date().toISOString(),
    };

    const tempFile = `${CYCLE_FILE_PATH}.tmp`;
    try {
      await fs.writeFile(tempFile, JSON.stringify(data), 'utf8');
      await fs.rename(tempFile, CYCLE_FILE_PATH);
    } catch (error) {
      try { await fs.unlink(tempFile); } catch { /* ignore */ }
      throw error;
    }
  }

  private cleanupExpiredSessions(): void {
    const maxAgeMs = SESSION_TTL_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > maxAgeMs) {
        this.sessions.delete(id);
        this.runtimeState?.detachCycleSession(id);
      }
    }
  }

  private async startSession(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const goal = input.goal?.trim();
    if (!goal || goal.length < 10) {
      return this.errorResult('', 'INVALID_INPUT', 'goal is required (min 10 chars)');
    }

    const requestedScopeId = input.scopeId?.trim();
    if (requestedScopeId && this.runtimeState && !this.runtimeState.hasScope(requestedScopeId)) {
      return this.errorResult('', 'INVALID_INPUT', `Unknown scopeId: ${requestedScopeId}`);
    }

    const context = input.context?.trim();
    const constraints = (input.constraints ?? [])
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 20);

    const backendMode = this.isBackendMode(input.backendMode) ? input.backendMode : 'auto';
    const maxLoopsRaw =
      typeof input.maxLoops === 'number' && Number.isFinite(input.maxLoops)
        ? input.maxLoops
        : CYCLE_DEFAULT_MAX_LOOPS;
    const maxLoops = clamp(Math.floor(maxLoopsRaw), CYCLE_MIN_MAX_LOOPS, CYCLE_MAX_MAX_LOOPS);
    const sessionId = this.generateSessionId();
    const scopeId = requestedScopeId
      ?? (this.runtimeState
        ? `scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : undefined);

    const complexityScore = this.calculateComplexityScore(goal, context, constraints);
    const requiredThoughts = Math.min(
      maxLoops,
      clamp(8 + Math.round(complexityScore * 4), CYCLE_REQUIRED_MIN, CYCLE_REQUIRED_MAX)
    );

    const session: CycleSession = {
      sessionId,
      scopeId,
      goal,
      context,
      constraints,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxLoops,
      requiredThoughts,
      backendMode,
      thoughts: [],
      phaseCoverage: createEmptyPhaseCoverage(),
      interopFallback: false,
    };

    if (backendMode !== 'independent') {
      const sync = this.checkBackendAvailability(backendMode);
      if (!sync.ok) {
        return this.errorResult(sessionId, 'INTEROP_BACKEND_ERROR', sync.message ?? 'think backend unavailable');
      }
      if (sync.fallback) {
        session.interopFallback = true;
      }
    }

    this.sessions.set(sessionId, session);
    try {
      await this.saveSessions();
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
    if (scopeId) {
      this.runtimeState?.attachCycleSession(scopeId, sessionId, goal, session.createdAt, session.updatedAt);
    }
    await this.flushRuntimeBestEffort();

    return this.buildSnapshot(session, {
      expandedTrace: input.showTrace === true,
      forceStatus: 'in_progress',
    });
  }

  private async addStep(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      return this.errorResult('', 'INVALID_INPUT', 'sessionId is required for step');
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return this.errorResult(sessionId, 'SESSION_NOT_FOUND', 'Session not found');
    }
    if (session.completedAt !== undefined) {
      return this.errorResult(sessionId, 'SESSION_COMPLETED', 'Session is already completed; start a new cycle for more work');
    }

    const thought = input.thought?.trim();
    if (!thought || thought.length < 20) {
      return this.errorResult(sessionId, 'INVALID_INPUT', 'thought is required (min 20 chars)');
    }

    if (session.thoughts.length >= session.maxLoops) {
      const blocked = this.buildSnapshot(session, {
        expandedTrace: input.showTrace === true,
      });
      blocked.status = 'blocked';
      if (!blocked.gate.reasonCodes.includes('MAX_LOOPS_REACHED')) {
        blocked.gate.reasonCodes.push('MAX_LOOPS_REACHED');
      }
      blocked.requiredMoreThoughts = 0;
      blocked.nextPrompts = this.generateNextPrompts(blocked.gate.reasonCodes);
      return blocked;
    }

    const thoughtType = this.isCycleThoughtType(input.thoughtType)
      ? input.thoughtType
      : this.classifyThoughtType(thought);
    const confidence =
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? clamp(input.confidence, 1, 10)
        : undefined;
    const previousThoughts = [...session.thoughts];
    const previousPhaseCoverage = { ...session.phaseCoverage };
    const previousUpdatedAt = session.updatedAt;
    const previousInteropFallback = session.interopFallback;

    const record: CycleThoughtRecord = {
      index: session.thoughts.length + 1,
      thought,
      thoughtType,
      confidence,
      timestamp: Date.now(),
    };
    session.thoughts.push(record);
    session.phaseCoverage = this.computePhaseCoverage(session.thoughts);
    session.updatedAt = Date.now();
    this.sessions.set(session.sessionId, session);
    try {
      await this.saveSessions();
    } catch (error) {
      session.thoughts = previousThoughts;
      session.phaseCoverage = previousPhaseCoverage;
      session.updatedAt = previousUpdatedAt;
      session.interopFallback = previousInteropFallback;
      this.sessions.set(session.sessionId, session);
      throw error;
    }

    if (session.backendMode !== 'independent') {
      const sync = this.mirrorStepToThinkBackend(
        session,
        record.index,
        thought,
        thoughtType,
        confidence
      );
      if (!sync.ok && session.backendMode === 'think') {
        session.thoughts = previousThoughts;
        session.phaseCoverage = previousPhaseCoverage;
        session.updatedAt = previousUpdatedAt;
        session.interopFallback = previousInteropFallback;
        this.sessions.set(session.sessionId, session);
        await this.saveSessions();
        return this.errorResult(session.sessionId, 'INTEROP_BACKEND_ERROR', sync.message ?? 'think backend rejected step');
      }
      if (!sync.ok && session.backendMode === 'auto' && !session.interopFallback) {
        session.interopFallback = true;
        try {
          await this.saveSessions();
        } catch (error) {
          session.thoughts = previousThoughts;
          session.phaseCoverage = previousPhaseCoverage;
          session.updatedAt = previousUpdatedAt;
          session.interopFallback = previousInteropFallback;
          this.sessions.set(session.sessionId, session);
          await this.saveSessions();
          throw error;
        }
      }
    }

    if (session.scopeId) {
      this.runtimeState?.attachCycleSession(
        session.scopeId,
        session.sessionId,
        session.goal,
        session.createdAt,
        session.updatedAt
      );
    }
    await this.flushRuntimeBestEffort();

    return this.buildSnapshot(session, {
      expandedTrace: input.showTrace === true,
    });
  }

  private async getStatus(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      return this.errorResult('', 'INVALID_INPUT', 'sessionId is required for status');
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return this.errorResult(sessionId, 'SESSION_NOT_FOUND', 'Session not found');
    }
    return this.buildSnapshot(session, {
      expandedTrace: input.showTrace === true,
    });
  }

  private async finalize(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      return this.errorResult('', 'INVALID_INPUT', 'sessionId is required for finalize');
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return this.errorResult(sessionId, 'SESSION_NOT_FOUND', 'Session not found');
    }
    if (session.completedAt !== undefined) {
      await this.retryPendingInsight(session);
      const completed = this.buildSnapshot(session, { expandedTrace: input.showTrace === true });
      if (input.exportReport) {
        completed.exportedReport = await this.exportSession(sessionId, {
          format: input.exportReport,
          includeMermaid: input.includeMermaid,
        });
      }
      return completed;
    }

    const finalAnswer = input.finalAnswer?.trim();
    if (!finalAnswer || finalAnswer.length < 30) {
      return this.errorResult(sessionId, 'INVALID_INPUT', 'finalAnswer is required (min 30 chars)');
    }

    const snapshot = this.buildSnapshot(session, {
      expandedTrace: input.showTrace === true,
    });

    if (
      snapshot.gate.passed
      && session.constraints.length > 0
      && !input.constraintCheck?.trim()
    ) {
      snapshot.status = 'blocked';
      snapshot.gate = { passed: false, reasonCodes: ['CONSTRAINT_CHECK_REQUIRED'] };
      snapshot.requiredMoreThoughts = 0;
      snapshot.nextPrompts = this.generateNextPrompts(snapshot.gate.reasonCodes);
      return snapshot;
    }

    if (snapshot.gate.passed) {
      const previousUpdatedAt = session.updatedAt;
      const previousFinalApprovedAnswer = session.finalApprovedAnswer;
      const previousInsightPending = session.insightPending;
      session.completedAt = Date.now();
      session.updatedAt = session.completedAt;
      session.finalApprovedAnswer = finalAnswer;
      session.insightPending = this.backend?.saveInsight !== undefined;
      try {
        await this.saveSessions();
      } catch (error) {
        session.completedAt = undefined;
        session.updatedAt = previousUpdatedAt;
        session.finalApprovedAnswer = previousFinalApprovedAnswer;
        session.insightPending = previousInsightPending;
        throw error;
      }
      await this.retryPendingInsight(session);
      if (session.scopeId) {
        this.runtimeState?.attachCycleSession(
          session.scopeId,
          session.sessionId,
          session.goal,
          session.createdAt,
          session.updatedAt
        );
      }
      await this.flushRuntimeBestEffort();
      const completed = this.buildSnapshot(session, { expandedTrace: input.showTrace === true });
      if (input.exportReport) {
        completed.exportedReport = await this.exportSession(sessionId, {
          format: input.exportReport,
          includeMermaid: input.includeMermaid,
        });
      }
      return completed;
    }

    snapshot.status = 'blocked';
    snapshot.requiredMoreThoughts = this.computeRequiredMoreThoughts(session, snapshot.gate.reasonCodes, snapshot.quality);
    snapshot.nextPrompts = this.generateNextPrompts(snapshot.gate.reasonCodes);
    return snapshot;
  }

  private async reset(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      return this.errorResult('', 'INVALID_INPUT', 'sessionId is required for reset');
    }

    const session = this.sessions.get(sessionId);
    const scopeId = session?.scopeId;
    if (session) {
      const previousSessions = new Map(this.sessions);
      this.sessions.delete(sessionId);
      try {
        await this.saveSessions();
      } catch (error) {
        this.sessions = previousSessions;
        throw error;
      }
      this.runtimeState?.detachCycleSession(sessionId);
      await this.flushRuntimeBestEffort();
      return {
        status: 'completed',
        sessionId,
        scopeId,
        loop: { ...EMPTY_LOOP, current: 0, remaining: 0 },
        quality: { ...EMPTY_QUALITY },
        kpi: { ...EMPTY_KPI },
        gate: { passed: true, reasonCodes: [] },
        requiredMoreThoughts: 0,
        nextPrompts: [],
      };
    }

    return this.errorResult(sessionId, 'SESSION_NOT_FOUND', 'Session not found');
  }

  private buildSnapshot(session: CycleSession, options: SnapshotOptions): ThinkCycleResult {
    const diagnostics = this.computeQuality(session);
    const completed = session.completedAt !== undefined;
    const gate = completed
      ? { passed: true, reasonCodes: [] }
      : this.evaluateGate(session, diagnostics);
    const loop = {
      current: session.thoughts.length,
      max: session.maxLoops,
      required: session.requiredThoughts,
      remaining: Math.max(0, session.maxLoops - session.thoughts.length),
    };
    const kpi = this.computeKpi(session, diagnostics);

    const requiredMoreThoughts = completed || gate.passed
      ? 0
      : this.computeRequiredMoreThoughts(session, gate.reasonCodes, diagnostics.quality);
    const nextPrompts = completed
      ? []
      : gate.passed
        ? [session.constraints.length > 0
            ? 'Next: think_cycle finalize with finalAnswer and constraintCheck — map every original constraint to evidence.'
            : 'Next: think_cycle finalize with finalAnswer — quality gate passed.']
        : this.generateNextPrompts(gate.reasonCodes);

    const shortTrace = options.expandedTrace ? this.buildTrace(session) : undefined;
    const status = completed ? 'completed' : options.forceStatus ?? this.deriveStatus(gate, session);

    return {
      status,
      sessionId: session.sessionId,
      scopeId: session.scopeId,
      loop,
      quality: diagnostics.quality,
      kpi,
      gate,
      requiredMoreThoughts,
      nextPrompts,
      shortTrace,
      finalApprovedAnswer: session.finalApprovedAnswer,
      interopFallback: session.interopFallback,
    };
  }

  private toRecallThoughts(session: CycleSession): ThoughtRecord[] {
    return session.thoughts.map((thought) => ({
      thoughtNumber: thought.index,
      totalThoughts: session.requiredThoughts,
      nextThoughtNeeded: thought.index < session.requiredThoughts,
      thought: thought.thought,
      confidence: thought.confidence,
      timestamp: thought.timestamp,
      sessionId: session.sessionId,
      metadata: { source: 'cycle' },
    }));
  }

  private computeAverageConfidence(session: CycleSession): number | undefined {
    const values = session.thoughts
      .map((thought) => thought.confidence)
      .filter((value): value is number => value !== undefined);

    if (values.length === 0) return undefined;

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.round(average * 100) / 100;
  }

  private async persistInsight(session: CycleSession, finalAnswer: string): Promise<boolean> {
    if (!this.backend?.saveInsight) return false;

    try {
      await this.backend.saveInsight({
        path: session.thoughts.map((thought) => thought.index),
        summary: finalAnswer,
        goal: session.goal,
        avgConfidence: this.computeAverageConfidence(session),
        sessionLength: session.thoughts.length,
        source: 'cycle',
        sessionId: session.sessionId,
        scopeId: session.scopeId,
      });
      return true;
    } catch (error) {
      console.error('Failed to save cycle insight:', error);
      return false;
    }
  }

  private async retryPendingInsight(session: CycleSession): Promise<void> {
    if (!session.insightPending || !session.finalApprovedAnswer) return;
    if (!await this.persistInsight(session, session.finalApprovedAnswer)) return;

    session.insightPending = false;
    try {
      await this.saveSessions();
    } catch (error) {
      session.insightPending = true;
      console.error('Failed to persist cycle insight status:', error);
    }
  }

  private deriveStatus(gate: CycleGate, session: CycleSession): ThinkCycleResult['status'] {
    if (session.completedAt !== undefined) return 'completed';
    if (gate.passed) return 'ready';
    if (session.thoughts.length >= session.maxLoops) return 'blocked';
    return 'in_progress';
  }

  private evaluateGate(session: CycleSession, diagnostics: QualityDiagnostics): CycleGate {
    const reasonCodes: CycleReasonCode[] = [];
    const thoughtCount = session.thoughts.length;

    if (thoughtCount < session.requiredThoughts) {
      reasonCodes.push('BELOW_REQUIRED_THOUGHTS');
    }

    const requiredPhases: (keyof CycleSession['phaseCoverage'])[] = [
      'decompose',
      'alternative',
      'critique',
      'synthesis',
      'verification',
    ];
    for (const phase of requiredPhases) {
      if (!session.phaseCoverage[phase]) {
        reasonCodes.push(missingPhaseReasonCode(phase));
      }
    }

    if (diagnostics.quality.overall < QUALITY_GATE_THRESHOLD) {
      reasonCodes.push('LOW_OVERALL_QUALITY');
    }
    if (diagnostics.quality.critique < 0.6) {
      reasonCodes.push('LOW_CRITIQUE_DEPTH');
    }
    if (diagnostics.quality.verification < 0.6) {
      reasonCodes.push('LOW_VERIFICATION_DEPTH');
    }
    if (diagnostics.quality.diversity < 0.55) {
      reasonCodes.push('LOW_DIVERSITY');
    }
    if (diagnostics.quality.confidenceStability !== undefined && diagnostics.quality.confidenceStability < 0.45) {
      reasonCodes.push('LOW_CONFIDENCE_STABILITY');
    }
    if (diagnostics.shortThoughtRatio > 0.35) {
      reasonCodes.push('TOO_MANY_SHORT_THOUGHTS');
    }
    if (diagnostics.contradictionSignals >= 2) {
      reasonCodes.push('CONTRADICTION_SIGNAL');
    }
    if (thoughtCount >= session.maxLoops && reasonCodes.length > 0) {
      reasonCodes.push('MAX_LOOPS_REACHED');
    }

    return {
      passed: reasonCodes.length === 0,
      reasonCodes: [...new Set(reasonCodes)],
    };
  }

  private computeQuality(session: CycleSession): QualityDiagnostics {
    const thoughtCount = session.thoughts.length;
    if (thoughtCount === 0) {
      return {
        quality: { ...EMPTY_QUALITY },
        duplicateRatio: 0,
        shortThoughtRatio: 0,
        contradictionSignals: 0,
      };
    }

    const phaseCount = Object.values(session.phaseCoverage).filter(Boolean).length;
    const coverage = phaseCount / 5;

    const critiqueCount = session.thoughts.filter((t) => t.thoughtType === 'critique' || t.thoughtType === 'revision').length;
    const critiqueTarget = Math.max(1, Math.ceil(thoughtCount * 0.2));
    const critique = clamp(critiqueCount / critiqueTarget, 0, 1);

    const verificationCount = session.thoughts.filter((t) => t.thoughtType === 'verification').length;
    const verificationTarget = Math.max(1, Math.ceil(thoughtCount * 0.15));
    const verification = clamp(verificationCount / verificationTarget, 0, 1);

    const avgEntropy =
      session.thoughts.reduce((sum, t) => sum + calculateWordEntropy(t.thought), 0) / thoughtCount;
    let duplicateLinks = 0;
    for (let i = 1; i < session.thoughts.length; i++) {
      const similarity = calculateJaccardSimilarity(session.thoughts[i - 1].thought, session.thoughts[i].thought);
      if (similarity > 0.82) {
        duplicateLinks++;
      }
    }
    const duplicateRatio = thoughtCount > 1 ? duplicateLinks / (thoughtCount - 1) : 0;
    const diversity = clamp(avgEntropy - duplicateRatio * 0.6, 0, 1);

    const confidenceValues = session.thoughts
      .map((thought) => thought.confidence)
      .filter((confidence): confidence is number => confidence !== undefined);
    const confidenceStability = confidenceValues.length >= 2
      ? this.computeConfidenceStability(confidenceValues)
      : undefined;

    const shortThoughtRatio =
      session.thoughts.filter((t) => t.thought.length < SHORT_THOUGHT_MIN).length / thoughtCount;
    const contradictionSignals = session.thoughts.filter((t) => CONTRADICTION_PATTERN.test(t.thought)).length;

    let overall = (
      coverage * 0.3 +
      critique * 0.2 +
      verification * 0.2 +
      diversity * 0.2
    ) / (confidenceStability === undefined ? 0.9 : 1);
    if (confidenceStability !== undefined) overall += confidenceStability * 0.1;

    overall -= shortThoughtRatio * 0.2;
    if (duplicateRatio > 0.4) {
      overall -= 0.08;
    }
    overall -= Math.min(0.15, contradictionSignals * 0.05);

    const quality = {
      overall: roundMetric(overall),
      coverage: roundMetric(coverage),
      critique: roundMetric(critique),
      verification: roundMetric(verification),
      diversity: roundMetric(diversity),
      confidenceStability: confidenceStability === undefined ? undefined : roundMetric(confidenceStability),
    };

    return {
      quality,
      duplicateRatio: roundMetric(duplicateRatio),
      shortThoughtRatio: roundMetric(shortThoughtRatio),
      contradictionSignals,
    };
  }

  private computeKpi(session: CycleSession, diagnostics: QualityDiagnostics): ThinkCycleResult['kpi'] {
    const elapsedMs = Math.max(1, Date.now() - session.createdAt);
    const elapsedMinutes = elapsedMs / (1000 * 60);
    const thoughtsPerMinute = session.thoughts.length / elapsedMinutes;

    const qualityDelta = diagnostics.quality.overall;
    const stagnationRisk = clamp(
      diagnostics.duplicateRatio * 0.7 + diagnostics.shortThoughtRatio * 0.2 + Math.min(0.3, diagnostics.contradictionSignals * 0.1),
      0,
      1
    );

    return {
      thoughtsPerMinute: Math.round(thoughtsPerMinute * 100) / 100,
      qualityDelta: roundMetric(qualityDelta),
      stagnationRisk: roundMetric(stagnationRisk),
    };
  }

  private computeConfidenceStability(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return clamp(1 - stdDev / 3, 0, 1);
  }

  private computeRequiredMoreThoughts(
    session: CycleSession,
    reasonCodes: CycleReasonCode[],
    quality: ThinkCycleResult['quality']
  ): number {
    const remaining = Math.max(0, session.maxLoops - session.thoughts.length);
    if (remaining === 0) return 0;

    const baseNeed = Math.max(0, session.requiredThoughts - session.thoughts.length);
    const targetedNeed = this.computeTargetedNeed(reasonCodes, quality);
    const requested = Math.max(baseNeed, targetedNeed);
    return Math.min(remaining, requested);
  }

  private computeTargetedNeed(reasonCodes: CycleReasonCode[], quality: ThinkCycleResult['quality']): number {
    let need = 0;
    const missingPhases = reasonCodes.filter((code) => code.startsWith('MISSING_PHASE_')).length;
    need += missingPhases;

    if (reasonCodes.includes('LOW_CRITIQUE_DEPTH') && !reasonCodes.includes('MISSING_PHASE_CRITIQUE')) need += 1;
    if (reasonCodes.includes('LOW_VERIFICATION_DEPTH') && !reasonCodes.includes('MISSING_PHASE_VERIFICATION')) need += 1;
    if (reasonCodes.includes('LOW_DIVERSITY')) need += 1;
    if (reasonCodes.includes('TOO_MANY_SHORT_THOUGHTS')) need += 1;
    if (reasonCodes.includes('CONTRADICTION_SIGNAL')) need += 1;
    if (reasonCodes.includes('LOW_CONFIDENCE_STABILITY')) need += 1;
    if (reasonCodes.includes('LOW_OVERALL_QUALITY') && quality.overall < QUALITY_GATE_THRESHOLD && need === 0) {
      need = 1;
    }

    return clamp(need, 0, 10);
  }

  private generateNextPrompts(reasonCodes: CycleReasonCode[]): string[] {
    if (reasonCodes.includes('CONSTRAINT_CHECK_REQUIRED')) {
      return ['Next: retry think_cycle finalize with constraintCheck — map every original constraint to evidence or a verification step.'];
    }
    if (reasonCodes.includes('MAX_LOOPS_REACHED')) {
      return ['Next: start a new think_cycle with a smaller goal and carry over only verified decisions.'];
    }

    if (reasonCodes.includes('MISSING_PHASE_DECOMPOSE')) {
      return ['Next: think_cycle step with thoughtType="decompose" — split the goal into dependencies and an execution order.'];
    }
    if (reasonCodes.includes('MISSING_PHASE_ALTERNATIVE')) {
      return ['Next: think_cycle step with thoughtType="alternative" — compare at least two viable approaches and their tradeoffs.'];
    }
    if (reasonCodes.includes('MISSING_PHASE_CRITIQUE') || reasonCodes.includes('LOW_CRITIQUE_DEPTH')) {
      return ['Next: think_cycle step with thoughtType="critique" — challenge assumptions, failure modes, and rejection criteria.'];
    }
    if (reasonCodes.includes('MISSING_PHASE_SYNTHESIS')) {
      return ['Next: think_cycle step with thoughtType="synthesis" — choose one coherent path and explain the tradeoff.'];
    }
    if (reasonCodes.includes('MISSING_PHASE_VERIFICATION') || reasonCodes.includes('LOW_VERIFICATION_DEPTH')) {
      return ['Next: think_cycle step with thoughtType="verification" — define tests, metrics, and rollback triggers.'];
    }
    if (reasonCodes.includes('LOW_DIVERSITY')) {
      return ['Next: think_cycle step with thoughtType="alternative" — add a genuinely different approach, not a rewording.'];
    }
    if (reasonCodes.includes('TOO_MANY_SHORT_THOUGHTS')) {
      return ['Next: think_cycle step with thoughtType="revision" — replace a shallow claim with evidence and a concrete decision.'];
    }
    if (reasonCodes.includes('CONTRADICTION_SIGNAL')) {
      return ['Next: think_cycle step with thoughtType="revision" — resolve the contradiction and state what changed.'];
    }
    if (reasonCodes.includes('LOW_CONFIDENCE_STABILITY')) {
      return ['Next: think_cycle step with thoughtType="verification" and confidence — validate and recalibrate the least certain claim.'];
    }
    return ['Next: think_cycle step with thoughtType="revision" — add one distinct, evidence-backed improvement.'];
  }

  private buildTrace(session: CycleSession): string[] {
    return session.thoughts
      .slice(-TRACE_LONG_LIMIT)
      .map((thought) => {
        const trimmed = thought.thought.length > 140
          ? `${thought.thought.slice(0, 140)}...`
          : thought.thought;
        const confidencePart = thought.confidence !== undefined ? ` c:${thought.confidence}` : '';
        return `#${thought.index} [${thought.thoughtType}${confidencePart}] ${trimmed}`;
      });
  }

  private classifyThoughtType(text: string): CycleThoughtType {
    const lower = text.toLowerCase();
    if (/(verify|test|check|assert|prove|валид|провер)/.test(lower)) return 'verification';
    if (/(alternative|option|fallback|trade[- ]?off|вариант|альтернатив)/.test(lower)) return 'alternative';
    if (/(critique|risk|weak|assumption|flaw|проблем|риск|слаб)/.test(lower)) return 'critique';
    if (/(revise|revision|fixing|correct|исправ|пересмотр)/.test(lower)) return 'revision';
    if (/(synthesis|summary|final path|decision|итог|синтез|объедин)/.test(lower)) return 'synthesis';
    return 'decompose';
  }

  private computePhaseCoverage(thoughts: CycleThoughtRecord[]): CycleSession['phaseCoverage'] {
    const coverage = createEmptyPhaseCoverage();
    for (const thought of thoughts) {
      if (thought.thoughtType === 'revision') {
        coverage.critique = true;
      } else {
        coverage[thought.thoughtType] = true;
      }
    }
    return coverage;
  }

  private checkBackendAvailability(mode: CycleBackendMode): { ok: boolean; fallback?: boolean; message?: string } {
    if (!this.backend) {
      if (mode === 'think') {
        return { ok: false, message: 'think backend unavailable' };
      }
      return { ok: true, fallback: mode === 'auto' };
    }
    return { ok: true };
  }

  private mirrorStepToThinkBackend(
    session: CycleSession,
    thoughtNumber: number,
    thought: string,
    thoughtType: CycleThoughtType,
    confidence?: number
  ): { ok: boolean; message?: string } {
    if (!this.backend) {
      return { ok: false, message: 'think backend unavailable' };
    }

    const payload: ThoughtInput = {
      thought,
      nextThoughtNeeded: true,
      thoughtNumber,
      totalThoughts: Math.max(session.requiredThoughts, thoughtNumber),
      confidence,
      goal: thoughtNumber === 1 ? session.goal : undefined,
      showTree: false,
      isRevision: thoughtType === 'revision' ? true : undefined,
      revisesThought: thoughtType === 'revision' && thoughtNumber > 1 ? thoughtNumber - 1 : undefined,
      quickExtension: thoughtType === 'critique'
        ? {
            type: 'critique',
            content: 'Cycle critique checkpoint',
            impact: 'medium',
          }
        : undefined,
      scopeId: thoughtNumber === 1 ? session.scopeId : undefined,
      mirroredCycleSessionId: session.sessionId,
    };

    try {
      const result = session.scopeId && this.backend.processThoughtInScope
        ? this.backend.processThoughtInScope(payload, session.scopeId)
        : this.backend.processThought(payload);
      if (result.isError) {
        return { ok: false, message: result.errorMessage ?? 'think backend rejected step' };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'think backend failed' };
    }
  }

  private calculateComplexityScore(goal: string, context: string | undefined, constraints: string[]): number {
    const combined = [goal, context ?? '', constraints.join(' ')].join(' ').toLowerCase();
    let riskCount = 0;
    for (const marker of RISK_MARKERS) {
      if (combined.includes(marker)) {
        riskCount++;
      }
    }

    const goalScore = Math.min(1.2, goal.length / 400);
    const constraintScore = Math.min(0.7, constraints.length * 0.12);
    const riskScore = Math.min(1.0, riskCount * 0.2);
    const contextScore = Math.min(0.6, (context?.length ?? 0) / 1800);

    return clamp(0.5 + goalScore + constraintScore + riskScore + contextScore, 0, 3);
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private isBackendMode(mode: unknown): mode is CycleBackendMode {
    return mode === 'auto' || mode === 'independent' || mode === 'think';
  }

  private isCycleThoughtType(type: unknown): type is CycleThoughtType {
    return (
      type === 'decompose' ||
      type === 'alternative' ||
      type === 'critique' ||
      type === 'synthesis' ||
      type === 'verification' ||
      type === 'revision'
    );
  }

  private errorResult(sessionId: string, reason: CycleReasonCode, message: string): ThinkCycleResult {
    return {
      status: 'error',
      sessionId,
      loop: { ...EMPTY_LOOP },
      quality: { ...EMPTY_QUALITY },
      kpi: { ...EMPTY_KPI },
      gate: { passed: false, reasonCodes: [reason] },
      requiredMoreThoughts: 0,
      nextPrompts: [],
      errorMessage: message,
    };
  }
}
