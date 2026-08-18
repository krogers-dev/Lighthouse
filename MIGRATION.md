# Lighthouse: moving the project to a new machine

The transfer consists of two archives exported from the old desktop on
2026-08-17:

| Archive | Size | What it holds |
|---|---|---|
| `LighthouseExport_2026-08-17.zip` | 355 MB | The project itself — source, config, and (almost certainly) its installed dependencies |
| `ClaudeState_2026-08-17.zip` | 195 MB | Claude Code's own state — conversation history, settings, skills, plugins |

They are restored differently. The project export becomes a git repository; the
Claude state goes into your home directory and is deliberately **not** committed.

---

## 1. Unpack the project export

From a checkout of this branch, with the zip somewhere local:

```bash
./scripts/unpack_export.sh ~/Downloads/LighthouseExport_2026-08-17.zip \
    --dest ~/code/lighthouse
```

Survey it first if you'd rather look before extracting anything:

```bash
./scripts/unpack_export.sh ~/Downloads/LighthouseExport_2026-08-17.zip --dry-run
```

`--dry-run` reads only the zip's central directory, so it reports on the whole
355 MB in a second or two without writing a byte to disk. You get the top-level
layout, how much of the archive is rebuildable dependency weight, the detected
stack, anything matching a credential pattern, and the largest files.

### What the unpack skips, and why

`node_modules`, `.venv`, `dist`, `build`, `target`, `__pycache__` and friends are
excluded by default. In a typical export these are the overwhelming majority of
the bytes, they are reproducible from the lockfiles, and committing them to git
is actively harmful — GitHub rejects any single file over 100 MB, and a repo
carrying a vendored `node_modules` is painful forever after.

The script prints the exact install command to rebuild them, derived from
whichever lockfiles the export actually contains, including ones nested in
subdirectories.

If you want the archive extracted verbatim anyway — to diff against the old
machine, or because something in there is not reproducible — use `--include-all`.

### Before committing

The survey flags files matching credential patterns (`.env`, `*.pem`, `*.key`,
`id_rsa*`, `*credentials*.json`). Read that list. An export taken off a working
desktop routinely contains live database URLs and API keys, and they are
straightforward to commit by accident.

The generated `.gitignore` already excludes them, but it only protects files that
were not already tracked. If a secret was committed on the old machine, it is in
the history you are about to push — rotate the credential rather than trying to
scrub it.

### Seeding the repository

`krogers-dev/Lighthouse` is currently empty — no commits on any branch. Once the
tree looks right:

```bash
cd ~/code/lighthouse
git init
git remote add origin https://github.com/krogers-dev/Lighthouse
git add -A
git status          # confirm no node_modules, no .env
git commit -m "Import Lighthouse project from 2026-08-17 desktop export"
git push -u origin main
```

Check `git status` before the commit, not after the push.

---

## 2. Restore Claude Code state

`ClaudeState_2026-08-17.zip` is Claude Code's application state, normally living
in `~/.claude`. Restoring it brings across conversation history, project
settings, custom skills, and installed plugins.

Look before you overwrite:

```bash
python3 ./scripts/inspect_zip.py ~/Downloads/ClaudeState_2026-08-17.zip
```

If the new desktop already has a `~/.claude`, back it up first — the restore
should be a merge you control, not a blind overwrite:

```bash
mv ~/.claude ~/.claude.backup-$(date +%Y%m%d)
unzip ~/Downloads/ClaudeState_2026-08-17.zip -d ~/claude-state-restore
# inspect ~/claude-state-restore, then move the pieces you want into ~/.claude
```

Two cautions:

- **Do not commit this archive or its contents to the repository.** Conversation
  history contains whatever was discussed on the old machine, and
  `~/.claude/settings.json` and `.credentials.json` can hold API keys.
- Absolute paths from the old desktop are baked into the project history keys
  (`~/.claude/projects/` is keyed by working directory). If the new machine puts
  Lighthouse at a different path, prior sessions will not line up with the new
  checkout. Restoring to the same absolute path avoids this entirely.

---

## Working with the export from a cloud session

Claude Code sessions on the web run in a sandboxed container with an egress
allowlist, and `drive.google.com` is not on it by default — a download attempt
fails at the proxy with `CONNECT tunnel failed, response 403`. The Drive
connector cannot bridge the gap either: it returns file bytes as base64, and a
355 MB zip is roughly 474 MB of base64, far past what fits in a context window.

To make `scripts/drive_fetch.sh` usable from a cloud session, add
`drive.google.com` and `drive.usercontent.google.com` to the environment's
network policy and start a **new** session — the policy is applied when the
container starts, so an existing session will not pick it up. See
https://code.claude.com/docs/en/claude-code-on-the-web

```bash
./scripts/drive_fetch.sh 1yEhfbUMHoyzxrTG5C250YP5jtB60s5QY LighthouseExport.zip
```

The script handles Drive's large-file confirmation interstitial, which is why a
plain `curl` of the share URL returns an HTML page instead of a zip. The file
must be shared as "Anyone with the link" for this to work at all.

Note that the container is ephemeral: anything not committed and pushed is lost
when the session ends. For a straightforward desktop-to-desktop move, unpacking
locally on the new machine is simpler and avoids pushing 355 MB through a
sandbox.
