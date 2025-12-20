/**
 * ValidationService Tests
 * Edge cases for thought sequence validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationService } from '../validation.service.js';
import type { ThoughtInput, ThoughtRecord } from '../../types/thought.types.js';

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(() => {
    service = new ValidationService();
  });

  // Helper to create thought records
  const createThought = (thought: string, num: number, opts: Partial<ThoughtRecord> = {}): ThoughtRecord => ({
    thought,
    thoughtNumber: num,
    totalThoughts: 10,
    nextThoughtNeeded: true,
    timestamp: Date.now(),
    ...opts,
  });

  // Helper to create thought input
  const createInput = (thought: string, num: number, opts: Partial<ThoughtInput> = {}): ThoughtInput => ({
    thought,
    thoughtNumber: num,
    totalThoughts: 10,
    nextThoughtNeeded: true,
    ...opts,
  });

  describe('validateSequence', () => {
    it('should accept first thought (number 1)', () => {
      const input = createInput('First thought', 1);
      const result = service.validateSequence(input, [], 0);
      expect(result.valid).toBe(true);
    });

    it('should accept sequential thoughts', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Second', 2);
      const result = service.validateSequence(input, history, 1);
      expect(result.valid).toBe(true);
    });

    it('should reject skipped thought numbers', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Third', 3); // Skipping 2
      const result = service.validateSequence(input, history, 1);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('Sequence break');
    });

    it('should accept valid revision', () => {
      const history = [
        createThought('First thought', 1),
        createThought('Second thought', 2),
      ];
      const input = createInput('Revised first thought with new approach', 1, {
        isRevision: true,
        revisesThought: 1,
      });
      const result = service.validateSequence(input, history, 2);
      expect(result.valid).toBe(true);
    });

    it('should reject revision of non-existent thought', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Revision', 5, {
        isRevision: true,
        revisesThought: 5, // Does not exist
      });
      const result = service.validateSequence(input, history, 1);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('INVALID REVISION');
    });

    it('should reject shallow revision (too similar)', () => {
      const history = [createThought('I need to check the database connection status', 1)];
      // Revision must be meaningfully different (< 85% similarity)
      const input = createInput('I need to check the database connection status', 1, {
        isRevision: true,
        revisesThought: 1,
      });
      const result = service.validateSequence(input, history, 1);
      // Exact same text should be rejected as shallow
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('SHALLOW');
    });
  });

  describe('checkDuplicateStrict', () => {
    it('should reject duplicate thought number', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Another first', 1);
      const result = service.checkDuplicateStrict(input, history);
      expect(result).toContain('REJECTED');
    });

    it('should allow revision with same number', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Revised first', 1, { isRevision: true });
      const result = service.checkDuplicateStrict(input, history);
      expect(result).toBeUndefined();
    });

    it('should allow new thought number', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Second', 2);
      const result = service.checkDuplicateStrict(input, history);
      expect(result).toBeUndefined();
    });
  });

  describe('validateBranchSource', () => {
    it('should accept branch from existing thought', () => {
      const history = [
        createThought('First', 1),
        createThought('Second', 2),
      ];
      const input = createInput('Branch thought', 3, { branchFromThought: 1 });
      const result = service.validateBranchSource(input, history);
      expect(result).toBeUndefined();
    });

    it('should reject branch from non-existent thought', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Branch', 2, { branchFromThought: 5 });
      const result = service.validateBranchSource(input, history);
      expect(result).toContain('INVALID BRANCH');
    });

    it('should allow input without branch', () => {
      const history = [createThought('First', 1)];
      const input = createInput('Second', 2);
      const result = service.validateBranchSource(input, history);
      expect(result).toBeUndefined();
    });
  });

  describe('validatePathConnectivity', () => {
    it('should accept sequential path', () => {
      const history = [
        createThought('First', 1),
        createThought('Second', 2),
        createThought('Third', 3),
      ];
      const result = service.validatePathConnectivity([1, 2, 3], history);
      expect(result.valid).toBe(true);
    });

    it('should reject disconnected path', () => {
      const history = [
        createThought('First', 1),
        createThought('Second', 2),
        createThought('Third', 3),
      ];
      const result = service.validatePathConnectivity([1, 3], history); // Missing 2
      expect(result.valid).toBe(false);
      expect(result.disconnectedAt).toBe(3);
    });

    it('should accept path with valid branch', () => {
      const history = [
        createThought('First', 1),
        createThought('Second', 2),
        createThought('Branch from 1', 3, { branchFromThought: 1 }),
      ];
      const result = service.validatePathConnectivity([1, 3], history);
      expect(result.valid).toBe(true);
    });
  });
});
