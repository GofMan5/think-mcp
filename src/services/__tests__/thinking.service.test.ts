import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThinkingService } from '../thinking.service.js';
import type { ThoughtRecord } from '../../types/thought.types.js';

describe.sequential('ThinkingService', () => {
  let service: ThinkingService;

  beforeEach(() => {
    service = new ThinkingService();
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

  it('does not invent zero confidence or a low-confidence nudge when batch confidence is omitted', () => {
    const result = service.submitSession({
      goal: 'Keep omitted batch confidence explicitly unmeasured',
      thoughts: [{
        thoughtNumber: 1,
        thought: 'Record a complete batch thought without pretending that confidence was measured by the caller.',
      }],
    });

    expect(result.status).toBe('accepted');
    expect(result.metrics.avgConfidence).toBeUndefined();
    expect(result.nudge).toBeUndefined();
  });

  it('rejects a disconnected batch path without changing state or saving an insight', () => {
    const originalThought = 'Keep this existing reasoning state intact when a later atomic batch is rejected.';
    service.processThought({
      thought: originalThought,
      thoughtNumber: 1,
      totalThoughts: 2,
      nextThoughtNeeded: true,
      goal: 'Preserve the active session across a rejected batch submission',
    });
    const saveInsight = vi.spyOn(service, 'saveInsight').mockResolvedValue();

    const result = service.submitSession({
      goal: 'Reject disconnected winning paths before committing batch state',
      thoughts: [
        { thoughtNumber: 1, thought: 'Map the request boundary and establish the first dependency with observable acceptance evidence.' },
        { thoughtNumber: 2, thought: 'Trace the intermediate state transition and rollback behavior under a failed persistence write.' },
        { thoughtNumber: 3, thought: 'Define final verification commands, expected outputs, and recovery checks for the completed change.' },
      ],
      consolidation: {
        winningPath: [1, 3],
        summary: 'This path incorrectly skips its required intermediate dependency.',
        verdict: 'ready',
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.validation.errors).toEqual(expect.arrayContaining([expect.stringContaining('Path gaps')]));
    expect(saveInsight).not.toHaveBeenCalled();
    const remainingThoughts = JSON.parse(service.exportSession({ format: 'json', includeMermaid: false })).thoughts;
    expect(remainingThoughts).toHaveLength(1);
    expect(remainingThoughts[0].thought).toBe(originalThought);
  });

  it('rejects an empty batch winning path without saving an insight', () => {
    const saveInsight = vi.spyOn(service, 'saveInsight').mockResolvedValue();
    const result = service.submitSession({
      goal: 'Reject an empty winning path before committing batch state',
      thoughts: [{
        thoughtNumber: 1,
        thought: 'Establish one concrete reasoning step with enough evidence for deterministic validation.',
      }],
      consolidation: {
        winningPath: [],
        summary: 'This summary has no supporting thought selected.',
        verdict: 'ready',
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.validation.errors).toContain('Winning path must include at least one thought');
    expect(saveInsight).not.toHaveBeenCalled();
  });

  it('rejects a blank batch summary without saving an insight', () => {
    const saveInsight = vi.spyOn(service, 'saveInsight').mockResolvedValue();
    const result = service.submitSession({
      goal: 'Reject a blank batch summary before committing reusable memory',
      thoughts: [{
        thoughtNumber: 1,
        thought: 'Establish one complete evidence-backed reasoning step for the selected path.',
      }],
      consolidation: {
        winningPath: [1],
        summary: '   ',
        verdict: 'ready',
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.validation.errors).toContain('Consolidation summary must not be blank');
    expect(saveInsight).not.toHaveBeenCalled();
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

  it('recalls matches from cycle thoughts when additional session records are provided', () => {
    const cycleThoughts: ThoughtRecord[] = [
      {
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
        thought: 'Cycle reasoning defines rollback trigger thresholds and canary guardrails for the migration.',
        timestamp: Date.now(),
        sessionId: 'cycle-session-1',
        metadata: { source: 'cycle' },
      },
    ];

    const result = service.recallThought({
      query: 'rollback trigger thresholds',
      scope: 'current',
      searchIn: 'all',
      limit: 3,
      threshold: 0.5,
    }, cycleThoughts);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].source).toBe('cycle');
    expect(result.matches[0].thought).toContain('rollback trigger thresholds');
  });

  it('deduplicates mirrored recall rows while preserving distinct sessions', () => {
    const mirrored = 'Rollback checkpoint uses the same canary threshold in think and cycle storage.';
    const repeated = 'Rollback checkpoint stays distinct when two think sessions record it independently.';
    const record = (
      thought: string,
      source: 'think' | 'cycle',
      sessionId: string,
      timestamp: number,
      mirroredCycleSessionId?: string
    ): ThoughtRecord => ({
      thought,
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      timestamp,
      sessionId,
      metadata: { source },
      mirroredCycleSessionId,
    });

    const result = service.recallThought({
      query: 'rollback checkpoint',
      scope: 'current',
      limit: 10,
      threshold: 0.8,
    }, [
      record(mirrored, 'think', 'think-mirror', 1, 'cycle-mirror'),
      record(mirrored, 'cycle', 'cycle-mirror', 2),
      record(repeated, 'think', 'think-a', 3),
      record(repeated, 'think', 'think-b', 4),
    ]);

    expect(result.matches.filter((match) => match.thought === mirrored))
      .toMatchObject([{ source: 'cycle', sessionId: 'cycle-mirror' }]);
    expect(result.matches.filter((match) => match.thought === repeated).map((match) => match.sessionId).sort())
      .toEqual(['think-a', 'think-b']);

    const unrelated = service.recallThought({
      query: 'rollback checkpoint',
      scope: 'current',
      limit: 10,
      threshold: 0.8,
    }, [
      record(mirrored, 'think', 'think-independent', 1),
      record(mirrored, 'cycle', 'cycle-unrelated', 2),
    ]);

    expect(unrelated.matches.map((match) => match.sessionId).sort())
      .toEqual(['cycle-unrelated', 'think-independent']);
  });
});
