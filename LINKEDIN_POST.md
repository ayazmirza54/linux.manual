# LinkedIn post — linux.manual

**Note on formatting:** LinkedIn renders no markdown. `**bold**`, `#` headings and
`-` bullets all show up as literal characters. The post bodies below are written as
plain text with line breaks so they can be pasted straight into the composer. The
`·` bullets survive; asterisks do not.

Before posting, add a link (the repo, or a live URL if you deploy it) and a
screenshot — posts with an image get materially more reach, and the home screen
with the ASCII banner is the most legible single frame.

---

## Main post (2,190 characters — LinkedIn's limit is 3,000)

I built an offline reference for 8,921 Linux commands. The interesting part wasn't the content — it was making it work with the network cable pulled.

The constraint: it had to run by double-clicking an HTML file. No server, no install, no connection.

That rules out the obvious approach. 20 MB of command pages is far too much to load up front, so you want to pull each page on demand — except fetch() is blocked by CORS on file:// URLs. Every request fails before it leaves the browser.

The fix is older than fetch: a script tag.

Script tags were never subject to the same-origin policy. That's the loophole JSONP was built on in 2008. So the build splits the corpus into 128 buckets keyed by crc32(name) % 128, and opening a page injects a script tag for the one bucket it needs. One ~160 KB local read instead of a 20 MB download — and it behaves identically from a web server, a local folder, or a USB stick.

The second lesson was about testing.

I drove the site in a real browser instead of re-reading my own markup. That caught four bugs I would otherwise have shipped:

· an invisible modal whose display:flex overrode the hidden attribute — it sat on top of the page silently swallowing every click

· a generated data file calling load([id, payload]) where the loader expected two arguments, so every page hung forever on "loading"

· CSS grid items defaulting to min-width:auto, which let long commands stretch the layout to 633px inside a 390px phone viewport

· a bold regex that forbade asterisks inside the match, so **refs/notes/*:refs/notes/*** leaked raw markup

Not one of those is visible by reading the code. All four were obvious the instant something clicked a button and measured the result.

Stack: no framework, no dependencies, no build step. Vanilla JS, one stylesheet, and a Python script that parses markdown into the data files. Four themes, a CRT scanline overlay, and a prompt that doubles as a shell — type "man tar" and it opens the page.

Command data comes from Simon Schubert's Linux Command Library, an excellent open-source corpus: github.com/SimonSchubert/LinuxCommandLibrary

#Linux #JavaScript #WebDevelopment #OpenSource #SoftwareEngineering

---

## Short variant (~700 characters)

fetch() is blocked by CORS on file:// URLs. So how do you build a 20 MB offline reference that runs by double-clicking an HTML file?

You use a script tag. Script tags were never bound by the same-origin policy — it's the loophole JSONP was built on.

I split 8,921 Linux command pages into 128 buckets keyed by crc32(name) % 128. Opening a page injects a script tag for its bucket: one ~160 KB local read instead of a 20 MB download. Works from a web server, a local folder, or a USB stick, with the network cable pulled.

No framework, no dependencies, no build step. Vanilla JS and one stylesheet.

Command data from Simon Schubert's Linux Command Library.

#Linux #JavaScript #WebDevelopment #OpenSource

---

## If you'd rather lead with the testing angle

Swap the opening for this and drop the file:// section to the middle:

I shipped four bugs into my own code last week and caught every one of them by pointing a headless browser at the page instead of re-reading the markup.

An invisible modal swallowing all clicks. A data file passing one argument where the loader wanted two. A grid stretching to 633px inside a 390px viewport. A regex that broke on asterisks.

Reading code finds none of these. Clicking a button and measuring the result finds all four.

---

## Facts used above, for reference

| Claim | Value |
| --- | --- |
| Command pages | 8,921 |
| Topic guides / tips | 30 / 16 |
| Total page data | 20.3 MB across 128 buckets (~160 KB each) |
| Search index loaded up front | 743 KB |
| Mobile overflow bug | 633px content inside a 390px viewport |
| Dependencies | none (vanilla JS, one CSS file, Python build script) |
| Data source | github.com/SimonSchubert/LinuxCommandLibrary |

Keep the credit to the Linux Command Library in whichever version you post — the
corpus is the project's work, and the site is a reader for it.
