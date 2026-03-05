import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ENV_KEY = 'THINK_MCP_DATA_DIR';

type BackendMock = {
  processThought: ReturnType<typeof vi.fn>;
  resetSession: ReturnType<typeof vi.fn>;
};

async function createService(backend?: BackendMock) {
  vi.resetModules();
  const mod = await import('../cycle.service.js');
  const service = new mod.CycleService(backend as never);
  await service.initialize();
  return service;
}

describe.sequential('CycleService', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'think-mcp-cycle-test-'));
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
  });

  it('step auto-classifies thought type and updates coverage', async () => {
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
    expect(stepped.shortTrace.some((line) => line.includes('[alternative'))).toBe(true);
  });

  it('finalize blocks early and requires at least 10 more thoughts when budget allows', async () => {
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
    expect(finalized.requiredMoreThoughts).toBeGreaterThanOrEqual(10);
  });

  it('finalize completes when all phases are covered with sufficient quality', async () => {
    const service = await createService();
    const started = await service.handle({
      action: 'start',
      backendMode: 'independent',
      goal: 'Prepare production-safe architecture update with explicit quality verification',
    });

    const baseSteps = [
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

    const requiredThoughts = started.loop.required;
    for (let i = 0; i < requiredThoughts; i++) {
      const template = baseSteps[i % baseSteps.length];
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
