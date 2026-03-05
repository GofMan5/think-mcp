import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThinkingService } from '../thinking.service.js';

describe.sequential('ThinkingService', () => {
  let service: ThinkingService;

  beforeEach(() => {
    service = new ThinkingService();
    vi.spyOn(service, 'saveSession').mockResolvedValue();
    vi.spyOn(service, 'clearSession').mockResolvedValue();
  });

  it('preserves session id and goal for batch submission', () => {
    const goal = 'Validate batch session state keeps identifiers and goal';
    const result = service.submitSession({
      goal,
      thoughts: [
        { thoughtNumber: 1, thought: 'A'.repeat(80), confidence: 7 },
        { thoughtNumber: 2, thought: 'B'.repeat(80), confidence: 8 },
      ],
      showTree: false,
    });

    expect(result.status).toBe('accepted');
    expect(result.sessionId).toBeTruthy();

    const exported = JSON.parse(service.exportSession({ format: 'json', includeMermaid: false }));
    expect(exported.goal).toBe(goal);

    const sessionIds = new Set((exported.thoughts as Array<{ sessionId?: string }>).map(t => t.sessionId));
    expect(sessionIds.size).toBe(1);
    expect(sessionIds.has(result.sessionId)).toBe(true);
  });

  it('does not break mainline sequence after revision', () => {
    const first = 'Primary approach with enough content for deterministic sequence checks and stable validation.';
    const second = 'Second step extends the approach with additional safeguards and confidence calibration.';
    const revision = 'Revised second step uses a different strategy with new constraints, retries, and rollback path.';
    const third = 'Third step continues mainline after revision with implementation decisions and verifiable checks.';

    service.processThought({
      thought: first,
      thoughtNumber: 1,
      totalThoughts: 4,
      nextThoughtNeeded: true,
    });

    service.processThought({
      thought: second,
      thoughtNumber: 2,
      totalThoughts: 4,
      nextThoughtNeeded: true,
    });

    const revisionResult = service.processThought({
      thought: revision,
      thoughtNumber: 2,
      totalThoughts: 4,
      nextThoughtNeeded: true,
      isRevision: true,
      revisesThought: 2,
    });

    expect(revisionResult.isError).toBeUndefined();

    const next = service.processThought({
      thought: third,
      thoughtNumber: 3,
      totalThoughts: 4,
      nextThoughtNeeded: false,
    });

    expect(next.isError).toBeUndefined();
    expect(next.warning?.includes('ERR_SEQUENCE')).not.toBe(true);
  });

  it('hard rejects invalid sequence and keeps state unchanged', () => {
    service.processThought({
      thought: 'Initial step with enough detail to begin valid chain and establish sequence baseline.',
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });

    const rejected = service.processThought({
      thought: 'Skipped step attempt that should fail because thought number jumps over expected sequence.',
      thoughtNumber: 3,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });

    expect(rejected.isError).toBe(true);
    expect(rejected.warning).toContain('ERR_SEQUENCE');
    expect(rejected.thoughtHistoryLength).toBe(1);

    const recovered = service.processThought({
      thought: 'Now we provide the expected second step and sequence should recover without reset.',
      thoughtNumber: 2,
      totalThoughts: 3,
      nextThoughtNeeded: false,
    });
    expect(recovered.isError).toBeUndefined();
  });

  it('skips mermaid generation when includeMermaid is false', () => {
    const mermaidSpy = vi.spyOn((service as unknown as { visualizationService: { generateMermaid: () => string } }).visualizationService, 'generateMermaid');

    service.exportSession({ format: 'json', includeMermaid: false });

    expect(mermaidSpy).not.toHaveBeenCalled();
  });
});
