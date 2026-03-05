# Safe Mode Developer Guide

## Architecture Overview

Safe Mode has two interception paths:

1. **Hooks (primary)** -- Native IDE hooks (Claude Code PreToolUse, Cursor beforeShellExecution). The hook runner receives tool call JSON on stdin, runs the governance pipeline, outputs allow/deny to stdout.

2. **MCP Proxy (fallback)** -- Wraps MCP server stdio, intercepts JSON-RPC tool calls. Used when native hooks aren't available.

## Governance Pipeline

```
Tool Call Input
  |
  v
CET Classifier (src/cet/)
  -> ToolCallEffect { action, category, scope, risk }
  |
  v
Rules Engine (src/rules/)
  -> Custom user rules from .safemode.yaml
  -> block/allow per rule
  |
  v
Knob Gate (src/knobs/)
  -> Preset-based permissions (allow/approve/block per knob)
  -> approve + approve_fallback=block -> block
  |
  v
Detection Engines (src/engines/)
  -> 15 engines run in parallel
  -> Any engine can block
  |
  v
Decision: allow or block
```

## CET Classifier

The CET (Constrained Execution Tools) classifier decomposes every tool call into a `ToolCallEffect`:

- **action**: read, write, create, delete, execute, transfer, search, list
- **category**: filesystem, terminal, git, network, database, financial, etc.
- **scope**: project, user_home, system, network, financial
- **risk**: low, medium, high, critical

Three classification levels:
1. **L1 Registry** -- Known tool names (Bash, Read, Write, etc.) with hardcoded classification
2. **L1 Refinement** -- Bash commands analyzed for content (rm -> filesystem/delete, git push -> git/write)
3. **L2 Inference** -- Parameter names and tool names inferred when L1 doesn't match

## Knob System

Knobs are configurable permissions per action type. Each knob has three values:

- `allow` -- Action proceeds without intervention
- `approve` -- Action requires approval (falls back to `approve_fallback` config)
- `block` -- Action is denied

Presets set knob defaults. Users override via `~/.safemode/config.yaml` overrides section.

The `ACTION_KNOB_MAP` in `src/knobs/gate.ts` maps (category, action) pairs to knob names.

## Detection Engines

All engines extend `DetectionEngine` from `src/engines/base.ts`:

```typescript
abstract evaluate(
  toolName: string,
  serverName: string,
  params: Record<string, unknown>,
  effect: ToolCallEffect,
  session: SessionState
): Promise<EngineResult>;
```

Engines run in parallel via `EngineRegistry.evaluate()`. Any engine returning `blocked: true` blocks the tool call.

## Hook Runner

`src/hooks/hook-runner.ts` is the standalone entry point for hook-based surfaces. It:

1. Lazy-initializes the pipeline (ConfigLoader, CET, KnobGate, EngineRegistry)
2. Reads JSON from stdin
3. Runs the governance pipeline
4. Outputs surface-specific JSON to stdout

Built with esbuild into `dist/hooks/hook-runner.bundle.js` (~247KB, ~50ms cold start).

### Claude Code format

Input (stdin):
```json
{"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}}
```

Output (stdout):
```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}
```

### Cursor format

Input (stdin): same JSON
Output: `{"continue": true}` or `{"continue": false, "message": "..."}`

## Adding a Detection Engine

1. Create `src/engines/NN-your-engine.ts` extending `DetectionEngine`
2. Implement `evaluate()` returning `EngineResult`
3. Register in `src/engines/index.ts` `EngineRegistry` constructor
4. Add tests in `tests/engines.test.ts`

## Adding a CET Tool

Add to `KNOWN_TOOLS` in `src/cet/index.ts`:

```typescript
'ToolName': {
  action: 'write',
  scope_from: 'parameters.path',
  category: 'filesystem',
  risk_from_scope: true,
},
```

## Event Store

SQLite database at `~/.safemode/events.db`. Schema in `src/store/index.ts`.

Every tool call is logged with: tool name, server, effect, outcome, latency, engine results.

Query with `safemode history`, `safemode summary`, or directly via SQLite.

## Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
```

Test files mirror source structure in `tests/`. Each module has its own test file.

Current count: 252 tests across 13 files. Do not reduce this number.
