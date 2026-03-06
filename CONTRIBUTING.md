# Contributing to Safe Mode

Thanks for your interest in contributing! Safe Mode is Apache-2.0 licensed and welcomes contributions.

## Setup

```bash
git clone https://github.com/SafeModeAI/safemode.git
cd safemode
npm install
npm run build
npm test
```

## Project Structure

```
src/
  cet/          CET classifier (action/category/risk/scope classification)
  knobs/        Knob gate (19 categories, 100+ configurable knobs)
  engines/      15 detection engines (loop killer, secrets, PII, firewall, etc.)
  hooks/        Hook runner + IDE installer (Claude Code, Cursor, Windsurf)
  proxy/        MCP proxy wrapper (alternative to hooks)
  config/       Config loader, presets, allowlist
  store/        SQLite event store
  scanner/      First-run secret scanner
  timemachine/  File snapshot + restore
  bridge/       TrustScope cloud sync (optional)
  rules/        Custom rules engine
  cli/          CLI command implementations
bin/
  safemode.ts   CLI entry point
tests/          Vitest test suite (692 tests across 14 files)
docs/           User and developer guides
```

## Development

```bash
npm run dev          # Watch mode (tsc --watch)
npm run build        # Build TypeScript
npm run build:hook   # Build esbuild bundle for hooks
npm test             # Run tests (vitest watch mode)
npm run test:run     # Run tests once
```

## Architecture

Every tool call flows through:

1. **CET Classification** — categorizes the action (read/write/delete/execute), scope (project/system/network), and risk (low/medium/high/critical)
2. **Rules Engine** — custom user rules from `.safemode.yaml`
3. **Knob Gate** — preset-based permission checks per (category, action) pair
4. **Detection Engines** — 15 engines run based on risk level (low=8 engines, medium+=15 engines)

The hook runner (`src/hooks/hook-runner.ts`) is the primary entry point for Claude Code and Cursor. It's bundled with esbuild into a single file for ~50ms cold start.

## Key Files

| File | Purpose |
|------|---------|
| `src/cet/index.ts` | CET classifier — every tool call goes through here |
| `src/cet/types.ts` | Core types: ToolCallEffect, ToolAction, ToolScope, RiskLevel |
| `src/knobs/gate.ts` | Knob gate — maps (category, action) to knob, returns allow/approve/block |
| `src/knobs/categories.ts` | Knob definitions — all 100+ knobs with defaults |
| `src/engines/base.ts` | Engine types + ENGINE_ROUTING (risk → engine IDs) |
| `src/engines/index.ts` | Engine registry — runs engines and aggregates results |
| `src/engines/13-command-firewall.ts` | Hardcoded blocked command patterns |
| `src/config/allowlist.ts` | Session overrides (`safemode allow <action> --once`) |
| `tests/calibration.test.ts` | 398-test calibration suite — full pipeline verification |

## Testing

```bash
npm test                                    # All tests (watch mode)
npx vitest run                              # All tests (single run)
npx vitest run tests/calibration.test.ts    # Calibration suite only
npx vitest run tests/cet.test.ts            # CET tests only
```

All 692 tests must pass before merging. Do not reduce the test count.

The **calibration test suite** (`tests/calibration.test.ts`) is the most important test file. It verifies every path through the full CET → KnobGate → Engine pipeline with real commands. If you change CET classification, knob routing, engine routing, or firewall patterns, update calibration tests accordingly.

## Common Tasks

### Adding a CET command pattern

1. Add classification in `refineSingleCommand()` in `src/cet/index.ts`
2. Add calibration test in `tests/calibration.test.ts` Section 1
3. If the command routes to a new knob, add knob gate mapping and knob definition
4. Run `npx vitest run tests/calibration.test.ts` to verify

### Adding a firewall pattern

1. Add pattern to `BLOCKED_PATTERNS` in `src/engines/13-command-firewall.ts`
2. Add test in `tests/calibration.test.ts` Section 5 (MUST block + MUST NOT block)
3. Verify safe variants are not caught

### Adding a knob

1. Add knob definition in `src/knobs/categories.ts` with `id`, `name`, `description`, `default`
2. Add gate mapping in `src/knobs/gate.ts` `ACTION_KNOB_MAP`
3. Add calibration test in `tests/calibration.test.ts` Section 2
4. If it should be configurable via `safemode allow`, add to `ACTION_KNOB_MAP` in `src/config/allowlist.ts`

### Adding a detection engine

1. Create `src/engines/NN-your-engine.ts` implementing `DetectionEngine`
2. Register in `src/engines/index.ts` constructor
3. Add to `ENGINE_ROUTING` in `src/engines/base.ts` (choose risk levels)
4. Add tests in `tests/engines.test.ts` and calibration tests

## Pull Requests

- Fork the repo and create a branch
- Write tests for new functionality
- Run `npm run test:run` and ensure all 692+ tests pass
- Keep PRs focused — one feature or fix per PR
- Update docs if adding user-facing features
- Update CHANGELOG.md

## Reporting Issues

File issues at https://github.com/SafeModeAI/safemode/issues with:
- Safe Mode version (`safemode version`)
- IDE and version (Claude Code, Cursor, Windsurf)
- Steps to reproduce
- Expected vs actual behavior
