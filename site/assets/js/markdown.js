/* ==========================================================================
   markdown.js — a small renderer for the flavour of markdown used by the
   LinuxCommandLibrary corpus. It is deliberately narrow: the corpus only uses
   headings, single- and multi-line code fences, blockquote descriptions,
   dash lists, bold/italic, inline code and /man/ links.
   ========================================================================== */

window.MD = (function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function manHref(name) {
    return '#/man/' + encodeURIComponent(name);
  }

  /* ---- inline ---------------------------------------------------------- */

  // Links, bold, italic and inline code inside a normal prose run.
  function inline(text) {
    var out = esc(text);

    out = out.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, function (_, label, url) {
      return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    out = out.replace(/\[([^\]]+)\]\(\/man\/([^)]+)\)/g, function (_, label, name) {
      return '<a href="' + manHref(name) + '">' + label + '</a>';
    });
    out = out.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
    // Lazy, with a trailing-star guard: bold runs regularly contain literal
    // asterisks ("**SELECT * -- noqa**", "**refs/notes/*:refs/notes/***").
    out = out.replace(/\*\*(.+?)\*\*(?!\*)/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:)])/g, '$1<em>$2</em>');
    return out;
  }

  /* ---- code ------------------------------------------------------------ */

  // Inside code we highlight [placeholders] and turn /man/ links into links,
  // but never interpret bold/italic — a literal * or _ is part of the shell.
  function codeBody(text) {
    var out = esc(text);
    out = out.replace(/\[([^\]]+)\]\(\/man\/([^)]+)\)/g, function (_, label, name) {
      return '<a href="' + manHref(name) + '">' + label + '</a>';
    });
    out = out.replace(/\[([^\]\n]+)\]/g, '<span class="ph">[$1]</span>');
    return out;
  }

  function codeBlock(text, opts) {
    opts = opts || {};
    var sigil = opts.sigil === false ? '' : '<span class="sigil">$</span>';
    var raw = esc(text.replace(/\[([^\]]+)\]\(\/man\/[^)]+\)/g, '$1'));
    return '<div class="code">' + sigil +
      '<pre>' + codeBody(text) + '</pre>' +
      '<button class="copy" type="button" data-copy="' + raw + '">copy</button>' +
      '</div>';
  }

  /* ---- tables ---------------------------------------------------------- */

  function isDelimiterRow(line) {
    var t = String(line).trim();
    return t.charAt(0) === '|' && t.indexOf('-') !== -1 && /^\|[\s:|-]+\|?$/.test(t);
  }

  // Split a row into cells, honouring \| escapes (the corpus uses them inside
  // cells for things like _GET\|PUT_).
  function splitRow(line) {
    var s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; }
      else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function renderTable(t) {
    var width = t.rows.reduce(function (max, r) { return Math.max(max, r.length); }, t.head.length);
    var attr = function (i) { return t.align[i] ? ' style="text-align:' + t.align[i] + '"' : ''; };
    var cell = function (tag, text, i) {
      return '<' + tag + attr(i) + '>' + inline(text || '') + '</' + tag + '>';
    };
    var pad = function (row) {
      var cells = row.slice(0, width);
      while (cells.length < width) cells.push('');
      return cells;
    };

    // Several tables carry a blank header row purely to satisfy the delimiter
    // syntax; rendering it would leave an empty band above the data.
    var labelled = t.head.some(function (c) { return c !== ''; });

    var html = '<div class="table-wrap"><table class="md-table">';
    if (labelled) {
      html += '<thead><tr>' + pad(t.head).map(function (c, i) {
        return cell('th', c, i);
      }).join('') + '</tr></thead>';
    }
    html += '<tbody>' + t.rows.map(function (r) {
      return '<tr>' + pad(r).map(function (c, i) { return cell('td', c, i); }).join('') + '</tr>';
    }).join('') + '</tbody>';
    return html + '</table></div>';
  }

  /* ---- block scanner --------------------------------------------------- */

  // Walks lines and yields blocks: {type: 'code'|'quote'|'list'|'h'|'p', ...}
  function blocks(src) {
    var lines = String(src || '').split('\n');
    var out = [];
    var para = [];

    function flush() {
      if (para.length) {
        out.push({ type: 'p', text: para.join('\n').trim() });
        para = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) { flush(); continue; }

      // ```one liner```
      var single = trimmed.match(/^```(.*)```$/);
      if (single && single[1] !== '') {
        flush();
        out.push({ type: 'code', text: single[1] });
        continue;
      }

      // ``` fenced block ```
      if (trimmed.indexOf('```') === 0) {
        flush();
        var buf = [trimmed.slice(3)];
        var closed = false;
        while (++i < lines.length) {
          var next = lines[i];
          if (next.trim() === '```') { closed = true; break; }
          if (next.trim().slice(-3) === '```') {
            buf.push(next.replace(/```\s*$/, ''));
            closed = true;
            break;
          }
          buf.push(next);
        }
        void closed;
        out.push({ type: 'code', text: buf.join('\n').replace(/^\n+|\n+$/g, '') });
        continue;
      }

      // ### heading
      var head = trimmed.match(/^(#{2,4})\s+(.*)$/);
      if (head) {
        flush();
        out.push({ type: 'h', level: head[1].length, text: head[2] });
        continue;
      }

      // | pipe | table |
      // A delimiter row on the following line is required, exactly as GFM
      // demands. That is what keeps ASCII art full of pipes from being
      // mistaken for a table.
      if (trimmed.charAt(0) === '|' && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
        flush();
        var head = splitRow(trimmed);
        var align = splitRow(lines[++i]).map(function (cell) {
          var left = cell.charAt(0) === ':';
          var right = cell.charAt(cell.length - 1) === ':';
          return right ? (left ? 'center' : 'right') : (left ? 'left' : '');
        });
        var rows = [];
        while (i + 1 < lines.length && lines[i + 1].trim().charAt(0) === '|') {
          rows.push(splitRow(lines[++i]));
        }
        out.push({ type: 'table', head: head, align: align, rows: rows });
        continue;
      }

      // > description
      if (trimmed.indexOf('>') === 0) {
        flush();
        var quote = [trimmed.replace(/^>\s?/, '')];
        while (i + 1 < lines.length && lines[i + 1].trim().indexOf('>') === 0) {
          quote.push(lines[++i].trim().replace(/^>\s?/, ''));
        }
        out.push({ type: 'quote', text: quote.join(' ') });
        continue;
      }

      // - list
      if (/^[-*]\s+/.test(trimmed)) {
        flush();
        var items = [trimmed.replace(/^[-*]\s+/, '')];
        while (i + 1 < lines.length && /^[-*]\s+/.test(lines[i + 1].trim())) {
          items.push(lines[++i].trim().replace(/^[-*]\s+/, ''));
        }
        out.push({ type: 'list', items: items });
        continue;
      }

      para.push(trimmed);
    }
    flush();
    return out;
  }

  /* ---- generic renderer ------------------------------------------------ */

  function render(src) {
    return blocks(src).map(function (b) {
      switch (b.type) {
        case 'code':  return codeBlock(b.text);
        case 'table': return renderTable(b);
        case 'h':     return '<h3>' + inline(b.text) + '</h3>';
        case 'quote': return '<p class="param-desc">' + inline(b.text) + '</p>';
        case 'list':  return '<ul>' + b.items.map(function (it) {
          return '<li>' + inline(it) + '</li>';
        }).join('') + '</ul>';
        default:      return '<p>' + inline(b.text) + '</p>';
      }
    }).join('');
  }

  /* ---- section-specific renderers -------------------------------------- */

  // TLDR is a run of "**description**" followed by one or more snippets.
  function renderTldr(src) {
    var items = [];
    var current = null;
    blocks(src).forEach(function (b) {
      if (b.type === 'code') {
        if (!current) { current = { desc: '', codes: [] }; items.push(current); }
        current.codes.push(b.text);
      } else if (b.type === 'p' || b.type === 'h') {
        // Descriptions are only partially bold ("**Create an archive** from
        // files"), so hand the raw text to inline() rather than unwrapping.
        current = { desc: b.text, codes: [] };
        items.push(current);
      }
    });
    if (!items.length) return render(src);
    return '<div class="tldr">' + items.map(function (it) {
      return '<div class="tldr-item">' +
        (it.desc ? '<div class="tldr-desc">' + inline(it.desc) + '</div>' : '') +
        it.codes.map(function (c) { return codeBlock(c); }).join('') +
        '</div>';
    }).join('') + '</div>';
  }

  // PARAMETERS is a term line (flags and/or _ARG_) followed by "> description".
  function renderParams(src) {
    var bs = blocks(src);
    var rows = [];
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.type === 'quote') {
        if (rows.length) rows[rows.length - 1].desc.push(b.text);
        else rows.push({ term: '', desc: [b.text] });
      } else if (b.type === 'p') {
        rows.push({ term: b.text, desc: [] });
      } else if (b.type === 'code') {
        if (rows.length) rows[rows.length - 1].desc.push('```' + b.text + '```');
        else rows.push({ term: b.text, desc: [] });
      }
    }
    if (!rows.length) return render(src);

    return '<div class="params">' + rows.map(function (r) {
      var term = esc(r.term)
        .replace(/\*\*(.+?)\*\*(?!\*)/g, '<span class="flag">$1</span>')
        .replace(/_([^_]+)_/g, '<span class="arg">$1</span>');
      var desc = r.desc.join('\n\n');
      return '<div class="param">' +
        '<div class="param-term">' + term + '</div>' +
        '<div class="param-desc">' + (desc ? render(desc) : '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  // INSTALL is a list of "```manager: command```" snippets.
  function renderInstall(src) {
    var rows = blocks(src).filter(function (b) { return b.type === 'code'; });
    if (!rows.length) return render(src);
    return '<div class="install">' + rows.map(function (b) {
      var m = b.text.match(/^([a-z0-9._+-]+):\s*(.*)$/i);
      var pm = m ? m[1] : '';
      var cmd = m ? m[2] : b.text;
      return '<div class="pm-row">' +
        '<span class="pm-tag">' + esc(pm) + '</span>' +
        codeBlock(cmd) +
        '</div>';
    }).join('') + '</div>';
  }

  // SEE ALSO is a comma separated run of /man/ links with section numbers.
  function renderSeeAlso(src) {
    var chips = [];
    var re = /\[([^\]]+)\]\(\/man\/([^)]+)\)(?:\((\d+)\))?/g;
    var m;
    while ((m = re.exec(src))) {
      chips.push('<a class="chip" href="' + manHref(m[2]) + '">' + esc(m[1]) +
        (m[3] ? '<span class="num">(' + m[3] + ')</span>' : '') + '</a>');
    }
    if (!chips.length) return render(src);
    return '<div class="chips">' + chips.join('') + '</div>';
  }

  function renderSection(title, body) {
    // The TLDR/PARAMETERS renderers walk blocks by type and would drop a table
    // on the floor. No section ships one today, but if the upstream data shifts
    // it is better to lose the two-column layout than the content.
    if (blocks(body).some(function (b) { return b.type === 'table'; })) return render(body);

    switch (String(title).toUpperCase()) {
      case 'TLDR':     return renderTldr(body);
      case 'PARAMETERS':
      case 'OPTIONS':
      case 'COMMON OPTIONS':
      case 'GLOBAL OPTIONS': return renderParams(body);
      case 'INSTALL':
      case 'INSTALLATION': return renderInstall(body);
      case 'SEE ALSO':
      case 'RELATED COMMANDS':
      case 'RELATED TOOLS': return renderSeeAlso(body);
      default:         return render(body);
    }
  }

  return {
    esc: esc,
    inline: inline,
    render: render,
    renderSection: renderSection,
    codeBlock: codeBlock,
    blocks: blocks
  };
})();
