/**
 * Knob System Tests
 *
 * Tests the 100-knob system and config merging.
 */

import { describe, it, expect } from 'vitest';
import { KnobGate } from '../src/knobs/gate.js';
import {
  KNOB_DEFINITIONS,
  getAllKnobIds,
  getKnobDefinition,
  getKnobsForCategory,
  isHardcodedKnob,
  getDefaultKnobValues,
  maxKnobValue,
  type KnobValue,
} from '../src/knobs/categories.js';
import type { ToolCallEffect } from '../src/cet/types.js';

describe('Knob Categories', () => {
  it('should have 19 categories defined', () => {
    expect(Object.keys(KNOB_DEFINITIONS).length).toBe(19);
  });

  it('should have terminal category with required knobs', () => {
    const terminal = KNOB_DEFINITIONS.terminal;
    expect(terminal).toBeDefined();
    const knobIds = terminal.map(k => k.id);
    expect(knobIds).toContain('command_exec');
    expect(knobIds).toContain('destructive_commands');
    expect(knobIds).toContain('pipe_to_shell');
  });

  it('should have filesystem category', () => {
    const fs = KNOB_DEFINITIONS.filesystem;
    expect(fs).toBeDefined();
    const knobIds = fs.map(k => k.id);
    expect(knobIds).toContain('file_read');
    expect(knobIds).toContain('file_write');
    expect(knobIds).toContain('file_delete');
  });

  it('should have financial category', () => {
    const financial = KNOB_DEFINITIONS.financial;
    expect(financial).toBeDefined();
    const knobIds = financial.map(k => k.id);
    expect(knobIds).toContain('payment_create');
    expect(knobIds).toContain('transfer');
  });
});

describe('Knob Helper Functions', () => {
  it('getAllKnobIds should return all knob IDs', () => {
    const ids = getAllKnobIds();
    expect(ids.length).toBeGreaterThan(50);
    expect(ids).toContain('file_read');
    expect(ids).toContain('command_exec');
    expect(ids).toContain('payment_create');
  });

  it('getKnobDefinition should return definition by ID', () => {
    const def = getKnobDefinition('file_read');
    expect(def).toBeDefined();
    expect(def?.id).toBe('file_read');
    expect(def?.category).toBe('filesystem');
  });

  it('getKnobsForCategory should return all knobs for a category', () => {
    const knobs = getKnobsForCategory('terminal');
    expect(knobs.length).toBe(10);
  });

  it('isHardcodedKnob should identify non-overridable knobs', () => {
    expect(isHardcodedKnob('pipe_to_shell')).toBe(true);
    expect(isHardcodedKnob('file_read')).toBe(false);
  });

  it('getDefaultKnobValues should return all defaults', () => {
    const defaults = getDefaultKnobValues();
    expect(defaults.file_read).toBe('allow');
    expect(defaults.file_delete).toBe('approve');
    expect(defaults.pipe_to_shell).toBe('block');
  });
});

describe('Knob Value Ordering', () => {
  it('should use strictest value with maxKnobValue', () => {
    expect(maxKnobValue('allow', 'allow')).toBe('allow');
    expect(maxKnobValue('allow', 'approve')).toBe('approve');
    expect(maxKnobValue('allow', 'block')).toBe('block');
    expect(maxKnobValue('approve', 'block')).toBe('block');
    expect(maxKnobValue('block', 'allow')).toBe('block');
  });
});

describe('Knob Gate', () => {
  // Helper to create effect
  function createEffect(overrides: Partial<ToolCallEffect> = {}): ToolCallEffect {
    return {
      action: 'read',
      target: '/test/path',
      scope: 'project',
      risk: 'low',
      category: 'filesystem',
      confidence: 1.0,
      source: 'registry',
      ...overrides,
    };
  }

  describe('Default Behavior', () => {
    it('should allow low-risk reads by default', () => {
      const gate = new KnobGate({
        knobs: { file_read: 'allow' },
        approveFallback: 'block',
      });

      const result = gate.evaluate(
        createEffect({ action: 'read', category: 'filesystem', risk: 'low' })
      );

      expect(result.decision).toBe('allow');
    });
  });

  describe('Knob Overrides', () => {
    it('should respect explicit knob overrides', () => {
      const gate = new KnobGate({
        knobs: { file_write: 'block' },
        approveFallback: 'block',
      });

      const result = gate.evaluate(
        createEffect({ action: 'write', category: 'filesystem' })
      );

      expect(result.decision).toBe('block');
    });

    it('should use approve fallback for high-risk without specific knob', () => {
      const gate = new KnobGate({
        knobs: {},
        approveFallback: 'block',
      });

      const result = gate.evaluate(
        createEffect({ action: 'write', category: 'unknown' as any, risk: 'high' })
      );

      expect(result.decision).toBe('approve');
    });
  });

  describe('Performance', () => {
    it('should evaluate in <1ms', () => {
      const gate = new KnobGate({
        knobs: getDefaultKnobValues(),
        approveFallback: 'block',
      });

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        gate.evaluate(createEffect());
      }

      const elapsed = performance.now() - start;
      const avgTime = elapsed / 100;

      expect(avgTime).toBeLessThan(1);
    });
  });

  describe('Category Mapping', () => {
    it('should map filesystem tools to filesystem category', () => {
      const gate = new KnobGate({
        knobs: { file_read: 'allow' },
        approveFallback: 'block',
      });

      const result = gate.evaluate(
        createEffect({ category: 'filesystem', action: 'read' })
      );

      expect(result.knob).toBe('file_read');
    });

    it('should map database tools to database category', () => {
      const gate = new KnobGate({
        knobs: { db_read: 'allow' },
        approveFallback: 'block',
      });

      const result = gate.evaluate(
        createEffect({ category: 'database', action: 'read' })
      );

      expect(result.knob).toBe('db_read');
    });
  });

  describe('isAllowed Helper', () => {
    it('should check if action is allowed', () => {
      const gate = new KnobGate({
        knobs: { file_read: 'allow', file_write: 'block' },
        approveFallback: 'block',
      });

      expect(gate.isAllowed('filesystem', 'read')).toBe(true);
      expect(gate.isAllowed('filesystem', 'write')).toBe(false);
    });
  });

  describe('Config Updates', () => {
    it('should update knob configuration', () => {
      const gate = new KnobGate({
        knobs: { file_read: 'allow' },
        approveFallback: 'block',
      });

      gate.updateConfig({ knobs: { file_read: 'block' } });

      expect(gate.getKnobValue('file_read')).toBe('block');
    });

    it('should set single knob value', () => {
      const gate = new KnobGate({
        knobs: {},
        approveFallback: 'block',
      });

      gate.setKnobValue('file_write', 'approve');

      expect(gate.getKnobValue('file_write')).toBe('approve');
    });
  });
});
