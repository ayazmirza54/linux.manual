/* ==========================================================================
   app.js — tty.man
   A terminal-styled, fully offline reference for the Linux command corpus.
   No build step, no dependencies, no network: command bodies live in bucketed
   .js files that are pulled in on demand with a <script> tag so the whole
   thing also works straight off a file:// URL.
   ========================================================================== */

(function () {
  'use strict';

  var META   = window.LCL_META || { commands: 0, guides: 0, tips: 0, buckets: 128 };
  var INDEX  = window.LCL_INDEX || [];   // [name, tagline, snippet]
  var BASICS = window.LCL_BASICS || [];
  var TIPS   = window.LCL_TIPS || [];

  var THEMES = ['phosphor', 'amber', 'ice', 'paper'];
  var RECENT_MAX = 8;

  var $ = function (sel) { return document.querySelector(sel); };
  var el = {
    view:    $('#view'),
    prompt:  $('#prompt'),
    form:    $('#promptform'),
    suggest: $('#suggest'),
    mode:    $('#st-mode'),
    path:    $('#st-path'),
    msg:     $('#st-msg'),
    title:   $('#titlebar-title'),
    modal:   $('#modal'),
    modalBody: $('#modal-body'),
    recent:  $('#recent'),
    recentGroup: $('#recent-group')
  };

  /* ------------------------------------------------------------ the caret */

  // A block caret that follows the real insertion point. The measure span
  // holds the text left of the caret, so the block lands exactly where the
  // native one would; the whole thing is shifted by the input's scrollLeft so
  // it stays put once the line is long enough to scroll.
  var caret = { box: $('#prompt-caret'), measure: $('#caret-measure'), timer: null };

  function syncCaret() {
    var value = el.prompt.value;
    var at = el.prompt.selectionStart;
    caret.measure.textContent = value.slice(0, at === null ? value.length : at);
    caret.box.style.transform = 'translateX(' + -el.prompt.scrollLeft + 'px)';
  }

  // selectionStart is still the pre-key value during keydown, so re-read next frame.
  function syncCaretSoon() { requestAnimationFrame(syncCaret); }

  // Programmatic writes do not fire 'input', so they go through here.
  function setPrompt(value) {
    el.prompt.value = value;
    syncCaret();
  }

  function caretTyping() {
    caret.box.classList.add('typing');
    clearTimeout(caret.timer);
    caret.timer = setTimeout(function () { caret.box.classList.remove('typing'); }, 420);
  }

  ['input', 'keyup', 'click', 'select', 'scroll'].forEach(function (evt) {
    el.prompt.addEventListener(evt, syncCaret);
  });
  el.prompt.addEventListener('keydown', function () { caretTyping(); syncCaretSoon(); });

  /* ---------------------------------------------------------------- store */

  var store = {
    get: function (k, fallback) {
      try {
        var v = localStorage.getItem('ttyman.' + k);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { localStorage.setItem('ttyman.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
    }
  };

  /* ------------------------------------------------------- bucket loading */

  // CRC-32, matching zlib.crc32 in build.py so bucket ids agree.
  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    return table;
  })();

  function crc32(str) {
    var bytes = unescape(encodeURIComponent(str));
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
  }

  var cache = {};        // name -> command object
  var loaded = {};       // bucket id -> true
  var pending = {};      // bucket id -> [callbacks]

  window.LCL_BUCKET = function (id, payload) {
    loaded[id] = true;
    for (var name in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, name)) cache[name] = payload[name];
    }
    var waiting = pending[id] || [];
    delete pending[id];
    waiting.forEach(function (cb) { cb(); });
  };

  function loadCommand(name, done) {
    if (cache[name]) return done(cache[name]);

    var id = crc32(name) % META.buckets;
    var finish = function () { done(cache[name] || null); };

    if (loaded[id]) return finish();
    if (pending[id]) return pending[id].push(finish);

    pending[id] = [finish];
    var script = document.createElement('script');
    script.src = 'data/cmd/' + String(id).padStart(3, '0') + '.js';
    script.onerror = function () {
      var waiting = pending[id] || [];
      delete pending[id];
      waiting.forEach(function (cb) { cb(); });
    };
    document.head.appendChild(script);
  }

  /* --------------------------------------------------------------- search */

  var lookup = {};
  INDEX.forEach(function (row) { lookup[row[0]] = row; });

  // Ranked substring search: exact > prefix > word-boundary > substring in
  // name > substring in tagline. Cheap enough to run on every keystroke over
  // ~9k rows without debouncing.
  function search(query, limit) {
    var q = query.toLowerCase().trim();
    if (!q) return [];
    limit = limit || 40;

    var hits = [];
    for (var i = 0; i < INDEX.length; i++) {
      var row = INDEX[i];
      var name = row[0].toLowerCase();
      var score;

      if (name === q) score = 0;
      else if (name.indexOf(q) === 0) score = 1 + name.length / 100;
      else {
        var at = name.indexOf(q);
        if (at > 0) {
          var boundary = /[^a-z0-9]/.test(name.charAt(at - 1));
          score = (boundary ? 2 : 3) + at / 100 + name.length / 1000;
        } else if ((row[1] || '').toLowerCase().indexOf(q) !== -1) {
          score = 5 + name.length / 1000;
        } else {
          continue;
        }
      }
      hits.push([score, row]);
    }

    hits.sort(function (a, b) { return a[0] - b[0] || (a[1][0] < b[1][0] ? -1 : 1); });
    return hits.slice(0, limit).map(function (h) { return h[1]; });
  }

  function highlight(text, query) {
    var safe = MD.esc(text);
    var q = query.trim();
    if (!q) return safe;
    var at = safe.toLowerCase().indexOf(q.toLowerCase());
    if (at === -1) return safe;
    return safe.slice(0, at) + '<mark>' + safe.slice(at, at + q.length) + '</mark>' +
      safe.slice(at + q.length);
  }

  /* ------------------------------------------------------------ suggester */

  var sg = { items: [], sel: -1, open: false };

  function closeSuggest() {
    sg.open = false;
    sg.items = [];
    sg.sel = -1;
    el.suggest.hidden = true;
    el.suggest.innerHTML = '';
  }

  function openSuggest(query) {
    var verb = query.trim().split(/\s+/)[0];
    // While typing a shell verb, suggest builtins instead of commands.
    if (query.trim() && !/\s/.test(query) && BUILTIN_NAMES.indexOf(verb) === -1) {
      var builtins = BUILTIN_NAMES.filter(function (b) { return b.indexOf(verb) === 0; });
      var results = search(query, 40);
      renderSuggest(query, builtins.map(function (b) {
        return { kind: 'builtin', name: b, tag: BUILTINS[b].help, href: null, run: b };
      }).concat(results.map(toItem)));
      return;
    }
    renderSuggest(query, search(query, 40).map(toItem));
  }

  function toItem(row) {
    return { kind: 'man', name: row[0], tag: row[1] || row[2] || '', href: '#/man/' + encodeURIComponent(row[0]) };
  }

  function renderSuggest(query, items) {
    sg.items = items;
    sg.sel = items.length ? 0 : -1;
    sg.open = true;

    if (!items.length) {
      el.suggest.innerHTML = '<div class="sg-head">no match for &quot;' + MD.esc(query) +
        '&quot; — try <b>help</b></div>';
      el.suggest.hidden = false;
      return;
    }

    var html = '<div class="sg-head">' + items.length + ' result' +
      (items.length === 1 ? '' : 's') + ' — <kbd>↑↓</kbd> move <kbd>⏎</kbd> open <kbd>esc</kbd> close</div>';

    html += items.map(function (it, i) {
      return '<div class="sg-item' + (i === sg.sel ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="sg-name">' + highlight(it.name, query) + '</span>' +
        '<span class="sg-tag">' + MD.esc(it.tag || '') + '</span>' +
        '<span class="sg-kind">' + it.kind + '</span>' +
        '</div>';
    }).join('');

    el.suggest.innerHTML = html;
    el.suggest.hidden = false;
  }

  function moveSuggest(delta) {
    if (!sg.open || !sg.items.length) return;
    sg.sel = (sg.sel + delta + sg.items.length) % sg.items.length;
    var nodes = el.suggest.querySelectorAll('.sg-item');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('sel', i === sg.sel);
    if (nodes[sg.sel]) nodes[sg.sel].scrollIntoView({ block: 'nearest' });
  }

  function activateSuggest(i) {
    var it = sg.items[i];
    if (!it) return;
    closeSuggest();
    setPrompt('');
    if (it.href) go(it.href);
    else exec(it.run);
  }

  /* ------------------------------------------------------------- builtins */

  var BUILTINS = {
    help:    { help: 'show available commands',        run: function () { showHelp(); } },
    man:     { help: 'open a command page',            run: function (a) { a ? go('#/man/' + encodeURIComponent(a)) : go('#/all'); } },
    ls:      { help: 'list every command',             run: function (a) { go(a ? '#/all/' + encodeURIComponent(a) : '#/all'); } },
    search:  { help: 'search the corpus',              run: function (a) { go('#/search/' + encodeURIComponent(a || '')); } },
    grep:    { help: 'alias for search',               run: function (a) { go('#/search/' + encodeURIComponent(a || '')); } },
    guides:  { help: 'browse the topic guides',        run: function (a) { go(a ? '#/guide/' + encodeURIComponent(a) : '#/guides'); } },
    tips:    { help: 'terminal tips and tricks',       run: function () { go('#/tips'); } },
    random:  { help: 'jump to a random command',       run: function () { go('#/random'); } },
    theme:   { help: 'switch theme [' + THEMES.join('|') + ']', run: function (a) { setTheme(a || nextTheme()); } },
    crt:     { help: 'toggle the scanline overlay',    run: function () { toggleCrt(); } },
    clear:   { help: 'go back to the home screen',     run: function () { go('#/'); } },
    whoami:  { help: 'about this reference',           run: function () { go('#/about'); } },
    about:   { help: 'about this reference',           run: function () { go('#/about'); } },
    history: { help: 'recently opened pages',          run: function () { showHistory(); } },
    exit:    { help: 'clear the prompt',               run: function () { setPrompt(''); flash('nice try'); } }
  };
  var BUILTIN_NAMES = Object.keys(BUILTINS);

  function exec(line) {
    var input = String(line || '').trim();
    if (!input) return;

    var parts = input.split(/\s+/);
    var verb = parts[0].toLowerCase();
    var rest = parts.slice(1).join(' ');

    if (BUILTINS[verb]) {
      BUILTINS[verb].run(rest);
      return;
    }
    // Not a builtin: if it names a command, open it; otherwise search.
    if (lookup[input]) return go('#/man/' + encodeURIComponent(input));
    if (lookup[verb]) return go('#/man/' + encodeURIComponent(verb));
    go('#/search/' + encodeURIComponent(input));
  }

  /* --------------------------------------------------------------- router */

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function route() {
    var raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var parts = raw.split('/');
    return { name: parts[0] || 'home', arg: parts.slice(1).join('/') };
  }

  function render() {
    var r = route();
    var views = {
      home: viewHome, all: viewAll, guides: viewGuides, guide: viewGuide,
      tips: viewTips, man: viewMan, search: viewSearch, about: viewAbout,
      random: viewRandom
    };
    (views[r.name] || viewNotFound)(r.arg);
    markNav(r.name);
  }

  function markNav(name) {
    var map = { home: 'home', all: 'all', guides: 'guides', guide: 'guides', tips: 'tips', random: 'random' };
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].dataset.nav === map[name]);
    }
  }

  function paint(html, opts) {
    opts = opts || {};
    el.view.innerHTML = '<div class="view-inner">' + html + '</div>';
    el.view.scrollTop = 0;
    el.path.textContent = opts.path || '~/';
    el.mode.textContent = opts.mode || 'NORMAL';
    el.title.textContent = 'root@localhost: ' + (opts.path || '~/');
    document.title = (opts.title ? opts.title + ' — ' : '') + 'tty.man';
  }

  /* ----------------------------------------------------------- view: home */

  var BANNER = [
    '████████╗████████╗██╗   ██╗   ███╗   ███╗ █████╗ ███╗   ██╗',
    '╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝   ████╗ ████║██╔══██╗████╗  ██║',
    '   ██║      ██║    ╚████╔╝    ██╔████╔██║███████║██╔██╗ ██║',
    '   ██║      ██║     ╚██╔╝     ██║╚██╔╝██║██╔══██║██║╚██╗██║',
    '   ██║      ██║      ██║  ██╗ ██║ ╚═╝ ██║██║  ██║██║ ╚████║',
    '   ╚═╝      ╚═╝      ╚═╝  ╚═╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝'
  ].join('\n');

  function viewHome() {
    var picks = ['ls', 'grep', 'find', 'tar', 'ssh', 'awk', 'sed', 'curl', 'rsync', 'systemctl',
                 'chmod', 'ps', 'top', 'git', 'docker', 'jq', 'xargs', 'df', 'du', 'lsof',
                 'nc', 'dd', 'ip', 'journalctl', 'crontab', 'tmux'];
    var known = picks.filter(function (p) { return lookup[p]; });

    var html = '<pre class="banner">' + MD.esc(BANNER) + '</pre>' +
      '<div class="boot">' +
        '<span class="line">[<span class="ok">ok</span>] mounted corpus … <b>' + META.commands.toLocaleString() + '</b> manual pages</span>' +
        '<span class="line">[<span class="ok">ok</span>] loaded topic guides … <b>' + META.guides + '</b></span>' +
        '<span class="line">[<span class="ok">ok</span>] loaded tips … <b>' + META.tips + '</b></span>' +
        '<span class="line">[<span class="ok">ok</span>] network not required — everything is local</span>' +
        '<span class="line">type a command or press <kbd>/</kbd> to search</span>' +
      '</div>' +

      '<div class="cards">' +
        card('#/all', 'all commands', 'Browse every page, alphabetically.') +
        card('#/guides', 'topic guides', BASICS.length + ' hand-written walkthroughs: git, ssh, vim, regex, networking…') +
        card('#/tips', 'terminal tips', TIPS.length + ' shortcuts and habits worth knowing.') +
        card('#/random', 'random page', 'Discover something you did not know existed.') +
      '</div>' +

      '<div class="sec"><h2>POPULAR</h2><div class="cmdgrid">' +
        known.map(function (n) {
          return '<a href="#/man/' + encodeURIComponent(n) + '">' + MD.esc(n) + '</a>';
        }).join('') +
      '</div></div>' +

      '<div class="sec"><h2>GUIDES</h2><div class="chips">' +
        BASICS.map(function (g) {
          return '<a class="chip" href="#/guide/' + encodeURIComponent(g.id) + '">' + MD.esc(g.title) + '</a>';
        }).join('') +
      '</div></div>';

    paint(html, { path: '~/', title: 'Linux command reference' });
  }

  function card(href, title, text) {
    return '<a class="card" href="' + href + '"><b>' + MD.esc(title) + '</b><span>' +
      MD.esc(text) + '</span></a>';
  }

  /* ------------------------------------------------------------ view: man */

  function viewMan(name) {
    if (!name) return go('#/all');

    paint('<div class="page-head"><h1>' + MD.esc(name) + '</h1></div>' +
          '<p class="empty">loading<span class="cursor"></span></p>',
          { path: '~/man/' + name, mode: 'LOAD', title: name });

    loadCommand(name, function (cmd) {
      if (!cmd) return viewMissing(name);
      pushRecent(name);

      var head = '<div class="page-head">' +
        '<div class="crumb">~/man/' + MD.esc(name) + '</div>' +
        '<h1>' + MD.esc(cmd.n) + '</h1>' +
        (cmd.t ? '<div class="tagline">' + MD.inline(cmd.t) + '</div>' : '') +
        '</div>';

      var body = cmd.s.map(function (sec) {
        if (String(sec[0]).toUpperCase() === 'TAGLINE') return '';
        return '<div class="sec"><h2>' + MD.esc(sec[0]) + '</h2>' +
          MD.renderSection(sec[0], sec[1]) + '</div>';
      }).join('');

      paint(head + body, { path: '~/man/' + name, title: name });
    });
  }

  function viewMissing(name) {
    var near = search(name, 12);
    paint('<div class="page-head"><h1>' + MD.esc(name) + '</h1>' +
      '<div class="tagline">No manual entry for ' + MD.esc(name) + '</div></div>' +
      '<p class="empty">The corpus has <b>' + META.commands.toLocaleString() +
      '</b> pages but not this one.</p>' +
      (near.length ? '<div class="sec"><h2>DID YOU MEAN</h2>' + listing(near) + '</div>' : ''),
      { path: '~/man/' + name, mode: 'ERROR', title: name });
  }

  /* ------------------------------------------------------------ view: all */

  var LETTERS = '0abcdefghijklmnopqrstuvwxyz'.split('');

  function letterOf(name) {
    var c = name.charAt(0).toLowerCase();
    return /[a-z]/.test(c) ? c : '0';
  }

  function viewAll(letter) {
    letter = (letter || 'a').toLowerCase();
    var rows = INDEX.filter(function (r) { return letterOf(r[0]) === letter; });

    var nav = '<div class="toc">' + LETTERS.map(function (l) {
      return '<a href="#/all/' + l + '"' + (l === letter ? ' style="color:var(--accent)"' : '') +
        '>' + (l === '0' ? '0-9' : l.toUpperCase()) + '</a>';
    }).join('') + '</div>';

    paint('<div class="page-head"><div class="crumb">~/all</div><h1>all commands ' +
      '<span class="sect">(' + META.commands.toLocaleString() + ')</span></h1>' +
      '<div class="tagline">' + rows.length + ' page' + (rows.length === 1 ? '' : 's') +
      ' starting with ' + (letter === '0' ? 'a digit or symbol' : '&ldquo;' + letter + '&rdquo;') +
      '</div></div>' + nav + listing(rows),
      { path: '~/all/' + letter, title: 'all commands' });
  }

  function listing(rows) {
    if (!rows.length) return '<p class="empty">nothing here.</p>';
    return '<div class="listing">' + rows.map(function (r) {
      return '<a href="#/man/' + encodeURIComponent(r[0]) + '">' +
        '<span class="ln">' + MD.esc(r[0]) + '</span>' +
        '<span class="lt">' + MD.esc(r[1] || r[2] || '') + '</span></a>';
    }).join('') + '</div>';
  }

  /* --------------------------------------------------------- view: search */

  function viewSearch(query) {
    var rows = search(query || '', 300);
    paint('<div class="page-head"><div class="crumb">~/search</div>' +
      '<h1>' + MD.esc(query || '') + ' <span class="sect">(' + rows.length +
      (rows.length === 300 ? '+' : '') + ')</span></h1>' +
      '<div class="tagline">matches in command names and taglines</div></div>' +
      listing(rows),
      { path: '~/search/' + (query || ''), mode: rows.length ? 'FOUND' : 'EMPTY', title: 'search ' + query });
  }

  /* --------------------------------------------------------- view: guides */

  function viewGuides() {
    paint('<div class="page-head"><div class="crumb">~/guides</div><h1>topic guides ' +
      '<span class="sect">(' + BASICS.length + ')</span></h1>' +
      '<div class="tagline">task-first walkthroughs, each one a short tour of a subject</div></div>' +
      '<div class="cards">' + BASICS.map(function (g) {
        return card('#/guide/' + encodeURIComponent(g.id), g.title,
          (g.topics || []).slice(0, 4).join(' · ') || 'guide');
      }).join('') + '</div>',
      { path: '~/guides', title: 'guides' });
  }

  function viewGuide(id) {
    var guide = null;
    for (var i = 0; i < BASICS.length; i++) if (BASICS[i].id === id) { guide = BASICS[i]; break; }
    if (!guide) return viewNotFound(id);

    var toc = (guide.topics || []).length
      ? '<div class="toc">' + guide.topics.map(function (t) {
          return '<a href="#" data-scroll="' + MD.esc(slug(t)) + '">' + MD.esc(t) + '</a>';
        }).join('') + '</div>'
      : '';

    var body = MD.render(guide.body).replace(/<h3>(.*?)<\/h3>/g, function (m, inner) {
      return '<h3 id="' + slug(inner.replace(/<[^>]+>/g, '')) + '">' + inner + '</h3>';
    });

    paint('<div class="page-head"><div class="crumb">~/guides/' + MD.esc(guide.id) + '</div>' +
      '<h1>' + MD.esc(guide.title) + '</h1></div>' + toc + '<div class="sec">' + body + '</div>',
      { path: '~/guides/' + guide.id, title: guide.title });
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /* ----------------------------------------------------------- view: tips */

  function viewTips() {
    var toc = '<div class="toc">' + TIPS.map(function (t) {
      return '<a href="#" data-scroll="' + MD.esc(slug(t.title)) + '">' + MD.esc(t.title) + '</a>';
    }).join('') + '</div>';

    var body = TIPS.map(function (t) {
      return '<div class="sec"><h2 id="' + slug(t.title) + '">' + MD.esc(t.title) + '</h2>' +
        MD.render(t.body) + '</div>';
    }).join('');

    paint('<div class="page-head"><div class="crumb">~/tips</div><h1>tips ' +
      '<span class="sect">(' + TIPS.length + ')</span></h1>' +
      '<div class="tagline">small things that make the shell faster</div></div>' + toc + body,
      { path: '~/tips', title: 'tips' });
  }

  /* --------------------------------------------------- views: misc/errors */

  function viewRandom() {
    if (!INDEX.length) return viewNotFound('random');
    var pick = INDEX[Math.floor(Math.random() * INDEX.length)];
    location.replace('#/man/' + encodeURIComponent(pick[0]));
  }

  function viewAbout() {
    paint('<div class="page-head"><div class="crumb">~/about</div><h1>whoami</h1>' +
      '<div class="tagline">an offline, terminal-styled Linux command reference</div></div>' +

      '<div class="sec"><h2>WHAT THIS IS</h2>' +
      '<p>A static reference over the <a href="https://github.com/SimonSchubert/LinuxCommandLibrary" ' +
      'target="_blank" rel="noopener">Linux Command Library</a> corpus by Simon Schubert: ' +
      '<strong>' + META.commands.toLocaleString() + '</strong> manual pages, <strong>' + META.guides +
      '</strong> topic guides and <strong>' + META.tips + '</strong> tips.</p>' +
      '<p>Every page ships with the site. There are no requests to any server once it is loaded ' +
      '— it runs from a local folder, a USB stick, or a static host, and works with the network cable pulled.</p></div>' +

      '<div class="sec"><h2>HOW IT WORKS</h2>' +
      '<p>The search index loads up front. Page bodies are split across ' + META.buckets +
      ' buckets that are pulled in on demand, so opening a page costs one small local read ' +
      'instead of a 20&nbsp;MB download.</p></div>' +

      '<div class="sec"><h2>LICENCE</h2>' +
      '<p>Command content is from the Linux Command Library project and remains under its ' +
      'original licence. Follow the link above for the source data.</p></div>' +

      '<div class="sec"><h2>SHELL</h2>' + builtinsHtml() + '</div>',
      { path: '~/about', title: 'about' });
  }

  function viewNotFound(arg) {
    paint('<div class="page-head"><h1>404 <span class="sect">not found</span></h1>' +
      '<div class="tagline">' + MD.esc(arg || location.hash) + '</div></div>' +
      '<p class="empty">No such page. Try <a href="#/">home</a> or press <kbd>/</kbd>.</p>',
      { path: '~/404', mode: 'ERROR', title: '404' });
  }

  function builtinsHtml() {
    return '<div class="params">' + BUILTIN_NAMES.map(function (b) {
      return '<div class="param"><div class="param-term"><span class="flag">' + b +
        '</span></div><div class="param-desc">' + MD.esc(BUILTINS[b].help) + '</div></div>';
    }).join('') + '</div>';
  }

  /* -------------------------------------------------------------- history */

  function pushRecent(name) {
    var list = store.get('recent', []).filter(function (n) { return n !== name; });
    list.unshift(name);
    store.set('recent', list.slice(0, RECENT_MAX));
    renderRecent();
  }

  function renderRecent() {
    var list = store.get('recent', []);
    el.recentGroup.hidden = !list.length;
    el.recent.innerHTML = list.map(function (n) {
      return '<a href="#/man/' + encodeURIComponent(n) + '">' + MD.esc(n) + '</a>';
    }).join('');
  }

  function showHistory() {
    var list = store.get('recent', []).map(function (n) { return lookup[n] || [n, '', '']; });
    paint('<div class="page-head"><div class="crumb">~/history</div><h1>history</h1>' +
      '<div class="tagline">pages you opened on this device</div></div>' +
      listing(list), { path: '~/history', title: 'history' });
  }

  /* --------------------------------------------------------- theme & chrome */

  function setTheme(name) {
    if (THEMES.indexOf(name) === -1) return flash('unknown theme: ' + name);
    document.documentElement.dataset.theme = name;
    $('#theme-name').textContent = name;
    store.set('theme', name);
    flash('theme → ' + name);
  }

  function nextTheme() {
    var current = document.documentElement.dataset.theme;
    return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  }

  function toggleCrt() {
    var off = document.body.classList.toggle('no-crt');
    store.set('crt', !off);
    flash('crt ' + (off ? 'off' : 'on'));
  }

  var flashTimer;
  function flash(msg) {
    el.msg.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.msg.textContent = ''; }, 2200);
  }

  /* ----------------------------------------------------------------- help */

  var KEYS = [
    ['/  or  :', 'focus the prompt'],
    ['esc', 'close suggestions / blur the prompt'],
    ['↑ ↓', 'move through suggestions'],
    ['enter', 'open the selection, or run the line'],
    ['g', 'topic guides'],
    ['a', 'all commands'],
    ['r', 'random page'],
    ['t', 'cycle theme'],
    ['c', 'toggle CRT overlay'],
    ['?', 'this panel']
  ];

  function showHelp() {
    el.modalBody.innerHTML =
      '<h4>// KEYS</h4><dl>' + KEYS.map(function (k) {
        return '<dt>' + MD.esc(k[0]) + '</dt><dd>' + MD.esc(k[1]) + '</dd>';
      }).join('') + '</dl>' +
      '<h4>// PROMPT COMMANDS</h4><dl>' + BUILTIN_NAMES.map(function (b) {
        return '<dt>' + b + '</dt><dd>' + MD.esc(BUILTINS[b].help) + '</dd>';
      }).join('') + '</dl>' +
      '<h4>// ANYTHING ELSE</h4><p style="color:var(--fg-dim);margin:0">' +
      'A bare word opens that command page if it exists, otherwise it searches.</p>';
    el.modal.hidden = false;
  }

  function closeModal() { el.modal.hidden = true; }

  /* ---------------------------------------------------------------- events */

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sg.open && sg.sel >= 0) return activateSuggest(sg.sel);
    var value = el.prompt.value;
    setPrompt('');
    closeSuggest();
    exec(value);
  });

  el.prompt.addEventListener('input', function () {
    var value = el.prompt.value;
    if (!value.trim()) return closeSuggest();
    openSuggest(value);
  });

  el.prompt.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
    else if (e.key === 'Escape') {
      if (sg.open) closeSuggest();
      else { setPrompt(''); el.prompt.blur(); }
    } else if (e.key === 'Tab' && sg.open && sg.items[sg.sel]) {
      e.preventDefault();
      setPrompt(sg.items[sg.sel].name);
      openSuggest(el.prompt.value);
    }
  });

  el.prompt.addEventListener('focus', function () {
    el.mode.textContent = 'INSERT';
    caret.box.classList.remove('blurred');
    syncCaret();
  });
  el.prompt.addEventListener('blur', function () {
    el.mode.textContent = 'NORMAL';
    caret.box.classList.add('blurred');
    setTimeout(closeSuggest, 120);
  });

  el.suggest.addEventListener('mousedown', function (e) {
    var item = e.target.closest('.sg-item');
    if (!item) return;
    e.preventDefault();
    activateSuggest(Number(item.dataset.i));
  });

  // Copy buttons and in-page anchors.
  document.addEventListener('click', function (e) {
    var copy = e.target.closest('.copy');
    if (copy) {
      e.preventDefault();
      var text = copy.dataset.copy || '';
      var done = function () {
        copy.textContent = 'copied';
        copy.classList.add('done');
        setTimeout(function () { copy.textContent = 'copy'; copy.classList.remove('done'); }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
      return;
    }

    var scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      e.preventDefault();
      var target = document.getElementById(scroll.dataset.scroll);
      if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { flash('copy failed'); }
    document.body.removeChild(ta);
  }

  document.addEventListener('keydown', function (e) {
    if (e.target === el.prompt || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;

    if (e.key === '/' || e.key === ':') { e.preventDefault(); el.prompt.focus(); el.prompt.select(); return; }
    if (e.key === '?') { e.preventDefault(); showHelp(); return; }
    if (e.key === 'Escape') { closeModal(); return; }
    if (!el.modal.hidden) return;

    var jumps = { g: '#/guides', a: '#/all', r: '#/random', h: '#/', i: '#/tips' };
    if (jumps[e.key]) { go(jumps[e.key]); return; }
    if (e.key === 't') { setTheme(nextTheme()); return; }
    if (e.key === 'c') { toggleCrt(); return; }
  });

  $('#btn-theme').addEventListener('click', function () { setTheme(nextTheme()); });
  $('#btn-crt').addEventListener('click', toggleCrt);
  $('#btn-help').addEventListener('click', showHelp);
  $('#modal-close').addEventListener('click', closeModal);
  el.modal.addEventListener('click', function (e) { if (e.target === el.modal) closeModal(); });

  window.addEventListener('hashchange', render);

  /* ------------------------------------------------------------------ init */

  function init() {
    setTheme(store.get('theme', 'phosphor'));
    el.msg.textContent = '';
    if (store.get('crt', true) === false) document.body.classList.add('no-crt');

    $('#stat-commands').textContent = META.commands.toLocaleString();
    $('#stat-guides').textContent = META.guides;

    $('#alpha').innerHTML = LETTERS.map(function (l) {
      return '<a href="#/all/' + l + '">' + (l === '0' ? '#' : l) + '</a>';
    }).join('');

    renderRecent();
    caret.box.classList.add('blurred');
    syncCaret();
    if (!location.hash) location.replace('#/');
    render();
  }

  init();
})();
