(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});

  function tokenize(input) {
    const tokens = [];
    const len = input.length;
    let i = 0;
    let line = 1;
    let col = 1;

    function push(type, value, startLine, startCol, startIdx, endIdx) {
      tokens.push({ type, value, line: startLine, col: startCol, start: startIdx, end: endIdx });
    }

    while (i < len) {
      const ch = input[i];

      // Horizontal whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        i++;
        col++;
        continue;
      }

      // Newline
      if (ch === '\n') {
        push('NEWLINE', '\n', line, col, i, i + 1);
        i++;
        line++;
        col = 1;
        continue;
      }

      // Line comment //
      if (ch === '/' && input[i + 1] === '/') {
        while (i < len && input[i] !== '\n') {
          i++;
          col++;
        }
        continue;
      }

      // Block comment /* ... */
      if (ch === '/' && input[i + 1] === '*') {
        i += 2;
        col += 2;
        while (i < len && !(input[i] === '*' && input[i + 1] === '/')) {
          if (input[i] === '\n') {
            line++;
            col = 1;
          } else {
            col++;
          }
          i++;
        }
        if (i < len) {
          i += 2;
          col += 2;
        }
        continue;
      }

      // Triple single quote string '''...'''
      if (ch === "'" && input[i + 1] === "'" && input[i + 2] === "'") {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        i += 3;
        col += 3;
        let val = '';
        while (i < len && !(input[i] === "'" && input[i + 1] === "'" && input[i + 2] === "'")) {
          if (input[i] === '\\' && i + 1 < len) {
            val += input[i + 1];
            i += 2;
            col += 2;
            continue;
          }
          if (input[i] === '\n') {
            line++;
            col = 1;
          } else {
            col++;
          }
          val += input[i];
          i++;
        }
        if (i < len) {
          i += 3;
          col += 3;
        }
        push('STRING', val, startLine, startCol, startIdx, i);
        continue;
      }

      // Quoted strings: ', ", `
      if (ch === "'" || ch === '"' || ch === '`') {
        const quote = ch;
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        i++;
        col++;
        let val = '';
        while (i < len && input[i] !== quote) {
          if (input[i] === '\\' && i + 1 < len) {
            val += input[i + 1];
            i += 2;
            col += 2;
            continue;
          }
          if (input[i] === '\n') {
            line++;
            col = 1;
          } else {
            col++;
          }
          val += input[i];
          i++;
        }
        if (i < len) {
          i++;
          col++;
        }
        const tokType = quote === '`' ? 'EXPR' : quote === '"' ? 'DSTRING' : 'STRING';
        push(tokType, val, startLine, startCol, startIdx, i);
        continue;
      }

      // Hex color #abc or #aabbcc
      if (ch === '#') {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        let j = i + 1;
        while (j < len && /[0-9a-fA-F]/.test(input[j])) j++;
        const val = input.slice(i, j);
        col += j - i;
        i = j;
        push('COLOR', val, startLine, startCol, startIdx, i);
        continue;
      }

      // Two-char operator <>
      if (ch === '<' && input[i + 1] === '>') {
        push('SYMBOL', '<>', line, col, i, i + 2);
        i += 2;
        col += 2;
        continue;
      }

      // Single-char symbols
      if ('{}[]():,.<>-'.includes(ch)) {
        // Negative number like -1 when not used as standalone ref op
        if (ch === '-' && /[0-9]/.test(input[i + 1] || '')) {
          const prev = tokens[tokens.length - 1];
          if (prev && (prev.value === ':' || prev.value === ',' || prev.value === '(')) {
            const startLine = line;
            const startCol = col;
            const startIdx = i;
            let j = i + 1;
            while (j < len && /[0-9.]/.test(input[j])) j++;
            const val = input.slice(i, j);
            col += j - i;
            i = j;
            push('NUMBER', val, startLine, startCol, startIdx, i);
            continue;
          }
        }
        push('SYMBOL', ch, line, col, i, i + 1);
        i++;
        col++;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch)) {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        let j = i;
        while (j < len && /[0-9.]/.test(input[j])) j++;
        const val = input.slice(i, j);
        col += j - i;
        i = j;
        push('NUMBER', val, startLine, startCol, startIdx, i);
        continue;
      }

      // Identifiers / words
      if (/[a-zA-Z0-9_@$]/.test(ch)) {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        let j = i;
        while (j < len && /[a-zA-Z0-9_@$]/.test(input[j])) j++;
        const val = input.slice(i, j);
        col += j - i;
        i = j;
        push('IDENT', val, startLine, startCol, startIdx, i);
        continue;
      }

      // Fallback any other character
      push('SYMBOL', ch, line, col, i, i + 1);
      i++;
      col++;
    }

    push('EOF', '', line, col, len, len);
    return tokens;
  }

  function parseDBML(source) {
    const tokens = tokenize(source || '');
    let idx = 0;

    const project = { name: null, databaseType: null, note: null };
    const tables = [];
    const enums = [];
    const tableGroups = [];
    const rawRefs = [];
    const stickyNotes = [];
    const errors = [];
    const aliasMap = Object.create(null);

    function cur() {
      return tokens[idx] || tokens[tokens.length - 1];
    }

    function peek(offset) {
      return tokens[idx + (offset || 0)] || tokens[tokens.length - 1];
    }

    function advance() {
      const t = cur();
      if (idx < tokens.length - 1) idx++;
      return t;
    }

    function skipNewlines() {
      while (cur().type === 'NEWLINE') advance();
    }

    function skipToLineEnd() {
      while (cur().type !== 'NEWLINE' && cur().type !== 'EOF' && cur().value !== '}') {
        advance();
      }
      if (cur().type === 'NEWLINE') advance();
    }

    function addError(message, token) {
      const t = token || cur();
      errors.push({
        message,
        line: t ? t.line : 1,
        col: t ? t.col : 1
      });
    }

    function isNameToken(t) {
      return t.type === 'IDENT' || t.type === 'DSTRING' || t.type === 'STRING' || t.type === 'EXPR';
    }

    function readNamePart() {
      const t = cur();
      if (isNameToken(t)) {
        advance();
        return t.value;
      }
      return null;
    }

    // Reads optional schema.name -> { schema, name, fullName }
    function readQualifiedName() {
      const first = readNamePart();
      if (!first) return null;
      if (cur().value === '.') {
        advance();
        const second = readNamePart();
        if (!second) {
          addError('Esperado nome após "."', cur());
          return { schema: null, name: first, fullName: first };
        }
        return { schema: first, name: second, fullName: first + '.' + second };
      }
      return { schema: null, name: first, fullName: first };
    }

    // Reads table.col or schema.table.col or table.(col1, col2)
    function readRefEndpoint() {
      const parts = [];
      const first = readNamePart();
      if (!first) return null;
      parts.push(first);

      while (cur().value === '.') {
        advance();
        if (cur().value === '(') {
          advance();
          const cols = [];
          while (cur().value !== ')' && cur().type !== 'EOF' && cur().type !== 'NEWLINE') {
            if (cur().value === ',') {
              advance();
              continue;
            }
            const c = readNamePart();
            if (c) cols.push(c);
            else advance();
          }
          if (cur().value === ')') advance();
          if (parts.length === 1) {
            return { tableRef: parts[0], cols };
          }
          return { tableRef: parts[0] + '.' + parts[1], cols };
        }
        const next = readNamePart();
        if (!next) break;
        parts.push(next);
      }

      if (parts.length === 2) {
        return { tableRef: parts[0], cols: [parts[1]] };
      }
      if (parts.length >= 3) {
        return { tableRef: parts[0] + '.' + parts[1], cols: [parts[2]] };
      }
      return null;
    }

    function readSettingValue() {
      const t = cur();
      if (t.type === 'STRING' || t.type === 'DSTRING' || t.type === 'EXPR' || t.type === 'COLOR' || t.type === 'NUMBER') {
        advance();
        return t.value;
      }
      if (t.type === 'IDENT') {
        let val = advance().value;
        // Handle multi-word values like `no action` or `set null`
        while (
          cur().type === 'IDENT' &&
          cur().value !== ',' &&
          cur().value !== ']'
        ) {
          val += ' ' + advance().value;
        }
        return val;
      }
      return null;
    }

    function parseSettingsBlock(context) {
      // Assumes cur() is '['
      const settings = {
        pk: false,
        notNull: false,
        unique: false,
        increment: false,
        defaultValue: null,
        note: null,
        headerColor: null,
        color: null,
        deleteAction: null,
        updateAction: null,
        inlineRefs: []
      };
      if (cur().value !== '[') return settings;
      advance(); // consume '['

      while (cur().value !== ']' && cur().type !== 'EOF') {
        if (cur().type === 'NEWLINE' || cur().value === ',') {
          advance();
          continue;
        }
        if (cur().value === '}') break;

        const keyTok = cur();
        if (!isNameToken(keyTok)) {
          addError('Configuração inesperada em [...] : "' + keyTok.value + '"', keyTok);
          advance();
          continue;
        }
        const key = advance().value.toLowerCase();

        // Multi-word flags: primary key, not null
        if (key === 'primary' && cur().type === 'IDENT' && cur().value.toLowerCase() === 'key') {
          advance();
          settings.pk = true;
          continue;
        }
        if (key === 'not' && cur().type === 'IDENT' && cur().value.toLowerCase() === 'null') {
          advance();
          settings.notNull = true;
          continue;
        }
        if (key === 'pk') {
          settings.pk = true;
          continue;
        }
        if (key === 'unique') {
          settings.unique = true;
          continue;
        }
        if (key === 'increment') {
          settings.increment = true;
          continue;
        }
        if (key === 'null') {
          settings.notNull = false;
          continue;
        }

        // Key: value
        if (cur().value === ':') {
          advance();
          if (key === 'ref') {
            let op = '>';
            if (cur().value === '>' || cur().value === '<' || cur().value === '-' || cur().value === '<>') {
              op = advance().value;
            }
            const target = readRefEndpoint();
            if (target) {
              settings.inlineRefs.push({
                op,
                target,
                line: keyTok.line
              });
            } else {
              addError('Referência inline inválida após "ref:"', cur());
            }
          } else {
            const val = readSettingValue();
            if (key === 'default') settings.defaultValue = val;
            else if (key === 'note') settings.note = val;
            else if (key === 'headercolor') settings.headerColor = val;
            else if (key === 'color') settings.color = val;
            else if (key === 'delete') settings.deleteAction = val;
            else if (key === 'update') settings.updateAction = val;
          }
          continue;
        }

        // Unknown flag without ':'
        if (context === 'index') continue;
      }

      if (cur().value === ']') advance();
      return settings;
    }

    function parseNoteStatement() {
      // Assumes 'Note' token just consumed
      let val = null;
      if (cur().value === ':') {
        advance();
        val = readSettingValue();
      } else if (cur().value === '{') {
        advance();
        skipNewlines();
        val = readSettingValue();
        skipNewlines();
        if (cur().value === '}') advance();
      }
      return val;
    }

    function parseBraceBlockSkip() {
      if (cur().value !== '{') return;
      advance();
      let depth = 1;
      while (cur().type !== 'EOF' && depth > 0) {
        if (cur().value === '{') depth++;
        else if (cur().value === '}') depth--;
        advance();
      }
    }

    function parseProject() {
      const name = isNameToken(cur()) ? advance().value : null;
      if (name) project.name = name;
      skipNewlines();
      if (cur().value !== '{') return;
      advance();
      while (cur().value !== '}' && cur().type !== 'EOF') {
        skipNewlines();
        if (cur().value === '}') break;
        const k = readNamePart();
        if (!k) {
          advance();
          continue;
        }
        const kl = k.toLowerCase();
        if (kl === 'note') {
          project.note = parseNoteStatement();
        } else if (cur().value === ':') {
          advance();
          const v = readSettingValue();
          if (kl === 'database_type') project.databaseType = v;
        } else {
          skipToLineEnd();
        }
      }
      if (cur().value === '}') advance();
    }

    function parseIndexesBlock(table) {
      if (cur().value !== '{') return;
      advance();
      while (cur().value !== '}' && cur().type !== 'EOF') {
        skipNewlines();
        if (cur().value === '}') break;
        const cols = [];
        if (cur().value === '(') {
          advance();
          while (cur().value !== ')' && cur().type !== 'EOF' && cur().type !== 'NEWLINE') {
            if (cur().value === ',') {
              advance();
              continue;
            }
            const c = readNamePart();
            if (c) cols.push(c);
            else advance();
          }
          if (cur().value === ')') advance();
        } else {
          const c = readNamePart();
          if (c) cols.push(c);
        }
        let settings = { pk: false, unique: false };
        if (cur().value === '[') {
          settings = parseSettingsBlock('index');
        }
        if (cols.length > 0) {
          table.indexes.push({ cols, unique: settings.unique, pk: settings.pk });
          if (settings.pk && cols.length === 1) {
            const found = table.columns.find((col) => col.name === cols[0]);
            if (found) found.isPk = true;
          }
          if (settings.unique && cols.length === 1) {
            const found = table.columns.find((col) => col.name === cols[0]);
            if (found) found.isUnique = true;
          }
        }
        skipToLineEnd();
      }
      if (cur().value === '}') advance();
    }

    function parseTable(startToken) {
      const qName = readQualifiedName();
      if (!qName) {
        addError('Esperado nome da tabela após "Table"', cur());
        skipToLineEnd();
        return;
      }

      let alias = null;
      if (cur().type === 'IDENT' && cur().value.toLowerCase() === 'as') {
        advance();
        alias = readNamePart();
        if (alias) {
          aliasMap[alias] = qName.fullName;
        }
      }

      let tableSettings = { headerColor: null, note: null };
      if (cur().value === '[') {
        tableSettings = parseSettingsBlock('table');
      }

      skipNewlines();
      if (cur().value !== '{') {
        addError('Esperado "{" para iniciar a definição da tabela "' + qName.fullName + '"', cur());
        return;
      }
      const openBraceTok = advance();

      const table = {
        schema: qName.schema,
        name: qName.name,
        fullName: qName.fullName,
        alias,
        headerColor: tableSettings.headerColor,
        note: tableSettings.note,
        columns: [],
        indexes: [],
        line: startToken.line,
        headerStart: startToken.start,
        openBracePos: openBraceTok.start
      };

      while (cur().value !== '}' && cur().type !== 'EOF') {
        skipNewlines();
        if (cur().value === '}') break;

        const tok = cur();

        // Table Note: Note: '...' or Note { '...' }
        if (
          tok.type === 'IDENT' &&
          tok.value.toLowerCase() === 'note' &&
          (peek(1).value === ':' || peek(1).value === '{')
        ) {
          advance();
          table.note = parseNoteStatement();
          continue;
        }

        // Table Indexes { ... }
        if (
          tok.type === 'IDENT' &&
          tok.value.toLowerCase() === 'indexes' &&
          (peek(1).value === '{' || (peek(1).type === 'NEWLINE' && peek(2).value === '{'))
        ) {
          advance();
          skipNewlines();
          parseIndexesBlock(table);
          continue;
        }

        // Column definition: col_name col_type... [settings]
        const colName = readNamePart();
        if (!colName) {
          addError('Sintaxe inválida dentro da tabela "' + table.fullName + '"', cur());
          skipToLineEnd();
          continue;
        }

        // Collect column type tokens until [, NEWLINE, }, EOF
        const typeParts = [];
        let parenDepth = 0;
        while (cur().type !== 'EOF' && cur().type !== 'NEWLINE' && cur().value !== '}') {
          if (cur().value === '[' && parenDepth === 0) {
            // Check for array suffix []
            if (peek(1).value === ']') {
              advance();
              advance();
              typeParts.push('[]');
              continue;
            }
            break;
          }
          const t = advance();
          if (t.value === '(') parenDepth++;
          else if (t.value === ')' && parenDepth > 0) parenDepth--;
          typeParts.push(t.value);
        }

        let colType = '';
        for (let i = 0; i < typeParts.length; i++) {
          const part = typeParts[i];
          const prev = i > 0 ? typeParts[i - 1] : '';
          if (
            i === 0 ||
            part === '(' ||
            part === ')' ||
            part === '[]' ||
            part === ',' ||
            part === '.' ||
            prev === '(' ||
            prev === '.'
          ) {
            colType += part;
          } else {
            colType += ' ' + part;
          }
        }

        if (!colType) {
          addError('Tipo ausente para a coluna "' + colName + '" na tabela "' + table.fullName + '"', tok);
          colType = 'unknown';
        }

        let colSettings = {
          pk: false,
          notNull: false,
          unique: false,
          increment: false,
          defaultValue: null,
          note: null,
          inlineRefs: []
        };

        if (cur().value === '[') {
          colSettings = parseSettingsBlock('column');
        }

        const column = {
          name: colName,
          type: colType,
          isPk: colSettings.pk,
          isFk: false,
          isNotNull: colSettings.notNull,
          isUnique: colSettings.unique,
          isIncrement: colSettings.increment,
          defaultValue: colSettings.defaultValue,
          note: colSettings.note,
          line: tok.line
        };
        table.columns.push(column);

        // Register inline refs
        for (const r of colSettings.inlineRefs) {
          rawRefs.push({
            name: null,
            from: { tableRef: table.fullName, cols: [colName] },
            op: r.op,
            to: r.target,
            deleteAction: null,
            updateAction: null,
            line: r.line
          });
        }

        skipToLineEnd();
      }

      if (cur().value === '}') {
        advance();
      } else {
        addError('Esperado "}" ao final da tabela "' + table.fullName + '"', cur());
      }

      tables.push(table);
    }

    function parseEnum(startToken) {
      const qName = readQualifiedName();
      if (!qName) {
        addError('Esperado nome do Enum', cur());
        skipToLineEnd();
        return;
      }
      skipNewlines();
      if (cur().value !== '{') {
        addError('Esperado "{" no Enum "' + qName.fullName + '"', cur());
        return;
      }
      advance();

      const enumObj = {
        schema: qName.schema,
        name: qName.name,
        fullName: qName.fullName,
        values: [],
        line: startToken.line
      };

      while (cur().value !== '}' && cur().type !== 'EOF') {
        skipNewlines();
        if (cur().value === '}') break;
        const valName = readNamePart();
        if (!valName) {
          advance();
          continue;
        }
        let note = null;
        if (cur().value === '[') {
          const st = parseSettingsBlock('enum');
          note = st.note;
        }
        enumObj.values.push({ name: valName, note });
        skipToLineEnd();
      }
      if (cur().value === '}') advance();
      enums.push(enumObj);
    }

    function parseTableGroup(startToken) {
      let groupName = null;
      if (isNameToken(cur())) {
        groupName = advance().value;
      }
      let settings = { color: null, note: null };
      if (cur().value === '[') {
        settings = parseSettingsBlock('group');
      }
      skipNewlines();
      if (cur().value !== '{') {
        addError('Esperado "{" no TableGroup', cur());
        return;
      }
      advance();

      const group = {
        name: groupName || 'Group ' + (tableGroups.length + 1),
        color: settings.color || '#3b82f6',
        note: settings.note,
        tables: [],
        line: startToken.line
      };

      while (cur().value !== '}' && cur().type !== 'EOF') {
        skipNewlines();
        if (cur().value === '}') break;

        // Support Note inside TableGroup
        if (
          cur().type === 'IDENT' &&
          cur().value.toLowerCase() === 'note' &&
          (peek(1).value === ':' || peek(1).value === '{')
        ) {
          advance();
          group.note = parseNoteStatement();
          continue;
        }

        // Support optional "Table" keyword inside TableGroup (TruDan/dbdiagram-oss style)
        if (
          cur().type === 'IDENT' &&
          cur().value.toLowerCase() === 'table' &&
          isNameToken(peek(1))
        ) {
          advance();
        }

        const qName = readQualifiedName();
        if (qName) {
          group.tables.push(qName.fullName);
        } else {
          advance();
        }
        skipToLineEnd();
      }
      if (cur().value === '}') advance();
      tableGroups.push(group);
    }

    function parseRefStatement(startToken) {
      let name = null;

      // Check for: Ref name: ... OR Ref: ... OR Ref name { ... } OR Ref { ... }
      if (cur().value !== ':' && cur().value !== '{') {
        // Could be `Ref name: ...` or `Ref name { ... }` or `Ref left > right`
        if (isNameToken(cur()) && (peek(1).value === ':' || peek(1).value === '{')) {
          name = advance().value;
        }
      }

      if (cur().value === ':') {
        advance();
        parseRefBody(name, startToken.line);
      } else if (cur().value === '{') {
        advance();
        while (cur().value !== '}' && cur().type !== 'EOF') {
          skipNewlines();
          if (cur().value === '}') break;
          parseRefBody(name, cur().line);
        }
        if (cur().value === '}') advance();
      } else {
        parseRefBody(name, startToken.line);
      }
    }

    function parseRefBody(name, lineNum) {
      skipNewlines();
      const left = readRefEndpoint();
      if (!left) {
        addError('Referência (Ref) inválida ou incompleta', cur());
        skipToLineEnd();
        return;
      }
      const opTok = cur();
      if (opTok.value !== '>' && opTok.value !== '<' && opTok.value !== '-' && opTok.value !== '<>') {
        addError('Esperado operador de relação (>, <, -, <>) na Ref', opTok);
        skipToLineEnd();
        return;
      }
      const op = advance().value;
      const right = readRefEndpoint();
      if (!right) {
        addError('Tabela/coluna de destino inválida na Ref', cur());
        skipToLineEnd();
        return;
      }
      let settings = { deleteAction: null, updateAction: null, color: null };
      if (cur().value === '[') {
        settings = parseSettingsBlock('ref');
      }
      rawRefs.push({
        name,
        from: left,
        op,
        to: right,
        deleteAction: settings.deleteAction,
        updateAction: settings.updateAction,
        color: settings.color,
        line: lineNum
      });
      skipToLineEnd();
    }

    // Top-level parse loop
    while (cur().type !== 'EOF') {
      skipNewlines();
      if (cur().type === 'EOF') break;

      const tok = cur();
      if (tok.type === 'IDENT') {
        const kw = tok.value.toLowerCase();
        if (kw === 'project') {
          advance();
          parseProject();
          continue;
        }
        if (kw === 'table') {
          advance();
          parseTable(tok);
          continue;
        }
        if (kw === 'enum') {
          advance();
          parseEnum(tok);
          continue;
        }
        if (kw === 'tablegroup') {
          advance();
          parseTableGroup(tok);
          continue;
        }
        if (kw === 'ref') {
          advance();
          parseRefStatement(tok);
          continue;
        }
        if (kw === 'note') {
          advance();
          const noteName = isNameToken(cur()) ? advance().value : 'Note';
          const text = parseNoteStatement();
          stickyNotes.push({ name: noteName, text, line: tok.line });
          continue;
        }
      }

      addError('Bloco ou comando desconhecido: "' + tok.value + '"', tok);
      if (cur().value === '{') {
        parseBraceBlockSkip();
      } else {
        skipToLineEnd();
      }
    }

    // Build lookup map for tables (by fullName, bare name, and alias)
    const tableByFull = Object.create(null);
    const tableByBare = Object.create(null);
    for (const t of tables) {
      tableByFull[t.fullName] = t;
      if (!tableByBare[t.name]) {
        tableByBare[t.name] = t;
      }
    }

    function resolveTable(refName) {
      if (!refName) return null;
      if (aliasMap[refName] && tableByFull[aliasMap[refName]]) {
        return tableByFull[aliasMap[refName]];
      }
      if (tableByFull[refName]) return tableByFull[refName];
      if (tableByBare[refName]) return tableByBare[refName];
      return null;
    }

    // Resolve TableGroup table members to canonical fullName
    for (const g of tableGroups) {
      g.resolvedTables = [];
      for (const name of g.tables) {
        const tbl = resolveTable(name);
        if (tbl && !g.resolvedTables.includes(tbl.fullName)) {
          g.resolvedTables.push(tbl.fullName);
        }
      }
    }

    // Resolve Refs & mark FK columns
    const refs = [];
    for (let i = 0; i < rawRefs.length; i++) {
      const r = rawRefs[i];
      const fromTable = resolveTable(r.from.tableRef);
      const toTable = resolveTable(r.to.tableRef);

      if (!fromTable) {
        addError('Tabela não encontrada na Ref: "' + r.from.tableRef + '"', { line: r.line, col: 1 });
        continue;
      }
      if (!toTable) {
        addError('Tabela não encontrada na Ref: "' + r.to.tableRef + '"', { line: r.line, col: 1 });
        continue;
      }

      const fromColName = r.from.cols[0];
      const toColName = r.to.cols[0];
      const fromCol = fromTable.columns.find((c) => c.name === fromColName);
      const toCol = toTable.columns.find((c) => c.name === toColName);

      if (!fromCol) {
        addError(
          'Coluna "' + fromColName + '" não encontrada em "' + fromTable.fullName + '"',
          { line: r.line, col: 1 }
        );
        continue;
      }
      if (!toCol) {
        addError(
          'Coluna "' + toColName + '" não encontrada em "' + toTable.fullName + '"',
          { line: r.line, col: 1 }
        );
        continue;
      }

      // Mark FK flags
      if (r.op === '>') {
        fromCol.isFk = true;
      } else if (r.op === '<') {
        toCol.isFk = true;
      } else if (r.op === '-') {
        if (!fromCol.isPk) fromCol.isFk = true;
        else if (!toCol.isPk) toCol.isFk = true;
      }

      const key =
        fromTable.fullName +
        '.' +
        fromCol.name +
        r.op +
        toTable.fullName +
        '.' +
        toCol.name +
        '#' +
        i;

      refs.push({
        id: 'ref_' + i,
        key,
        name: r.name,
        fromTable: fromTable.fullName,
        fromColumn: fromCol.name,
        fromCols: r.from.cols,
        op: r.op,
        toTable: toTable.fullName,
        toColumn: toCol.name,
        toCols: r.to.cols,
        deleteAction: r.deleteAction,
        updateAction: r.updateAction,
        color: r.color,
        line: r.line
      });
    }

    // Mark columns whose type matches an Enum
    const enumMap = Object.create(null);
    for (const en of enums) {
      enumMap[en.fullName] = en;
      enumMap[en.name] = en;
    }
    for (const t of tables) {
      for (const c of t.columns) {
        const baseType = c.type.replace(/\[\]$/, '').trim();
        if (enumMap[baseType]) {
          c.enumRef = enumMap[baseType].fullName;
        }
      }
    }

    return {
      project,
      tables,
      enums,
      tableGroups,
      refs,
      stickyNotes,
      errors
    };
  }

  /**
   * Comment-preserving clean DBML formatter.
   */
  function formatDBML(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let indent = 0;
    let inMultilineComment = false;
    let inTripleQuote = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (inTripleQuote) {
        out.push(raw);
        if (trimmed.includes("'''")) inTripleQuote = false;
        continue;
      }
      if (inMultilineComment) {
        out.push(raw);
        if (trimmed.includes('*/')) inMultilineComment = false;
        continue;
      }

      if (trimmed === '') {
        if (out.length > 0 && out[out.length - 1] !== '') {
          out.push('');
        }
        continue;
      }

      if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
        inMultilineComment = true;
        out.push('  '.repeat(indent) + trimmed);
        continue;
      }

      if (trimmed.includes("'''") && trimmed.split("'''").length % 2 === 0) {
        inTripleQuote = true;
      }

      const startsClosing = trimmed.startsWith('}');
      const currentIndent = startsClosing ? Math.max(0, indent - 1) : indent;
      out.push('  '.repeat(currentIndent) + trimmed);

      // Update indent ignoring quoted strings and comments
      let clean = trimmed.replace(/\/\/.*$/, '').replace(/'[^']*'|`[^`]*`|"[^"]*"/g, '');
      const opens = (clean.match(/\{/g) || []).length;
      const closes = (clean.match(/\}/g) || []).length;
      indent = Math.max(0, indent + opens - closes);
    }

    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  /**
   * Updates or inserts [headercolor: #hex] on a specific Table in DBML source.
   */
  function updateTableHeaderColor(source, tableFullName, newColor) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const ast = parseDBML(source);
    const tbl = ast.tables.find((t) => t.fullName === tableFullName);
    if (!tbl) return source;

    const lineIdx = Math.max(0, tbl.line - 1);
    let line = lines[lineIdx] || '';

    // Check if headercolor already exists on that line
    if (/headercolor\s*:\s*(#[0-9a-fA-F]{3,8}|'[^']*'|"[^"]*")/i.test(line)) {
      if (newColor) {
        line = line.replace(
          /(headercolor\s*:\s*)(#[0-9a-fA-F]{3,8}|'[^']*'|"[^"]*")/i,
          '$1' + newColor
        );
      } else {
        line = line
          .replace(/,?\s*headercolor\s*:\s*(#[0-9a-fA-F]{3,8}|'[^']*'|"[^"]*")\s*,?/i, (m) =>
            m.startsWith(',') && m.endsWith(',') ? ', ' : ''
          )
          .replace(/\[\s*\]/g, '')
          .replace(/\s+\{/g, ' {');
      }
      lines[lineIdx] = line;
      return lines.join('\n');
    }

    if (!newColor) return source;

    // Insert into existing [settings] before '{' or add [headercolor: ...] before '{'
    const braceIdx = line.indexOf('{');
    const beforeBrace = braceIdx >= 0 ? line.slice(0, braceIdx) : line;
    const afterBrace = braceIdx >= 0 ? line.slice(braceIdx) : '';

    if (/\]\s*$/.test(beforeBrace)) {
      const updatedBefore = beforeBrace.replace(/\]\s*$/, ', headercolor: ' + newColor + '] ');
      lines[lineIdx] = updatedBefore + afterBrace;
    } else {
      lines[lineIdx] = beforeBrace.replace(/\s*$/, '') + ' [headercolor: ' + newColor + '] ' + afterBrace;
    }
    return lines.join('\n');
  }

  DBStudio.parser = {
    tokenize,
    parseDBML,
    formatDBML,
    updateTableHeaderColor
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.parser;
  }
})(typeof window !== 'undefined' ? window : globalThis);
