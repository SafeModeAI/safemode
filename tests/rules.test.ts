/**
 * Rules Engine Tests
 *
 * Tests custom rules evaluation.
 */

import { describe, it, expect } from 'vitest';
import { RulesEngine, parseRules, type Rule, type RuleEvaluationContext } from '../src/rules/engine.js';
import type { ToolCallEffect } from '../src/cet/types.js';

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

// Helper to create context
function createContext(overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext {
  return {
    toolName: 'test_tool',
    serverName: 'test_server',
    parameters: {},
    effect: createEffect(),
    ...overrides,
  };
}

describe('Rules Engine', () => {
  describe('Rule Matching', () => {
    it('should match rule with equals operator', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block dangerous tool',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'tool_name', operator: 'equals', value: 'dangerous_tool' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      const result = engine.evaluate(createContext({ toolName: 'dangerous_tool' }));
      expect(result.matched).toBe(true);
      expect(result.finalAction).toBe('block');

      const result2 = engine.evaluate(createContext({ toolName: 'safe_tool' }));
      expect(result2.matched).toBe(false);
    });

    it('should match rule with contains operator', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block delete operations',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'tool_name', operator: 'contains', value: 'delete' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      expect(engine.evaluate(createContext({ toolName: 'file_delete' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ toolName: 'delete_record' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ toolName: 'read_file' })).matched).toBe(false);
    });

    it('should match rule with matches (regex) operator', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Match pattern',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'tool_name', operator: 'matches', value: '^(rm|delete)_.*' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      expect(engine.evaluate(createContext({ toolName: 'rm_file' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ toolName: 'delete_item' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ toolName: 'read_file' })).matched).toBe(false);
    });

    it('should match rule with in operator', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block specific servers',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'server_name', operator: 'in', value: ['server-a', 'server-b'] },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      expect(engine.evaluate(createContext({ serverName: 'server-a' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ serverName: 'server-b' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ serverName: 'server-c' })).matched).toBe(false);
    });

    it('should match rule with case insensitive option', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Case insensitive match',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'tool_name', operator: 'equals', value: 'dangerous', ignoreCase: true },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      expect(engine.evaluate(createContext({ toolName: 'DANGEROUS' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ toolName: 'Dangerous' })).matched).toBe(true);
      expect(engine.evaluate(createContext({ toolName: 'dangerous' })).matched).toBe(true);
    });
  });

  describe('Multiple Conditions', () => {
    it('should require all conditions to match (AND logic)', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Multiple conditions',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'tool_name', operator: 'equals', value: 'write_file' },
          { field: 'scope', operator: 'equals', value: 'system' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      // Both conditions match
      const ctx1 = createContext({
        toolName: 'write_file',
        effect: createEffect({ scope: 'system' }),
      });
      expect(engine.evaluate(ctx1).matched).toBe(true);

      // Only first condition matches
      const ctx2 = createContext({
        toolName: 'write_file',
        effect: createEffect({ scope: 'project' }),
      });
      expect(engine.evaluate(ctx2).matched).toBe(false);
    });
  });

  describe('Effect Field Matching', () => {
    it('should match on effect.action', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block execute actions',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'action', operator: 'equals', value: 'execute' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      const ctx1 = createContext({ effect: createEffect({ action: 'execute' }) });
      expect(engine.evaluate(ctx1).matched).toBe(true);

      const ctx2 = createContext({ effect: createEffect({ action: 'read' }) });
      expect(engine.evaluate(ctx2).matched).toBe(false);
    });

    it('should match on effect.risk', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block critical risk',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'risk', operator: 'equals', value: 'critical' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      const ctx = createContext({ effect: createEffect({ risk: 'critical' }) });
      expect(engine.evaluate(ctx).matched).toBe(true);
    });
  });

  describe('Parameter Field Matching', () => {
    it('should match on param.* fields', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block root path',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'param.path', operator: 'starts_with', value: '/' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      const ctx1 = createContext({ parameters: { path: '/etc/passwd' } });
      expect(engine.evaluate(ctx1).matched).toBe(true);

      const ctx2 = createContext({ parameters: { path: './local/file' } });
      expect(engine.evaluate(ctx2).matched).toBe(false);
    });

    it('should match nested parameter fields', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Block nested value',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'param.config.type', operator: 'equals', value: 'dangerous' },
        ],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);

      const ctx = createContext({
        parameters: { config: { type: 'dangerous' } },
      });
      expect(engine.evaluate(ctx).matched).toBe(true);
    });
  });

  describe('Rule Priority', () => {
    it('should process rules in priority order', () => {
      const rules: Rule[] = [
        {
          id: 'rule-low',
          name: 'Low priority',
          enabled: true,
          priority: 10,
          conditions: [{ field: 'tool_name', operator: 'equals', value: 'test' }],
          action: 'allow',
        },
        {
          id: 'rule-high',
          name: 'High priority',
          enabled: true,
          priority: 1,
          conditions: [{ field: 'tool_name', operator: 'equals', value: 'test' }],
          action: 'block',
          stopOnMatch: true,
        },
      ];

      const engine = new RulesEngine(rules);
      const result = engine.evaluate(createContext({ toolName: 'test' }));

      // Should only match high priority rule due to stopOnMatch
      expect(result.matches.length).toBe(1);
      expect(result.matches[0]!.rule.id).toBe('rule-high');
    });
  });

  describe('Final Action', () => {
    it('should return most restrictive action', () => {
      const rules: Rule[] = [
        {
          id: 'rule-1',
          name: 'Alert rule',
          enabled: true,
          priority: 1,
          conditions: [{ field: 'tool_name', operator: 'contains', value: 'test' }],
          action: 'alert',
        },
        {
          id: 'rule-2',
          name: 'Block rule',
          enabled: true,
          priority: 2,
          conditions: [{ field: 'tool_name', operator: 'contains', value: 'test' }],
          action: 'block',
        },
      ];

      const engine = new RulesEngine(rules);
      const result = engine.evaluate(createContext({ toolName: 'test_tool' }));

      expect(result.finalAction).toBe('block'); // Most restrictive
    });
  });

  describe('Disabled Rules', () => {
    it('should skip disabled rules', () => {
      const rule: Rule = {
        id: 'rule-1',
        name: 'Disabled rule',
        enabled: false,
        priority: 1,
        conditions: [{ field: 'tool_name', operator: 'equals', value: 'test' }],
        action: 'block',
      };

      const engine = new RulesEngine([rule]);
      const result = engine.evaluate(createContext({ toolName: 'test' }));

      expect(result.matched).toBe(false);
    });
  });
});

describe('Rule Parsing', () => {
  it('should parse rules from config object', () => {
    const config = {
      rules: [
        {
          id: 'parsed-rule',
          name: 'Parsed Rule',
          priority: 5,
          conditions: [
            { field: 'tool_name', operator: 'equals', value: 'test' },
          ],
          action: 'block',
        },
      ],
    };

    const rules = parseRules(config);

    expect(rules.length).toBe(1);
    expect(rules[0]!.id).toBe('parsed-rule');
    expect(rules[0]!.enabled).toBe(true);
  });

  it('should handle empty/invalid config', () => {
    expect(parseRules(null).length).toBe(0);
    expect(parseRules({}).length).toBe(0);
    expect(parseRules({ rules: 'not-array' }).length).toBe(0);
  });
});

describe('Rule Validation', () => {
  it('should validate required fields', () => {
    const engine = new RulesEngine();

    const validRule: Rule = {
      id: 'valid',
      name: 'Valid Rule',
      enabled: true,
      priority: 1,
      conditions: [{ field: 'tool_name', operator: 'equals', value: 'test' }],
      action: 'block',
    };

    const result = engine.validateRule(validRule);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should reject invalid rules', () => {
    const engine = new RulesEngine();

    const invalidRule = {
      name: 'Missing ID',
      enabled: true,
      priority: 1,
      conditions: [],
      action: 'invalid-action',
    } as unknown as Rule;

    const result = engine.validateRule(invalidRule);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
