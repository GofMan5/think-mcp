import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ENV_KEY = 'THINK_MCP_DATA_DIR';

type BackendMock = {
  processThought: ReturnType<typeof vi.fn>;
  resetSession: ReturnType<typeof vi.fn>;
  saveInsight?: ReturnType<typeof vi.fn>;
};

async function createService(backend?: BackendMock) {
  vi.resetModules();
  const mod = await import('../cycle.service.js');
  const service = new mod.CycleService(backend as never);
  await service.initialize();
  return service;
}

const robustCycleSteps = [
  {
    thoughtType: 'decompose',
    thought: 'Decompose work into API contract update, migration script, read-path compatibility, and rollback checkpoints with ownership.',
  },
  {
    thoughtType: 'alternative',
    thought: 'Alternative path uses dual-write and read-repair strategy; compare complexity, risk profile, and latency overhead before choosing.',
  },
  {
    thoughtType: 'critique',
    thought: 'Critique current plan by stress testing failure domains: partial deploy, stale cache, and idempotency under retry storms.',
  },
  {
    thoughtType: 'synthesis',
    thought: 'Synthesize decision: choose backward-compatible read-first migration with controlled canary and measurable rollback trigger.',
  },
  {
    thoughtType: 'verification',
    thought: 'Verification checklist includes unit/integration tests, migration dry-run, canary SLO watch, alert routing, and rollback drill.',
  },
  {
    thoughtType: 'decompose',
    thought: 'Split execution into day-by-day milestones with owners, deliverables, and precondition checks to avoid hidden dependencies.',
  },
  {
    thoughtType: 'alternative',
    thought: 'Compare blue-green deployment against canary path to confirm operational blast radius and observability requirements.',
  },
  {
    thoughtType: 'critique',
    thought: 'Challenge assumptions about data cardinality and lock contention; add mitigation for worst-case migration duration spikes.',
  },
  {
    thoughtType: 'synthesis',
    thought: 'Merge findings into final rollout narrative aligned with constraints: safety first, measurable progress, reversible execution.',
  },
  {
    thoughtType: 'verification',
    thought: 'Define objective success metrics and failure thresholds, then map each threshold to an automatic rollback policy.',
  },
] as const;

describe.sequential('CycleService', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'think-mcp-cycle-test-'));
    process.env[ENV_KEY] = tempDir;
    vi.resetModules();
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

  it('treats a missing cycle store as an empty state', async () => {
    await expect(fs.access(join(tempDir, 'cycle_sessions.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    const service = await createService();

    expect(service.getSessionsForBootstrap()).toEqual([]);
  });

  it('rejects corrupt cycle storage without changing it', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const corruptStore = '{"schemaVersion":1,"sessions":[';
    await fs.writeFile(cycleFile, corruptStore, 'utf8');
    vi.resetModules();
    const mod = await import('../cycle.service.js');

    await expect(new mod.CycleService().initialize()).rejects.toBeInstanceOf(SyntaxError);
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(corruptStore);
  });

  it('rejects unsupported cycle schema versions without changing the store', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const unsupportedStore = JSON.stringify({
      schemaVersion: 2,
      sessions: [],
      savedAt: new Date().toISOString(),
    });
    await fs.writeFile(cycleFile, unsupportedStore, 'utf8');
    vi.resetModules();
    const mod = await import('../cycle.service.js');

    await expect(new mod.CycleService().initialize()).rejects.toThrow(
      'Unsupported cycle store schemaVersion: 2'
    );
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(unsupportedStore);
  });

  it('rejects cycle storage access failures without changing it', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const committedStore = JSON.stringify({
      schemaVersion: 1,
      sessions: [],
      savedAt: new Date().toISOString(),
    });
    await fs.writeFile(cycleFile, committedStore, 'utf8');
    vi.resetModules();
    const mod = await import('../cycle.service.js');
    const readError = Object.assign(new Error('access denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(readError);

    await expect(new mod.CycleService().initialize()).rejects.toMatchObject({ code: 'EACCES' });
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(committedStore);
  });

  it('rejects malformed thought entries without changing the committed store', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const seed = await createService();
    await seed.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Create a valid cycle store before malformed thought validation',
    });
    const parsed = JSON.parse(await fs.readFile(cycleFile, 'utf8'));
    parsed.sessions[0].thoughts = [null];
    const malformedStore = JSON.stringify(parsed);
    await fs.writeFile(cycleFile, malformedStore, 'utf8');
    vi.resetModules();
    const mod = await import('../cycle.service.js');

    await expect(new mod.CycleService().initialize()).rejects.toThrow('Invalid cycle session structure');
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(malformedStore);
  });

  it('rejects duplicate session ids without changing the committed store', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const seed = await createService();
    await seed.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Create a valid cycle store before duplicate identifier validation',
    });
    const parsed = JSON.parse(await fs.readFile(cycleFile, 'utf8'));
    parsed.sessions.push({ ...parsed.sessions[0] });
    const duplicateStore = JSON.stringify(parsed);
    await fs.writeFile(cycleFile, duplicateStore, 'utf8');
    vi.resetModules();
    const mod = await import('../cycle.service.js');

    await expect(new mod.CycleService().initialize()).rejects.toThrow('Duplicate cycle session id');
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(duplicateStore);
  });

  it('rolls back a failed step and commits one thought on retry', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const tempFile = `${cycleFile}.tmp`;
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Preserve committed cycle state when atomic replacement fails',
    });
    const committedStore = await fs.readFile(cycleFile, 'utf8');
    expect(committedStore).toBe(JSON.stringify(JSON.parse(committedStore)));
    const renameError = Object.assign(new Error('rename denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(renameError);

    await expect(service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Attempt a persisted cycle update that must fail without replacing the last committed state.',
      confidence: 8,
    })).rejects.toMatchObject({ code: 'EACCES' });

    expect(await fs.readFile(cycleFile, 'utf8')).toBe(committedStore);
    await expect(fs.access(tempFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(service.getSessionsForBootstrap()[0].thoughts).toEqual([]);

    const status = await service.handle({ action: 'status', sessionId: started.sessionId });
    expect(status.loop.current).toBe(0);

    const retried = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Attempt a persisted cycle update that must fail without replacing the last committed state.',
      confidence: 8,
    });
    expect(retried.loop.current).toBe(1);
    const persisted = JSON.parse(await fs.readFile(cycleFile, 'utf8'));
    expect(persisted.sessions[0].thoughts).toHaveLength(1);
    expect(persisted.sessions[0].thoughts[0].thought).toContain('Attempt a persisted cycle update');
  });

  it('serializes concurrent step transactions so a failed rollback cannot erase a successful step', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Serialize concurrent cycle mutations across durable commit and rollback',
    });
    const originalRename = fs.rename.bind(fs);
    let releaseFirstRename!: () => void;
    const firstRenameRelease = new Promise<void>((resolve) => {
      releaseFirstRename = resolve;
    });
    let markFirstRenameEntered!: () => void;
    const firstRenameEntered = new Promise<void>((resolve) => {
      markFirstRenameEntered = resolve;
    });
    let shouldFailCycleRename = true;
    vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (shouldFailCycleRename && String(oldPath).endsWith('cycle_sessions.json.tmp')) {
        shouldFailCycleRename = false;
        markFirstRenameEntered();
        await firstRenameRelease;
        throw Object.assign(new Error('rename denied'), { code: 'EACCES' });
      }
      await originalRename(oldPath, newPath);
    });

    const failedStep = service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Concurrent step A must roll back after its deliberately failed durable rename operation.',
      confidence: 7,
    });
    const failedAssertion = expect(failedStep).rejects.toMatchObject({ code: 'EACCES' });
    await firstRenameEntered;
    const successfulStep = service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Concurrent step B must commit exactly once after step A releases the transaction lock.',
      confidence: 8,
    });
    releaseFirstRename();

    await failedAssertion;
    const committed = await successfulStep;
    expect(committed.loop.current).toBe(1);
    expect(service.getSessionsForBootstrap()[0].thoughts.map((thought) => thought.thought)).toEqual([
      'Concurrent step B must commit exactly once after step A releases the transaction lock.',
    ]);
    const persisted = JSON.parse(await fs.readFile(cycleFile, 'utf8'));
    expect(persisted.sessions[0].thoughts.map((thought: { thought: string }) => thought.thought)).toEqual([
      'Concurrent step B must commit exactly once after step A releases the transaction lock.',
    ]);
  });

  for (const backendMode of ['auto', 'think'] as const) {
    it(`does not mirror a failed ${backendMode} cycle commit and mirrors its retry exactly once`, async () => {
      const cycleFile = join(tempDir, 'cycle_sessions.json');
      const { RuntimeStateService } = await import('../runtime-state.service.js');
      const { ThinkingService } = await import('../thinking.service.js');
      const { CycleService } = await import('../cycle.service.js');
      const runtimeState = new RuntimeStateService();
      await runtimeState.initialize();
      const thinkingService = new ThinkingService(runtimeState);
      const service = new CycleService(thinkingService, runtimeState);
      await service.initialize();
      const started = await service.handle({
        action: 'start',
        backendMode,
        goal: `Keep ${backendMode} think mirroring aligned with durable cycle commits`,
      });
      const originalRename = fs.rename.bind(fs);
      let shouldFailCycleRename = true;
      vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
        if (shouldFailCycleRename && String(oldPath).endsWith('cycle_sessions.json.tmp')) {
          shouldFailCycleRename = false;
          throw Object.assign(new Error('rename denied'), { code: 'EACCES' });
        }
        await originalRename(oldPath, newPath);
      });
      const thought = `Persist ${backendMode} cycle state before mirroring this unique reasoning step to the real think backend.`;

      await expect(service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thought,
        thoughtType: 'decompose',
        confidence: 8,
      })).rejects.toMatchObject({ code: 'EACCES' });

      expect(service.getSessionsForBootstrap()[0].thoughts).toEqual([]);
      expect(thinkingService.getThoughtsForScope(started.scopeId)).toEqual([]);
      expect(runtimeState.getThinkState(started.scopeId!)?.history ?? []).toEqual([]);

      const retried = await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thought,
        thoughtType: 'decompose',
        confidence: 8,
      });

      expect(retried.loop.current).toBe(1);
      expect(thinkingService.getThoughtsForScope(started.scopeId).map((item) => item.thought)).toEqual([thought]);
      expect(runtimeState.getThinkState(started.scopeId!)?.history.map((item) => item.thought)).toEqual([thought]);
      const persisted = JSON.parse(await fs.readFile(cycleFile, 'utf8'));
      expect(persisted.sessions[0].thoughts.map((item: { thought: string }) => item.thought)).toEqual([thought]);
    });
  }

  it('rolls back a failed start without attaching its runtime scope', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const { RuntimeStateService } = await import('../runtime-state.service.js');
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const scopeId = runtimeState.createScope('Existing runtime scope');
    await runtimeState.flush();
    const mod = await import('../cycle.service.js');
    const service = new mod.CycleService(undefined, runtimeState);
    await service.initialize();
    const renameError = Object.assign(new Error('rename denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(renameError);

    await expect(service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Reject a cycle start when its durable commit cannot complete',
      scopeId,
    })).rejects.toMatchObject({ code: 'EACCES' });

    expect(service.getSessionsForBootstrap()).toEqual([]);
    expect(runtimeState.getScope(scopeId)?.cycleSessionIds).toEqual([]);
    expect(runtimeState.getActiveScopeId()).toBe(scopeId);
    await expect(fs.access(cycleFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back a failed reset without detaching runtime state', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const { RuntimeStateService } = await import('../runtime-state.service.js');
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const scopeId = runtimeState.createScope('Runtime scope retained on reset failure');
    await runtimeState.flush();
    const mod = await import('../cycle.service.js');
    const service = new mod.CycleService(undefined, runtimeState);
    await service.initialize();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Keep a cycle session intact until reset is durably committed',
      scopeId,
    });
    const committedStore = await fs.readFile(cycleFile, 'utf8');
    const renameError = Object.assign(new Error('rename denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(renameError);

    await expect(service.handle({
      action: 'reset',
      sessionId: started.sessionId,
    })).rejects.toMatchObject({ code: 'EACCES' });

    expect(service.getSessionsForBootstrap().map((session) => session.sessionId)).toEqual([started.sessionId]);
    expect(runtimeState.getScopeIdByCycleSessionId(started.sessionId)).toBe(scopeId);
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(committedStore);

    const retried = await service.handle({ action: 'reset', sessionId: started.sessionId });
    expect(retried.status).toBe('completed');
    expect(service.getSessionsForBootstrap()).toEqual([]);
    expect(runtimeState.getScopeIdByCycleSessionId(started.sessionId)).toBeUndefined();
  });

  it('rolls back a failed scope reset without detaching runtime state', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const { RuntimeStateService } = await import('../runtime-state.service.js');
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const scopeId = runtimeState.createScope('Runtime scope retained on scope reset failure');
    await runtimeState.flush();
    const mod = await import('../cycle.service.js');
    const service = new mod.CycleService(undefined, runtimeState);
    await service.initialize();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Keep scoped cycle state intact until reset is durably committed',
      scopeId,
    });
    const committedStore = await fs.readFile(cycleFile, 'utf8');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('rename denied'), { code: 'EACCES' })
    );

    await expect(service.resetScope(scopeId)).rejects.toMatchObject({ code: 'EACCES' });

    expect(service.getSessionsForBootstrap().map((session) => session.sessionId)).toEqual([started.sessionId]);
    expect(runtimeState.getScopeIdByCycleSessionId(started.sessionId)).toBe(scopeId);
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(committedStore);
  });

  it('keeps cycle commits successful when runtime persistence fails and reconciles a stale reset on restart', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const runtimeFile = join(tempDir, 'runtime_state.json');
    const { RuntimeStateService } = await import('../runtime-state.service.js');
    const { CycleService } = await import('../cycle.service.js');
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const service = new CycleService(undefined, runtimeState);
    await service.initialize();
    const originalRename = fs.rename.bind(fs);
    let failRuntimeRename = true;
    let runtimeRenameFailures = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (failRuntimeRename && String(newPath).endsWith('runtime_state.json')) {
        runtimeRenameFailures++;
        throw Object.assign(new Error('runtime rename denied'), { code: 'EACCES' });
      }
      await originalRename(oldPath, newPath);
    });

    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Keep durable cycle operations successful across runtime metadata failures',
    });
    expect(started.status).toBe('in_progress');
    expect(runtimeRenameFailures).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(cycleFile, 'utf8')).sessions).toHaveLength(1);

    failRuntimeRename = false;
    runtimeState.setActiveScope(started.scopeId);
    await runtimeState.flush();
    runtimeRenameFailures = 0;
    failRuntimeRename = true;
    const stepped = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Commit this reasoning step exactly once even when runtime metadata cannot be replaced.',
      confidence: 8,
    });
    expect(stepped.loop.current).toBe(1);
    expect(runtimeRenameFailures).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(cycleFile, 'utf8')).sessions[0].thoughts).toHaveLength(1);

    failRuntimeRename = false;
    runtimeState.setActiveScope(started.scopeId);
    await runtimeState.flush();
    runtimeRenameFailures = 0;
    failRuntimeRename = true;
    const reset = await service.handle({ action: 'reset', sessionId: started.sessionId });
    expect(reset.status).toBe('completed');
    expect(runtimeRenameFailures).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(cycleFile, 'utf8')).sessions).toEqual([]);
    expect(JSON.parse(await fs.readFile(runtimeFile, 'utf8')).scopes[0].cycleSessionIds)
      .toEqual([started.sessionId]);

    failRuntimeRename = false;
    const reloadedRuntime = new RuntimeStateService();
    await reloadedRuntime.initialize({ cycleSessions: [] });
    expect(reloadedRuntime.getScopeIdByCycleSessionId(started.sessionId)).toBeUndefined();
    expect(reloadedRuntime.hasScope(started.scopeId!)).toBe(false);
  });

  it('rolls back failed scope reconciliation before touching runtime attachments', async () => {
    const cycleFile = join(tempDir, 'cycle_sessions.json');
    const { RuntimeStateService } = await import('../runtime-state.service.js');
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const originalScopeId = runtimeState.createScope('Original cycle scope');
    const runtimeScopeId = runtimeState.createScope('Runtime-authoritative replacement scope');
    await runtimeState.flush();
    const mod = await import('../cycle.service.js');
    const service = new mod.CycleService(undefined, runtimeState);
    await service.initialize();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Reconcile a persisted cycle scope only after a durable update',
      scopeId: originalScopeId,
    });
    runtimeState.attachCycleSession(runtimeScopeId, started.sessionId, 'Move runtime association');
    await runtimeState.flush();
    const committedStore = await fs.readFile(cycleFile, 'utf8');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('rename denied'), { code: 'EACCES' })
    );

    await expect(service.reconcileRuntimeScopes()).rejects.toMatchObject({ code: 'EACCES' });

    expect(service.getSessionsForBootstrap()[0].scopeId).toBe(originalScopeId);
    expect(runtimeState.getScopeIdByCycleSessionId(started.sessionId)).toBe(runtimeScopeId);
    expect(await fs.readFile(cycleFile, 'utf8')).toBe(committedStore);
  });

  it('start creates session and calculates adaptive required thought depth', async () => {
    const service = await createService();
    const result = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Design secure payment migration with rollback and concurrency safety while preserving auditability and uptime',
      constraints: ['zero data loss', 'no downtime', 'strict security checks'],
      context: 'System is distributed and performance sensitive under high traffic.',
    });

    expect(result.status).toBe('in_progress');
    expect(result.sessionId.length).toBeGreaterThan(0);
    expect(result.loop.required).toBeGreaterThanOrEqual(10);
    expect(result.loop.required).toBeLessThanOrEqual(20);
    expect(result.loop.max).toBe(20);
    expect(result.nextPrompts).toEqual([
      expect.stringContaining('thoughtType="decompose"'),
    ]);
  });

  it('joins an explicit scopeId when provided on start', async () => {
    const { RuntimeStateService } = await import('../runtime-state.service.js');
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const scopeId = runtimeState.createScope('Pre-created scope');

    const mod = await import('../cycle.service.js');
    const service = new mod.CycleService(undefined, runtimeState);
    await service.initialize();

    const result = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Attach cycle to an existing scope',
      scopeId,
    });

    expect(result.scopeId).toBe(scopeId);
    expect(runtimeState.getScopeIdByCycleSessionId(result.sessionId)).toBe(scopeId);
  });

  it('caps required thought depth to maxLoops so the session remains completable', async () => {
    const service = await createService();
    const result = await service.handle({
      action: 'start',
      backendMode: 'independent',
      maxLoops: 10,
      goal: 'Design secure payment migration with rollback and concurrency safety while preserving auditability and uptime',
    });

    expect(result.status).toBe('in_progress');
    expect(result.loop.max).toBe(10);
    expect(result.loop.required).toBe(10);
  });

  it('applies comparable adaptive depth to English and Russian high-risk goals', async () => {
    const service = await createService();
    const english = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Design secure payment migration with rollback and concurrency safety while preserving auditability and uptime',
    });
    const russian = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Спроектировать безопасную миграцию платежей с откатом и защитой от проблем конкурентности без потери аудита и доступности',
    });

    expect(russian.loop.required).toBeGreaterThanOrEqual(english.loop.required - 1);
    expect(Math.abs(english.loop.required - russian.loop.required)).toBeLessThanOrEqual(2);
  });

  it('step auto-classifies thought type while trace stays opt-in and prompts stay bounded', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Plan implementation path for resilient data processing pipeline',
    });

    const stepped = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Alternative approach: move heavy transformations to a queue worker and compare latency, retry control, and operational cost.',
      confidence: 7,
    });

    expect(stepped.status).toBe('in_progress');
    expect(stepped.quality.coverage).toBeGreaterThanOrEqual(0.2);
    expect(stepped.shortTrace).toBeUndefined();
    expect(stepped.nextPrompts.length).toBeLessThanOrEqual(3);

    const traced = await service.handle({
      action: 'status',
      sessionId: started.sessionId,
      showTrace: true,
    });
    expect(traced.shortTrace?.some((line) => line.includes('[alternative'))).toBe(true);
    expect(traced.nextPrompts.length).toBeLessThanOrEqual(3);
  });

  it('exports latest cycle thoughts in recall-compatible format', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Plan implementation path for resilient data processing pipeline',
    });

    await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thoughtType: 'verification',
      thought: 'Verification defines rollback trigger thresholds, canary metrics, and alert routing for the rollout.',
      confidence: 8,
    });

    const recallThoughts = await service.getLatestSessionThoughtsForRecall();

    expect(recallThoughts).toHaveLength(1);
    expect(recallThoughts[0]).toMatchObject({
      thoughtNumber: 1,
      sessionId: started.sessionId,
      metadata: { source: 'cycle' },
    });
  });

  it('finalize blocks early and reports only the remaining minimum gate work', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Create robust rollout strategy for risky backend change',
    });

    await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thoughtType: 'decompose',
      thought: 'Break rollout into staging, canary, and full deployment stages with explicit guardrails and rollback ownership.',
      confidence: 7,
    });

    const finalized = await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Deploy in phases with monitoring and rollback hooks.',
    });

    expect(finalized.status).toBe('blocked');
    expect(finalized.gate.reasonCodes).toContain('BELOW_REQUIRED_THOUGHTS');
    expect(finalized.requiredMoreThoughts).toBe(started.loop.required - 1);
  });

  it('finalize completes when all phases are covered with sufficient quality', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Prepare production-safe architecture update with explicit quality verification',
    });

    const requiredThoughts = started.loop.required;
    for (let i = 0; i < requiredThoughts; i++) {
      const template = robustCycleSteps[i % robustCycleSteps.length];
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: `${template.thought} Iteration ${i + 1} adds a distinct evidence checkpoint for rollout safety.`,
        confidence: i % 2 === 0 ? 7 : 8,
      });
    }

    const finalized = await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Execute staged migration with canary, strict observability, and automatic rollback thresholds.',
    });

    expect(finalized.status).toBe('completed');
    expect(finalized.gate.passed).toBe(true);
    expect(finalized.finalApprovedAnswer).toContain('staged migration');
  });

  it('requires an explicit constraint check without relying on language-specific overlap', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Protect a payment migration while preserving service continuity and recovery speed',
      constraints: ['zero downtime', 'rollback under five minutes'],
    });

    for (let i = 0; i < started.loop.required; i++) {
      const template = robustCycleSteps[i % robustCycleSteps.length];
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: `${template.thought} Constraint-gate iteration ${i + 1} records separate evidence.`,
        confidence: i % 2 === 0 ? 7 : 8,
      });
    }

    const ready = await service.handle({ action: 'status', sessionId: started.sessionId });
    expect(ready.status).toBe('ready');
    expect(ready.nextPrompts).toEqual([expect.stringContaining('think_cycle finalize')]);
    expect(ready.nextPrompts[0]).toContain('constraintCheck');

    const blocked = await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Use a staged migration with continuous service and a rehearsed rapid recovery path.',
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.gate.reasonCodes).toEqual(['CONSTRAINT_CHECK_REQUIRED']);
    expect(blocked.nextPrompts).toEqual([expect.stringContaining('constraintCheck')]);
    expect(blocked.finalApprovedAnswer).toBeUndefined();

    const completed = await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Use a staged migration with continuous service and a rehearsed rapid recovery path.',
      constraintCheck: 'Доступность: canary; откат: drill.',
    });
    expect(completed.status).toBe('completed');
    expect(completed.gate.reasonCodes).not.toContain('CONSTRAINT_CHECK_REQUIRED');
  });

  it('finalize can include export output using the think_done-style report contract', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Prepare production-safe architecture update with explicit quality verification',
    });

    const requiredThoughts = started.loop.required;
    for (let i = 0; i < requiredThoughts; i++) {
      const template = robustCycleSteps[i % robustCycleSteps.length];
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: `${template.thought} Iteration ${i + 1} adds a distinct evidence checkpoint for rollout safety.`,
        confidence: i % 2 === 0 ? 7 : 8,
      });
    }

    const finalized = await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Execute staged migration with canary, strict observability, and automatic rollback thresholds.',
      exportReport: 'markdown',
      includeMermaid: false,
    });

    expect(finalized.status).toBe('completed');
    expect(finalized.exportedReport).toContain('# Think Session Report');
    expect(finalized.exportedReport).toContain('Thoughts');
  });

  it('retries a pending insight without losing the terminal answer', async () => {
    const backend: BackendMock = {
      processThought: vi.fn(() => ({
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thoughtTree: '',
      })),
      resetSession: vi.fn(async () => undefined),
      saveInsight: vi.fn()
        .mockRejectedValueOnce(new Error('insight store unavailable'))
        .mockResolvedValue(undefined),
    };
    const service = await createService(backend);
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Prepare production-safe architecture update with explicit quality verification',
    });

    const requiredThoughts = started.loop.required;
    for (let i = 0; i < requiredThoughts; i++) {
      const template = robustCycleSteps[i % robustCycleSteps.length];
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: `${template.thought} Iteration ${i + 1} adds a distinct evidence checkpoint for rollout safety.`,
        confidence: i % 2 === 0 ? 7 : 8,
      });
    }

    const finalized = await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Execute staged migration with canary, strict observability, and automatic rollback thresholds.',
    });

    expect(finalized.status).toBe('completed');
    expect(finalized.finalApprovedAnswer).toContain('staged migration');
    expect(backend.saveInsight).toHaveBeenCalledTimes(1);
    expect(backend.saveInsight).toHaveBeenCalledWith(expect.objectContaining({
      goal: 'Prepare production-safe architecture update with explicit quality verification',
      summary: 'Execute staged migration with canary, strict observability, and automatic rollback thresholds.',
      sessionLength: requiredThoughts,
      path: Array.from({ length: requiredThoughts }, (_, idx) => idx + 1),
    }));

    const status = await service.handle({ action: 'status', sessionId: started.sessionId });
    expect(status.status).toBe('completed');
    expect(status.finalApprovedAnswer).toBe(finalized.finalApprovedAnswer);
    expect(status.gate).toEqual({ passed: true, reasonCodes: [] });
    expect(status.nextPrompts).toEqual([]);

    const lateStep = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'This late thought must not reopen a cycle whose approved result is already durable.',
    });
    expect(lateStep.gate.reasonCodes).toEqual(['SESSION_COMPLETED']);

    const pending = JSON.parse(await fs.readFile(join(tempDir, 'cycle_sessions.json'), 'utf8'));
    expect(pending.sessions[0]).toMatchObject({
      completedAt: expect.any(Number),
      finalApprovedAnswer: finalized.finalApprovedAnswer,
      insightPending: true,
    });

    const reloaded = await createService(backend);
    expect(backend.saveInsight).toHaveBeenCalledTimes(2);
    const reloadedStatus = await reloaded.handle({ action: 'status', sessionId: started.sessionId });
    expect(reloadedStatus.status).toBe('completed');
    expect(reloadedStatus.finalApprovedAnswer).toBe(finalized.finalApprovedAnswer);

    const repeated = await reloaded.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      exportReport: 'markdown',
      includeMermaid: false,
    });
    expect(repeated.status).toBe('completed');
    expect(repeated.finalApprovedAnswer).toBe(finalized.finalApprovedAnswer);
    expect(repeated.exportedReport).toContain('# Think Session Report');
    expect(backend.saveInsight).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await fs.readFile(join(tempDir, 'cycle_sessions.json'), 'utf8')).sessions[0].insightPending).toBe(false);
  });

  it('rolls back a failed completion marker before saving an insight', async () => {
    const backend: BackendMock = {
      processThought: vi.fn(() => ({
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thoughtTree: '',
      })),
      resetSession: vi.fn(async () => undefined),
      saveInsight: vi.fn(async () => undefined),
    };
    const service = await createService(backend);
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Keep cycle completion atomic before persisting its reusable insight',
    });
    for (let i = 0; i < started.loop.required; i++) {
      const template = robustCycleSteps[i % robustCycleSteps.length];
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: `${template.thought} Atomic completion iteration ${i + 1} adds separate evidence.`,
        confidence: i % 2 === 0 ? 7 : 8,
      });
    }

    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('rename denied'), { code: 'EACCES' })
    );
    await expect(service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Approve the durable staged plan only after its completion marker commits.',
    })).rejects.toMatchObject({ code: 'EACCES' });

    expect((await service.handle({ action: 'status', sessionId: started.sessionId })).status).toBe('ready');
    expect(service.getSessionsForBootstrap()[0].completedAt).toBeUndefined();
    expect(backend.saveInsight).not.toHaveBeenCalled();

    expect((await service.handle({
      action: 'finalize',
      sessionId: started.sessionId,
      finalAnswer: 'Approve the durable staged plan only after its completion marker commits.',
    })).status).toBe('completed');
    expect(backend.saveInsight).toHaveBeenCalledTimes(1);
  });

  it('keeps confidence stability unmeasured when confidence is omitted', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Measure confidence honestly when a model leaves confidence unspecified',
    });

    for (const template of robustCycleSteps.slice(0, 2)) {
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: template.thought,
      });
    }

    const status = await service.handle({ action: 'status', sessionId: started.sessionId });
    expect(status.quality.confidenceStability).toBeUndefined();
    expect(status.gate.reasonCodes).not.toContain('LOW_CONFIDENCE_STABILITY');
  });

  it('reports one remaining thought when all other gates are already satisfied', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Prepare production-safe architecture update with explicit quality verification',
    });

    for (let i = 0; i < started.loop.required - 1; i++) {
      const template = robustCycleSteps[i % robustCycleSteps.length];
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: template.thoughtType,
        thought: `${template.thought} Iteration ${i + 1} adds a distinct evidence checkpoint for rollout safety.`,
        confidence: i % 2 === 0 ? 7 : 8,
      });
    }

    const status = await service.handle({
      action: 'status',
      sessionId: started.sessionId,
    });

    expect(status.status).toBe('in_progress');
    expect(status.gate.reasonCodes).toEqual(['BELOW_REQUIRED_THOUGHTS']);
    expect(status.requiredMoreThoughts).toBe(1);
  });

  it('blocks further steps when maxLoops is reached', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      maxLoops: 10,
      goal: 'Find answer quickly with constrained budget',
    });

    for (let i = 0; i < 10; i++) {
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: 'decompose',
        thought: `Repeat narrow decomposition ${i + 1} with similar structure and limited variation.`,
        confidence: 6,
      });
    }

    const blocked = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thoughtType: 'decompose',
      thought: 'One extra thought beyond max loops should be blocked immediately by budget gate.',
      confidence: 6,
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.gate.reasonCodes).toContain('MAX_LOOPS_REACHED');
    expect(blocked.requiredMoreThoughts).toBe(0);
  });

  it('penalizes repeated thoughts by lowering diversity score', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Evaluate diversity scoring behavior under repeated thoughts',
    });

    const repeatedThought = 'This repeated reasoning step keeps the same wording, same structure, and same assumptions without adding new signal.';
    for (let i = 0; i < 3; i++) {
      await service.handle({
        action: 'step',
        sessionId: started.sessionId,
        thoughtType: 'decompose',
        thought: repeatedThought,
        confidence: 6,
      });
    }

    const status = await service.handle({
      action: 'status',
      sessionId: started.sessionId,
    });

    expect(status.quality.diversity).toBeLessThan(0.55);
  });

  it('auto mode falls back to independent when think backend fails', async () => {
    const backend: BackendMock = {
      processThought: vi.fn(() => {
        throw new Error('backend unavailable');
      }),
      resetSession: vi.fn(async () => undefined),
    };
    const service = await createService(backend);

    const started = await service.handle({
      action: 'start',
      backendMode: 'auto',
      goal: 'Validate fallback behavior for think backend failure path',
    });

    const stepped = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Add a substantial thought that should continue even when backend mirroring fails in auto mode.',
    });

    expect(stepped.status).toBe('in_progress');
    expect(stepped.interopFallback).toBe(true);
  });

  it('think mode returns error when backend fails and fallback is disabled', async () => {
    const backend: BackendMock = {
      processThought: vi.fn(() => {
        throw new Error('backend rejected');
      }),
      resetSession: vi.fn(async () => undefined),
    };
    const service = await createService(backend);

    const started = await service.handle({
      action: 'start',
      backendMode: 'think',
      goal: 'Validate strict think backend interoperability mode',
    });

    const failedStep = await service.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: 'Strict mode should fail if mirror backend rejects this reasoning step.',
    });

    expect(failedStep.status).toBe('error');
    expect(failedStep.gate.reasonCodes).toContain('INTEROP_BACKEND_ERROR');
  });

  it('supports status and reset lifecycle by session id', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Validate status and reset lifecycle behavior',
    });

    const status = await service.handle({
      action: 'status',
      sessionId: started.sessionId,
    });
    expect(['in_progress', 'ready', 'blocked']).toContain(status.status);

    const reset = await service.handle({
      action: 'reset',
      sessionId: started.sessionId,
    });
    expect(reset.status).toBe('completed');

    const afterReset = await service.handle({
      action: 'status',
      sessionId: started.sessionId,
    });
    expect(afterReset.status).toBe('error');
    expect(afterReset.gate.reasonCodes).toContain('SESSION_NOT_FOUND');
  });
});
