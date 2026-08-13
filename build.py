#!/usr/bin/env python3
"""
Build the offline Linux Command Reference site.

Reads the markdown corpus from SimonSchubert/LinuxCommandLibrary (assets/) and
emits JS data files under site/data/. Data is written as plain .js files that
assign onto globals rather than .json fetched at runtime, so the whole site
works from a file:// URL with no server and no network.

Usage:
    python3 build.py --source /path/to/LinuxCommandLibrary/assets
"""

import argparse
import json
import os
import re
import shutil
import sys
import zlib

SECTION_RE = re.compile(r"^# (.+?)\s*$", re.MULTILINE)
COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

# Number of buckets the command corpus is split across. Each bucket is fetched
# lazily by injecting a <script> tag, so this trades request count for size.
BUCKETS = 128


def bucket_of(name):
    """Stable bucket id for a command name (must match the JS implementation)."""
    return zlib.crc32(name.encode("utf-8")) % BUCKETS


def parse_sections(text):
    """Split a command markdown file into an ordered list of [title, body]."""
    text = COMMENT_RE.sub("", text)
    matches = list(SECTION_RE.finditer(text))
    sections = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            sections.append([m.group(1).strip(), body])
    return sections


def see_also_names(body):
    """Extract linked command names from a SEE ALSO body."""
    return [m.group(1) for m in re.finditer(r"\[([^\]]+)\]\(/man/([^)]+)\)", body)]


def tldr_first_snippet(body):
    """First code snippet of a TLDR block, used as a search-result preview."""
    m = re.search(r"```(.+?)```", body, re.DOTALL)
    return m.group(1).strip() if m else ""


def load_commands(commands_dir):
    commands = {}
    for filename in sorted(os.listdir(commands_dir)):
        if not filename.endswith(".md"):
            continue
        name = filename[:-3]
        with open(os.path.join(commands_dir, filename), encoding="utf-8") as fh:
            sections = parse_sections(fh.read())
        if not sections:
            continue
        by_title = {title.upper(): body for title, body in sections}
        commands[name] = {
            "n": name,
            "t": by_title.get("TAGLINE", "").replace("\n", " ").strip(),
            "s": sections,
            "e": see_also_names(by_title.get("SEE ALSO", "")),
            "x": tldr_first_snippet(by_title.get("TLDR", "")),
        }
    return commands


def load_basics(basics_dir):
    """Load the topic guides. Each file starts with a '# Title' line."""
    index_path = os.path.join(basics_dir, "index.txt")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as fh:
            order = [line.strip() for line in fh if line.strip()]
    else:
        order = sorted(f for f in os.listdir(basics_dir) if f.endswith(".md"))

    guides = []
    for filename in order:
        path = os.path.join(basics_dir, filename)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            text = COMMENT_RE.sub("", fh.read()).strip()
        title_match = re.match(r"^#\s+(.+)", text)
        title = title_match.group(1).strip() if title_match else filename[:-3]
        body = text[title_match.end():].strip() if title_match else text
        guides.append({
            "id": filename[:-3],
            "title": title,
            "body": body,
            "topics": re.findall(r"^##\s+(.+)$", body, re.MULTILINE),
        })
    return guides


def load_tips(tips_path):
    with open(tips_path, encoding="utf-8") as fh:
        text = COMMENT_RE.sub("", fh.read()).strip()
    text = re.sub(r"^#\s+.+\n", "", text, count=1)
    chunks = re.split(r"^##\s+", text, flags=re.MULTILINE)
    tips = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        title, _, body = chunk.partition("\n")
        tips.append({"title": title.strip(), "body": body.strip()})
    return tips


def write_js(path, varname, payload, call=None):
    """Emit a .js file. With `call`, payload is a list of call arguments."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    dump = lambda obj: json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as fh:
        if call:
            fh.write("%s(%s);\n" % (call, ",".join(dump(arg) for arg in payload)))
        else:
            fh.write("window.%s=%s;\n" % (varname, dump(payload)))
    return os.path.getsize(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        default="/workspace/simonschubert/linuxcommandlibrary/assets",
        help="path to the LinuxCommandLibrary assets directory",
    )
    parser.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "site"),
        help="output site directory",
    )
    args = parser.parse_args()

    commands_dir = os.path.join(args.source, "commands")
    if not os.path.isdir(commands_dir):
        sys.exit("error: %s is not a LinuxCommandLibrary assets directory" % args.source)

    print("reading %s" % args.source)
    commands = load_commands(commands_dir)
    basics = load_basics(os.path.join(args.source, "basics"))
    tips = load_tips(os.path.join(args.source, "tips.md"))
    print("  %d commands, %d guides, %d tips" % (len(commands), len(basics), len(tips)))

    data_dir = os.path.join(args.out, "data")
    if os.path.isdir(data_dir):
        shutil.rmtree(data_dir)

    # Search index: name, tagline, example snippet. Loaded up front.
    index = [[c["n"], c["t"], c["x"]] for c in commands.values()]
    index.sort(key=lambda row: row[0].lower())
    index_size = write_js(os.path.join(data_dir, "index.js"), "LCL_INDEX", index)

    # Command bodies, split into lazily loaded buckets.
    buckets = {i: {} for i in range(BUCKETS)}
    for name, command in commands.items():
        buckets[bucket_of(name)][name] = command

    total = 0
    for i, payload in buckets.items():
        path = os.path.join(data_dir, "cmd", "%03d.js" % i)
        total += write_js(path, None, [i, payload], call="window.LCL_BUCKET")

    basics_size = write_js(os.path.join(data_dir, "basics.js"), "LCL_BASICS", basics)
    tips_size = write_js(os.path.join(data_dir, "tips.js"), "LCL_TIPS", tips)
    write_js(
        os.path.join(data_dir, "meta.js"),
        "LCL_META",
        {
            "commands": len(commands),
            "guides": len(basics),
            "tips": len(tips),
            "buckets": BUCKETS,
        },
    )

    print("wrote %s" % data_dir)
    print("  index.js    %6.1f KB" % (index_size / 1024))
    print("  basics.js   %6.1f KB" % (basics_size / 1024))
    print("  tips.js     %6.1f KB" % (tips_size / 1024))
    print("  cmd/*.js    %6.1f MB across %d buckets (avg %.0f KB)"
          % (total / 1048576, BUCKETS, total / BUCKETS / 1024))


if __name__ == "__main__":
    main()
