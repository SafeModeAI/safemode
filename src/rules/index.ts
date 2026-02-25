/**
 * Rules Module
 *
 * Exports for custom rules engine.
 */

export {
  RulesEngine,
  parseRules,
  getRulesEngine,
  configureRulesEngine,
} from './engine.js';

export type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleMatch,
  RuleEvaluationContext,
  RulesEvaluationResult,
} from './engine.js';
