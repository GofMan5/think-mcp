import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { RuntimeThinkState } from '../../types/thought.types.js';

const ENV_KEY = 'THINK_MCP_DATA_DIR';

async function loadRuntimeStateService() {
  vi.resetModules();
  const mod = await import('../runtime-state.service.js');
  return mod.RuntimeStateService;
}

describe.sequential('RuntimeStateService', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'think-mcp-runtime-state-test-'));
    process.env[ENV_KEY] = tempDir;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    delete process.env[ENV_KEY];
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('rebuilds active scope from think state first when runtime_state is missing', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const runtimeState = new RuntimeStateService();
    const now = Date.now();
    const thinkState: RuntimeThinkState = {
      history: [
        {
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
          thought: 'Primary scope bootstrap thought with concrete migration checkpoints.',
          timestamp: now - 2000,
          sessionId: 'think-session-1',
          metadata: { source: 'think' },
        },
      ],
      branches: [],
      lastThoughtNumber: 1,
      goal: 'Bootstrap active scope from think state',
      currentSessionId: 'think-session-1',
      currentScopeId: 'scope-think-primary',
      deadEnds: [],
    };

    await runtimeState.initialize({
      currentThinkState: thinkState,
      cycleSessions: [
        {
          sessionId: 'cycle-session-1',
          scopeId: 'scope-cycle-secondary',
          goal: 'Secondary cycle scope',
          constraints: [],
          createdAt: now - 1000,
          updatedAt: now,
          maxLoops: 20,
          requiredThoughts: 10,
          backendMode: 'independent',
          thoughts: [],
          phaseCoverage: {
            decompose: false,
            alternative: false,
            critique: false,
            synthesis: false,
            verification: false,
          },
          interopFallback: false,
        },
      ],
    });

    expect(runtimeState.getActiveScopeId()).toBe('scope-think-primary');
    expect(runtimeState.getThinkState('scope-think-primary')?.currentSessionId).toBe('think-session-1');
    expect(runtimeState.getScopeIdByCycleSessionId('cycle-session-1')).toBe('scope-cycle-secondary');

    const persisted = JSON.parse(await fs.readFile(join(tempDir, 'runtime_state.json'), 'utf8')) as {
      activeScopeId?: string;
      scopes: Array<{ scopeId: string }>;
    };
    expect(persisted.activeScopeId).toBe('scope-think-primary');
    expect(persisted.scopes).toHaveLength(2);
  });

  it('keeps persisted think state authoritative over legacy bootstrap data', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const now = Date.now();
    const persistedState: RuntimeThinkState = {
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought: 'Authoritative runtime thought.',
        timestamp: now,
        sessionId: 'runtime-session',
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentSessionId: 'runtime-session',
      currentScopeId: 'scope-runtime',
    };
    const legacyState: RuntimeThinkState = {
      ...persistedState,
      history: [{ ...persistedState.history[0], thought: 'Stale legacy thought.', timestamp: now + 1000 }],
      currentSessionId: 'legacy-session',
      currentScopeId: 'scope-legacy',
    };

    await new RuntimeStateService().initialize({ currentThinkState: persistedState });
    const reloaded = new RuntimeStateService();
    await reloaded.initialize({ currentThinkState: legacyState });

    expect(reloaded.getThinkState('scope-runtime')?.history[0].thought).toBe('Authoritative runtime thought.');
    expect(reloaded.hasScope('scope-legacy')).toBe(false);
  });

  it('owns an independent copy of upserted think state', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const source: RuntimeThinkState = {
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought: 'Original thought remains owned by runtime state.',
        timestamp: Date.now(),
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentScopeId: 'scope-owned',
      deadEnds: [],
    };

    runtimeState.upsertThinkState('scope-owned', source);
    await runtimeState.flush();
    source.history[0].thought = 'Caller mutation must not leak into runtime state.';

    expect(runtimeState.getThinkState('scope-owned')?.history[0].thought)
      .toBe('Original thought remains owned by runtime state.');
  });

  it('does not treat a runtime read failure as a missing state file', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const runtimeFile = join(tempDir, 'runtime_state.json');
    const authoritative = {
      schemaVersion: 1,
      activeScopeId: 'scope-runtime',
      scopes: [{
        scopeId: 'scope-runtime',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cycleSessionIds: ['runtime-cycle'],
      }],
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(runtimeFile, JSON.stringify(authoritative), 'utf8');
    const readError = Object.assign(new Error('access denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(readError);

    await expect(new RuntimeStateService().initialize({
      currentThinkState: {
        history: [{
          thoughtNumber: 1,
          totalThoughts: 1,
          nextThoughtNeeded: false,
          thought: 'Stale legacy thought must not replace unreadable runtime state.',
          timestamp: Date.now(),
        }],
        branches: [],
        lastThoughtNumber: 1,
        currentScopeId: 'scope-legacy',
      },
    })).rejects.toMatchObject({ code: 'EACCES' });

    expect(JSON.parse(await fs.readFile(runtimeFile, 'utf8'))).toEqual(authoritative);
  });

  it('does not rebuild authoritative runtime state after reconciliation write failure', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const now = Date.now();
    await fs.writeFile(join(tempDir, 'runtime_state.json'), JSON.stringify({
      schemaVersion: 1,
      activeScopeId: 'scope-runtime',
      scopes: [{
        scopeId: 'scope-runtime',
        createdAt: now,
        updatedAt: now,
        thinkSessionId: 'runtime-session',
        thinkState: {
          history: [{
            thoughtNumber: 1,
            totalThoughts: 1,
            nextThoughtNeeded: false,
            thought: 'Authoritative runtime thought must survive transient write failure.',
            timestamp: now,
          }],
          branches: [],
          lastThoughtNumber: 1,
          currentSessionId: 'runtime-session',
          currentScopeId: 'scope-runtime',
        },
        cycleSessionIds: [],
      }],
      savedAt: new Date(now).toISOString(),
    }), 'utf8');
    const staleLegacy: RuntimeThinkState = {
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought: 'Stale legacy thought must never replace authoritative runtime state.',
        timestamp: now + 1000,
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentScopeId: 'scope-legacy',
    };
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('transient write failure'));
    const runtimeState = new RuntimeStateService();

    await expect(runtimeState.initialize({
      currentThinkState: staleLegacy,
      cycleSessions: [{
        sessionId: 'cycle-bootstrap',
        scopeId: 'scope-cycle',
        goal: 'Reconcile a new cycle session',
        constraints: [],
        createdAt: now,
        updatedAt: now,
        maxLoops: 20,
        requiredThoughts: 10,
        backendMode: 'independent',
        thoughts: [],
        phaseCoverage: {
          decompose: false,
          alternative: false,
          critique: false,
          synthesis: false,
          verification: false,
        },
        interopFallback: false,
      }],
    })).rejects.toThrow('transient write failure');

    const persisted = JSON.parse(await fs.readFile(join(tempDir, 'runtime_state.json'), 'utf8')) as {
      scopes: Array<{ scopeId: string; thinkState?: { history: Array<{ thought: string }> } }>;
    };
    expect(persisted.scopes.map((scope) => scope.scopeId)).toEqual(['scope-runtime']);
    expect(persisted.scopes[0].thinkState?.history[0].thought)
      .toBe('Authoritative runtime thought must survive transient write failure.');
  });

  it('imports legacy think state into an existing runtime without a think snapshot', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    await new RuntimeStateService().initialize();
    const legacyState: RuntimeThinkState = {
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought: 'Legacy thought awaiting one-time runtime migration.',
        timestamp: Date.now(),
        sessionId: 'legacy-session',
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentSessionId: 'legacy-session',
      currentScopeId: 'scope-legacy',
    };

    const reloaded = new RuntimeStateService();
    await reloaded.initialize({ currentThinkState: legacyState });

    expect(reloaded.getThinkState('scope-legacy')?.history[0].thought).toBe(legacyState.history[0].thought);
    const persisted = JSON.parse(await fs.readFile(join(tempDir, 'runtime_state.json'), 'utf8')) as {
      scopes: Array<{ scopeId: string }>;
    };
    expect(persisted.scopes.some((scope) => scope.scopeId === 'scope-legacy')).toBe(true);
  });

  it('fails initialization when legacy migration cannot be persisted', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    await fs.writeFile(join(tempDir, 'runtime_state.json'), JSON.stringify({
      schemaVersion: 1,
      scopes: [],
      savedAt: new Date().toISOString(),
    }), 'utf8');
    await fs.mkdir(join(tempDir, 'runtime_state.json.tmp'));
    const legacyState: RuntimeThinkState = {
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought: 'Do not delete this legacy thought when migration cannot persist.',
        timestamp: Date.now(),
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentScopeId: 'scope-legacy',
    };

    await expect(new RuntimeStateService().initialize({ currentThinkState: legacyState }))
      .rejects.toBeInstanceOf(Error);
  });

  it('persists a mutation queued while an earlier write is in flight', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();

    const originalWriteFile = fs.writeFile.bind(fs);
    let releaseWrite = () => {};
    let signalWriteStarted = () => {};
    const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
    let shouldBlock = true;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (path, data, options) => {
      if (shouldBlock && String(path).endsWith('runtime_state.json.tmp')) {
        shouldBlock = false;
        signalWriteStarted();
        await writeBlocked;
      }
      return originalWriteFile(path, data, options);
    });

    const scopeId = runtimeState.createScope('Race-safe persistence scope');
    await writeStarted;
    runtimeState.attachCycleSession(scopeId, 'cycle-raced');
    releaseWrite();
    await runtimeState.flush();

    const persisted = JSON.parse(await fs.readFile(join(tempDir, 'runtime_state.json'), 'utf8')) as {
      scopes: Array<{ scopeId: string; cycleSessionIds: string[] }>;
    };
    expect(persisted.scopes.find((scope) => scope.scopeId === scopeId)?.cycleSessionIds).toEqual(['cycle-raced']);
  });

  it('expires runtime think snapshots older than the session TTL', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const oldTimestamp = Date.now() - 48 * 60 * 60 * 1000;
    await fs.writeFile(join(tempDir, 'runtime_state.json'), JSON.stringify({
      schemaVersion: 1,
      activeScopeId: 'scope-expired',
      scopes: [{
        scopeId: 'scope-expired',
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
        thinkSessionId: 'expired-session',
        thinkState: {
          history: [{
            thoughtNumber: 1,
            totalThoughts: 1,
            nextThoughtNeeded: false,
            thought: 'Expired runtime thought.',
            timestamp: oldTimestamp,
          }],
          branches: [],
          lastThoughtNumber: 1,
          currentSessionId: 'expired-session',
          currentScopeId: 'scope-expired',
        },
        cycleSessionIds: [],
      }],
      savedAt: new Date(oldTimestamp).toISOString(),
    }), 'utf8');

    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();

    expect(runtimeState.getThinkState('scope-expired')).toBeUndefined();
    expect(runtimeState.hasScope('scope-expired')).toBe(false);
    const persisted = JSON.parse(await fs.readFile(join(tempDir, 'runtime_state.json'), 'utf8')) as { scopes: unknown[] };
    expect(persisted.scopes).toHaveLength(0);
  });

  it('keeps recent think state and removes only expired think data from a cycle scope', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const now = Date.now();
    const oldTimestamp = now - 48 * 60 * 60 * 1000;
    const thinkState = (scopeId: string, timestamp: number, thought: string) => ({
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought,
        timestamp,
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentScopeId: scopeId,
    });
    await fs.writeFile(join(tempDir, 'runtime_state.json'), JSON.stringify({
      schemaVersion: 1,
      activeScopeId: 'scope-expired-cycle',
      scopes: [
        {
          scopeId: 'scope-recent',
          createdAt: now,
          updatedAt: now,
          thinkState: thinkState('scope-recent', now, 'Recent runtime thought.'),
          cycleSessionIds: [],
        },
        {
          scopeId: 'scope-expired-cycle',
          createdAt: oldTimestamp,
          updatedAt: now,
          thinkSessionId: 'expired-session',
          thinkState: thinkState('scope-expired-cycle', oldTimestamp, 'Expired runtime thought.'),
          cycleSessionIds: ['cycle-live'],
        },
      ],
      savedAt: new Date(now).toISOString(),
    }), 'utf8');

    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();

    expect(runtimeState.getThinkState('scope-recent')?.history[0].thought).toBe('Recent runtime thought.');
    expect(runtimeState.getThinkState('scope-expired-cycle')).toBeUndefined();
    expect(runtimeState.getScope('scope-expired-cycle')?.cycleSessionIds).toEqual(['cycle-live']);
    expect(runtimeState.getScopeIdByCycleSessionId('cycle-live')).toBe('scope-expired-cycle');
  });

  it('drops orphan scope references after the last attached cycle session is removed', async () => {
    const RuntimeStateService = await loadRuntimeStateService();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();

    const scopeId = runtimeState.createScope('Ephemeral cycle-only scope');
    runtimeState.attachCycleSession(scopeId, 'cycle-session-1', 'Ephemeral cycle-only scope', Date.now(), Date.now());
    runtimeState.detachCycleSession('cycle-session-1');
    await runtimeState.flush();

    expect(runtimeState.hasScope(scopeId)).toBe(false);
  });
});
