# Changelog

## 2.2.0 (2026-03-06)

Preset simplification. Replaced `personal` and `trading` presets with a single `autonomous` preset designed for 24/7 unattended agents.

### Breaking Changes

- **Removed `personal` and `trading` presets.** Replace with `autonomous` or `coding`.
  - If you used `personal`: switch to `coding` with custom rules for secrets protection, or use `autonomous` for unattended agents.
  - If you used `trading`: switch to `autonomous` (blocks network + push) or `strict` (blocks everything).

### New Features

- **`autonomous` preset** for 24/7 unattended agents. Key design: `approve_fallback: 'block'` means any action that would normally prompt a human is auto-blocked. Reads, project writes, builds, and local git (add/commit) all work. Network requests, git push, package installs, file deletes, and container operations are blocked.

  Network caveat: blocks explicit network tool calls (`curl`, `wget`) but does NOT block network access from build scripts (e.g. `npm run build` may fetch packages internally). This is tool-level governance, not OS-level network isolation.

### Testing

- 715 total tests (441 calibration + 274 others), all passing
- New: 23 autonomous preset verification tests (12 allow, 8 block, 3 approve-fallback)

## 2.1.1 (2026-03-06)

Preset accuracy release. Six routing fixes ensure presets work as documented.

### Bug Fixes

- **yolo preset blocked too much.** `overrides: {}` meant all default-block knobs (destructive_commands, sudo, permissions_change, secrets, PII, etc.) stayed blocked. Now yolo explicitly overrides all overridable default-block knobs to `allow`. Only hardcoded invariants (Command Firewall, pipe_to_shell) remain.
- **`git push` routing was broken.** `git push` was classified as `git/write` which routed to `git_commit` knob. The `git_push` knob was unreachable — strict's `git_push: block` had no effect. Fixed: CET now classifies `git push` as `git/transfer`, gate maps `git/transfer` → `git_push`.
- **`chmod`/`chown` routing was broken.** Classified as `filesystem/write` which routed to `file_write` (allow). The `permissions_change` knob (default: block) was unreachable. Fixed: CET now classifies chmod/chown as `filesystem/execute`, gate maps `filesystem/execute` → `permissions_change`.
- **`sudo` knob was unreachable.** `sudo` and `eval` (terminal/execute/critical) routed to `command_exec` (allow). The `sudo` knob (default: block) was never triggered. Fixed: gate now routes critical terminal execution to `sudo` knob. `sudo` and `eval` are blocked on coding/personal/trading/strict.
- **`git_force_push` knob was unreachable.** `git push --force` was classified as `git/delete` which routed to `git_branch_delete`, not `git_force_push`. The coding preset's `git_force_push: approve` had no effect. Fixed: CET classifies force push as `git/execute`, gate maps `git/execute` → `git_force_push`.
- **`package_installs` knob was a dead reference.** Coding and personal presets overrode `package_installs` (terminal category) but `npm install` routes to the `install` knob (package category). Personal's `package_installs: block` did not block `npm install`. Fixed: presets now override the correct `install` knob. Personal now correctly blocks package installs.

### Documentation

- **Comprehensive preset reference table** in USER_GUIDE.md verified against actual code behavior for all 5 presets across 25+ common actions.

### Testing

- 692 total tests (418 calibration + 274 others), all passing
- New tests: sudo/eval routing, git_force_push routing, package install on personal, yolo preset verification

## 2.1.0 (2026-03-05)

Major calibration release. 398 calibration tests verify every path through the governance pipeline. Multiple security fixes, classification improvements, and gap closures.

### Security Fixes

- **Scope detection for Write/Edit tools was broken.** The `scope_from` registry paths used `parameters.file_path` (nested) but Claude Code and Cursor pass flat params (`file_path`). Writing to `/etc/passwd` was classified as `project/low` instead of `system/high`. Fixed for all Claude Code tools (Read, Write, Edit) and Cursor tools (read_file, edit_file, delete_file).
- **Engines 11-12 (Prompt Injection, Jailbreak) skipped at medium risk.** Commands like `npm run build`, `curl`, `pip install` ran only engines 1-10 + 13-15, missing injection/jailbreak detection. Now all 15 engines run at medium risk and above.
- **Command firewall evasion patterns.** Added 6 new hardcoded block patterns: base64 decode piped to shell, ANSI-C hex escapes (`$'\x72\x6d'`), xxd/printf decode to shell, python `os.system()`/`subprocess` one-liners, perl `system()`/`exec()` one-liners.

### CET Classification Improvements

- **40+ new command patterns** covering:
  - Dangerous execution: `eval` (critical), `exec` (high), `source`/`.` (high)
  - `nohup` prefix handling (classifies inner command)
  - `find` with `-delete`/`-exec`/`-execdir` (high), safe `find` (low)
  - Remote access: `ssh` (high), `scp`/`rsync` (medium)
  - Scheduling: `crontab -e` (medium), `crontab -l` (low), `crontab -r` (high), `at` (medium)
  - Language package managers: `cargo add/install`, `go get/install`, `gem install`, `composer require`, `dotnet add package`
  - System package managers: `apt`, `brew`, `dnf`, `yum`, `pacman`, `apk` with subcommand differentiation
  - `npm ci` recognized as package install
- **Infrastructure tool differentiation** (previously all `terminal/execute/medium`):
  - Docker/Podman: `run`/`exec` (high), `build`/`compose` (medium), `ps`/`images` (low), `rm`/`rmi` (high), `push` (medium)
  - kubectl: `delete` (high), `apply`/`create` (medium), `exec` (high), `get`/`describe` (low)
  - Terraform/OpenTofu: `destroy` (critical), `apply` (high), `plan`/`init` (low)
- **Output redirection detection.** `echo "data" > file.txt` now classified as `filesystem/write/medium` instead of `terminal/read/low`.
- **Scope detection fixes:**
  - `/tmp` paths classified as `system` scope (was `user_home`)
  - `~` paths correctly classified as `user_home` (was falling through to `project`)
  - Project directory checked before system paths (prevents `/tmp/my-project/file.txt` from being classified as `system` when `projectDir=/tmp/my-project`)

### Knob Gate Fixes

- **5 knob name mismatches fixed** between `gate.ts` and `categories.ts`:
  - `package_install` → `install`, `package_uninstall` → `uninstall`
  - `data_export` → `export`, `data_import` → `import`
  - `iot_read` → `sensor_read`
- **Added `git_read` knob** (was referenced in gate but never defined — all git reads fell through to fragile fallback logic)
- **Added `data_protection` category** mapping (read/write → `block_secrets`, delete → `block_credentials`)
- **Added `network/execute` mapping** (for `ssh` commands, routes to `http_request` knob)
- **14 new knob definitions:** `payment_read`, `message_read`, `cloud_read`, `container_read`, `container_exec`, `package_read`, `schedule_read`, `cron_delete`, `credential_delete`, `deployment_read`, `log_write`, `data_read`, `data_delete`, `browser_read`

### Command Firewall

- **10 new hardcoded block patterns:**
  - `rm -rf /usr`, `/var`, `/etc`, `/bin`, `/sbin`, `/lib`, `/boot`, `/sys`, `/proc`, `/dev`
  - `nc -le` (combined netcat flags)
  - `find / -delete`, `find / -exec rm`
  - `rm --recursive --force /` (long-form flags)
  - `eval` with dangerous content (`eval "rm -rf /"`, `eval "curl | bash"`)
  - Base64/hex decode piped to shell
  - Python/Perl system command one-liners

### Testing

- **Calibration test suite:** 398 tests across 8 sections verifying every path through CET → KnobGate → Engine pipeline
  - Section 1: CET classification (200+ commands)
  - Section 2: Knob gate routing (all 19 categories)
  - Section 3: Full pipeline E2E (MUST ALLOW / MUST PROMPT / MUST BLOCK)
  - Section 4: All knob coverage (every knob reachable)
  - Section 5: Command firewall patterns (40+ blocked, 20+ safe)
  - Section 6: Scope detection (6 path types)
  - Section 7: Engine routing verification
  - Section 8: git_read + ssh knob routing
- **672 total tests** across 14 test files, all passing

### Previous Fixes (2.0.14–2.0.20)

- 2.0.14: Fixed all Bash commands classified as critical (blanket registry entry)
- 2.0.15: Fixed `rm` routing — `rm -rf` → `destructive_commands` (block), `rm file.txt` → `file_delete` (approve)
- 2.0.16: Made `destructive_commands` knob reachable via `terminal/delete` action
- 2.0.17: Approve passthrough — `approve` knobs fall through to Claude Code's native permission prompt
- 2.0.18: Fixed Engine 7 (Error Rate) feedback loop — engine's own blocks counted as errors
- 2.0.19: Command Firewall checks all tool calls, not just terminal category
- 2.0.20: Various stability fixes

## 2.0.0 (2026-02-15)

Initial public release. 15 detection engines, 19 knob categories, CET classifier, hook-based interception for Claude Code/Cursor/Windsurf.
