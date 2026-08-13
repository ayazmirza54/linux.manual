# linux.manual

An offline, terminal-styled reference for **8,921 Linux commands**, 30 topic guides
and 16 shell tips — built from the
[Linux Command Library](https://github.com/SimonSchubert/LinuxCommandLibrary) corpus
by Simon Schubert.

No build tooling, no framework, no runtime dependencies, and no network access once
the files are on disk. It runs from a static host, a local folder, or a USB stick.

## Run it

```sh
# straight from disk — no server needed
xdg-open site/index.html

# or over http, if you prefer
python3 serve.py            # http://localhost:8000
```

## Rebuild the data

The `site/data/` directory is generated. To regenerate it from the upstream corpus:

```sh
git clone --depth 1 https://github.com/SimonSchubert/LinuxCommandLibrary /tmp/lcl
python3 build.py --source /tmp/lcl/assets
```

## What's in it

| Route | What it shows |
| --- | --- |
| `#/` | Boot screen, popular commands, guide index |
| `#/man/<name>` | A command page: examples, synopsis, parameters, description, history, install, see-also |
| `#/all/<letter>` | Every command, alphabetically |
| `#/guides` · `#/guide/<id>` | The 30 topic walkthroughs (git, ssh, vim, regex, networking, …) |
| `#/tips` | Shell tips and tricks |
| `#/search/<query>` | Ranked search results |

## The prompt

The search field is also a shell. Type a bare command name to jump to its page,
anything else to search, or use a builtin:

```
man <cmd>      open a command page          theme <name>   phosphor | amber | ice | paper
ls [letter]    list every command           crt            toggle the scanline overlay
search <q>     search the corpus            random         jump to a random page
guides [id]    browse the topic guides      history        recently opened pages
tips           terminal tips and tricks     help           show everything
```

Keys: `/` focus prompt · `↑↓` move · `⏎` open · `g` guides · `a` all · `r` random ·
`t` theme · `c` CRT · `?` shortcuts.

## How it works

```
build.py          parses the markdown corpus into site/data/
site/
├── index.html    the whole app shell
├── assets/js/
│   ├── markdown.js   renderer for the corpus' markdown dialect
│   └── app.js        router, search, lazy loading, the prompt
├── assets/css/style.css
└── data/
    ├── index.js      search index (name + tagline + example), ~740 KB
    ├── basics.js     the 30 topic guides
    ├── tips.js       the tips
    └── cmd/NNN.js    page bodies, split across 128 buckets (~160 KB each)
```

Page bodies are keyed into buckets by `crc32(name) % 128` — the same function in
`build.py` and `app.js` — and a bucket is pulled in on demand with an injected
`<script>` tag. Using script tags rather than `fetch` is deliberate: it keeps the
site working from a `file://` URL, where `fetch` is blocked by CORS. Opening a page
therefore costs one ~160 KB local read instead of a 20 MB download, and the whole
corpus still ships with the site.

## Licence

The command content comes from the Linux Command Library project and remains under
its original licence. The site code here is MIT.
