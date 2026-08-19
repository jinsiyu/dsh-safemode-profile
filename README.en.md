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
# keep the undo tool (must be installed into the safemode profile first;
# note: any bundle outside the whitelist added by hand gets restored away)
$env:DSH_SAFEMODE_BUNDLES = "@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,dsh-undo-savepoint"
```

The variable is read from `process.env` by both the guard and the restore
logic, and takes effect the next time `dsh` starts with it set.

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