import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ThoughtInput } from '../../types/thought.types.js';

const ENV_KEY = 'THINK_MCP_DATA_DIR';

async function loadServices() {
  vi.resetModules();
  const { RuntimeStateService } = await import('../runtime-state.service.js');
  const { ThinkingService } = await import('../thinking.service.js');
  const { CycleService } = await import('../cycle.service.js');
  return { RuntimeStateService, ThinkingService, CycleService };
}

describe.sequential('Scope Integration', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'think-mcp-scope-integration-'));
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

  it('aggregates think and cycle thoughts inside one shared scope for recall', async () => {
    const { RuntimeStateService, ThinkingService, CycleService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();

    const thinkingService = new ThinkingService(runtimeState);
    const cycleService = new CycleService(thinkingService, runtimeState);
    await cycleService.initialize();

    const thinkResult = thinkingService.processThought({
      thought: 'Plan rollback thresholds and dependency-safe migration checkpoints before the rollout begins.',
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Coordinate one scope across think and cycle',
    });

    expect(thinkResult.scopeId).toBeTruthy();

    const startedCycle = await cycleService.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Coordinate one scope across think and cycle',
      scopeId: thinkResult.scopeId,
    });

    await cycleService.handle({
      action: 'step',
      sessionId: startedCycle.sessionId,
      thoughtType: 'verification',
      thought: 'Verification defines rollback thresholds, canary metrics, and the exact rollback trigger for release safety.',
      confidence: 8,
    });

    const recall = thinkingService.recallThought(
      {
        query: 'rollback thresholds',
        scope: 'current',
        limit: 5,
        threshold: 0.6,
      },
      [
        ...thinkingService.getThoughtsForScope(thinkResult.scopeId),
        ...(await cycleService.getThoughtsForScope(thinkResult.scopeId!)),
      ]
    );

    expect(recall.matches.some((match) => match.source === 'think')).toBe(true);
    expect(recall.matches.some((match) => match.source === 'cycle')).toBe(true);
  });

  it.each(['auto', 'think'] as const)('keeps an existing think snapshot when %s cycle starts', async (backendMode) => {
    const { RuntimeStateService, ThinkingService, CycleService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    const cycleService = new CycleService(thinkingService, runtimeState);
    await cycleService.initialize();

    const originalThought = 'Preserve this existing think snapshot while attaching a cycle session to its scope.';
    const mirroredThought = 'Append this cycle verification without replacing the original think snapshot in the shared scope.';
    const thought = thinkingService.processThought({
      thought: originalThought,
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Preserve think state during cycle start',
    });
    await runtimeState.flush();

    const started = await cycleService.handle({
      action: 'start',
      backendMode,
      goal: 'Preserve think state during cycle start',
      scopeId: thought.scopeId,
    });

    expect(started.status).toBe('in_progress');
    expect(runtimeState.getThinkState(thought.scopeId!)?.history).toHaveLength(1);

    const stepped = await cycleService.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: mirroredThought,
      thoughtType: 'verification',
    });
    const combined = [
      ...thinkingService.getThoughtsForScope(thought.scopeId),
      ...await cycleService.getThoughtsForScope(thought.scopeId!),
    ];

    expect(stepped.status).toBe('in_progress');
    expect(runtimeState.getThinkState(thought.scopeId!)?.history.map((item) => item.thought))
      .toEqual([originalThought, mirroredThought]);
    expect(combined.some((item) => item.thought === originalThought)).toBe(true);
    expect(combined.some((item) => item.thought === mirroredThought)).toBe(true);
  });

  it.each(['auto', 'think'] as const)('continues scope A in %s mode while preserving current scope B', async (backendMode) => {
    const { RuntimeStateService, ThinkingService, CycleService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    const cycleService = new CycleService(thinkingService, runtimeState);
    await cycleService.initialize();

    const scopeAThought = 'Original scope A thought must remain before its cycle mirror is appended.';
    const scopeBThought = 'Independent scope B thought must remain untouched while cycle continues scope A.';
    const mirroredThought = 'Cycle adds this verification to scope A without writing into current scope B.';
    const scopeA = thinkingService.processThought({
      thought: scopeAThought,
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Continue occupied scope A safely',
    }).scopeId!;
    const scopeB = thinkingService.processThought({
      thought: scopeBThought,
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Keep current scope B intact',
    }).scopeId!;
    const started = await cycleService.handle({
      action: 'start',
      backendMode,
      goal: 'Continue occupied scope A safely',
      scopeId: scopeA,
    });

    const stepped = await cycleService.handle({
      action: 'step',
      sessionId: started.sessionId,
      thought: mirroredThought,
      thoughtType: 'verification',
    });

    expect(stepped.status).toBe('in_progress');
    expect(runtimeState.getActiveScopeId()).toBe(scopeA);
    expect(runtimeState.getThinkState(scopeA)?.history.map((item) => item.thought))
      .toEqual([scopeAThought, mirroredThought]);
    expect(runtimeState.getThinkState(scopeB)?.history.map((item) => item.thought)).toEqual([scopeBThought]);
    expect(thinkingService.getThoughtsForScope().map((item) => item.thought))
      .toEqual([scopeAThought, mirroredThought]);
  });

  it('continues mainline numbering after a scoped cycle revision', async () => {
    const { RuntimeStateService, ThinkingService, CycleService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    const cycleService = new CycleService(thinkingService, runtimeState);
    await cycleService.initialize();
    const scopeId = thinkingService.processThought({
      thought: 'Initial scoped thought establishes the mainline before revision.',
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
      goal: 'Keep scoped revision numbering coherent',
    }).scopeId!;
    const started = await cycleService.handle({
      action: 'start',
      backendMode: 'auto',
      goal: 'Keep scoped revision numbering coherent',
      scopeId,
    });

    const revised = await cycleService.handle({
      action: 'step',
      sessionId: started.sessionId,
      thoughtType: 'revision',
      thought: 'Revision replaces the initial approach with a materially different rollback-safe strategy.',
    });
    const continued = await cycleService.handle({
      action: 'step',
      sessionId: started.sessionId,
      thoughtType: 'decompose',
      thought: 'Second mainline thought now continues with concrete implementation checkpoints and ownership.',
    });
    const history = runtimeState.getThinkState(scopeId)?.history ?? [];

    expect(revised.status).toBe('in_progress');
    expect(continued.status).toBe('in_progress');
    expect(history.map((thought) => [thought.thoughtNumber, thought.isRevision ?? false]))
      .toEqual([[1, false], [1, true], [2, false]]);
  });

  it('resets only the selected runtime scope when active and in-memory scopes differ', async () => {
    const { RuntimeStateService, ThinkingService, CycleService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    const cycleService = new CycleService(thinkingService, runtimeState);
    await cycleService.initialize();

    const current = thinkingService.processThought({
      thought: 'Keep this current think scope intact while a different active scope is reset.',
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      goal: 'Preserve non-target think scope',
    });
    const currentScopeId = current.scopeId!;
    const targetScopeId = runtimeState.createScope('Reset only this target scope');
    runtimeState.upsertThinkState(targetScopeId, {
      history: [{
        thought: 'Target scope thought to clear.',
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        timestamp: Date.now(),
        sessionId: 'target-session',
      }],
      branches: [],
      lastThoughtNumber: 1,
      currentSessionId: 'target-session',
      currentScopeId: targetScopeId,
    });
    await cycleService.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Reset only this target scope',
      scopeId: targetScopeId,
    });
    const selectedScopeId = runtimeState.getActiveScopeId();

    const reset = await thinkingService.resetSession(selectedScopeId);
    await cycleService.resetScope(selectedScopeId!);
    runtimeState.removeScope(selectedScopeId!);
    await runtimeState.flush();
    const nextScopeId = runtimeState.getActiveScopeId();
    thinkingService.restoreRuntimeScope(
      nextScopeId,
      nextScopeId ? runtimeState.getThinkState(nextScopeId) : undefined
    );

    expect(reset.clearedThoughts).toBe(1);
    expect(runtimeState.hasScope(targetScopeId)).toBe(false);
    expect(runtimeState.getThinkState(currentScopeId)?.history).toHaveLength(1);
    expect(thinkingService.getThoughtsForScope(currentScopeId)).toHaveLength(1);
  });

  it('restores the next active think scope after resetting the current scope', async () => {
    const { RuntimeStateService, ThinkingService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    const originalThought = 'Older scope B thought must survive reset of the newer active scope A.';
    const continuation = 'Continue scope B with its second thought after scope A has been removed.';
    const scopeB = thinkingService.processThought({
      thought: originalThought,
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Preserve older scope B after reset',
    }).scopeId!;
    const scopeA = thinkingService.processThought({
      thought: 'Newer active scope A is the only scope selected for reset.',
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      goal: 'Reset newer active scope A',
    }).scopeId!;

    await thinkingService.resetSession(scopeA);
    runtimeState.removeScope(scopeA);
    await runtimeState.flush();
    const nextScopeId = runtimeState.getActiveScopeId();
    thinkingService.restoreRuntimeScope(
      nextScopeId,
      nextScopeId ? runtimeState.getThinkState(nextScopeId) : undefined
    );
    const continued = thinkingService.processThought({
      thought: continuation,
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });
    await runtimeState.flush();

    expect(continued.isError).toBeUndefined();
    expect(runtimeState.getActiveScopeId()).toBe(scopeB);
    expect(runtimeState.getThinkState(scopeB)?.history.map((item) => item.thought))
      .toEqual([originalThought, continuation]);
    expect(runtimeState.hasScope(scopeA)).toBe(false);
  });

  it('clears loaded legacy memory when runtime has no think snapshot', async () => {
    const { ThinkingService } = await loadServices();
    const thinkingService = new ThinkingService();
    thinkingService.processThought({
      thought: 'Legacy in-memory thought that must not survive an authoritative empty runtime.',
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });

    thinkingService.restoreRuntimeScope(undefined, undefined);

    expect(thinkingService.getThoughtsForScope()).toHaveLength(0);
  });

  it('keeps the active scope byte-for-byte unchanged when a thought is rejected', async () => {
    const { RuntimeStateService, ThinkingService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    const originalThought = 'Scope A must survive every rejected attempt without any local or persisted mutation.';
    const scopeA = thinkingService.processThought({
      thought: originalThought,
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Preserve scope A on rejection',
    }).scopeId!;
    await runtimeState.flush();

    const runtimeFile = join(tempDir, 'runtime_state.json');
    const localBefore = thinkingService.getRuntimeBootstrapState();
    const scopeBefore = runtimeState.getScope(scopeA);
    const fileBefore = await fs.readFile(runtimeFile, 'utf8');
    const rejectedInputs: Array<{ input: ThoughtInput; error: string }> = [
      {
        input: { thought: '', thoughtNumber: 1, totalThoughts: 2, nextThoughtNeeded: true },
        error: 'ERR_EMPTY_THOUGHT',
      },
      {
        input: {
          thought: 'This valid text still targets an unknown scope and must be rejected without resetting A.',
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
          scopeId: 'missing-scope',
        },
        error: 'ERR_SCOPE_NOT_FOUND',
      },
      {
        input: {
          thought: 'A new session cannot branch from a thought that does not exist in that new session.',
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
          branchFromThought: 99,
          branchId: 'invalid-new-branch',
        },
        error: 'ERR_INVALID_BRANCH',
      },
      {
        input: {
          thought: originalThought,
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
          isRevision: true,
          revisesThought: 1,
          goal: 'Rejected revision must not replace the original goal',
        },
        error: 'SHALLOW',
      },
      {
        input: {
          thought: 'Skipping directly to thought three must leave the current sequence untouched.',
          thoughtNumber: 3,
          totalThoughts: 3,
          nextThoughtNeeded: true,
        },
        error: 'ERR_SEQUENCE',
      },
    ];

    for (const { input, error } of rejectedInputs) {
      const rejected = thinkingService.processThought(input);
      await runtimeState.flush();

      expect(rejected.isError).toBe(true);
      expect(rejected.errorMessage).toContain(error);
      expect(rejected.scopeId).toBe(scopeA);
      expect(thinkingService.getRuntimeBootstrapState()).toEqual(localBefore);
      expect(runtimeState.getActiveScopeId()).toBe(scopeA);
      expect(runtimeState.getScope(scopeA)).toEqual(scopeBefore);
      expect(await fs.readFile(runtimeFile, 'utf8')).toBe(fileBefore);
    }

    const continued = thinkingService.processThought({
      thought: 'The valid second thought continues scope A after every rejection.',
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });
    await runtimeState.flush();

    expect(continued.isError).toBeUndefined();
    expect(continued.scopeId).toBe(scopeA);
    expect(runtimeState.getThinkState(scopeA)?.history.map((thought) => thought.thought))
      .toEqual([originalThought, 'The valid second thought continues scope A after every rejection.']);
  });

  it('rejects a fresh non-first sequence without creating or activating a scope', async () => {
    const { RuntimeStateService, ThinkingService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();
    const thinkingService = new ThinkingService(runtimeState);
    await runtimeState.flush();
    const runtimeFile = join(tempDir, 'runtime_state.json');
    const fileBefore = await fs.readFile(runtimeFile, 'utf8');

    const rejected = thinkingService.processThought({
      thought: 'A fresh service must not accept thought two without thought one.',
      thoughtNumber: 2,
      totalThoughts: 2,
      nextThoughtNeeded: false,
    });
    await runtimeState.flush();

    expect(rejected.isError).toBe(true);
    expect(rejected.errorMessage).toContain('[ERR_SEQUENCE] Expected #1, got #2.');
    expect(rejected.scopeId).toBeUndefined();
    expect(thinkingService.getRuntimeBootstrapState()).toBeUndefined();
    expect(runtimeState.getActiveScopeId()).toBeUndefined();
    expect(await fs.readFile(runtimeFile, 'utf8')).toBe(fileBefore);
  });

  it('preserves a legacy session when it cannot be read', async () => {
    const { ThinkingService } = await loadServices();
    const sessionFile = join(tempDir, 'thought_session.json');
    const legacySession = JSON.stringify({
      schemaVersion: 1,
      history: [{
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        thought: 'The only legacy thought must survive a transient read failure.',
        timestamp: Date.now(),
      }],
      branches: [],
      lastThoughtNumber: 1,
    });
    await fs.writeFile(sessionFile, legacySession, 'utf8');
    vi.spyOn(fs, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('access denied'), { code: 'EACCES' })
    );

    await expect(new ThinkingService().loadSession()).rejects.toMatchObject({ code: 'EACCES' });
    expect(await fs.readFile(sessionFile, 'utf8')).toBe(legacySession);
  });

  it('clears runtime scope attachments after shared-scope reset orchestration', async () => {
    const { RuntimeStateService, ThinkingService, CycleService } = await loadServices();
    const runtimeState = new RuntimeStateService();
    await runtimeState.initialize();

    const thinkingService = new ThinkingService(runtimeState);
    const cycleService = new CycleService(thinkingService, runtimeState);
    await cycleService.initialize();

    const thinkResult = thinkingService.processThought({
      thought: 'Map the active scope before reset so runtime cleanup can remove all attached state.',
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      goal: 'Test scope-wide reset',
    });
    const scopeId = thinkResult.scopeId!;

    const startedCycle = await cycleService.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Test scope-wide reset',
      scopeId,
    });

    await thinkingService.resetSession();
    const clearedCycleSessions = await cycleService.resetScope(scopeId);
    runtimeState.removeScope(scopeId);
    await runtimeState.flush();

    expect(clearedCycleSessions).toBe(1);
    expect(runtimeState.hasScope(scopeId)).toBe(false);
    expect((await cycleService.getThoughtsForScope(scopeId))).toHaveLength(0);
    expect((await cycleService.handle({ action: 'status', sessionId: startedCycle.sessionId })).status).toBe('error');
  });
});
