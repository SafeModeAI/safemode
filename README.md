# Safe Mode

Stop your AI coding agent from doing something you'll regret.

```bash
npx safemode init
```

Safe Mode is a governance layer that sits between your AI coding agent and your system. It intercepts every tool call — file writes, shell commands, git operations, API calls — and blocks the dangerous ones before they execute.

Works with **Claude Code**, **Cursor**, and **Windsurf**. Free and open source (Apache-2.0).

## What it blocks

- `rm -rf /` and other destructive shell commands (hardcoded, cannot be disabled)
- Firewall evasion: base64-decoded pipes to shell, hex escapes, python/perl system() one-liners
- Secrets and API keys leaving your machine
- PII in tool call parameters
- Unauthorized git pushes, force operations
- Package installs with known vulnerabilities
- Prompt injection attempts in tool outputs
- Jailbreak attempts to bypass safety controls
- Runaway loops and cost spikes

## How it works

```
Your prompt → AI Agent → Tool Call → Safe Mode → Allow/Block → System
```

Every tool call passes through a governance pipeline:

1. **CET Classification** — decomposes the action into category, action, scope, and risk level
2. **Rules Engine** — custom rules from your config
3. **Knob Gate** — preset-based permission checks (19 categories, 100+ knobs)
4. **15 Detection Engines** — loop detection, secrets scanning, PII detection, command firewall, prompt injection, jailbreak detection, budget caps, and more

Risk-based engine routing:
- **Low risk** (reads, ls, git status): 8 counter engines (~2ms)
- **Medium risk** (npm run, curl, pip install): all 15 engines (~5ms)
- **High/Critical risk** (rm -rf, sudo, terraform destroy): all 15 engines, sequential with early-stop (~10ms)

The hook runs as an esbuild bundle. Cold start is ~50ms. You won't notice it.

## Install

```bash
npm install -g safemode
safemode init
```

`safemode init` does three things:
1. Scans your project for exposed secrets
2. Writes a config file to `~/.safemode/config.yaml`
3. Installs hooks into your IDE (Claude Code, Cursor, Windsurf)

Restart your IDE after init.

## Presets

```bash
safemode preset <name>
```

| Preset | Description |
|--------|-------------|
| `yolo` | Log everything, block nothing |
| `coding` | Block destructive ops, approve file deletes and package installs (default) |
| `personal` | Block secrets, PII, and destructive ops |
| `trading` | Strict financial safety — block network, packages, git |
| `strict` | Block everything that isn't a read |

## CLI

```bash
safemode init                  # Set up Safe Mode
safemode status                # Hook status, preset, cloud connection
safemode doctor                # Health check
safemode history               # View recent events
safemode history --json        # Machine-readable output
safemode preset coding         # Switch preset
safemode allow secrets --once  # Temporarily allow a blocked action
safemode restore               # Roll back files from Time Machine
safemode restore --list        # List available restore points
safemode phone --telegram      # Set up block notifications
safemode uninstall             # Remove hooks and restore configs
```

## CET Classification

Every shell command is deeply classified, not treated as a black box:

| Command | Category | Action | Risk |
|---------|----------|--------|------|
| `ls`, `cat`, `grep` | terminal | read | low |
| `echo "data" > file.txt` | filesystem | write | medium |
| `rm file.txt` | filesystem | delete | medium |
| `rm -rf dist/` | terminal | delete | high |
| `git status`, `git log` | git | read | low |
| `git push --force` | git | delete | critical |
| `npm install lodash` | package | create | medium |
| `docker run nginx` | container | execute | high |
| `docker ps` | container | read | low |
| `kubectl delete pod` | cloud | delete | high |
| `terraform destroy` | cloud | delete | critical |
| `terraform plan` | cloud | read | low |
| `ssh user@host` | network | execute | high |
| `eval "..."` | terminal | execute | critical |
| `sudo apt install` | terminal | execute | critical |

Infrastructure tools (Docker, kubectl, Terraform) are differentiated by subcommand — `docker ps` (low) is treated differently from `docker run` (high).

## False positive? One command.

```bash
safemode allow <action> --once     # Allow for this session (5 min)
safemode allow <action> --always   # Allow permanently
```

Actions: `secrets`, `pii`, `delete`, `write`, `git`, `network`, `packages`, `commands`

## Time Machine

Every file your AI agent modifies is snapshotted before the write happens. If something goes wrong:

```bash
safemode restore              # Restore most recent session
safemode restore 14:31        # Restore to a specific time
safemode restore -s <id>      # Restore a specific session
```

Snapshots use `git stash create` in git repos (zero worktree impact) with file copy as fallback.

## Custom rules

Add rules to `.safemode.yaml` in your project root:

```yaml
rules:
  - name: block-production-db
    conditions:
      - field: parameters.command
        operator: contains
        value: "prod-db"
    action: block
    message: "No production database access"
```

## Phone notifications

Get notified on Telegram or Discord when Safe Mode blocks something:

```bash
safemode phone --telegram    # Set up Telegram
safemode phone --discord     # Set up Discord
safemode phone --test        # Send a test notification
```

## Detection engines

| # | Engine | What it catches |
|---|--------|----------------|
| 1 | Loop Killer | Repeated identical tool calls |
| 2 | Oscillation | Write-undo-write cycles |
| 3 | Velocity Limiter | Too many calls per minute |
| 4 | Cost Exposure | Estimated session cost approaching budget |
| 5 | Action Growth | Escalating permission requests |
| 6 | Latency Spike | Abnormal response times |
| 7 | Error Rate | Sustained error patterns |
| 8 | Throughput Drop | Sudden drops in success rate |
| 9 | PII Scanner | SSNs, credit cards, emails in params |
| 10 | Secrets Scanner | AWS keys, tokens, passwords |
| 11 | Prompt Injection | Injection attempts in tool outputs |
| 12 | Jailbreak | Attempts to bypass safety controls |
| 13 | Command Firewall | Dangerous shell commands (hardcoded, cannot be disabled) |
| 14 | Budget Cap | Hard estimated spending limit |
| 15 | Action-Label Mismatch | Tool says "read" but actually writes |

### Command Firewall (Engine 13)

Hardcoded patterns that cannot be disabled by any preset or override:

- Disk destruction: `rm -rf /`, `rm -rf ~/`, `mkfs`, `dd if=/dev/zero`
- System directories: `rm -rf /usr`, `/var`, `/etc`, `/bin`, `/boot`
- Fork bombs: `:(){ :|:& };:`
- Pipe to shell: `curl | bash`, `wget | sh`
- Permission abuse: `chmod -R 777 /`, `chown -R root:root /`
- Raw device access: `> /dev/sda`, `> /dev/mem`
- System file tampering: `> /etc/passwd`, `> /etc/shadow`
- Reverse shells: `nc -le /bin/bash`, `python -c "import socket"`
- Evasion attempts: `base64 -d | bash`, `$'\x72\x6d'`, `xxd -r | sh`
- Dangerous eval: `eval "rm -rf /"`, `eval "curl | bash"`
- Python/Perl system exec: `python -c "os.system()"`, `perl -e "system()"`

## Scope detection

File paths are classified into scopes that affect risk level:

| Path | Scope | Why |
|------|-------|-----|
| `./src/index.ts` | project | Relative path |
| `/Users/me/project/file.ts` | project | Within project directory |
| `~/Documents/secret.txt` | user_home | Home directory |
| `/etc/hosts` | system | System path |
| `/tmp/scratch.txt` | system | Temp directory |
| `https://api.example.com` | network | URL |

Writing to `system` scope escalates risk (write → high, delete → critical).

## Config

Personal config: `~/.safemode/config.yaml`
Project config: `.safemode.yaml` (project root, overrides personal)

Project rules are stricter — they can only tighten permissions, never loosen them.

## Requirements

- Node.js >= 18
- One of: Claude Code, Cursor, Windsurf

## Cloud (optional)

Connect to [TrustScope](https://trustscope.ai) for team policy management, centralized audit logs, and a dashboard:

```bash
safemode connect -k ts_your_api_key
```

The CLI works fully offline. Cloud is optional.

## License

Apache-2.0
