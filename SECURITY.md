# Security Policy

## Network Connections

Safe Mode makes **zero network requests** on install, import, or startup. All external connections require explicit user action.

| URL | Purpose | When it's called |
|-----|---------|-----------------|
| `api.telegram.org` | Phone notifications via Telegram | Only when user runs `safemode phone --telegram` |
| `api.trustscope.ai` | Cloud sync (optional) | Only when user runs `safemode connect` |
| `huggingface.co` | ML model download | Only on first use after user opts in with `--ml-enabled` |
| `app.trustscope.ai` | Documentation links | Displayed in CLI output text only (never fetched) |

### Verification

You can verify no startup network calls exist:

1. **No top-level fetches.** All `fetch()` calls are inside async methods that require explicit invocation.
2. **No constructor-time requests.** Network clients are instantiated lazily — constructors only set config, they don't connect.
3. **No install scripts.** The package has no `postinstall` or `preinstall` hooks.
4. **Module initialization is file I/O only.** Cached policies and pending events load from local SQLite, never from network.

### Hook Runner

The hook runner (`dist/hooks/hook-runner.bundle.js`) is the hot path — it runs on every tool call. It makes **zero network requests**. It reads from local SQLite and writes decisions to stdout. The entire governance pipeline (CET classification, knob gate, 15 detection engines) runs locally in ~5ms.

## Data Handling

- **No telemetry.** Safe Mode does not phone home, collect usage data, or transmit any information without explicit user action.
- **Local-only by default.** All event logs, session state, and file snapshots are stored in `~/.safemode/` on the local filesystem.
- **Cloud is opt-in.** The TrustScope cloud bridge (`safemode connect`) requires the user to explicitly provide an API key and run a connect command.

## Reporting Vulnerabilities

Report security vulnerabilities to security@trustscope.ai or file a private advisory at https://github.com/SafeModeAI/safemode/security/advisories.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Safe Mode version (`safemode version`)
- Your environment (OS, Node.js version, IDE)

We aim to acknowledge reports within 48 hours and publish fixes within 7 days for critical issues.
