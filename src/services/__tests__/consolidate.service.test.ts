import { describe, expect, it, vi } from 'vitest';
import { ConsolidateService } from '../consolidate.service.js';

describe('ConsolidateService', () => {
  it('blocks a ready verdict while the last thought explicitly requires more work', () => {
    const result = new ConsolidateService().consolidate(
      {
        winningPath: [1],
        summary: 'The initial hypothesis is not yet ready for a final answer.',
        verdict: 'ready',
      },
      [{
        thought: 'This initial hypothesis still requires verification before a final answer.',
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
        timestamp: 1,
      }]
    );

    expect(result.canProceedToFinalAnswer).toBe(false);
    expect(result.warnings).toContain(
      'ERROR SESSION INCOMPLETE: Last thought explicitly requires more work.'
    );
  });

  it('blocks a blank summary without saving an insight', () => {
    const onSuccess = vi.fn();
    const result = new ConsolidateService().consolidate(
      {
        winningPath: [1],
        summary: '   ',
        verdict: 'ready',
      },
      [{
        thought: 'The verified reasoning step is complete and ready for an explicit final summary.',
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        timestamp: 1,
      }],
      undefined,
      onSuccess
    );

    expect(result.canProceedToFinalAnswer).toBe(false);
    expect(result.warnings).toContain(
      'ERROR SUMMARY REQUIRED: Provide a non-empty final logic summary.'
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
