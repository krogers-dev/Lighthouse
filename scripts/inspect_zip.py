#!/usr/bin/env python3
"""Report on a zip archive's contents by reading its central directory only.

Nothing is extracted, so a multi-hundred-megabyte export can be surveyed in a
second or two. The point is to answer "what is actually in here, and which of it
belongs in git" before spending disk on a full unpack.

With --deep, small text files are additionally decompressed in memory and
scanned for absolute paths from the machine that produced the export. Those are
the usual cause of a migrated project failing to start on the new machine.

Usage: inspect_zip.py <archive.zip> [--top N] [--deep]
"""

import argparse
import collections
import fnmatch
import posixpath
import re
import sys
import zipfile

# Directories that are rebuildable from a manifest. Carrying them into git costs
# hundreds of megabytes and buys nothing.
JUNK_DIRS = [
    "node_modules", ".venv", "venv", "env", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".tox", "dist", "build", ".next", ".nuxt",
    ".turbo", ".parcel-cache", "target", "vendor", ".gradle",
    ".DS_Store", "coverage", ".nyc_output", "bin/obj", ".cache",
]

# Patterns worth a human look before anything is committed or pushed.
SECRET_PATTERNS = [
    "*.env", ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.keystore",
    "id_rsa*", "id_ed25519*", "*credentials*.json", "*secret*", "*.jks",
    "service-account*.json", ".npmrc", ".pypirc", "*.ovpn", "terraform.tfstate*",
]

# Absolute paths naming a specific user's home directory. A project export that
# hard-codes these will not start on a machine where the path does not exist.
HOME_PATH_RE = re.compile(
    rb"(?:/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)"
)

# Only these are worth decompressing for the --deep scan; binaries would be
# noise and large files would defeat the point of a fast survey.
SCANNABLE_EXTS = {
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".txt", ".md", ".sh", ".bash", ".zsh", ".fish", ".py", ".js", ".ts",
    ".tsx", ".jsx", ".rb", ".go", ".rs", ".java", ".xml", ".properties",
    ".code-workspace", ".sublime-project", ".plist", ".service", ".pth",
}
SCANNABLE_NAMES = {
    ".env", ".envrc", ".npmrc", ".pypirc", ".bashrc", ".zshrc", ".profile",
    ".gitconfig", ".gitmodules", "Makefile", "Dockerfile", "Procfile",
}
SCAN_MAX_BYTES = 512 * 1024

# Files that identify a project's stack and entry points.
STACK_MARKERS = {
    "package.json": "Node / npm",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "Yarn",
    "package-lock.json": "npm lockfile",
    "requirements.txt": "Python (pip)",
    "pyproject.toml": "Python (PEP 621)",
    "Pipfile": "Python (pipenv)",
    "poetry.lock": "Poetry",
    "Cargo.toml": "Rust",
    "go.mod": "Go",
    "pom.xml": "Java (Maven)",
    "build.gradle": "Java (Gradle)",
    "Gemfile": "Ruby",
    "composer.json": "PHP",
    "Dockerfile": "Docker",
    "docker-compose.yml": "Docker Compose",
    "CLAUDE.md": "Claude Code project instructions",
    ".claude": "Claude Code config directory",
    "tsconfig.json": "TypeScript",
    "next.config.js": "Next.js",
    "vite.config.ts": "Vite",
    "Makefile": "Make",
}


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:,.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:,.1f} TB"


def is_junk(path):
    parts = path.split("/")
    for jd in JUNK_DIRS:
        if "/" in jd:
            if jd in path:
                return jd
        elif jd in parts:
            return jd
    return None


def is_symlink(info):
    """Unix mode lives in the high 16 bits of external_attr; 0o12 marks a link."""
    if info.create_system != 3:  # not produced on Unix, so no mode to read
        return False
    return (info.external_attr >> 16) & 0o170000 == 0o120000


def is_secret(path):
    name = path.split("/")[-1]
    for pat in SECRET_PATTERNS:
        if fnmatch.fnmatch(name.lower(), pat.lower()):
            return pat
    return None


def strip_root(names):
    """Drop a single shared top-level directory so the report shows real layout."""
    roots = {n.split("/")[0] for n in names if n}
    if len(roots) == 1:
        root = roots.pop()
        if any(n.startswith(root + "/") for n in names):
            return root
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--top", type=int, default=20, help="rows per ranked table")
    ap.add_argument("--deep", action="store_true",
                    help="also scan text files for paths from the source machine")
    args = ap.parse_args()

    try:
        zf = zipfile.ZipFile(args.archive)
    except zipfile.BadZipFile as exc:
        sys.exit(f"Not a readable zip archive: {exc}")

    infos = [i for i in zf.infolist() if not i.is_dir()]
    if not infos:
        sys.exit("Archive contains no files.")

    total_raw = sum(i.file_size for i in infos)
    total_zip = sum(i.compress_size for i in infos)
    names = [i.filename for i in infos]
    root = strip_root(names)

    print("=" * 72)
    print(f"ARCHIVE  {args.archive}")
    print("=" * 72)
    print(f"  files             {len(infos):,}")
    print(f"  compressed        {human(total_zip)}")
    print(f"  uncompressed      {human(total_raw)}")
    print(f"  expansion         {total_raw / max(total_zip, 1):.1f}x")
    if root:
        print(f"  single root dir   {root}/")
    encrypted = [i for i in infos if i.flag_bits & 0x1]
    if encrypted:
        print(f"  !! encrypted      {len(encrypted):,} entries need a password")

    def rel(path):
        return path[len(root) + 1:] if root and path.startswith(root + "/") else path

    # --- top-level layout -------------------------------------------------
    tops = collections.defaultdict(lambda: [0, 0])
    for i in infos:
        r = rel(i.filename)
        key = r.split("/")[0] if "/" in r else "(files at root)"
        tops[key][0] += 1
        tops[key][1] += i.file_size

    print("\n" + "-" * 72)
    print("TOP-LEVEL LAYOUT")
    print("-" * 72)
    for name, (count, size) in sorted(tops.items(), key=lambda kv: -kv[1][1]):
        flag = " [rebuildable]" if is_junk(name + "/x") else ""
        print(f"  {human(size):>12}  {count:>7,} files  {name}{flag}")

    # --- rebuildable weight ----------------------------------------------
    junk = collections.defaultdict(lambda: [0, 0])
    for i in infos:
        j = is_junk(i.filename)
        if j:
            junk[j][0] += 1
            junk[j][1] += i.file_size

    if junk:
        jf = sum(v[0] for v in junk.values())
        js = sum(v[1] for v in junk.values())
        print("\n" + "-" * 72)
        print("REBUILDABLE CONTENT (exclude from git; restore via install)")
        print("-" * 72)
        for name, (count, size) in sorted(junk.items(), key=lambda kv: -kv[1][1]):
            print(f"  {human(size):>12}  {count:>7,} files  {name}")
        print(f"  {'-' * 12}")
        print(f"  {human(js):>12}  {jf:>7,} files  TOTAL "
              f"({js / max(total_raw, 1) * 100:.0f}% of archive)")
        print(f"\n  Source-only payload: {human(total_raw - js)} "
              f"in {len(infos) - jf:,} files")

    # --- stack detection --------------------------------------------------
    found = {}
    for i in infos:
        r = rel(i.filename)
        parts = r.split("/")
        if is_junk(i.filename):
            continue
        for marker, label in STACK_MARKERS.items():
            if parts[-1] == marker or marker in parts:
                found.setdefault(label, r)

    if found:
        print("\n" + "-" * 72)
        print("DETECTED STACK")
        print("-" * 72)
        for label, where in sorted(found.items()):
            print(f"  {label:<32} {where}")

    # --- secrets ----------------------------------------------------------
    secrets = [(rel(i.filename), is_secret(i.filename), i.file_size)
               for i in infos if is_secret(i.filename) and not is_junk(i.filename)]
    if secrets:
        print("\n" + "-" * 72)
        print(f"REVIEW BEFORE COMMITTING ({len(secrets)} matches)")
        print("-" * 72)
        for path, pat, size in sorted(secrets)[:args.top]:
            print(f"  {human(size):>10}  {path}   <- matched {pat}")
        if len(secrets) > args.top:
            print(f"  ... and {len(secrets) - args.top} more")

    # --- symlinks ---------------------------------------------------------
    links = [i for i in infos if is_symlink(i)]
    if links:
        print("\n" + "-" * 72)
        print(f"SYMLINKS ({len(links)})")
        print("-" * 72)
        print("  Links to absolute paths will dangle if the new machine differs.")
        for i in sorted(links, key=lambda x: x.filename)[:args.top]:
            try:
                target = zf.read(i).decode("utf-8", "replace")
            except Exception:
                target = "<unreadable>"
            mark = "  <- absolute" if target.startswith("/") else ""
            print(f"  {rel(i.filename)} -> {target}{mark}")
        if len(links) > args.top:
            print(f"  ... and {len(links) - args.top} more")

    # --- hard-coded paths from the exporting machine ----------------------
    if args.deep:
        print("\n" + "-" * 72)
        print("HARD-CODED PATHS FROM THE SOURCE MACHINE")
        print("-" * 72)
        hits = collections.defaultdict(collections.Counter)
        scanned = skipped = 0
        for i in infos:
            if is_junk(i.filename) or is_symlink(i):
                continue
            name = posixpath.basename(i.filename)
            ext = "." + name.rsplit(".", 1)[1].lower() if "." in name[1:] else ""
            if (ext not in SCANNABLE_EXTS
                    and name not in SCANNABLE_NAMES
                    and name not in STACK_MARKERS):
                continue
            if i.file_size > SCAN_MAX_BYTES:
                skipped += 1
                continue
            try:
                blob = zf.read(i)
            except (RuntimeError, zipfile.BadZipFile):
                skipped += 1  # encrypted or damaged entry
                continue
            scanned += 1
            for m in HOME_PATH_RE.findall(blob):
                hits[rel(i.filename)][m.decode("utf-8", "replace")] += 1

        if hits:
            homes = collections.Counter()
            for counts in hits.values():
                homes.update(counts)
            print(f"  Found in {len(hits)} of {scanned:,} scanned text files.")
            print("  Home directories referenced:")
            for home, n in homes.most_common(5):
                print(f"    {n:>5} x  {home}")
            print("\n  Files needing a path fix on the new machine:")
            for path, counts in sorted(hits.items(), key=lambda kv: -sum(kv[1].values()))[:args.top]:
                print(f"    {sum(counts.values()):>4} refs  {path}")
            if len(hits) > args.top:
                print(f"    ... and {len(hits) - args.top} more files")
        else:
            print(f"  None found ({scanned:,} text files scanned).")
        if skipped:
            print(f"  ({skipped:,} files skipped: too large, encrypted, or unreadable)")

    # --- largest files ----------------------------------------------------
    print("\n" + "-" * 72)
    print(f"LARGEST FILES (top {args.top}, excluding rebuildable dirs)")
    print("-" * 72)
    real = [i for i in infos if not is_junk(i.filename)]
    for i in sorted(real, key=lambda x: -x.file_size)[:args.top]:
        over = "  << over GitHub's 100MB limit" if i.file_size > 100 * 1024**2 else (
            "  << over 50MB, GitHub warns" if i.file_size > 50 * 1024**2 else "")
        print(f"  {human(i.file_size):>10}  {rel(i.filename)}{over}")

    # --- extension histogram ---------------------------------------------
    exts = collections.defaultdict(lambda: [0, 0])
    for i in real:
        name = i.filename.split("/")[-1]
        ext = "." + name.rsplit(".", 1)[1].lower() if "." in name[1:] else "(no ext)"
        exts[ext][0] += 1
        exts[ext][1] += i.file_size

    print("\n" + "-" * 72)
    print(f"FILE TYPES (top {args.top}, excluding rebuildable dirs)")
    print("-" * 72)
    for ext, (count, size) in sorted(exts.items(), key=lambda kv: -kv[1][0])[:args.top]:
        print(f"  {count:>7,} files  {human(size):>12}  {ext}")

    print()


if __name__ == "__main__":
    main()
