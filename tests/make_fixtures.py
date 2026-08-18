#!/usr/bin/env python3
"""Build zip fixtures covering the shapes a real desktop export can take.

Written with zipfile rather than the zip(1) command so that the awkward cases —
path traversal, absolute paths, symlinks, non-UTF8 names — can be constructed
exactly, since the shell tool refuses to create most of them.
"""

import os
import shutil
import sys
import zipfile

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def build(name, entries, comment=None):
    """entries: list of (arcname, data) or (arcname, data, extra_attrs)."""
    path = os.path.join(OUT, name)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in entries:
            arcname, data = entry[0], entry[1]
            attrs = entry[2] if len(entry) > 2 else {}
            info = zipfile.ZipInfo(arcname, date_time=(2026, 8, 17, 12, 0, 0))
            info.external_attr = attrs.get("mode", 0o644) << 16
            if attrs.get("symlink"):
                # High bits mark the entry as a symlink; payload is the target.
                info.external_attr = (0o120777 << 16)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)
        if comment:
            zf.comment = comment.encode()
    return path


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    # A typical export: one wrapper directory, real source, heavy dependency
    # directories, a build directory, and a live .env.
    build("typical.zip", [
        ("LighthouseExport/package.json", '{"name":"lighthouse"}\n'),
        ("LighthouseExport/package-lock.json", '{"lockfileVersion":3}\n'),
        ("LighthouseExport/.env", "DATABASE_URL=postgres://user:pw@host/db\n"),
        ("LighthouseExport/CLAUDE.md", "# Lighthouse\n"),
        ("LighthouseExport/.claude/settings.json", '{"model":"opus"}\n'),
        ("LighthouseExport/src/index.ts", "export {}\n" * 40),
        ("LighthouseExport/src/app.tsx", "// app\n" * 60),
        ("LighthouseExport/server/main.py", "print('api')\n"),
        ("LighthouseExport/server/requirements.txt", "fastapi\n"),
        ("LighthouseExport/node_modules/react/index.js", "x" * 90000),
        ("LighthouseExport/node_modules/.bin/tsc", "#!/bin/sh\n"),
        ("LighthouseExport/.venv/lib/site.py", "y" * 40000),
        ("LighthouseExport/dist/bundle.js", "z" * 25000),
        ("LighthouseExport/__pycache__/main.cpython-311.pyc", "\x00" * 500),
    ])

    # No wrapper directory: files sit at the archive root.
    build("no_wrapper.zip", [
        ("package.json", '{"name":"lighthouse"}\n'),
        ("src/index.ts", "export {}\n"),
        ("node_modules/left-pad/index.js", "q" * 5000),
    ])

    # Several top-level directories, so there is no single wrapper to collapse.
    build("multi_root.zip", [
        ("frontend/package.json", "{}\n"),
        ("frontend/src/main.ts", "// main\n"),
        ("backend/pyproject.toml", "[project]\nname='x'\n"),
        ("backend/app/__init__.py", ""),
        ("README.md", "# both halves\n"),
    ])

    # Awkward but legal names.
    build("odd_names.zip", [
        ("Lighthouse Export/my project/file with spaces.txt", "ok\n"),
        ("Lighthouse Export/unicode/café-données.md", "# accents\n"),
        ("Lighthouse Export/unicode/日本語.txt", "japanese\n"),
        ("Lighthouse Export/quotes/it's \"quoted\".js", "// tricky\n"),
        ("Lighthouse Export/dash/-leading-dash.txt", "dash\n"),
        ("Lighthouse Export/deep/" + "/".join(f"lvl{i}" for i in range(1, 16)) + "/deep.txt", "bottom\n"),
    ])

    # Path traversal and absolute paths — must never escape the destination.
    build("malicious.zip", [
        ("safe/ok.txt", "fine\n"),
        ("../../../tmp/zipslip_escaped.txt", "ESCAPED\n"),
        ("safe/../../zipslip_relative.txt", "ESCAPED\n"),
        ("/tmp/zipslip_absolute.txt", "ESCAPED\n"),
    ])

    # A symlink pointing outside the tree.
    build("symlink.zip", [
        ("proj/real.txt", "real\n"),
        ("proj/link_to_etc", "/etc/passwd", {"symlink": True}),
    ])

    # Nothing but rebuildable content — the source payload is empty.
    build("all_junk.zip", [
        ("proj/node_modules/a/index.js", "a" * 10000),
        ("proj/dist/out.js", "b" * 10000),
    ])

    # An archive with no file entries at all.
    build("empty.zip", [])

    # A single file larger than GitHub's hard limit, to check the warning.
    build("oversized.zip", [
        ("proj/src/app.ts", "// small\n"),
        ("proj/assets/model.bin", "0" * (101 * 1024 * 1024)),
    ])

    # An export carrying the exporting machine's absolute paths, plus editor
    # config that a migration needs to keep.
    build("hardcoded_paths.zip", [
        ("Proj/.env", "DB=postgres://x\nCACHE=/Users/kody/lighthouse/.cache\n"),
        ("Proj/.vscode/settings.json",
         '{"python.defaultInterpreterPath":"/Users/kody/lighthouse/.venv/bin/python"}'),
        ("Proj/.idea/workspace.xml", '<project dir="/Users/kody/lighthouse" />'),
        ("Proj/scripts/run.sh", "#!/bin/sh\ncd /Users/kody/lighthouse && node server.js\n"),
        ("Proj/notes.md", "Old backup at C:\\Users\\kody\\lighthouse\n"),
        ("Proj/src/clean.ts", "export const ok = 1\n"),
        ("Proj/package.json", '{"name":"lighthouse"}'),
        # Junk paths must not be reported: they get rebuilt, not fixed.
        ("Proj/.venv/bin/activate", "VIRTUAL_ENV=/Users/kody/lighthouse/.venv\n"),
        ("Proj/node_modules/x/cfg.json", '{"p":"/Users/kody/lighthouse"}'),
    ])

    # Not a zip at all.
    with open(os.path.join(OUT, "corrupt.zip"), "wb") as fh:
        fh.write(os.urandom(20000))

    # Password-protected entries.
    enc = os.path.join(OUT, "encrypted.zip")
    with zipfile.ZipFile(enc, "w") as zf:
        zf.writestr("proj/secret.txt", "classified\n")
    # zipfile cannot write encrypted entries, so flip the encryption bit by hand
    # to produce an archive that reads as encrypted.
    data = bytearray(open(enc, "rb").read())
    sig = b"PK\x03\x04"
    idx = data.find(sig)
    while idx != -1:
        data[idx + 6] |= 0x01  # general purpose bit flag, bit 0
        idx = data.find(sig, idx + 1)
    csig = b"PK\x01\x02"
    idx = data.find(csig)
    while idx != -1:
        data[idx + 8] |= 0x01
        idx = data.find(csig, idx + 1)
    open(enc, "wb").write(bytes(data))

    for f in sorted(os.listdir(OUT)):
        size = os.path.getsize(os.path.join(OUT, f))
        print(f"  {size:>12,} B  {f}")


if __name__ == "__main__":
    main()
    print("fixtures written to", OUT, file=sys.stderr)
