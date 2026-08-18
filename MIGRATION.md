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
stack, anything matching a credential pattern, any symlinks (which dangle if
they point at paths the new machine does not have), and the largest files.

### Finding paths baked in by the old desktop

The single most common reason a migrated project will not start is an absolute
path from the machine it left. A `.vscode/settings.json` pointing at
`/Users/you/lighthouse/.venv/bin/python`, a shell script that `cd`s to a home
directory that no longer exists, a `.env` naming an old cache location.

```bash
python3 ./scripts/inspect_zip.py ~/Downloads/LighthouseExport_2026-08-17.zip --deep
```

`--deep` decompresses the small text files in memory and reports every file
holding such a path, along with which home directories appear. Paths inside
dependency directories are ignored, since those get rebuilt rather than fixed.

### What the unpack skips, and why

`node_modules`, `.venv`, `dist`, `build`, `target`, `__pycache__` and friends are
excluded by default. In a typical export these are the overwhelming majority of
the bytes, they are reproducible from the lockfiles, and committing them to git
is actively harmful — GitHub rejects any single file over 100 MB, and a repo
carrying a vendored `node_modules` is painful forever after.

The script prints the exact install command to rebuild them, derived from
whichever lockfiles the export actually contains, including ones nested in
subdirectories.

Editor configuration (`.vscode/`, `.idea/`) is **not** skipped. It is small, it
is hand-written, and losing it in a migration is more annoying than carrying it.
Whether it belongs in the repository is a separate question the generated
`.gitignore` leaves to you.

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

Use the restore script rather than unzipping over the top of `~/.claude`:

```bash
# Reports a plan and changes nothing.
./scripts/restore_claude_state.sh ~/Downloads/ClaudeState_2026-08-17.zip

# Perform it.
./scripts/restore_claude_state.sh ~/Downloads/ClaudeState_2026-08-17.zip --apply
```

The dry run is the default because a plain unzip gets three things wrong.

**It clobbers existing state.** If the new desktop has already run Claude Code,
that `~/.claude` holds settings and history of its own. The script backs the
directory up to `~/.claude.backup-<timestamp>` and merges rather than replaces,
so local files absent from the archive survive.

**Conversation history is keyed by absolute project path.** Each directory under
`~/.claude/projects/` is named for the working directory it belongs to, with the
separators flattened to dashes — this session's is `-home-user-Lighthouse`. If
the old desktop kept the project at `/Users/you/lighthouse` and the new one puts
it at `~/code/lighthouse`, the history is present but never matched. The script
lists every key it finds, marks the ones that do not resolve on this machine,
and rewrites one on request:

```bash
./scripts/restore_claude_state.sh ~/Downloads/ClaudeState_2026-08-17.zip \
    --remap /Users/you/lighthouse=$HOME/code/lighthouse --apply
```

Restoring to the same absolute path avoids the problem entirely.

**Credentials should not be copied between machines.** `.credentials.json` is
skipped unless you pass `--include-credentials`; sign in on the new machine
instead.

Do not commit this archive or its contents to the repository. Conversation
history contains whatever was discussed on the old machine.

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

---

## Tests

```bash
./tests/run_all.sh
```

104 checks across the three scripts, covering the shapes a real export can
take: no wrapper directory, several top-level directories, spaces and non-latin
filenames, symlinks, path-traversal entries, encrypted entries, corrupt and
empty archives, files over GitHub's size limit, both of Drive's confirmation
flows, and a state restore that must not clobber existing local state.

Fixtures are generated by `tests/make_fixtures.py` and are not checked in.

The approach was also measured against a synthetic export at the real archive's
scale — 32,708 entries, 178 MB — to confirm the central-directory survey is
actually cheap:

| Operation | Time |
|---|---|
| Survey (`--dry-run`) | 0.8 s |
| Survey with `--deep` | 1.0 s |
| Full unpack | 4.5 s |

The unpack dropped 31,901 rebuildable files and wrote 808.
