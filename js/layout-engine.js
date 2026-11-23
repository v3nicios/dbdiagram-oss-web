(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});

  const FONT_FAMILIES = {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    classic: 'Arial, Helvetica, sans-serif'
  };

  let measureCtx = null;

  function getFontFamilyCSS(key) {
    return FONT_FAMILIES[key] || FONT_FAMILIES.sans;
  }

  function measureTextWidth(text, fontSize, fontWeight, fontFamilyCss) {
    const str = String(text || '');
    if (!str) return 0;

    if (typeof document !== 'undefined') {
      if (!measureCtx) {
        const canvas = document.createElement('canvas');
        measureCtx = canvas.getContext('2d');
      }
      if (measureCtx) {
        measureCtx.font = (fontWeight || '400') + ' ' + fontSize + 'px ' + fontFamilyCss;
        return measureCtx.measureText(str).width;
      }
    }

    // Fallback for headless/Node environments without DOM canvas
    const avgRatio = fontFamilyCss.includes('monospace') ? 0.62 : 0.56;
    const weightBoost = Number(fontWeight) >= 600 ? 1.05 : 1.0;
    return str.length * fontSize * avgRatio * weightBoost;
  }

  function getColumnBadges(col) {
    const badges = [];
    if (col.isPk) badges.push({ label: 'PK', kind: 'pk' });
    if (col.isFk) badges.push({ label: 'FK', kind: 'fk' });
    if (col.isUnique) badges.push({ label: 'UQ', kind: 'uq' });
    if (col.isNotNull && !col.isPk) badges.push({ label: 'NN', kind: 'nn' });
    if (col.isIncrement) badges.push({ label: 'AI', kind: 'ai' });
    return badges;
  }

  function computeTypographyMetrics(settings) {
    const baseFont = Math.max(8, Math.min(36, Number(settings.diagramFontSize) || 14));
    const headerScale = Number(settings.headerFontScale) || 1.15;
    const fontFamilyCss = getFontFamilyCSS(settings.diagramFontFamily || 'sans');
    const headerFontSize = Math.max(baseFont + 1, Math.round(baseFont * headerScale));
    const badgeFontSize = Math.max(8, Math.round(baseFont * 0.72));
    const groupFontSize = Math.max(10, Math.round(baseFont * 1.0));
    const rowHeight = Math.round(baseFont * 1.85) + 6;
    const headerHeight = Math.round(headerFontSize * 2.0) + 10;
    const padX = Math.round(baseFont * 0.9);
    const colGap = Math.round(baseFont * 1.35);
    const badgePadX = Math.max(4, Math.round(badgeFontSize * 0.48));
    const badgeGap = Math.max(3, Math.round(baseFont * 0.25));
    const badgeHeight = Math.round(badgeFontSize * 1.45) + 2;
    const bottomPad = Math.round(baseFont * 0.35);
    const dotSlot = Math.round(baseFont * 0.95);
    const minTableWidth = Math.max(180, Math.round(baseFont * 14));
    const markerSize = Math.max(7, Math.round(baseFont * 0.58));

    return {
      baseFont,
      headerFontSize,
      badgeFontSize,
      groupFontSize,
      fontFamilyCss,
      rowHeight,
      headerHeight,
      padX,
      colGap,
      badgePadX,
      badgeGap,
      badgeHeight,
      bottomPad,
      dotSlot,
      minTableWidth,
      markerSize
    };
  }

  function measureAllNodes(ast, settings) {
    const m = computeTypographyMetrics(settings);
    const showTypes = settings.showTypes !== false;
    const showBadges = settings.showBadges !== false;

    const tableLayouts = Object.create(null);

    for (const table of ast.tables || []) {
      const titleW = measureTextWidth(table.fullName, m.headerFontSize, '700', m.fontFamilyCss);
      const headerIconsW = table.note ? m.baseFont * 3.0 : m.baseFont * 1.8;
      let maxW = Math.max(m.minTableWidth, titleW + m.padX * 2 + headerIconsW);

      const measuredCols = [];
      for (let i = 0; i < table.columns.length; i++) {
        const col = table.columns[i];
        const nameWeight = col.isPk ? '600' : '500';
        const nameW = measureTextWidth(col.name, m.baseFont, nameWeight, m.fontFamilyCss);

        const badges = showBadges ? getColumnBadges(col) : [];
        let badgesW = 0;
        const measuredBadges = [];
        for (let b = 0; b < badges.length; b++) {
          const bw =
            measureTextWidth(badges[b].label, m.badgeFontSize, '700', m.fontFamilyCss) +
            m.badgePadX * 2;
          measuredBadges.push({
            label: badges[b].label,
            kind: badges[b].kind,
            width: Math.ceil(bw)
          });
          badgesW += bw + m.badgeGap;
        }
        if (badgesW > 0) badgesW += m.badgeGap;

        const noteIconW = col.note ? m.baseFont * 1.15 : 0;
        const typeW = showTypes ? measureTextWidth(col.type, m.baseFont, '400', m.fontFamilyCss) : 0;

        const rowW =
          m.padX * 2 +
          m.dotSlot +
          nameW +
          badgesW +
          noteIconW +
          (showTypes ? m.colGap + typeW : 0);

        if (rowW > maxW) maxW = rowW;

        const yOffset = m.headerHeight + i * m.rowHeight;
        measuredCols.push({
          col,
          badges: measuredBadges,
          nameW,
          typeW,
          yOffset,
          yCenter: yOffset + m.rowHeight / 2
        });
      }

      const rowCount = Math.max(1, table.columns.length);
      const width = Math.ceil(maxW);
      const height = m.headerHeight + rowCount * m.rowHeight + m.bottomPad;

      tableLayouts[table.fullName] = {
        table,
        width,
        height,
        columns: measuredCols,
        colByName: Object.fromEntries(measuredCols.map((mc) => [mc.col.name, mc]))
      };
    }

    const enumLayouts = Object.create(null);
    for (const en of ast.enums || []) {
      const pillW = measureTextWidth('ENUM', m.badgeFontSize, '700', m.fontFamilyCss) + m.badgePadX * 2;
      const titleW = measureTextWidth(en.fullName, m.headerFontSize, '700', m.fontFamilyCss);
      let maxW = Math.max(Math.round(m.baseFont * 11), pillW + m.badgeGap * 2 + titleW + m.padX * 2);

      for (const val of en.values) {
        const vw =
          m.padX * 2 +
          measureTextWidth(val.name, m.baseFont, '500', m.fontFamilyCss) +
          (val.note ? m.baseFont * 1.2 : 0);
        if (vw > maxW) maxW = vw;
      }

      const rowCount = Math.max(1, en.values.length);
      enumLayouts[en.fullName] = {
        enumObj: en,
        width: Math.ceil(maxW),
        height: m.headerHeight + rowCount * m.rowHeight + m.bottomPad
      };
    }

    return {
      metrics: m,
      tableLayouts,
      enumLayouts
    };
  }

  /**
   * Computes non-overlapping coordinates for tables and enums.
   * Respects existing positions unless forceReset is true.
   */
  function computePositions(ast, measured, existingPositions, forceReset) {
    const m = measured.metrics;
    const pos = {};
    const gapX = Math.max(72, Math.round(m.baseFont * 5.0));
    const gapY = Math.max(58, Math.round(m.baseFont * 4.0));
    const groupInnerGapX = Math.max(64, Math.round(m.baseFont * 4.4));
    const groupInnerGapY = Math.max(46, Math.round(m.baseFont * 3.2));
    const groupPadX = Math.round(m.baseFont * 1.5);
    const groupPadTop = Math.round(m.groupFontSize * 2.1) + 14;
    const groupPadBottom = Math.round(m.baseFont * 1.4);

    if (!forceReset && existingPositions) {
      for (const k of Object.keys(existingPositions)) {
        if (existingPositions[k] && Number.isFinite(existingPositions[k].x) && Number.isFinite(existingPositions[k].y)) {
          pos[k] = { x: existingPositions[k].x, y: existingPositions[k].y };
        }
      }
    }

    // Check which tables still need placement
    const tablesToPlace = (ast.tables || []).filter((t) => !pos[t.fullName]);
    const enumsToPlace = (ast.enums || []).filter((e) => !pos['enum:' + e.fullName]);

    if (forceReset || tablesToPlace.length === (ast.tables || []).length) {
      // Full clean auto-layout: organize by TableGroup + remaining tables
      const placedSet = new Set();
      let cursorX = 60;
      let cursorY = 60;
      let rowMaxBottom = 60;
      const maxRowWidth = Math.max(1200, m.baseFont * 92);

      // 1. Place each TableGroup as a clean block
      for (const grp of ast.tableGroups || []) {
        const members = (grp.resolvedTables || []).filter((name) => !placedSet.has(name) && measured.tableLayouts[name]);
        if (members.length === 0) continue;

        const colsInGroup = members.length <= 2 ? members.length : Math.ceil(Math.sqrt(members.length));
        const colWidths = new Array(colsInGroup).fill(0);
        const rowHeights = [];

        members.forEach((name, idx) => {
          const c = idx % colsInGroup;
          const r = Math.floor(idx / colsInGroup);
          const tl = measured.tableLayouts[name];
          colWidths[c] = Math.max(colWidths[c], tl.width);
          rowHeights[r] = Math.max(rowHeights[r] || 0, tl.height);
        });

        const groupContentW =
          colWidths.reduce((a, b) => a + b, 0) + Math.max(0, colsInGroup - 1) * groupInnerGapX;
        const groupContentH =
          rowHeights.reduce((a, b) => a + b, 0) + Math.max(0, rowHeights.length - 1) * groupInnerGapY;
        const totalGroupW = groupContentW + groupPadX * 2;
        const totalGroupH = groupContentH + groupPadTop + groupPadBottom;

        if (cursorX > 60 && cursorX + totalGroupW > maxRowWidth) {
          cursorX = 60;
          cursorY = rowMaxBottom + gapY + 20;
        }

        const startX = cursorX + groupPadX;
        const startY = cursorY + groupPadTop;

        members.forEach((name, idx) => {
          const c = idx % colsInGroup;
          const r = Math.floor(idx / colsInGroup);
          let tx = startX;
          for (let cc = 0; cc < c; cc++) tx += colWidths[cc] + groupInnerGapX;
          let ty = startY;
          for (let rr = 0; rr < r; rr++) ty += rowHeights[rr] + groupInnerGapY;
          pos[name] = { x: Math.round(tx), y: Math.round(ty) };
          placedSet.add(name);
        });

        rowMaxBottom = Math.max(rowMaxBottom, cursorY + totalGroupH);
        cursorX += totalGroupW + gapX;
      }

      // 2. Place remaining ungrouped tables in balanced grid ordered by degree (most connected near center/top)
      const ungrouped = (ast.tables || []).filter((t) => !placedSet.has(t.fullName));
      if (ungrouped.length > 0) {
        if (placedSet.size > 0) {
          cursorX = 60;
          cursorY = rowMaxBottom + gapY + 16;
          rowMaxBottom = cursorY;
        }

        // Order ungrouped tables by connection count descending for cleaner layout
        const degree = Object.create(null);
        for (const r of ast.refs || []) {
          degree[r.fromTable] = (degree[r.fromTable] || 0) + 1;
          degree[r.toTable] = (degree[r.toTable] || 0) + 1;
        }
        ungrouped.sort((a, b) => (degree[b.fullName] || 0) - (degree[a.fullName] || 0));

        const colsCount = ungrouped.length <= 3 ? ungrouped.length : Math.ceil(Math.sqrt(ungrouped.length));
        const colWidths = new Array(colsCount).fill(0);
        const rowHeights = [];

        ungrouped.forEach((t, idx) => {
          const c = idx % colsCount;
          const r = Math.floor(idx / colsCount);
          const tl = measured.tableLayouts[t.fullName];
          colWidths[c] = Math.max(colWidths[c], tl.width);
          rowHeights[r] = Math.max(rowHeights[r] || 0, tl.height);
        });

        ungrouped.forEach((t, idx) => {
          const c = idx % colsCount;
          const r = Math.floor(idx / colsCount);
          let tx = cursorX;
          for (let cc = 0; cc < c; cc++) tx += colWidths[cc] + gapX;
          let ty = cursorY;
          for (let rr = 0; rr < r; rr++) ty += rowHeights[rr] + gapY;
          pos[t.fullName] = { x: Math.round(tx), y: Math.round(ty) };
          const tl = measured.tableLayouts[t.fullName];
          rowMaxBottom = Math.max(rowMaxBottom, ty + tl.height);
        });
      }

      // 3. Place enums neatly below tables
      const enumList = ast.enums || [];
      if (enumList.length > 0) {
        let ex = 60;
        let ey = Math.max(60, rowMaxBottom + gapY + 16);
        let eRowMaxH = 0;
        for (const en of enumList) {
          const el = measured.enumLayouts[en.fullName];
          if (ex > 60 && ex + el.width > maxRowWidth) {
            ex = 60;
            ey += eRowMaxH + gapY;
            eRowMaxH = 0;
          }
          pos['enum:' + en.fullName] = { x: Math.round(ex), y: Math.round(ey) };
          ex += el.width + gapX;
          eRowMaxH = Math.max(eRowMaxH, el.height);
        }
      }
    } else if (tablesToPlace.length > 0 || enumsToPlace.length > 0) {
      // Place only newly added tables/enums below existing bounding box
      let maxBottom = 60;
      for (const t of ast.tables || []) {
        if (pos[t.fullName] && measured.tableLayouts[t.fullName]) {
          maxBottom = Math.max(maxBottom, pos[t.fullName].y + measured.tableLayouts[t.fullName].height);
        }
      }
      for (const en of ast.enums || []) {
        const key = 'enum:' + en.fullName;
        if (pos[key] && measured.enumLayouts[en.fullName]) {
          maxBottom = Math.max(maxBottom, pos[key].y + measured.enumLayouts[en.fullName].height);
        }
      }

      let nx = 60;
      let ny = maxBottom + gapY;
      let rowH = 0;
      for (const t of tablesToPlace) {
        const tl = measured.tableLayouts[t.fullName];
        if (nx > 60 && nx + tl.width > 1200) {
          nx = 60;
          ny += rowH + gapY;
          rowH = 0;
        }
        pos[t.fullName] = { x: Math.round(nx), y: Math.round(ny) };
        nx += tl.width + gapX;
        rowH = Math.max(rowH, tl.height);
      }
      if (tablesToPlace.length > 0) {
        nx = 60;
        ny += rowH + gapY;
        rowH = 0;
      }
      for (const en of enumsToPlace) {
        const el = measured.enumLayouts[en.fullName];
        if (nx > 60 && nx + el.width > 1200) {
          nx = 60;
          ny += rowH + gapY;
          rowH = 0;
        }
        pos['enum:' + en.fullName] = { x: Math.round(nx), y: Math.round(ny) };
        nx += el.width + gapX;
        rowH = Math.max(rowH, el.height);
      }
    }

    // Compute TableGroup bounding rectangles from member positions
    const groupLayouts = [];
    for (const grp of ast.tableGroups || []) {
      const members = (grp.resolvedTables || []).filter(
        (name) => pos[name] && measured.tableLayouts[name]
      );
      if (members.length === 0) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const name of members) {
        const p = pos[name];
        const tl = measured.tableLayouts[name];
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + tl.width);
        maxY = Math.max(maxY, p.y + tl.height);
      }

      groupLayouts.push({
        group: grp,
        members,
        x: Math.round(minX - groupPadX),
        y: Math.round(minY - groupPadTop),
        width: Math.round(maxX - minX + groupPadX * 2),
        height: Math.round(maxY - minY + groupPadTop + groupPadBottom)
      });
    }

    return {
      positions: pos,
      groupLayouts
    };
  }

  DBStudio.layout = {
    getFontFamilyCSS,
    measureTextWidth,
    computeTypographyMetrics,
    measureAllNodes,
    computePositions
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.layout;
  }
})(typeof window !== 'undefined' ? window : globalThis);
