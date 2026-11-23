(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightLine(line) {
    // Token-by-token color-only highlighting (identical metrics to textarea!)
    let out = '';
    let i = 0;
    const len = line.length;

    while (i < len) {
      // Line comment
      if (line[i] === '/' && line[i + 1] === '/') {
        out += '<span class="tok-comment">' + escapeHTML(line.slice(i)) + '</span>';
        break;
      }

      // Block comment inline /* ... */
      if (line[i] === '/' && line[i + 1] === '*') {
        const end = line.indexOf('*/', i + 2);
        const slice = end >= 0 ? line.slice(i, end + 2) : line.slice(i);
        out += '<span class="tok-comment">' + escapeHTML(slice) + '</span>';
        i += slice.length;
        continue;
      }

      // Strings ', ", `
      if (line[i] === "'" || line[i] === '"' || line[i] === '`') {
        const q = line[i];
        let j = i + 1;
        while (j < len && line[j] !== q) {
          if (line[j] === '\\') j += 2;
          else j++;
        }
        if (j < len) j++;
        const cls = q === '`' ? 'tok-expr' : 'tok-string';
        out += '<span class="' + cls + '">' + escapeHTML(line.slice(i, j)) + '</span>';
        i = j;
        continue;
      }

      // Hex color #...
      if (line[i] === '#' && /[0-9a-fA-F]/.test(line[i + 1] || '')) {
        let j = i + 1;
        while (j < len && /[0-9a-fA-F]/.test(line[j])) j++;
        out += '<span class="tok-color">' + escapeHTML(line.slice(i, j)) + '</span>';
        i = j;
        continue;
      }

      // Punctuation & relation operators
      if (line[i] === '<' && line[i + 1] === '>') {
        out += '<span class="tok-op">&lt;&gt;</span>';
        i += 2;
        continue;
      }
      if ('{}[]():.,<>-'.includes(line[i])) {
        const cls = '{}[]'.includes(line[i]) ? 'tok-brace' : '<>-'.includes(line[i]) ? 'tok-op' : 'tok-punct';
        out += '<span class="' + cls + '">' + escapeHTML(line[i]) + '</span>';
        i++;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(line[i])) {
        let j = i;
        while (j < len && /[0-9.]/.test(line[j])) j++;
        out += '<span class="tok-num">' + escapeHTML(line.slice(i, j)) + '</span>';
        i = j;
        continue;
      }

      // Words
      if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < len && /[a-zA-Z0-9_]/.test(line[j])) j++;
        const word = line.slice(i, j);
        const low = word.toLowerCase();
        let cls = '';
        if (['table', 'enum', 'tablegroup', 'ref', 'project', 'indexes', 'note', 'as'].includes(low)) {
          cls = 'tok-kw';
        } else if (
          [
            'pk',
            'primary',
            'key',
            'unique',
            'increment',
            'not',
            'null',
            'default',
            'headercolor',
            'color',
            'delete',
            'update',
            'cascade',
            'restrict',
            'database_type'
          ].includes(low)
        ) {
          cls = 'tok-attr';
        } else if (
          [
            'int',
            'integer',
            'bigint',
            'smallint',
            'varchar',
            'char',
            'text',
            'boolean',
            'bool',
            'timestamp',
            'timestamptz',
            'date',
            'time',
            'decimal',
            'numeric',
            'float',
            'double',
            'real',
            'uuid',
            'json',
            'jsonb',
            'bytea',
            'serial',
            'bigserial'
          ].includes(low)
        ) {
          cls = 'tok-type';
        }
        out += cls ? '<span class="' + cls + '">' + escapeHTML(word) + '</span>' : escapeHTML(word);
        i = j;
        continue;
      }

      out += escapeHTML(line[i]);
      i++;
    }

    return out;
  }

  function highlightDBML(text) {
    const lines = String(text || '').split('\n');
    const html = lines.map(highlightLine).join('\n') + '\n';
    return html;
  }

  function createEditorController(options) {
    const textarea = options.textarea;
    const highlightPre = options.highlightPre;
    const gutter = options.gutter;
    const cursorPosEl = options.cursorPosEl;
    const onChange = options.onChange;

    let errorLines = new Set();
    let currentFontSize = 14;

    function syncScroll() {
      highlightPre.scrollTop = textarea.scrollTop;
      highlightPre.scrollLeft = textarea.scrollLeft;
      gutter.scrollTop = textarea.scrollTop;
    }

    function updateGutterAndHighlight() {
      const val = textarea.value;
      highlightPre.innerHTML = highlightDBML(val);

      const lineCount = val.split('\n').length;
      let gutterHtml = '';
      for (let i = 1; i <= lineCount; i++) {
        const cls = errorLines.has(i) ? 'gutter-line is-error' : 'gutter-line';
        gutterHtml += '<div class="' + cls + '">' + i + '</div>';
      }
      gutter.innerHTML = gutterHtml;
      syncScroll();
    }

    function updateCursorStatus() {
      if (!cursorPosEl) return;
      const pos = textarea.selectionStart || 0;
      const before = textarea.value.slice(0, pos);
      const lines = before.split('\n');
      const ln = lines.length;
      const col = lines[lines.length - 1].length + 1;
      cursorPosEl.textContent = 'Ln ' + ln + ', Col ' + col;
    }

    function setErrors(errors) {
      errorLines = new Set((errors || []).map((e) => e.line));
      updateGutterAndHighlight();
    }

    function setValue(text, silent) {
      textarea.value = text;
      if (silent) {
        try {
          textarea.setSelectionRange(0, 0);
          textarea.scrollTop = 0;
        } catch (_e) {}
      }
      updateGutterAndHighlight();
      updateCursorStatus();
      if (!silent && onChange) onChange(textarea.value);
    }

    function getValue() {
      return textarea.value;
    }

    function setFontSize(px) {
      currentFontSize = Math.max(11, Math.min(24, Number(px) || 14));
      const lineHeight = Math.round(currentFontSize * 1.55);
      textarea.style.fontSize = currentFontSize + 'px';
      textarea.style.lineHeight = lineHeight + 'px';
      highlightPre.style.fontSize = currentFontSize + 'px';
      highlightPre.style.lineHeight = lineHeight + 'px';
      gutter.style.fontSize = Math.max(10, currentFontSize - 2) + 'px';
      gutter.style.lineHeight = lineHeight + 'px';
      updateGutterAndHighlight();
    }

    function jumpToLine(lineNum) {
      const lines = textarea.value.split('\n');
      const target = Math.max(1, Math.min(lines.length, Number(lineNum) || 1));
      let idx = 0;
      for (let i = 0; i < target - 1; i++) {
        idx += lines[i].length + 1;
      }
      textarea.focus();
      textarea.setSelectionRange(idx, idx + lines[target - 1].length);
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 21;
      textarea.scrollTop = Math.max(0, (target - 4) * lineHeight);
      syncScroll();
      updateCursorStatus();
    }

    textarea.addEventListener('input', () => {
      updateGutterAndHighlight();
      updateCursorStatus();
      if (onChange) onChange(textarea.value);
    });

    textarea.addEventListener('scroll', syncScroll);
    textarea.addEventListener('click', updateCursorStatus);
    textarea.addEventListener('keyup', updateCursorStatus);

    textarea.addEventListener('keydown', (e) => {
      // Tab / Shift+Tab indentation
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (start === end && !e.shiftKey) {
          textarea.value = val.slice(0, start) + '  ' + val.slice(end);
          textarea.setSelectionRange(start + 2, start + 2);
        } else {
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineEndIdx = val.indexOf('\n', end);
          const blockEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
          const block = val.slice(lineStart, blockEnd);
          const lines = block.split('\n');
          const modified = lines.map((l) => {
            if (e.shiftKey) return l.replace(/^  /, '');
            return '  ' + l;
          });
          const joined = modified.join('\n');
          textarea.value = val.slice(0, lineStart) + joined + val.slice(blockEnd);
          textarea.setSelectionRange(lineStart, lineStart + joined.length);
        }
        updateGutterAndHighlight();
        updateCursorStatus();
        if (onChange) onChange(textarea.value);
        return;
      }

      // Ctrl+/ or Cmd+/ comment toggle
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEndIdx = val.indexOf('\n', end);
        const blockEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
        const lines = val.slice(lineStart, blockEnd).split('\n');
        const allCommented = lines.every((l) => /^\s*\/\//.test(l) || l.trim() === '');
        const toggled = lines.map((l) => {
          if (l.trim() === '') return l;
          if (allCommented) return l.replace(/^(\s*)\/\/\s?/, '$1');
          return l.replace(/^(\s*)/, '$1// ');
        });
        const joined = toggled.join('\n');
        textarea.value = val.slice(0, lineStart) + joined + val.slice(blockEnd);
        textarea.setSelectionRange(lineStart, lineStart + joined.length);
        updateGutterAndHighlight();
        if (onChange) onChange(textarea.value);
        return;
      }

      // Gentle auto-pair for {, [, (
      const pairs = { '{': '}', '[': ']', '(': ')' };
      if (pairs[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start === end) {
          const nextChar = textarea.value[start] || '';
          if (nextChar === '' || nextChar === '\n' || nextChar === ' ' || nextChar === '\t') {
            e.preventDefault();
            const val = textarea.value;
            textarea.value = val.slice(0, start) + e.key + pairs[e.key] + val.slice(end);
            textarea.setSelectionRange(start + 1, start + 1);
            updateGutterAndHighlight();
            if (onChange) onChange(textarea.value);
          }
        }
      }
    });

    setFontSize(currentFontSize);

    return {
      setValue,
      getValue,
      setErrors,
      setFontSize,
      jumpToLine,
      refresh: updateGutterAndHighlight
    };
  }

  DBStudio.editor = {
    createEditorController,
    highlightDBML
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.editor;
  }
})(typeof window !== 'undefined' ? window : globalThis);
