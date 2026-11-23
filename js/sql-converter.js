(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});

  function quoteId(name, dialect) {
    if (!name) return '';
    const parts = name.split('.');
    return parts
      .map((p) => {
        if (dialect === 'mysql') return '`' + p.replace(/`/g, '') + '`';
        return '"' + p.replace(/"/g, '') + '"';
      })
      .join('.');
  }

  function escapeSqlString(str) {
    return "'" + String(str).replace(/'/g, "''") + "'";
  }

  function formatDefaultValue(val, colType) {
    if (val === null || val === undefined) return '';
    const trimmed = String(val).trim();
    if (/^(now\(\)|current_timestamp|true|false|null)$/i.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.includes('(') && trimmed.includes(')')) {
      return trimmed;
    }
    return escapeSqlString(trimmed);
  }

  function mapTypeForDialect(type, dialect, enumMap) {
    const clean = (type || 'varchar').trim();
    const enumObj = enumMap[clean] || enumMap[clean.replace(/\[\]$/, '')];
    if (enumObj) {
      if (dialect === 'mysql') {
        const vals = enumObj.values.map((v) => escapeSqlString(v.name)).join(', ');
        return 'ENUM(' + vals + ')';
      }
      if (dialect === 'sqlite') {
        return 'TEXT';
      }
      return quoteId(enumObj.fullName, dialect);
    }

    const low = clean.toLowerCase();
    if (dialect === 'mysql') {
      if (low === 'integer' || low === 'int') return 'INT';
      if (low === 'bigint') return 'BIGINT';
      if (low === 'boolean' || low === 'bool') return 'TINYINT(1)';
      if (low === 'uuid') return 'CHAR(36)';
      if (low === 'timestamp') return 'TIMESTAMP';
      if (low === 'varchar') return 'VARCHAR(255)';
      return clean.toUpperCase();
    }
    if (dialect === 'sqlite') {
      if (low === 'integer' || low === 'int' || low === 'bigint' || low === 'smallint') return 'INTEGER';
      if (low === 'boolean' || low === 'bool') return 'INTEGER';
      if (low.startsWith('decimal') || low.startsWith('numeric') || low === 'float' || low === 'double') return 'REAL';
      return 'TEXT';
    }
    // PostgreSQL
    if (low === 'varchar') return 'varchar(255)';
    return clean;
  }

  function toSQL(ast, dialect) {
    const d = dialect || 'postgresql';
    const lines = [];
    const enumMap = Object.create(null);
    for (const en of ast.enums || []) {
      enumMap[en.fullName] = en;
      enumMap[en.name] = en;
    }

    lines.push('-- Gerado por DBDiagram OSS Studio (' + d.toUpperCase() + ')');
    lines.push('');

    if (d === 'postgresql' && ast.enums && ast.enums.length > 0) {
      for (const en of ast.enums) {
        const vals = en.values.map((v) => escapeSqlString(v.name)).join(', ');
        lines.push('CREATE TYPE ' + quoteId(en.fullName, d) + ' AS ENUM (' + vals + ');');
      }
      lines.push('');
    }

    // Group refs per child table for SQLite inline FKs
    const sqliteFksByTable = Object.create(null);
    if (d === 'sqlite') {
      for (const r of ast.refs || []) {
        let childTable = r.fromTable;
        let childCols = r.fromCols;
        let parentTable = r.toTable;
        let parentCols = r.toCols;
        if (r.op === '<') {
          childTable = r.toTable;
          childCols = r.toCols;
          parentTable = r.fromTable;
          parentCols = r.fromCols;
        }
        if (!sqliteFksByTable[childTable]) sqliteFksByTable[childTable] = [];
        sqliteFksByTable[childTable].push({ childCols, parentTable, parentCols, r });
      }
    }

    const pgComments = [];

    for (const table of ast.tables || []) {
      const pkCols = table.columns.filter((c) => c.isPk);
      const multiPk = pkCols.length > 1;
      const colDefs = [];

      for (const col of table.columns) {
        let def = '  ' + quoteId(col.name, d) + ' ';
        const mappedType = mapTypeForDialect(col.type, d, enumMap);

        if (col.isIncrement && d === 'postgresql') {
          def += col.type.toLowerCase() === 'bigint' ? 'BIGSERIAL' : 'SERIAL';
        } else {
          def += mappedType;
        }

        if (d === 'sqlite') {
          const enObj = enumMap[col.type] || enumMap[col.type.replace(/\[\]$/, '')];
          if (enObj && enObj.values.length > 0) {
            const vals = enObj.values.map((v) => escapeSqlString(v.name)).join(', ');
            def += ' CHECK (' + quoteId(col.name, d) + ' IN (' + vals + '))';
          }
        }

        if (col.isPk && !multiPk) {
          def += ' PRIMARY KEY';
          if (col.isIncrement && d === 'sqlite') def += ' AUTOINCREMENT';
        }
        if (col.isIncrement && d === 'mysql') {
          def += ' AUTO_INCREMENT';
        }
        if (col.isNotNull && !col.isPk) {
          def += ' NOT NULL';
        }
        if (col.isUnique && !col.isPk) {
          def += ' UNIQUE';
        }
        if (col.defaultValue !== null && col.defaultValue !== undefined) {
          def += ' DEFAULT ' + formatDefaultValue(col.defaultValue, col.type);
        }
        if (col.note && d === 'mysql') {
          def += ' COMMENT ' + escapeSqlString(col.note);
        }
        if (col.note && d === 'postgresql') {
          pgComments.push(
            'COMMENT ON COLUMN ' +
              quoteId(table.fullName, d) +
              '.' +
              quoteId(col.name, d) +
              ' IS ' +
              escapeSqlString(col.note) +
              ';'
          );
        }
        colDefs.push(def);
      }

      if (multiPk) {
        colDefs.push(
          '  PRIMARY KEY (' + pkCols.map((c) => quoteId(c.name, d)).join(', ') + ')'
        );
      }

      if (d === 'sqlite' && sqliteFksByTable[table.fullName]) {
        for (const fk of sqliteFksByTable[table.fullName]) {
          let fkLine =
            '  FOREIGN KEY (' +
            fk.childCols.map((c) => quoteId(c, d)).join(', ') +
            ') REFERENCES ' +
            quoteId(fk.parentTable, d) +
            ' (' +
            fk.parentCols.map((c) => quoteId(c, d)).join(', ') +
            ')';
          if (fk.r.deleteAction) fkLine += ' ON DELETE ' + fk.r.deleteAction.toUpperCase();
          if (fk.r.updateAction) fkLine += ' ON UPDATE ' + fk.r.updateAction.toUpperCase();
          colDefs.push(fkLine);
        }
      }

      let stmt = 'CREATE TABLE ' + quoteId(table.fullName, d) + ' (\n' + colDefs.join(',\n') + '\n)';
      if (table.note && d === 'mysql') {
        stmt += ' COMMENT=' + escapeSqlString(table.note);
      }
      stmt += ';';
      lines.push(stmt);
      lines.push('');

      if (table.note && d === 'postgresql') {
        pgComments.push(
          'COMMENT ON TABLE ' + quoteId(table.fullName, d) + ' IS ' + escapeSqlString(table.note) + ';'
        );
      }

      if (table.indexes && table.indexes.length > 0) {
        for (let idx = 0; idx < table.indexes.length; idx++) {
          const index = table.indexes[idx];
          if (index.pk) continue;
          const idxName = 'idx_' + table.name + '_' + index.cols.join('_');
          const uniq = index.unique ? 'UNIQUE ' : '';
          lines.push(
            'CREATE ' +
              uniq +
              'INDEX ' +
              quoteId(idxName, d) +
              ' ON ' +
              quoteId(table.fullName, d) +
              ' (' +
              index.cols.map((c) => quoteId(c, d)).join(', ') +
              ');'
          );
        }
        lines.push('');
      }
    }

    if (d !== 'sqlite' && ast.refs && ast.refs.length > 0) {
      for (const r of ast.refs) {
        if (r.op === '<>') continue;
        let childTable = r.fromTable;
        let childCols = r.fromCols;
        let parentTable = r.toTable;
        let parentCols = r.toCols;
        if (r.op === '<') {
          childTable = r.toTable;
          childCols = r.toCols;
          parentTable = r.fromTable;
          parentCols = r.fromCols;
        }
        let alter =
          'ALTER TABLE ' +
          quoteId(childTable, d) +
          ' ADD FOREIGN KEY (' +
          childCols.map((c) => quoteId(c, d)).join(', ') +
          ') REFERENCES ' +
          quoteId(parentTable, d) +
          ' (' +
          parentCols.map((c) => quoteId(c, d)).join(', ') +
          ')';
        if (r.deleteAction) alter += ' ON DELETE ' + r.deleteAction.toUpperCase();
        if (r.updateAction) alter += ' ON UPDATE ' + r.updateAction.toUpperCase();
        alter += ';';
        lines.push(alter);
      }
      lines.push('');
    }

    if (d === 'postgresql' && pgComments.length > 0) {
      lines.push(...pgComments);
      lines.push('');
    }

    return lines.join('\n').trim() + '\n';
  }

  function unquoteId(id) {
    return (id || '').trim().replace(/^[`"\[]|[`"\]]$/g, '');
  }

  function splitTopLevelCommas(str) {
    const parts = [];
    let current = '';
    let paren = 0;
    let inQuote = null;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inQuote) {
        current += ch;
        if (ch === inQuote && str[i - 1] !== '\\') inQuote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inQuote = ch;
        current += ch;
        continue;
      }
      if (ch === '(') paren++;
      else if (ch === ')' && paren > 0) paren--;
      if (ch === ',' && paren === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function fromSQL(sqlInput) {
    const raw = String(sqlInput || '')
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const enumBlocks = [];
    const tableBlocks = [];
    const alterRefs = [];

    // 1. Parse CREATE TYPE ... AS ENUM (...)
    const enumRe = /CREATE\s+TYPE\s+([^\s(]+)\s+AS\s+ENUM\s*\(([^)]+)\)\s*;?/gi;
    let m;
    while ((m = enumRe.exec(raw)) !== null) {
      const name = m[1].split('.').map(unquoteId).join('.');
      const vals = splitTopLevelCommas(m[2]).map((v) => v.trim().replace(/^'|'$/g, ''));
      enumBlocks.push({ name, vals });
    }

    // 2. Parse CREATE TABLE ... (...)
    const tableHeaderRe = /CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[\]\w.]+)\s*\(/gi;
    while ((m = tableHeaderRe.exec(raw)) !== null) {
      const tableName = m[1].split('.').map(unquoteId).join('.');
      let pos = tableHeaderRe.lastIndex;
      let depth = 1;
      let inQuote = null;
      while (pos < raw.length && depth > 0) {
        const ch = raw[pos];
        if (inQuote) {
          if (ch === inQuote && raw[pos - 1] !== '\\') inQuote = null;
        } else {
          if (ch === "'" || ch === '"' || ch === '`') inQuote = ch;
          else if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        pos++;
      }
      const body = raw.slice(tableHeaderRe.lastIndex, pos - 1);
      const items = splitTopLevelCommas(body);
      const cols = [];
      const pkConstraintCols = [];
      const uniqueConstraintCols = [];
      const inlineRefs = [];

      for (const item of items) {
        const upper = item.toUpperCase().trim();
        if (/^(CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(/i.test(upper)) {
          const pMatch = item.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
          if (pMatch) {
            pMatch[1].split(',').forEach((c) => pkConstraintCols.push(unquoteId(c)));
          }
          continue;
        }
        if (/^(CONSTRAINT\s+\S+\s+)?UNIQUE\s*(?:KEY|INDEX)?\s*(?:\S+\s*)?\(/i.test(upper)) {
          const uMatch = item.match(/\(([^)]+)\)/);
          if (uMatch) {
            const uCols = uMatch[1].split(',').map((c) => unquoteId(c));
            if (uCols.length === 1) uniqueConstraintCols.push(uCols[0]);
          }
          continue;
        }
        if (/^(CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(/i.test(upper)) {
          const fkMatch = item.match(
            /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([`"\[\]\w.]+)\s*\(([^)]+)\)/i
          );
          if (fkMatch) {
            const fromCol = unquoteId(fkMatch[1].split(',')[0]);
            const toTbl = fkMatch[2].split('.').map(unquoteId).join('.');
            const toCol = unquoteId(fkMatch[3].split(',')[0]);
            inlineRefs.push({ fromTable: tableName, fromCol, toTable: toTbl, toCol });
          }
          continue;
        }
        if (/^(KEY|INDEX|FULLTEXT|CHECK)\b/i.test(upper)) {
          continue;
        }

        // Column line
        const colMatch = item.match(/^([`"\[\]\w]+)\s+([^\s(]+(?:\([^)]+\))?(?:\s+(?:without|with)\s+time\s+zone|\s+varying)?(?:\[\])?)(.*)$/i);
        if (!colMatch) continue;

        const colName = unquoteId(colMatch[1]);
        let colType = colMatch[2].trim().replace(/\s+/g, ' ');
        const rest = colMatch[3] || '';
        const settings = [];

        if (/PRIMARY\s+KEY/i.test(rest)) settings.push('pk');
        if (/(AUTO_INCREMENT|AUTOINCREMENT|GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY)/i.test(rest)) {
          settings.push('increment');
        }
        if (/^(serial|bigserial|smallserial)$/i.test(colType)) {
          settings.push('increment');
          colType = colType.toLowerCase() === 'bigserial' ? 'bigint' : 'integer';
        }
        if (/NOT\s+NULL/i.test(rest)) settings.push('not null');
        if (/\bUNIQUE\b/i.test(rest)) settings.push('unique');

        const defMatch = rest.match(/\bDEFAULT\s+('(?:[^']|'')*'|\S+\(\)|[^\s,]+)/i);
        if (defMatch) {
          let defVal = defMatch[1].trim();
          if (defVal.includes('(') && !defVal.startsWith("'")) {
            defVal = '`' + defVal + '`';
          }
          settings.push('default: ' + defVal);
        }

        const refMatch = rest.match(/\bREFERENCES\s+([`"\[\]\w.]+)\s*\(([^)]+)\)/i);
        if (refMatch) {
          const toTbl = refMatch[1].split('.').map(unquoteId).join('.');
          const toCol = unquoteId(refMatch[2].split(',')[0]);
          settings.push('ref: > ' + toTbl + '.' + toCol);
        }

        cols.push({ name: colName, type: colType, settings });
      }

      // Apply table-level PK / UNIQUE constraints
      for (const c of cols) {
        if (pkConstraintCols.includes(c.name) && !c.settings.includes('pk')) {
          c.settings.unshift('pk');
        }
        if (uniqueConstraintCols.includes(c.name) && !c.settings.includes('unique')) {
          c.settings.push('unique');
        }
      }

      tableBlocks.push({ name: tableName, cols });
      alterRefs.push(...inlineRefs);
    }

    // 3. Parse ALTER TABLE ... ADD FOREIGN KEY ...
    const alterRe =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?([`"\[\]\w.]+)\s+ADD\s+(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([`"\[\]\w.]+)\s*\(([^)]+)\)/gi;
    while ((m = alterRe.exec(raw)) !== null) {
      const fromTbl = m[1].split('.').map(unquoteId).join('.');
      const fromCol = unquoteId(m[2].split(',')[0]);
      const toTbl = m[3].split('.').map(unquoteId).join('.');
      const toCol = unquoteId(m[4].split(',')[0]);
      alterRefs.push({ fromTable: fromTbl, fromCol, toTable: toTbl, toCol });
    }

    if (tableBlocks.length === 0) {
      return null;
    }

    const out = [];
    for (const en of enumBlocks) {
      out.push('Enum ' + en.name + ' {');
      for (const v of en.vals) {
        out.push('  ' + (/^[a-zA-Z0-9_]+$/.test(v) ? v : "'" + v + "'"));
      }
      out.push('}');
      out.push('');
    }

    for (const t of tableBlocks) {
      out.push('Table ' + t.name + ' {');
      for (const c of t.cols) {
        const setStr = c.settings.length ? ' [' + c.settings.join(', ') + ']' : '';
        out.push('  ' + c.name + ' ' + c.type + setStr);
      }
      out.push('}');
      out.push('');
    }

    for (const r of alterRefs) {
      out.push('Ref: ' + r.fromTable + '.' + r.fromCol + ' > ' + r.toTable + '.' + r.toCol);
    }

    return out.join('\n').trim() + '\n';
  }

  DBStudio.sql = {
    toSQL,
    fromSQL
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.sql;
  }
})(typeof window !== 'undefined' ? window : globalThis);
