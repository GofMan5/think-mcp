import { describe, expect, it } from 'vitest';
import { formatLogicMethodology } from '../logic.service.js';

describe('formatLogicMethodology', () => {
  it('keeps the public methodology and validation text stable', () => {
    const [text, isError] = formatLogicMethodology({
      target: 'Trace a production request from ingress to storage',
      context: 'Preserve rollback safety',
      depth: 'standard',
      focus: ['security'],
      stack: ['zod'],
    });

    expect(isError).toBe(false);
    expect(text).toContain('# LOGIC ANALYSIS METHODOLOGY\n**Depth:** standard | **Focus:** security\n**Stack:** zod');
    expect(text).toContain('Analyze: "Trace a production request from ingress to storage" (Preserve rollback safety)');
    expect(text).toContain('## 🔍 PHASE 1: CHAIN MAPPING');
    expect(text).toContain('## 💥 PHASE 2: CRACK HUNTING');
    expect(text).toContain('## ✨ PHASE 3: STANDARD BENCHMARK');
    expect(text).toContain('## 🎯 PHASE 4: ACTION PLANNING');
    expect(text).toContain('## 🛠️ STACK REMINDERS\n- Remember: Validate at boundaries, use strict mode, coerce query params');

    expect(formatLogicMethodology({ target: 'short' })).toEqual([
      '🚫 ERROR: Target must be at least 10 characters',
      true,
    ]);

    const [deep] = formatLogicMethodology({
      target: 'Trace a production request from ingress to storage',
      depth: 'deep',
    });
    expect(deep).toContain('## DEEP EVIDENCE GATE');
    expect(deep).toContain('Try to disprove the finding');
    expect(text).not.toContain('## DEEP EVIDENCE GATE');
  });
});
