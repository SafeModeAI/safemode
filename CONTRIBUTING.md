# Contributing to Safe Mode

Thanks for your interest in contributing! Safe Mode is Apache-2.0 licensed and welcomes contributions.

## Setup

```bash
git clone https://github.com/trustscope/safemode.git
cd safemode
npm install
npm run build
npm test
```

## Project Structure

```
src/
  cet/          CET classifier (action/category/risk classification)
  knobs/        Knob gate (configurable allow/approve/block per action)
  engines/      15 detection engines (loop killer, secrets, PII, etc.)
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
tests/          Vitest test suite (252 tests)
hooks/          Legacy hook scripts (deprecated, use hook-runner)
```

## Development

```bash
npm run dev          # Watch mode (tsc --watch)
npm run build        # Build TypeScript
npm run build:hook   # Build esbuild bundle for hooks
npm test             # Run tests (vitest)
npm run test:run     # Run tests once
```

## Architecture

Every tool call flows through:

1. **CET Classification** -- categorizes the action (read/write/delete/execute)
2. **Rules Engine** -- custom user rules from `.safemode.yaml`
3. **Knob Gate** -- preset-based permission checks
4. **Detection Engines** -- 15 parallel engines (secrets, PII, loops, cost, etc.)

The hook runner (`src/hooks/hook-runner.ts`) is the primary entry point for Claude Code and Cursor. It's bundled with esbuild into a single file for ~50ms cold start.

## Testing

```bash
npm test                          # All tests
npx vitest run tests/cet.test.ts  # Single file
```

All 252 tests must pass before merging. Do not reduce the test count.

## Pull Requests

- Fork the repo and create a branch
- Write tests for new functionality
- Run `npm test` and ensure all 252+ tests pass
- Keep PRs focused -- one feature or fix per PR
- Update README if adding user-facing features

## Reporting Issues

File issues at https://github.com/trustscope/safemode/issues with:
- Safe Mode version (`safemode version`)
- IDE and version (Claude Code, Cursor, Windsurf)
- Steps to reproduce
- Expected vs actual behavior
