import { promises as fs } from 'fs';
import { calculateJaccardSimilarity, calculateWordEntropy } from '../utils/text-analysis.js';
import {
  ensureThinkMcpDataDir,
  getThinkMcpDataFile,
} from '../utils/storage-paths.js';
import { SESSION_TTL_HOURS } from '../constants/index.js';
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
const TRACE_SHORT_LIMIT = 3;
const TRACE_LONG_LIMIT = 10;
const SHORT_THOUGHT_MIN = 60;
const CONTRADICTION_PATTERN = /contradict|conflict|however|but now|наоборот|противореч|однако|но при этом/i;
const RISK_MARKERS = [
  'security',
  'auth',
  'payment',
  'concurrency',
  'migration',
  'distributed',
  'performance',
  'rollback',
];

interface ThinkCycleBackend {
  processThought(input: ThoughtInput): ThinkingResult;
  resetSession?: () => Promise<unknown>;
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
  finalApprovedAnswer?: string;
  forcedGate?: CycleGate;
}

const EMPTY_QUALITY: ThinkCycleResult['quality'] = {
  overall: 0,
  coverage: 0,
  critique: 0,
  verification: 0,
  diversity: 0,
  confidenceStability: 0,
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
  private fsLock: Promise<void> = Promise.resolve();

  constructor(private readonly backend?: ThinkCycleBackend) {}

  async initialize(): Promise<void> {
    await this.loadSessions();
  }

  async handle(input: ThinkCycleInput): Promise<ThinkCycleResult> {
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
  }

  private async withFsLock<T>(operation: () => Promise<T>): Promise<T> {
    const currentLock = this.fsLock;
    let releaseLock: () => void;
    this.fsLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentLock;
      return await operation();
    } finally {
      releaseLock!();
    }
  }

  private async loadSessions(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(CYCLE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CycleStore>;
      const loadedSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];

      for (const session of loadedSessions) {
        const normalized = this.normalizeSession(session);
        if (normalized) {
          this.sessions.set(normalized.sessionId, normalized);
        }
      }
    } catch {
      // Start with empty state if file does not exist or is invalid.
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

    const thoughts: CycleThoughtRecord[] = candidate.thoughts
      .filter((item): item is CycleThoughtRecord => !!item && typeof item === 'object')
      .map((item) => {
        const thoughtType = this.isCycleThoughtType(item.thoughtType) ? item.thoughtType : this.classifyThoughtType(item.thought);
        const confidence =
          typeof item.confidence === 'number' && Number.isFinite(item.confidence)
            ? clamp(item.confidence, 1, 10)
            : undefined;
        return {
          index: Number.isInteger(item.index) && item.index > 0 ? item.index : 1,
          thought: typeof item.thought === 'string' ? item.thought : '',
          thoughtType,
          confidence,
          timestamp: Number.isFinite(item.timestamp) ? item.timestamp : Date.now(),
        };
      })
      .filter((item) => item.thought.trim().length > 0)
      .map((item, idx) => ({ ...item, index: idx + 1 }));

    const constraints = Array.isArray(candidate.constraints)
      ? candidate.constraints.filter((c): c is string => typeof c === 'string').slice(0, 20)
      : [];

    const maxLoopsRaw =
      typeof candidate.maxLoops === 'number' && Number.isFinite(candidate.maxLoops)
        ? candidate.maxLoops
        : CYCLE_DEFAULT_MAX_LOOPS;
    const maxLoops = clamp(Math.floor(maxLoopsRaw), CYCLE_MIN_MAX_LOOPS, CYCLE_MAX_MAX_LOOPS);

    const requiredThoughtsRaw =
      typeof candidate.requiredThoughts === 'number' && Number.isFinite(candidate.requiredThoughts)
        ? candidate.requiredThoughts
        : CYCLE_REQUIRED_MIN;
    const requiredThoughts = clamp(Math.floor(requiredThoughtsRaw), CYCLE_REQUIRED_MIN, CYCLE_REQUIRED_MAX);

    const mode = this.isBackendMode(candidate.backendMode) ? candidate.backendMode : 'auto';

    const session: CycleSession = {
      sessionId: candidate.sessionId,
      goal: candidate.goal,
      context: typeof candidate.context === 'string' ? candidate.context : undefined,
      constraints,
      createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now(),
      updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : Date.now(),
      maxLoops,
      requiredThoughts,
      backendMode: mode,
      thoughts,
      phaseCoverage: createEmptyPhaseCoverage(),
      interopFallback: Boolean(candidate.interopFallback),
    };

    session.phaseCoverage = this.computePhaseCoverage(session.thoughts);
    return session;
  }

  private async saveSessions(): Promise<void> {
    await this.withFsLock(async () => {
      await ensureThinkMcpDataDir();

      const data: CycleStore = {
        schemaVersion: CYCLE_SCHEMA_VERSION,
        sessions: Array.from(this.sessions.values()),
        savedAt: new Date().toISOString(),
      };

      const tempFile = `${CYCLE_FILE_PATH}.tmp`;
      try {
        await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(tempFile, CYCLE_FILE_PATH);
      } catch (error) {
        try { await fs.unlink(tempFile); } catch { /* ignore */ }
        console.error('Failed to save cycle sessions:', error);
      }
    });
  }

  private cleanupExpiredSessions(): void {
    const maxAgeMs = SESSION_TTL_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > maxAgeMs) {
        this.sessions.delete(id);
      }
    }
  }

  private async startSession(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const goal = input.goal?.trim();
    if (!goal || goal.length < 10) {
      return this.errorResult('', 'INVALID_INPUT', 'goal is required (min 10 chars)');
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

    const complexityScore = this.calculateComplexityScore(goal, context, constraints);
    const requiredThoughts = clamp(8 + Math.round(complexityScore * 4), CYCLE_REQUIRED_MIN, CYCLE_REQUIRED_MAX);

    const session: CycleSession = {
      sessionId,
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
      const sync = await this.resetBackendSession(backendMode);
      if (!sync.ok) {
        return this.errorResult(sessionId, 'INTEROP_BACKEND_ERROR', sync.message ?? 'think backend reset failed');
      }
      if (sync.fallback) {
        session.interopFallback = true;
      }
    }

    this.sessions.set(sessionId, session);
    await this.saveSessions();

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
      blocked.nextPrompts = this.generateNextPrompts(blocked.gate.reasonCodes, blocked.quality, session, blocked.requiredMoreThoughts);
      return blocked;
    }

    const thoughtType = this.isCycleThoughtType(input.thoughtType)
      ? input.thoughtType
      : this.classifyThoughtType(thought);
    const confidence =
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? clamp(input.confidence, 1, 10)
        : undefined;

    if (session.backendMode !== 'independent') {
      const sync = this.mirrorStepToThinkBackend(session, thought, thoughtType, confidence);
      if (!sync.ok && session.backendMode === 'think') {
        return this.errorResult(session.sessionId, 'INTEROP_BACKEND_ERROR', sync.message ?? 'think backend rejected step');
      }
      if (!sync.ok && session.backendMode === 'auto') {
        session.interopFallback = true;
      }
    }

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
    await this.saveSessions();

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

    const finalAnswer = input.finalAnswer?.trim();
    if (!finalAnswer || finalAnswer.length < 30) {
      return this.errorResult(sessionId, 'INVALID_INPUT', 'finalAnswer is required (min 30 chars)');
    }

    const snapshot = this.buildSnapshot(session, {
      expandedTrace: input.showTrace === true,
    });

    if (snapshot.gate.passed) {
      snapshot.status = 'completed';
      snapshot.requiredMoreThoughts = 0;
      snapshot.nextPrompts = [];
      snapshot.finalApprovedAnswer = finalAnswer;
      return snapshot;
    }

    snapshot.status = 'blocked';
    snapshot.requiredMoreThoughts = this.computeRequiredMoreThoughts(session, snapshot.gate.reasonCodes, snapshot.quality);
    snapshot.nextPrompts = this.generateNextPrompts(snapshot.gate.reasonCodes, snapshot.quality, session, snapshot.requiredMoreThoughts);
    return snapshot;
  }

  private async reset(input: ThinkCycleInput): Promise<ThinkCycleResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      return this.errorResult('', 'INVALID_INPUT', 'sessionId is required for reset');
    }

    const existed = this.sessions.delete(sessionId);
    if (existed) {
      await this.saveSessions();
      return {
        status: 'completed',
        sessionId,
        loop: { ...EMPTY_LOOP, current: 0, remaining: 0 },
        quality: { ...EMPTY_QUALITY },
        kpi: { ...EMPTY_KPI },
        gate: { passed: true, reasonCodes: [] },
        requiredMoreThoughts: 0,
        nextPrompts: [],
        shortTrace: [],
      };
    }

    return this.errorResult(sessionId, 'SESSION_NOT_FOUND', 'Session not found');
  }

  private buildSnapshot(session: CycleSession, options: SnapshotOptions): ThinkCycleResult {
    const diagnostics = this.computeQuality(session);
    const gate = options.forcedGate ?? this.evaluateGate(session, diagnostics);
    const loop = {
      current: session.thoughts.length,
      max: session.maxLoops,
      required: session.requiredThoughts,
      remaining: Math.max(0, session.maxLoops - session.thoughts.length),
    };
    const kpi = this.computeKpi(session, diagnostics);

    const requiredMoreThoughts = gate.passed
      ? 0
      : this.computeRequiredMoreThoughts(session, gate.reasonCodes, diagnostics.quality);
    const nextPrompts = gate.passed
      ? []
      : this.generateNextPrompts(gate.reasonCodes, diagnostics.quality, session, requiredMoreThoughts);

    const shortTrace = this.buildTrace(session, options.expandedTrace);
    const status = options.forceStatus ?? this.deriveStatus(gate, session);

    return {
      status,
      sessionId: session.sessionId,
      loop,
      quality: diagnostics.quality,
      kpi,
      gate,
      requiredMoreThoughts,
      nextPrompts,
      shortTrace,
      finalApprovedAnswer: options.finalApprovedAnswer,
      interopFallback: session.interopFallback,
    };
  }

  private deriveStatus(gate: CycleGate, session: CycleSession): ThinkCycleResult['status'] {
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
    if (diagnostics.quality.confidenceStability < 0.45) {
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

    const confidenceValues = session.thoughts.map((t) => t.confidence ?? 6);
    const confidenceStability = this.computeConfidenceStability(confidenceValues);

    const shortThoughtRatio =
      session.thoughts.filter((t) => t.thought.length < SHORT_THOUGHT_MIN).length / thoughtCount;
    const contradictionSignals = session.thoughts.filter((t) => CONTRADICTION_PATTERN.test(t.thought)).length;

    let overall =
      coverage * 0.3 +
      critique * 0.2 +
      verification * 0.2 +
      diversity * 0.2 +
      confidenceStability * 0.1;

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
      confidenceStability: roundMetric(confidenceStability),
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
    if (values.length === 0) return 0;
    if (values.length === 1) return 0.65;

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

    const baseNeed = session.requiredThoughts - session.thoughts.length;
    const weakBoost = this.computeWeakAreaBoost(reasonCodes, quality);
    const requested = Math.max(10, baseNeed, weakBoost);
    return Math.min(remaining, requested);
  }

  private computeWeakAreaBoost(reasonCodes: CycleReasonCode[], quality: ThinkCycleResult['quality']): number {
    let boost = 0;
    const missingPhases = reasonCodes.filter((code) => code.startsWith('MISSING_PHASE_')).length;
    boost += missingPhases * 2;
    if (reasonCodes.includes('LOW_CRITIQUE_DEPTH')) boost += 3;
    if (reasonCodes.includes('LOW_VERIFICATION_DEPTH')) boost += 3;
    if (reasonCodes.includes('LOW_DIVERSITY')) boost += 3;
    if (reasonCodes.includes('LOW_OVERALL_QUALITY')) boost += 2;
    if (quality.coverage < 0.4) boost += 2;
    return clamp(boost, 0, 15);
  }

  private generateNextPrompts(
    reasonCodes: CycleReasonCode[],
    quality: ThinkCycleResult['quality'],
    session: CycleSession,
    requiredMoreThoughts: number
  ): string[] {
    const prompts: string[] = [];

    if (requiredMoreThoughts > 0) {
      prompts.push(`Continue with at least ${requiredMoreThoughts} additional thoughts before finalizing.`);
    }

    if (reasonCodes.includes('MAX_LOOPS_REACHED')) {
      prompts.push('Split the goal into a smaller scope and start a new cycle session.');
      prompts.push('Preserve only top risks/decisions and continue in a focused follow-up session.');
      return prompts.slice(0, 10);
    }

    if (reasonCodes.includes('MISSING_PHASE_DECOMPOSE')) {
      prompts.push('Decompose the goal into concrete sub-problems, dependencies, and execution order.');
    }
    if (reasonCodes.includes('MISSING_PHASE_ALTERNATIVE')) {
      prompts.push('Generate at least two alternative approaches and compare tradeoffs explicitly.');
    }
    if (reasonCodes.includes('MISSING_PHASE_CRITIQUE') || reasonCodes.includes('LOW_CRITIQUE_DEPTH')) {
      prompts.push('Challenge your current approach: list failure modes, hidden assumptions, and rejection criteria.');
    }
    if (reasonCodes.includes('MISSING_PHASE_SYNTHESIS')) {
      prompts.push('Synthesize previous thoughts into one coherent strategy with chosen path rationale.');
    }
    if (reasonCodes.includes('MISSING_PHASE_VERIFICATION') || reasonCodes.includes('LOW_VERIFICATION_DEPTH')) {
      prompts.push('Define verification: tests, metrics, observability checks, rollback triggers.');
    }
    if (reasonCodes.includes('LOW_DIVERSITY')) {
      prompts.push('Avoid repeating wording; reframe from architecture, data-flow, and operational perspectives.');
    }
    if (reasonCodes.includes('TOO_MANY_SHORT_THOUGHTS')) {
      prompts.push('Use higher-detail thoughts (>80 chars) with concrete evidence and decisions.');
    }
    if (reasonCodes.includes('CONTRADICTION_SIGNAL')) {
      prompts.push('Resolve contradictions explicitly: state what changed and why.');
    }
    if (reasonCodes.includes('LOW_CONFIDENCE_STABILITY')) {
      prompts.push('Stabilize confidence by validating uncertain parts before introducing new branches.');
    }
    if (reasonCodes.includes('LOW_OVERALL_QUALITY') && quality.overall < 0.75) {
      prompts.push('Run one focused refinement pass to improve quality score above 0.75.');
    }

    if (prompts.length === 0) {
      prompts.push(`Continue reasoning until all phases are covered and quality reaches ${QUALITY_GATE_THRESHOLD}.`);
    }

    return prompts.slice(0, 10);
  }

  private buildTrace(session: CycleSession, expanded: boolean): string[] {
    const limit = expanded ? TRACE_LONG_LIMIT : TRACE_SHORT_LIMIT;
    return session.thoughts
      .slice(-limit)
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

  private async resetBackendSession(mode: CycleBackendMode): Promise<{ ok: boolean; fallback?: boolean; message?: string }> {
    if (!this.backend?.resetSession) {
      if (mode === 'think') {
        return { ok: false, message: 'think backend reset unavailable' };
      }
      return { ok: true, fallback: mode === 'auto' };
    }

    try {
      await this.backend.resetSession();
      return { ok: true };
    } catch (error) {
      if (mode === 'think') {
        return { ok: false, message: error instanceof Error ? error.message : 'think backend reset failed' };
      }
      return { ok: true, fallback: true, message: error instanceof Error ? error.message : 'fallback enabled' };
    }
  }

  private mirrorStepToThinkBackend(
    session: CycleSession,
    thought: string,
    thoughtType: CycleThoughtType,
    confidence?: number
  ): { ok: boolean; message?: string } {
    if (!this.backend) {
      return { ok: false, message: 'think backend unavailable' };
    }

    const thoughtNumber = session.thoughts.length + 1;
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
    };

    try {
      const result = this.backend.processThought(payload);
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
      shortTrace: [],
      errorMessage: message,
    };
  }
}
