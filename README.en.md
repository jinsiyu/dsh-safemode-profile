# dsh-safemode-profile

**One job: keep `dsh --profile safemode` clean — force-restore on startup,
continuously guard at runtime, so the profile only ever contains the
whitelisted core bundles.**

```
dsh --profile safemode        # boot with zero third-party plugins (suggest: dsh --profile safemode --port 3081)
```

## What it does (two phases)

### 1. On startup: force-restore (regardless of whether the profile exists or was modified)

Every time DSH boots and loads this plugin row, it unconditionally rewrites
`$DSH_HOME/profiles/safemode/` back to the whitelist template:

| File | Forced content |
|---|---|
| `package.json` | `dsh.profile.bundles` = whitelist (default `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`), `dependencies` emptied |
| `cordis.patch.yml` | empty user patch layer (`[]` template) |
| `pnpm-workspace.yaml` | same pnpm settings as an official profile |

If the files already match the template, nothing is written (avoids a
self-triggering watch loop); anything that drifted is rewritten.

### 2. At runtime: continuous guard (drift checking)

While the plugin row is alive, two channels watch the profile for modification:

- **fs.watch realtime**: any change to `package.json` / `cordis.patch.yml` /
  `pnpm-workspace.yaml` → debounced 300ms → immediate restore;
- **30s polling fallback**: full `detectDrift()` comparison (covers
  unreliable watch mounts and files replaced wholesale externally).

On drift (bundle added/removed, patch layer written to, `dependencies` added)
the guard restores the profile and logs a warning:
`safemode profile was modified (...); restored to whitelist template`.

## Activation (no build scripts — installs cleanly in one shot)

**This package has no postinstall / no build scripts of any kind** — pnpm
never blocks it, `dsh plugin add` succeeds with exit code 0 and reconcile runs
normally. No `approve-builds` / `allowBuilds` configuration needed.

All work is done by the **plugin row** (`lib/index.js` → `lib/guard.js`):
every DSH start force-restores once, then the guard stays resident.

Optional manual tool: `node scripts/ensure-safemode.mjs` force-restores
immediately (handy without a DSH restart, or for troubleshooting).

## Install

Prerequisites: DSH (`@deepseek-ai/dsh`) and Node.js (>=18) installed.

**Method A (recommended, one command from npm)** — the package is published on
npm with a `dsh.bundle` manifest; install directly with the official plugin
command:

```powershell
dsh plugin --profile web add dsh-safemode-profile
```

**Method B (from GitHub)** — install straight from the source repository
(commit-ish pinned to the default branch `main`, works with both npm and pnpm):

```powershell
dsh plugin --profile web add github:jinsiyu/dsh-safemode-profile#main
```

**Method C (local tarball / unpublished)** — pack and install a local build:

```powershell
# pack inside the plugin directory
npm pack                          # → dsh-safemode-profile-0.3.5.tgz

# install into a target profile (e.g. web)
dsh plugin --profile web add .\dsh-safemode-profile-0.3.5.tgz
```

Restart DSH; once the plugin row is active, safemode enters
"force-restore + resident guard" mode. On startup the plugin prints a short
usage banner (guard status, start command, whitelist, repo link).

## Custom whitelist

The whitelist is the **only** customization entry point — set it via the
environment variable (do **not** hand-edit the safemode profile files; any
edit is restored by the guard):

```powershell
# pure CLI only (no GUI)
$env:DSH_SAFEMODE_BUNDLES = "@deepseek-ai/dsh-base"
```

The variable is read from `process.env` by both the guard and the restore
logic, and takes effect the next time `dsh` starts with it set.

## Hardening: make the three managed files read-only

**Recommended**: set the three managed files under
`~/.dsh/profiles/safemode/` read-only to block
`dsh plugin --profile safemode add <pkg>` at the filesystem level — pnpm
fails when it cannot write them, so the plugin never gets in (DSH startup
is unaffected: it only reads them and writes `cordis.yml`):

- `package.json` (dependencies + bundles — the choke point of any install)
- `cordis.patch.yml` (the user patch layer)
- `pnpm-workspace.yaml` (pnpm-managed file)

> ⚠️ **Never lock the whole directory**: DSH rewrites `cordis.yml` on every
> boot (`prepareProfile` unconditionally writeFileSync), so a read-only
> directory or read-only `cordis.yml` makes safemode fail to start (verified:
> exit 1). Windows `attrib +R <dir> /S` recursively locks every file
> including `cordis.yml` — **do not use it**.

```powershell
# Windows: lock only the three files (no /S recursion)
attrib +R "$env:USERPROFILE\.dsh\profiles\safemode\package.json" `
         "$env:USERPROFILE\.dsh\profiles\safemode\cordis.patch.yml" `
         "$env:USERPROFILE\.dsh\profiles\safemode\pnpm-workspace.yaml"

# POSIX: the three files to 444 (the directory still needs r-x and must stay writable)
chmod 444 ~/.dsh/profiles/safemode/package.json \
          ~/.dsh/profiles/safemode/cordis.patch.yml \
          ~/.dsh/profiles/safemode/pnpm-workspace.yaml
```

To unlock:

```powershell
attrib -R "$env:USERPROFILE\.dsh\profiles\safemode\package.json" `
         "$env:USERPROFILE\.dsh\profiles\safemode\cordis.patch.yml" `
         "$env:USERPROFILE\.dsh\profiles\safemode\pnpm-workspace.yaml"  # Windows
chmod 644 ~/.dsh/profiles/safemode/package.json \
          ~/.dsh/profiles/safemode/cordis.patch.yml \
          ~/.dsh/profiles/safemode/pnpm-workspace.yaml                 # POSIX
```

Notes:
- **Let the plugin create/restore the profile first, then lock** — the
  content must match the whitelist template before locking (the guard only
  writes when it detects drift; template-matching content is left untouched,
  so locking coexists with the guard). If drift is found while locked, the
  guard's restore fails with a warning — that is the expected behavior of a
  lock: locked means no drift should exist.
- Unlock before changing the whitelist. The guard itself is unaffected — it
  reads `package.json` to detect drift and only writes when a drift is found.

### Deeper protection: ACL (Windows) and chattr +i (Linux)

The `attrib +R` / `chmod 444` above is "**basic read-only**": the two
platforms treat it differently, and neither can stop **deletion** (deleting
a file depends on the parent directory's permissions; root ignores all
permission bits anyway). The following are "**hard locks**", pick as needed:

#### Windows: ACL deny (icacls) — precise control over write vs delete

```powershell
# Deny the current user write access to the three files (W = write data)
icacls "$env:USERPROFILE\.dsh\profiles\safemode\package.json" /deny "$env:USERNAME:(W)"
icacls "$env:USERPROFILE\.dsh\profiles\safemode\cordis.patch.yml" /deny "$env:USERNAME:(W)"
icacls "$env:USERPROFILE\.dsh\profiles\safemode\pnpm-workspace.yaml" /deny "$env:USERNAME:(W)"

# Stronger: also deny deletion (DE = delete; WD = write data / create file)
icacls "...\package.json" /deny "$env:USERNAME:(WD,DE)"
```

To unlock (remove that user's deny entries):

```powershell
icacls "...\package.json" /remove:d "$env:USERNAME"
```

Key points:
- `(W)` blocks content modification, `(DE)` blocks deletion, `(WD)` blocks
  write + create — more precise than attrib: you can block writes while
  leaving admins able to delete;
- **Still does not stop administrators**: Administrators / SYSTEM have Full
  Control (F) by default and can take ownership or clear the deny. To block
  them too, deny `BUILTIN\Administrators` as well — but admins can still
  bypass via "take ownership";
- icacls requires permission to modify the file's ACL (the file owner has it
  by default).

#### Linux: immutable attribute (chattr +i) — root cannot touch it either

```bash
# Lock: file cannot be modified, deleted, or renamed (root included)
sudo chattr +i ~/.dsh/profiles/safemode/package.json \
              ~/.dsh/profiles/safemode/cordis.patch.yml \
              ~/.dsh/profiles/safemode/pnpm-workspace.yaml

# Inspect
lsattr ~/.dsh/profiles/safemode/package.json     # output containing "i" = locked

# Unlock
sudo chattr -i ~/.dsh/profiles/safemode/package.json \
              ~/.dsh/profiles/safemode/cordis.patch.yml \
              ~/.dsh/profiles/safemode/pnpm-workspace.yaml
```

Key points:
- `+i` (immutable) is the strongest lock: **nobody (root included) can
  modify, delete, or rename** — you must `-i` first for any operation,
  harder than chmod or ACL;
- Requires `sudo` (root), and the filesystem must support the attribute
  (ext4/xfs do; some network/container filesystems do not);
- **Side effect for safemode**: the guard normally rebuilds a deleted file
  (detectDrift finds "missing" → force-restore), but `+i` blocks even that;
  upgrading the plugin or changing the whitelist also needs `-i` first. Use
  it only when "no account on this machine (root included) may touch the
  safemode config" is a real requirement; basic read-only
  (attrib / chmod 444) is enough for everyday use.

#### Three levels compared

| Option | Blocks content edit | Blocks delete | Blocks root | Requires | Impact on guard self-heal |
|---|---|---|---|---|---|
| `attrib +R` / `chmod 444` (basic) | ✅ for normal users | ❌ | ❌ | none | none (guard skips writes when clean) |
| icacls deny (ACL) | ✅ | ✅ (with DE) | ❌ (admins can bypass) | file owner | none |
| `chattr +i` (immutable) | ✅ | ✅ | ✅ | sudo | ⚠️ blocks guard rebuild; `-i` first |

Suggestion: **basic read-only is enough for everyday use** (pnpm runs as a
normal user, 444 already blocks installs completely); add ACL `(DE)` if you
want to guard against accidental deletion; only choose `chattr +i` when
"no account (root included) may touch the safemode config" is a hard
requirement.

## Notes

- **Port**: safemode also carries the webServer, default 3080. Running it
  alongside the web profile conflicts (`EADDRINUSE` fails the boot) — use
  `--port` to separate them: `dsh --profile safemode --port 3081`.
- **Sessions/credentials are NOT isolated**: sessions, `settings.yaml` and
  `.env` are home-level shared; safemode only isolates plugins.
- **Home patch leaks in**: `~/.dsh/cordis.patch.yml` applies to every profile
  — don't mount plugins there (the guard only watches the safemode directory
  itself, not the home patch).
- **Don't hand-edit `cordis.yml`**: DSH rewrites it on every boot; edit
  `cordis.patch.yml` instead — but safemode's patch layer is restored to empty
  by this plugin, so customize through the whitelist env var.