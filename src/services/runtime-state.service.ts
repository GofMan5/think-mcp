import { promises as fs } from 'fs';
import type {
  CycleSession,
  RuntimeScopeRecord,
  RuntimeStateData,
  RuntimeThinkState,
} from '../types/thought.types.js';
import {
  ensureThinkMcpDataDir,
  getThinkMcpDataFile,
} from '../utils/storage-paths.js';
import { SESSION_TTL_HOURS } from '../constants/index.js';

const RUNTIME_STATE_FILE = getThinkMcpDataFile('runtime_state.json');
const RUNTIME_SCHEMA_VERSION = 1;

interface RuntimeBootstrapInput {
  currentThinkState?: RuntimeThinkState;
  cycleSessions?: CycleSession[];
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyState(): RuntimeStateData {
  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    activeScopeId: undefined,
    scopes: [],
    savedAt: new Date(0).toISOString(),
  };
}

export class RuntimeStateService {
  private state: RuntimeStateData = createEmptyState();
  private loaded = false;
  private isDirty = false;
  private fsLock: Promise<void> = Promise.resolve();
  private pendingSave: Promise<void> = Promise.resolve();
  private pendingSaveError: unknown;

  async initialize(input: RuntimeBootstrapInput = {}): Promise<void> {
    if (!this.loaded) {
      await this.loadState(input);
      this.loaded = true;
      return;
    }

    if (this.reconcileBootstrap({ ...input, currentThinkState: undefined })) {
      await this.flush();
    }
  }

  getActiveScopeId(): string | undefined {
    return this.state.activeScopeId;
  }

  hasScope(scopeId: string): boolean {
    return this.state.scopes.some((scope) => scope.scopeId === scopeId);
  }

  getScope(scopeId: string): RuntimeScopeRecord | undefined {
    const scope = this.state.scopes.find((entry) => entry.scopeId === scopeId);
    return scope ? cloneValue(scope) : undefined;
  }

  getThinkState(scopeId: string): RuntimeThinkState | undefined {
    const scope = this.state.scopes.find((entry) => entry.scopeId === scopeId);
    return scope?.thinkState ? cloneValue(scope.thinkState) : undefined;
  }

  getScopeIdByCycleSessionId(sessionId: string): string | undefined {
    return this.state.scopes.find((scope) => scope.cycleSessionIds.includes(sessionId))?.scopeId;
  }

  createScope(goal?: string, preferredScopeId?: string): string {
    const scopeId = preferredScopeId?.trim() || this.generateScopeId();
    const existing = this.state.scopes.find((scope) => scope.scopeId === scopeId);
    if (existing) {
      if (goal && !existing.goal) {
        existing.goal = goal;
        this.touchScope(existing);
        this.scheduleSave();
      }
      return scopeId;
    }

    const now = Date.now();
    this.state.scopes.push({
      scopeId,
      createdAt: now,
      updatedAt: now,
      goal,
      thinkSessionId: undefined,
      thinkState: undefined,
      cycleSessionIds: [],
    });
    this.state.activeScopeId = scopeId;
    this.markDirty();
    this.scheduleSave();
    return scopeId;
  }

  activateScope(scopeId: string): boolean {
    if (!this.hasScope(scopeId)) return false;
    if (this.state.activeScopeId === scopeId) return true;
    this.state.activeScopeId = scopeId;
    this.markDirty();
    this.scheduleSave();
    return true;
  }

  setActiveScope(scopeId: string | undefined): void {
    this.state.activeScopeId = scopeId;
    this.markDirty();
    this.scheduleSave();
  }

  upsertThinkState(scopeId: string, thinkState: RuntimeThinkState): void {
    const scope = this.getOrCreateMutableScope(scopeId, thinkState.goal);
    scope.thinkState = cloneValue({
      ...thinkState,
      currentScopeId: scopeId,
    });
    scope.thinkSessionId = thinkState.currentSessionId;
    scope.goal = thinkState.goal ?? scope.goal;
    this.state.activeScopeId = scopeId;
    this.touchScope(scope);
    this.scheduleSave();
  }

  clearThinkState(scopeId?: string): void {
    const targetScopeId = scopeId ?? this.state.activeScopeId;
    if (!targetScopeId) return;
    const scope = this.state.scopes.find((entry) => entry.scopeId === targetScopeId);
    if (!scope) return;

    scope.thinkState = undefined;
    scope.thinkSessionId = undefined;
    this.touchScope(scope);
    this.dropOrphanScope(targetScopeId);
    this.scheduleSave();
  }

  attachCycleSession(
    scopeId: string,
    sessionId: string,
    goal?: string,
    createdAt?: number,
    updatedAt?: number
  ): void {
    this.detachCycleSession(sessionId, false);
    const scope = this.getOrCreateMutableScope(scopeId, goal);
    if (!scope.cycleSessionIds.includes(sessionId)) {
      scope.cycleSessionIds.push(sessionId);
    }
    scope.goal = goal ?? scope.goal;
    scope.createdAt = Math.min(scope.createdAt, createdAt ?? scope.createdAt);
    scope.updatedAt = Math.max(scope.updatedAt, updatedAt ?? Date.now());
    this.state.activeScopeId = scopeId;
    this.markDirty();
    this.scheduleSave();
  }

  detachCycleSession(sessionId: string, dropOrphan = true): string | undefined {
    const scope = this.state.scopes.find((entry) => entry.cycleSessionIds.includes(sessionId));
    if (!scope) return undefined;

    scope.cycleSessionIds = scope.cycleSessionIds.filter((id) => id !== sessionId);
    this.touchScope(scope);
    const scopeId = scope.scopeId;
    if (dropOrphan) {
      this.dropOrphanScope(scopeId);
    } else {
      this.markDirty();
    }
    this.scheduleSave();
    return scopeId;
  }

  removeScope(scopeId: string): boolean {
    const before = this.state.scopes.length;
    this.state.scopes = this.state.scopes.filter((scope) => scope.scopeId !== scopeId);
    if (this.state.activeScopeId === scopeId) {
      this.state.activeScopeId = this.pickMostRecentScopeId();
    }
    const removed = this.state.scopes.length !== before;
    if (removed) {
      this.markDirty();
      this.scheduleSave();
    }
    return removed;
  }

  async flush(): Promise<void> {
    await this.pendingSave;
    if (this.pendingSaveError) throw this.pendingSaveError;
  }

  private async loadState(input: RuntimeBootstrapInput): Promise<void> {
    let loadedRuntimeState = false;
    try {
      const raw = await fs.readFile(RUNTIME_STATE_FILE, 'utf8');
      this.state = this.normalizeState(JSON.parse(raw));
      loadedRuntimeState = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Rebuild lazily from other persisted stores when runtime state does not exist yet.
    }

    if (!loadedRuntimeState) {
      this.state = this.rebuildFromBootstrap(input);
      this.pruneExpiredThinkStates();
      this.markDirty();
      await this.persist();
      return;
    }

    const expired = this.pruneExpiredThinkStates();
    if (expired) {
      this.markDirty();
      this.scheduleSave();
    }
    const hasRuntimeThinkState = this.state.scopes.some((scope) => scope.thinkState?.history.length);
    const reconciled = this.reconcileBootstrap({
      ...input,
      currentThinkState: hasRuntimeThinkState ? undefined : input.currentThinkState,
    });
    if (expired || reconciled) {
      await this.flush();
    }
  }

  private rebuildFromBootstrap(input: RuntimeBootstrapInput): RuntimeStateData {
    const state = createEmptyState();
    const thinkState = input.currentThinkState ? this.normalizeThinkState(input.currentThinkState) : undefined;
    const cycleSessions = input.cycleSessions ?? [];

    if (thinkState && thinkState.history.length > 0) {
      const scopeId = thinkState.currentScopeId?.trim() || this.generateScopeId();
      state.scopes.push({
        scopeId,
        createdAt: this.getThinkStateCreatedAt(thinkState),
        updatedAt: this.getThinkStateUpdatedAt(thinkState),
        goal: thinkState.goal,
        thinkSessionId: thinkState.currentSessionId,
        thinkState: cloneValue({ ...thinkState, currentScopeId: scopeId }),
        cycleSessionIds: [],
      });
      state.activeScopeId = scopeId;
    }

    for (const session of cycleSessions) {
      const preferredScopeId = session.scopeId?.trim();
      const scopeId = preferredScopeId || this.generateScopeId();
      let scope = state.scopes.find((entry) => entry.scopeId === scopeId);
      if (!scope) {
        scope = {
          scopeId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          goal: session.goal,
          thinkSessionId: undefined,
          thinkState: undefined,
          cycleSessionIds: [],
        };
        state.scopes.push(scope);
      }
      if (!scope.cycleSessionIds.includes(session.sessionId)) {
        scope.cycleSessionIds.push(session.sessionId);
      }
      scope.goal = scope.goal ?? session.goal;
      scope.createdAt = Math.min(scope.createdAt, session.createdAt);
      scope.updatedAt = Math.max(scope.updatedAt, session.updatedAt);
    }

    if (!state.activeScopeId) {
      state.activeScopeId = this.pickMostRecentScopeId(state.scopes);
    }

    state.savedAt = new Date().toISOString();
    return state;
  }

  private reconcileBootstrap(input: RuntimeBootstrapInput): boolean {
    let changed = false;
    const thinkState = input.currentThinkState ? this.normalizeThinkState(input.currentThinkState) : undefined;
    const cycleSessions = input.cycleSessions ?? [];

    if (input.cycleSessions) {
      const persistedSessionIds = new Set(cycleSessions.map((session) => session.sessionId));
      for (const scope of [...this.state.scopes]) {
        const retainedSessionIds = scope.cycleSessionIds.filter((id) => persistedSessionIds.has(id));
        if (retainedSessionIds.length !== scope.cycleSessionIds.length) {
          scope.cycleSessionIds = retainedSessionIds;
          this.dropOrphanScope(scope.scopeId);
          changed = true;
        }
      }
    }

    if (thinkState && thinkState.history.length > 0) {
      const preferredScopeId = thinkState.currentScopeId?.trim();
      const targetScopeId = preferredScopeId
        || this.state.activeScopeId
        || this.generateScopeId();
      const scope = this.getOrCreateMutableScope(targetScopeId, thinkState.goal);
      const nextThinkState = cloneValue({ ...thinkState, currentScopeId: targetScopeId });
      if (JSON.stringify(scope.thinkState) !== JSON.stringify(nextThinkState) || scope.thinkSessionId !== thinkState.currentSessionId) {
        scope.thinkState = nextThinkState;
        scope.thinkSessionId = thinkState.currentSessionId;
        scope.goal = thinkState.goal ?? scope.goal;
        scope.updatedAt = Math.max(scope.updatedAt, this.getThinkStateUpdatedAt(thinkState));
        this.state.activeScopeId = targetScopeId;
        changed = true;
      }
    }

    for (const session of cycleSessions) {
      const knownScopeId = this.getScopeIdByCycleSessionId(session.sessionId);
      const preferredScopeId = session.scopeId?.trim();
      const targetScopeId = preferredScopeId || knownScopeId || this.generateScopeId();
      const scope = this.getOrCreateMutableScope(targetScopeId, session.goal);
      const hadSession = scope.cycleSessionIds.includes(session.sessionId);
      if (!hadSession) {
        this.detachCycleSession(session.sessionId, false);
        scope.cycleSessionIds.push(session.sessionId);
        changed = true;
      }
      const nextUpdatedAt = Math.max(scope.updatedAt, session.updatedAt);
      const nextCreatedAt = Math.min(scope.createdAt, session.createdAt);
      if (scope.updatedAt !== nextUpdatedAt || scope.createdAt !== nextCreatedAt) {
        scope.updatedAt = nextUpdatedAt;
        scope.createdAt = nextCreatedAt;
        changed = true;
      }
      if (!scope.goal && session.goal) {
        scope.goal = session.goal;
        changed = true;
      }
    }

    if (this.state.activeScopeId && !this.hasScope(this.state.activeScopeId)) {
      this.state.activeScopeId = undefined;
      changed = true;
    }

    if (!this.state.activeScopeId) {
      const nextActiveScopeId = thinkState?.history.length
        ? thinkState.currentScopeId?.trim() || this.pickMostRecentScopeId()
        : this.pickMostRecentScopeId();
      if (nextActiveScopeId) {
        this.state.activeScopeId = nextActiveScopeId;
        changed = true;
      }
    }

    if (changed) {
      this.markDirty();
      this.scheduleSave();
    }
    return changed;
  }

  private getOrCreateMutableScope(scopeId: string, goal?: string): RuntimeScopeRecord {
    let scope = this.state.scopes.find((entry) => entry.scopeId === scopeId);
    if (!scope) {
      const now = Date.now();
      scope = {
        scopeId,
        createdAt: now,
        updatedAt: now,
        goal,
        thinkSessionId: undefined,
        thinkState: undefined,
        cycleSessionIds: [],
      };
      this.state.scopes.push(scope);
      this.markDirty();
    }
    if (goal && !scope.goal) {
      scope.goal = goal;
      this.markDirty();
    }
    return scope;
  }

  private normalizeState(raw: unknown): RuntimeStateData {
    const parsed = raw && typeof raw === 'object' ? (raw as Partial<RuntimeStateData>) : {};
    const scopes = Array.isArray(parsed.scopes)
      ? parsed.scopes
        .map((scope) => this.normalizeScope(scope))
        .filter((scope): scope is RuntimeScopeRecord => scope !== null)
      : [];
    const activeScopeId =
      typeof parsed.activeScopeId === 'string' && scopes.some((scope) => scope.scopeId === parsed.activeScopeId)
        ? parsed.activeScopeId
        : this.pickMostRecentScopeId(scopes);

    return {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      activeScopeId,
      scopes,
      savedAt:
        typeof parsed.savedAt === 'string' && !Number.isNaN(Date.parse(parsed.savedAt))
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  }

  private normalizeScope(raw: unknown): RuntimeScopeRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const parsed = raw as Partial<RuntimeScopeRecord>;
    if (typeof parsed.scopeId !== 'string' || parsed.scopeId.trim().length === 0) {
      return null;
    }

    const cycleSessionIds = Array.isArray(parsed.cycleSessionIds)
      ? [...new Set(parsed.cycleSessionIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : [];

    const thinkState = parsed.thinkState ? this.normalizeThinkState(parsed.thinkState) : undefined;
    const createdAt = Number.isFinite(parsed.createdAt) ? Number(parsed.createdAt) : this.getThinkStateCreatedAt(thinkState);
    const updatedAt = Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : this.getThinkStateUpdatedAt(thinkState);

    return {
      scopeId: parsed.scopeId,
      createdAt,
      updatedAt,
      goal: typeof parsed.goal === 'string' && parsed.goal.trim().length > 0 ? parsed.goal : thinkState?.goal,
      thinkSessionId:
        typeof parsed.thinkSessionId === 'string' && parsed.thinkSessionId.trim().length > 0
          ? parsed.thinkSessionId
          : thinkState?.currentSessionId,
      thinkState,
      cycleSessionIds,
    };
  }

  private normalizeThinkState(raw: unknown): RuntimeThinkState | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const parsed = raw as Partial<RuntimeThinkState>;
    if (!Array.isArray(parsed.history) || !Array.isArray(parsed.branches)) {
      return undefined;
    }

    return {
      history: cloneValue(parsed.history),
      branches: cloneValue(parsed.branches),
      lastThoughtNumber:
        typeof parsed.lastThoughtNumber === 'number' && Number.isFinite(parsed.lastThoughtNumber)
          ? Math.floor(parsed.lastThoughtNumber)
          : 0,
      goal: typeof parsed.goal === 'string' && parsed.goal.trim().length > 0 ? parsed.goal : undefined,
      currentSessionId:
        typeof parsed.currentSessionId === 'string' && parsed.currentSessionId.trim().length > 0
          ? parsed.currentSessionId
          : undefined,
      currentScopeId:
        typeof parsed.currentScopeId === 'string' && parsed.currentScopeId.trim().length > 0
          ? parsed.currentScopeId
          : undefined,
      deadEnds: Array.isArray(parsed.deadEnds) ? cloneValue(parsed.deadEnds) : [],
    };
  }

  private dropOrphanScope(scopeId: string): boolean {
    const scope = this.state.scopes.find((entry) => entry.scopeId === scopeId);
    if (!scope) return false;
    const hasThink = Boolean(scope.thinkState && scope.thinkState.history.length > 0);
    const hasCycles = scope.cycleSessionIds.length > 0;
    if (hasThink || hasCycles) {
      this.markDirty();
      return false;
    }

    this.state.scopes = this.state.scopes.filter((entry) => entry.scopeId !== scopeId);
    if (this.state.activeScopeId === scopeId) {
      this.state.activeScopeId = this.pickMostRecentScopeId();
    }
    this.markDirty();
    return true;
  }

  private getThinkStateCreatedAt(thinkState?: RuntimeThinkState): number {
    if (!thinkState || thinkState.history.length === 0) return Date.now();
    return Math.min(...thinkState.history.map((record) => record.timestamp));
  }

  private getThinkStateUpdatedAt(thinkState?: RuntimeThinkState): number {
    if (!thinkState || thinkState.history.length === 0) return Date.now();
    return thinkState.history.reduce(
      (latest, record) => Number.isFinite(record.timestamp) ? Math.max(latest, record.timestamp) : latest,
      0
    );
  }

  private pruneExpiredThinkStates(now = Date.now()): boolean {
    const cutoff = now - SESSION_TTL_HOURS * 60 * 60 * 1000;
    let changed = false;

    for (const scope of this.state.scopes) {
      if (scope.thinkState && (
        scope.thinkState.history.length === 0
        || this.getThinkStateUpdatedAt(scope.thinkState) < cutoff
      )) {
        scope.thinkState = undefined;
        scope.thinkSessionId = undefined;
        changed = true;
      }
    }

    const retainedScopes = this.state.scopes.filter(
      (scope) => scope.thinkState || scope.cycleSessionIds.length > 0
    );
    if (retainedScopes.length !== this.state.scopes.length) {
      this.state.scopes = retainedScopes;
      changed = true;
    }
    if (this.state.activeScopeId && !this.hasScope(this.state.activeScopeId)) {
      this.state.activeScopeId = this.pickMostRecentScopeId();
      changed = true;
    }

    return changed;
  }

  private touchScope(scope: RuntimeScopeRecord): void {
    scope.updatedAt = Date.now();
    this.markDirty();
  }

  private pickMostRecentScopeId(scopes = this.state.scopes): string | undefined {
    return scopes
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
      ?.scopeId;
  }

  private generateScopeId(): string {
    return `scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private markDirty(): void {
    this.isDirty = true;
  }

  private scheduleSave(): void {
    this.pendingSave = this.pendingSave
      .then(async () => {
        try {
          await this.persist();
          this.pendingSaveError = undefined;
        } catch (error) {
          this.pendingSaveError = error;
          console.error('Failed to persist runtime state:', error);
        }
      });
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

  private async persist(): Promise<void> {
    if (!this.isDirty) return;

    await this.withFsLock(async () => {
      if (!this.isDirty) return;

      this.isDirty = false;
      const savedAt = new Date().toISOString();
      try {
        const payload = JSON.stringify({
          ...this.state,
          schemaVersion: RUNTIME_SCHEMA_VERSION,
          savedAt,
        });
        await ensureThinkMcpDataDir();
        const tempFile = `${RUNTIME_STATE_FILE}.tmp`;
        await fs.writeFile(tempFile, payload, 'utf8');
        await fs.rename(tempFile, RUNTIME_STATE_FILE);
        this.state.savedAt = savedAt;
      } catch (error) {
        this.isDirty = true;
        try { await fs.unlink(`${RUNTIME_STATE_FILE}.tmp`); } catch { /* ignore */ }
        throw error;
      }
    });
  }
}
