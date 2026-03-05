# Safe Mode User Guide

## Quick Start

```bash
npm install -g safemode
safemode init
```

Restart your IDE. Safe Mode is now running.

## How It Works

Safe Mode installs hooks into your IDE (Claude Code, Cursor, Windsurf). Every tool call your AI agent makes -- file writes, shell commands, git operations -- passes through Safe Mode's governance pipeline before execution.

```
Your prompt -> AI Agent -> Tool Call -> Safe Mode -> Allow/Block -> System
```

If Safe Mode blocks something, you'll see a denial message in your IDE. The block is logged and you can review it with `safemode history`.

## Presets

Presets control what gets blocked. Switch with `safemode preset <name>`.

| Preset | Blocks | Allows |
|--------|--------|--------|
| `yolo` | Nothing (log only) | Everything |
| `coding` | File deletion, destructive commands | Reads, writes, git commit |
| `personal` | Secrets, PII, shell commands | Reads, writes |
| `trading` | Network, packages, file writes | Reads, financial reads |
| `strict` | Everything except reads | Reads only |

**Default:** `coding`

## False Positives

If Safe Mode blocks something you need to do:

```bash
safemode allow <action> --once     # Allow for this session
safemode allow <action> --always   # Allow permanently
```

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
safemode allow <action> --once # Allow blocked action for session
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
| `~/.safemode/events.db` | SQLite event log |
| `~/.safemode/snapshots/` | Time Machine file snapshots |

## Detection Engines

| Engine | What It Catches |
|--------|----------------|
| Loop Killer | Repeated identical tool calls |
| Oscillation | Write-undo-write cycles |
| Velocity Limiter | Too many calls per minute |
| Cost Exposure | Session cost exceeding budget |
| Action Growth | Escalating permission requests |
| Latency Spike | Abnormal response times |
| Error Rate | Sustained error patterns |
| Throughput Drop | Sudden drops in success rate |
| PII Scanner | SSNs, credit cards, emails in params |
| Secrets Scanner | AWS keys, tokens, passwords |
| Prompt Injection | Injection attempts in tool outputs |
| Jailbreak | Attempts to bypass safety controls |
| Command Firewall | Dangerous shell commands |
| Budget Cap | Hard spending limits |
| Action-Label Mismatch | Tool says "read" but actually writes |

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
