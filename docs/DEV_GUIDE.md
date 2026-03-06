# Safe Mode Developer Guide

## Architecture Overview

Safe Mode has two interception paths:

1. **Hooks (primary)** — Native IDE hooks (Claude Code PreToolUse, Cursor beforeShellExecution). The hook runner receives tool call JSON on stdin, runs the governance pipeline, outputs allow/deny to stdout.

2. **MCP Proxy (fallback)** — Wraps MCP server stdio, intercepts JSON-RPC tool calls. Used when native hooks aren't available.

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
  -> Maps (category, action) to knob name via ACTION_KNOB_MAP
  -> Looks up knob value (allow/approve/block) from preset config
  -> approve falls through to Claude Code's native permission prompt
  |
  v
Detection Engines (src/engines/)
  -> Risk-based routing: low=8 engines, medium+=15 engines
  -> Engines run in parallel (sequential for critical risk with early-stop)
  -> Any engine returning action:'block' blocks the tool call
  |
  v
Decision: allow or block
```

## CET Classifier

The CET (Constrained Execution Tools) classifier decomposes every tool call into a `ToolCallEffect`:

- **action**: read, write, create, delete, execute, transfer, search, list
- **category**: filesystem, terminal, git, network, database, financial, container, cloud, package, scheduling, authentication, deployment, monitoring, data, browser, physical, data_protection, api, communication
- **scope**: project, user_home, system, network, financial
- **risk**: low, medium, high, critical

### Classification Levels

1. **L1 Registry** — Known tool names (Bash, Read, Write, etc.) with hardcoded classification
2. **L1 Refinement** — Bash commands analyzed for content:
   - 200+ command patterns: `rm` → filesystem/delete, `git push` → git/write, `docker run` → container/execute
   - Infrastructure differentiation: docker/kubectl/terraform subcommands
   - Pipe/chain analysis: `curl | bash` → worst segment (critical)
   - Output redirection: `echo "data" > file.txt` → filesystem/write
3. **L2 Inference** — Parameter names and tool names inferred when L1 doesn't match (~85% accuracy)

### Scope Detection

Paths are classified in this priority order:
1. Network (`https://...`) → network
2. Within project directory → project
3. Relative paths (not starting with `/` or `~`) → project
4. System paths (`/etc`, `/usr`, `/var`, `/tmp`, `/sys`, `/bin`, `/sbin`, `/lib`) → system
5. Home paths (`~`, `/home/`, `/Users/`) → user_home
6. Default → user_home

## Knob System

Knobs are configurable permissions per action type. Each knob has three values:

- `allow` — Action proceeds without intervention
- `approve` — Falls through to Claude Code's native permission prompt (since 2.0.17)
- `block` — Action is denied

### Routing

The `ACTION_KNOB_MAP` in `src/knobs/gate.ts` maps (category, action) pairs to knob names. For example:

```
terminal/read    → command_exec     (allow)
terminal/delete  → destructive_commands (block)
filesystem/write → file_write       (allow)
package/create   → install          (approve)
container/create → container_create (approve)
git/delete       → git_branch_delete (approve)
```

Knob definitions in `src/knobs/categories.ts` provide the default values. Preset configs in `src/config/index.ts` override these defaults.

### Adding a Knob

1. Add definition in `categories.ts` → `KNOB_DEFINITIONS[category]`
2. Add gate mapping in `gate.ts` → `ACTION_KNOB_MAP[category][action]`
3. The knob name in gate.ts MUST match the `id` in categories.ts (mismatch causes silent fallthrough to fallback logic)
4. Add calibration test in `tests/calibration.test.ts`

## Engine Routing

```typescript
// src/engines/base.ts
export const ENGINE_ROUTING: Record<RiskLevel, number[]> = {
  low:      [1, 2, 3, 4, 5, 6, 7, 8],
  medium:   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  high:     [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  critical: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
};
```

- **Low risk** (reads): 8 counter/timer engines only (~2ms)
- **Medium risk** (npm run, curl): all 15 engines (~5ms)
- **High/Critical risk** (rm -rf, sudo): all 15 engines, critical runs sequentially with early-stop on block

### Detection Engines

| # | Engine | Type | What it catches |
|---|--------|------|----------------|
| 1-8 | Counters/Timers | Statistical | Loops, oscillation, velocity, cost, growth, latency, errors, throughput |
| 9 | PII Scanner | Content | SSNs, credit cards, emails in parameters |
| 10 | Secrets Scanner | Content | AWS keys, tokens, passwords in parameters |
| 11 | Prompt Injection | Pattern | Injection attempts in tool outputs |
| 12 | Jailbreak | Pattern | Attempts to bypass safety controls |
| 13 | Command Firewall | Hardcoded | Dangerous shell commands (40+ regex patterns) |
| 14 | Budget Cap | Threshold | Hard spending limit |
| 15 | Action-Label Mismatch | Semantic | Tool claims "read" but parameters suggest write |

### Session State in Hooks

The hook runner is a separate process per invocation. Session state is reconstructed from SQLite events in `getOrCreateSession()`:

- `call_counts` / `error_counts` — per-server Maps from event outcomes
- `latency_history` — per-server latency arrays from `latency_ms` column
- `session_cost_usd` — estimated cost (`tool_call_count * cost_per_call`, default $0.01)
- `calls_per_minute` — per-minute bucket counts from timestamps

This gives engines 4, 6, 7, 8, and 14 the data they need to function across hook invocations.

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

## Command Firewall

Engine 13 is hardcoded — it cannot be disabled by any preset or config. It blocks 40+ regex patterns including:

- Disk destruction (`rm -rf /`, `mkfs`, `dd if=/dev/zero`)
- Fork bombs (`:(){ :|:& };:`)
- Pipe to shell (`curl | bash`, `wget | sh`)
- System file tampering (`> /etc/passwd`, `rm /boot/`)
- Reverse shells (`nc -le /bin/bash`, `python -c "socket"`)
- Evasion patterns (`base64 -d | bash`, `$'\x72\x6d'`, `python -c "os.system()"`)

The firewall runs at medium risk and above. For low risk commands (reads), it does not run — but reads can't contain dangerous patterns anyway.

## Key Invariants

1. **Gate knob names must match categories.ts IDs.** A mismatch causes the knob lookup to return `undefined`, triggering fallback logic instead of the configured value.
2. **scope_from paths are relative to the params object.** For Claude Code native tools, use flat paths (`file_path`). For MCP tools, use nested paths (`parameters.path`).
3. **Project scope must be checked before system scope.** A project at `/tmp/myproject` must classify `/tmp/myproject/file.ts` as `project`, not `system`.
4. **Approve falls through to allow.** Since 2.0.17, `approve` knobs don't block — they let Claude Code's native permission prompt handle it. Only `block` knobs hard-deny.

## Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
```

### Test Structure

| File | Tests | Purpose |
|------|-------|---------|
| `calibration.test.ts` | 398 | Full pipeline verification (CET → KnobGate → Engines) |
| `cet.test.ts` | 33 | CET classifier unit tests |
| `engines.test.ts` | 36 | Individual engine tests |
| `knobs.test.ts` | 19 | Knob gate routing tests |
| `bridge.test.ts` | 37 | TrustScope cloud sync |
| `hooks.test.ts` | 17 | Hook runner integration |
| `timemachine.test.ts` | 19 | File snapshot/restore |
| Others | ~113 | Rules, ATSP, quarantine, CLI, proxy, ML engines, approvals |

**Total: 672 tests across 14 files.** Do not reduce this number.

The calibration test suite is the most important — it tests every real-world command through the full pipeline and catches regressions across all components.

## Event Store

SQLite database at `~/.safemode/safemode.db`. Schema in `src/store/index.ts`.

Every tool call is logged with: tool name, server, effect, outcome, latency, engine results.

Query with `safemode history`, `safemode summary`, or directly via SQLite.
