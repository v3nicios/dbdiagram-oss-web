(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const PALETTES = {
    dark: {
      canvasBg: '#0d1017',
      tableBg: '#171c28',
      tableAltRow: '#1b2130',
      tableBorder: '#2c3549',
      tableShadow: 'rgba(0, 0, 0, 0.45)',
      defaultHeader: '#2563eb',
      enumHeader: '#6d28d9',
      textPrimary: '#e2e8f0',
      textSecondary: '#94a3b8',
      textMuted: '#64748b',
      rowDivider: '#232a3b',
      refStroke: '#64748b',
      refHighlight: '#38bdf8',
      groupBgAlpha: '18',
      groupBorderAlpha: '88',
      badge: {
        pk: { bg: '#452809', fg: '#fbbf24', border: '#92400e' },
        fk: { bg: '#0c2d48', fg: '#38bdf8', border: '#0369a1' },
        uq: { bg: '#2e1c4d', fg: '#c4b5fd', border: '#6d28d9' },
        nn: { bg: '#3f1524', fg: '#fda4af', border: '#9f1239' },
        ai: { bg: '#093829', fg: '#6ee7b7', border: '#047857' },
        enumPill: { bg: '#3b1d6a', fg: '#ddd6fe', border: '#7c3aed' }
      }
    },
    light: {
      canvasBg: '#f8fafc',
      tableBg: '#ffffff',
      tableAltRow: '#f8fafc',
      tableBorder: '#cbd5e1',
      tableShadow: 'rgba(15, 23, 42, 0.10)',
      defaultHeader: '#1e293b',
      enumHeader: '#6d28d9',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
      textMuted: '#94a3b8',
      rowDivider: '#e2e8f0',
      refStroke: '#64748b',
      refHighlight: '#2563eb',
      groupBgAlpha: '14',
      groupBorderAlpha: '88',
      badge: {
        pk: { bg: '#fef3c7', fg: '#b45309', border: '#f59e0b' },
        fk: { bg: '#e0f2fe', fg: '#0369a1', border: '#38bdf8' },
        uq: { bg: '#ede9fe', fg: '#6d28d9', border: '#a78bfa' },
        nn: { bg: '#ffe4e6', fg: '#be123c', border: '#fda4af' },
        ai: { bg: '#d1fae5', fg: '#047857', border: '#34d399' },
        enumPill: { bg: '#ede9fe', fg: '#5b21b6', border: '#8b5cf6' }
      }
    }
  };

  function svgEl(doc, tag, attrs, textContent) {
    const el = doc.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (attrs[k] !== undefined && attrs[k] !== null) {
          el.setAttribute(k, String(attrs[k]));
        }
      }
    }
    if (textContent !== undefined && textContent !== null) {
      el.textContent = String(textContent);
    }
    return el;
  }

  function normalizeHex(hex, fallback) {
    if (!hex || typeof hex !== 'string') return fallback;
    let h = hex.trim();
    if (!h.startsWith('#')) return fallback;
    if (h.length === 4) {
      h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    if (/^#[0-9a-fA-F]{6}$/.test(h)) return h;
    return fallback;
  }

  function hexWithAlpha(hex, alphaHex, fallback) {
    const norm = normalizeHex(hex, fallback || '#3b82f6');
    return norm + alphaHex;
  }

  function getContrastTextColor(hex) {
    const norm = normalizeHex(hex, '#2563eb');
    const r = parseInt(norm.slice(1, 3), 16);
    const g = parseInt(norm.slice(3, 5), 16);
    const b = parseInt(norm.slice(5, 7), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 165 ? '#0f172a' : '#ffffff';
  }

  function roundedTopRectPath(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h);
    return (
      'M ' + (x + rad) + ' ' + y +
      ' L ' + (x + w - rad) + ' ' + y +
      ' Q ' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + rad) +
      ' L ' + (x + w) + ' ' + (y + h) +
      ' L ' + x + ' ' + (y + h) +
      ' L ' + x + ' ' + (y + rad) +
      ' Q ' + x + ' ' + y + ' ' + (x + rad) + ' ' + y + ' Z'
    );
  }

  function computeRefGeometry(ref, measured, positions, refOffsets, laneIndex, settings) {
    const m = measured.metrics;
    const srcLayout = measured.tableLayouts[ref.fromTable];
    const dstLayout = measured.tableLayouts[ref.toTable];
    const srcPos = positions[ref.fromTable];
    const dstPos = positions[ref.toTable];
    if (!srcLayout || !dstLayout || !srcPos || !dstPos) return null;

    const srcCol = srcLayout.colByName[ref.fromColumn];
    const dstCol = dstLayout.colByName[ref.toColumn];
    if (!srcCol || !dstCol) return null;

    const y1 = srcPos.y + srcCol.yCenter;
    const y2 = dstPos.y + dstCol.yCenter;
    const rawOffset = refOffsets && refOffsets[ref.key];
    const userOffsetX =
      typeof rawOffset === 'number'
        ? rawOffset
        : rawOffset && typeof rawOffset === 'object'
          ? Number(rawOffset.dx) || 0
          : 0;
    const userOffsetY =
      rawOffset && typeof rawOffset === 'object' ? Number(rawOffset.dy) || 0 : 0;
    const laneOffset = ((laneIndex % 5) - 2) * Math.max(8, Math.round(m.baseFont * 0.55));
    const lineStyle = settings.lineStyle || 'orthogonal';

    let x1, x2, dir1, dir2, midX, midY;
    const srcLeft = srcPos.x;
    const srcRight = srcPos.x + srcLayout.width;
    const dstLeft = dstPos.x;
    const dstRight = dstPos.x + dstLayout.width;

    function isCorridorBlocked(xCoord, minY, maxY) {
      const yLo = Math.min(minY, maxY) - 4;
      const yHi = Math.max(minY, maxY) + 4;
      for (const tName of Object.keys(measured.tableLayouts)) {
        if (tName === ref.fromTable || tName === ref.toTable) continue;
        const p = positions[tName];
        const tl = measured.tableLayouts[tName];
        if (!p || !tl) continue;
        if (xCoord >= p.x - 10 && xCoord <= p.x + tl.width + 10) {
          if (yHi >= p.y && yLo <= p.y + tl.height) {
            return true;
          }
        }
      }
      return false;
    }

    if (ref.fromTable === ref.toTable) {
      // Self reference loop: fit comfortably inside inter-table gap
      const reach = Math.max(28, Math.round(m.baseFont * 2.0));
      const rightBlocked = isCorridorBlocked(srcRight + reach, y1, y2);
      const leftBlocked = isCorridorBlocked(srcLeft - reach, y1, y2);
      if (rightBlocked && !leftBlocked) {
        x1 = srcLeft;
        x2 = dstLeft;
        dir1 = -1;
        dir2 = -1;
        midX = srcLeft - reach + userOffsetX;
      } else {
        x1 = srcRight;
        x2 = dstRight;
        dir1 = 1;
        dir2 = 1;
        midX = srcRight + reach + userOffsetX;
      }
      midY = (y1 + y2) / 2;
    } else if (srcRight + 26 <= dstLeft) {
      x1 = srcRight;
      x2 = dstLeft;
      dir1 = 1;
      dir2 = -1;
      midX = (x1 + x2) / 2 + laneOffset + userOffsetX;
      if (lineStyle !== 'bezier') {
        midX = Math.max(x1 + 12, Math.min(x2 - 12, midX));
      }
      midY = (y1 + y2) / 2;
    } else if (dstRight + 26 <= srcLeft) {
      x1 = srcLeft;
      x2 = dstRight;
      dir1 = -1;
      dir2 = 1;
      midX = (x1 + x2) / 2 + laneOffset + userOffsetX;
      if (lineStyle !== 'bezier') {
        midX = Math.max(x2 + 12, Math.min(x1 - 12, midX));
      }
      midY = (y1 + y2) / 2;
    } else {
      // Overlapping horizontally: choose unobstructed outer corridor (left vs right)
      const rightMost = Math.max(srcRight, dstRight);
      const leftMost = Math.min(srcLeft, dstLeft);
      const reach = Math.max(30, Math.round(m.baseFont * 2.2)) + Math.abs(laneOffset);
      const rightCand = rightMost + reach;
      const leftCand = leftMost - reach;
      const rightBlocked = isCorridorBlocked(rightCand, y1, y2);
      const leftBlocked = isCorridorBlocked(leftCand, y1, y2);

      const basePreferLeft =
        !leftBlocked &&
        (rightBlocked || Math.abs(srcLeft - dstLeft) <= Math.abs(srcRight - dstRight));

      if (basePreferLeft) {
        if (leftCand + userOffsetX > (srcLeft + srcRight) / 2) {
          x1 = srcRight;
          x2 = dstRight;
          dir1 = 1;
          dir2 = 1;
          midX = leftCand + userOffsetX;
        } else {
          x1 = srcLeft;
          x2 = dstLeft;
          dir1 = -1;
          dir2 = -1;
          midX = leftCand + userOffsetX;
        }
      } else {
        if (rightCand + userOffsetX < (srcLeft + srcRight) / 2) {
          x1 = srcLeft;
          x2 = dstLeft;
          dir1 = -1;
          dir2 = -1;
          midX = rightCand + userOffsetX;
        } else {
          x1 = srcRight;
          x2 = dstRight;
          dir1 = 1;
          dir2 = 1;
          midX = rightCand + userOffsetX;
        }
      }
      midY = (y1 + y2) / 2;
    }

    // Build path string
    let pathD = '';
    const dy = y2 - y1;

    if (lineStyle === 'bezier') {
      const cy1 = y1 + userOffsetY * 1.333;
      const cy2 = y2 + userOffsetY * 1.333;
      if (dir1 !== dir2) {
        const span = Math.max(52, Math.abs(midX - x1), Math.abs(x2 - midX));
        const cx1 = x1 + dir1 * span;
        const cx2 = x2 + dir2 * span;
        pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
        midX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
        midY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
      } else {
        const loopReach = Math.max(60, Math.abs(midX - Math.min(x1, x2)) * 1.25);
        const cx1 = x1 + dir1 * loopReach;
        const cx2 = x2 + dir2 * loopReach;
        pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
        midX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
        midY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
      }
    } else {
      // Orthogonal rounded elbow (or 5-segment bridge when dragged vertically)
      const dyAbs = Math.abs(dy);
      if (dir1 !== dir2 && Math.abs(userOffsetY) >= 4) {
        const bridgeY = (y1 + y2) / 2 + userOffsetY;
        const spanX = Math.abs(x2 - x1);
        const stub = Math.min(28, Math.max(12, spanX * 0.22));
        const turnX1 = x1 + dir1 * stub;
        const turnX2 = x2 + dir2 * stub;
        const signX1 = turnX1 >= x1 ? 1 : -1;
        const signXBridge = turnX2 >= turnX1 ? 1 : -1;
        const signX2 = x2 >= turnX2 ? 1 : -1;
        const dy1 = bridgeY - y1;
        const dy2 = y2 - bridgeY;
        const signY1 = dy1 >= 0 ? 1 : -1;
        const signY2 = dy2 >= 0 ? 1 : -1;
        const r1 = Math.min(9, Math.abs(turnX1 - x1) / 2, Math.abs(dy1) / 2, Math.abs(turnX2 - turnX1) / 2);
        const r2 = Math.min(9, Math.abs(x2 - turnX2) / 2, Math.abs(dy2) / 2, Math.abs(turnX2 - turnX1) / 2);

        const seg1 =
          r1 >= 1.2
            ? `M ${x1} ${y1} L ${turnX1 - signX1 * r1} ${y1} Q ${turnX1} ${y1} ${turnX1} ${y1 + signY1 * r1} ` +
              `L ${turnX1} ${bridgeY - signY1 * r1} Q ${turnX1} ${bridgeY} ${turnX1 + signXBridge * r1} ${bridgeY} `
            : `M ${x1} ${y1} L ${turnX1} ${y1} L ${turnX1} ${bridgeY} `;
        const seg2 =
          r2 >= 1.2
            ? `L ${turnX2 - signXBridge * r2} ${bridgeY} Q ${turnX2} ${bridgeY} ${turnX2} ${bridgeY + signY2 * r2} ` +
              `L ${turnX2} ${y2 - signY2 * r2} Q ${turnX2} ${y2} ${turnX2 + signX2 * r2} ${y2} L ${x2} ${y2}`
            : `L ${turnX2} ${bridgeY} L ${turnX2} ${y2} L ${x2} ${y2}`;
        pathD = seg1 + seg2;
        midX = (turnX1 + turnX2) / 2;
        midY = bridgeY;
      } else if (dir1 !== dir2 && dyAbs < 2 && Math.abs(userOffsetX) < 2) {
        pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else if (dir1 !== dir2) {
        const r = Math.min(
          10,
          dyAbs / 2,
          Math.abs(midX - x1) / 2,
          Math.abs(x2 - midX) / 2
        );
        const signY = dy >= 0 ? 1 : -1;
        const signX1 = midX >= x1 ? 1 : -1;
        const signX2 = x2 >= midX ? 1 : -1;
        if (r >= 1.5) {
          pathD =
            `M ${x1} ${y1} ` +
            `L ${midX - signX1 * r} ${y1} ` +
            `Q ${midX} ${y1} ${midX} ${y1 + signY * r} ` +
            `L ${midX} ${y2 - signY * r} ` +
            `Q ${midX} ${y2} ${midX + signX2 * r} ${y2} ` +
            `L ${x2} ${y2}`;
        } else {
          pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        }
      } else {
        // Same-side loop
        const r = Math.min(10, dyAbs / 2, Math.abs(midX - x1) / 2, Math.abs(midX - x2) / 2);
        const signY = dy >= 0 ? 1 : -1;
        if (r >= 1.5) {
          pathD =
            `M ${x1} ${y1} ` +
            `L ${midX - dir1 * r} ${y1} ` +
            `Q ${midX} ${y1} ${midX} ${y1 + signY * r} ` +
            `L ${midX} ${y2 - signY * r} ` +
            `Q ${midX} ${y2} ${midX - dir2 * r} ${y2} ` +
            `L ${x2} ${y2}`;
        } else {
          pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        }
      }
    }

    // Cardinality markers
    // op: '>' means from=many, to=one; '<' means from=one, to=many; '-' one-to-one; '<>' many-to-many
    const fromKind = ref.op === '>' || ref.op === '<>' ? 'many' : 'one';
    const toKind = ref.op === '<' || ref.op === '<>' ? 'many' : 'one';

    const s = m.markerSize;
    const markerPaths = [];

    function addCardinalityPaths(edgeX, edgeY, dir, kind) {
      if (kind === 'many') {
        const stemX = edgeX + dir * s * 1.25;
        const spreadY = s * 0.68;
        markerPaths.push(`M ${stemX} ${edgeY} L ${edgeX} ${edgeY - spreadY}`);
        markerPaths.push(`M ${stemX} ${edgeY} L ${edgeX} ${edgeY + spreadY}`);
        // One-bar behind crow's foot
        const barX = edgeX + dir * s * 1.5;
        markerPaths.push(`M ${barX} ${edgeY - s * 0.52} L ${barX} ${edgeY + s * 0.52}`);
      } else {
        const barX1 = edgeX + dir * s * 0.85;
        markerPaths.push(`M ${barX1} ${edgeY - s * 0.55} L ${barX1} ${edgeY + s * 0.55}`);
      }
    }

    addCardinalityPaths(x1, y1, dir1, fromKind);
    addCardinalityPaths(x2, y2, dir2, toKind);

    return {
      ref,
      x1,
      y1,
      x2,
      y2,
      dir1,
      dir2,
      midX,
      midY,
      pathD,
      markerD: markerPaths.join(' '),
      fromKind,
      toKind
    };
  }

  /**
   * Renders the full diagram contents into target container layers (used for both Screen and Export).
   */
  function renderSceneInto(doc, layers, state, measured, layoutPositions, options) {
    const opts = options || {};
    const isExport = Boolean(opts.isExport);
    const themeName = opts.theme === 'light' ? 'light' : opts.theme === 'dark' ? 'dark' : state.theme;
    const pal = PALETTES[themeName] || PALETTES.dark;
    const m = measured.metrics;
    const ast = state.ast;
    const settings = state.settings;
    const positions = layoutPositions.positions;

    // Clear layers
    layers.groups.textContent = '';
    layers.refs.textContent = '';
    layers.tables.textContent = '';
    layers.enums.textContent = '';

    // 1. Render TableGroups
    if (settings.showGroups !== false) {
      for (const gl of layoutPositions.groupLayouts) {
        const gColor = normalizeHex(gl.group.color, '#3b82f6');
        const gEl = svgEl(doc, 'g', {
          class: 'diagram-group',
          'data-group-name': gl.group.name
        });

        gEl.appendChild(
          svgEl(doc, 'rect', {
            x: gl.x,
            y: gl.y,
            width: gl.width,
            height: gl.height,
            rx: 12,
            ry: 12,
            fill: hexWithAlpha(gColor, pal.groupBgAlpha, '#3b82f6'),
            stroke: hexWithAlpha(gColor, pal.groupBorderAlpha, '#3b82f6'),
            'stroke-width': 1.5,
            'stroke-dasharray': '6 4'
          })
        );

        const titleY = gl.y + Math.round(m.groupFontSize * 1.45) + 6;
        const titleX = gl.x + Math.round(m.baseFont * 1.0);

        gEl.appendChild(
          svgEl(doc, 'circle', {
            cx: titleX + m.groupFontSize * 0.35,
            cy: titleY - m.groupFontSize * 0.33,
            r: Math.max(4, m.groupFontSize * 0.28),
            fill: gColor
          })
        );

        gEl.appendChild(
          svgEl(
            doc,
            'text',
            {
              x: titleX + m.groupFontSize * 0.95,
              y: titleY,
              fill: themeName === 'dark' ? '#e2e8f0' : '#1e293b',
              'font-family': m.fontFamilyCss,
              'font-size': m.groupFontSize,
              'font-weight': '700'
            },
            gl.group.name
          )
        );

        if (!isExport) {
          // Invisible hit handle along the top bar for dragging the whole group
          gEl.appendChild(
            svgEl(doc, 'rect', {
              x: gl.x,
              y: gl.y,
              width: gl.width,
              height: Math.round(m.groupFontSize * 2.1) + 12,
              rx: 12,
              fill: 'transparent',
              class: 'group-drag-handle',
              'data-group-name': gl.group.name
            })
          );
        }

        layers.groups.appendChild(gEl);
      }
    }

    // 2. Render Relationship Connectors (Refs)
    const refGeometries = [];
    for (let i = 0; i < (ast.refs || []).length; i++) {
      const ref = ast.refs[i];
      const geom = computeRefGeometry(ref, measured, positions, state.refOffsets, i, settings);
      if (!geom) continue;
      refGeometries.push(geom);

      const isHighlighted =
        !isExport &&
        (state.hoveredRefKey === ref.key ||
          state.hoveredTable === ref.fromTable ||
          state.hoveredTable === ref.toTable);
      const isDimmed =
        !isExport &&
        state.hoveredTable &&
        state.hoveredTable !== ref.fromTable &&
        state.hoveredTable !== ref.toTable;

      const strokeColor = isHighlighted
        ? pal.refHighlight
        : ref.color
          ? normalizeHex(ref.color, pal.refStroke)
          : pal.refStroke;

      const refGroup = svgEl(doc, 'g', {
        class: 'diagram-ref' + (isHighlighted ? ' is-highlighted' : '') + (isDimmed ? ' is-dimmed' : ''),
        'data-ref-key': ref.key,
        'data-same-side': geom.dir1 === geom.dir2 ? '1' : '0',
        'data-flat': Math.abs(geom.y2 - geom.y1) < 12 ? '1' : '0',
        'data-from': ref.fromTable + '.' + ref.fromColumn,
        'data-to': ref.toTable + '.' + ref.toColumn
      });

      // Invisible wide hit path for easy clicking/dragging anywhere along the line
      if (!isExport) {
        refGroup.appendChild(
          svgEl(doc, 'path', {
            d: geom.pathD,
            fill: 'none',
            stroke: 'transparent',
            'stroke-width': 18,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'pointer-events': 'stroke',
            class: 'ref-hit-area'
          })
        );
      }

      refGroup.appendChild(
        svgEl(doc, 'path', {
          d: geom.pathD,
          fill: 'none',
          stroke: strokeColor,
          'stroke-width': isHighlighted ? 2.4 : 1.75,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          opacity: isDimmed ? 0.25 : 1
        })
      );

      if (geom.markerD) {
        refGroup.appendChild(
          svgEl(doc, 'path', {
            d: geom.markerD,
            fill: 'none',
            stroke: strokeColor,
            'stroke-width': isHighlighted ? 2.2 : 1.7,
            'stroke-linecap': 'round',
            opacity: isDimmed ? 0.25 : 1
          })
        );
      }

      // Interactive midpoint drag handle on screen
      if (!isExport) {
        refGroup.appendChild(
          svgEl(doc, 'circle', {
            cx: geom.midX,
            cy: geom.midY,
            r: 5.5,
            fill: isHighlighted ? pal.refHighlight : pal.tableBg,
            stroke: strokeColor,
            'stroke-width': 1.8,
            class: 'ref-midpoint-handle',
            'data-ref-key': ref.key
          })
        );
      }

      layers.refs.appendChild(refGroup);
    }

    // 3. Render Tables
    for (const table of ast.tables || []) {
      const tl = measured.tableLayouts[table.fullName];
      const pos = positions[table.fullName];
      if (!tl || !pos) continue;

      const headerBg = normalizeHex(table.headerColor, pal.defaultHeader);
      const headerFg = getContrastTextColor(headerBg);
      const isHighlighted = !isExport && state.hoveredTable === table.fullName;
      const isSearchMatch = !isExport && state.highlightedTable === table.fullName;

      const tGroup = svgEl(doc, 'g', {
        class: 'diagram-table' + (isHighlighted ? ' is-highlighted' : ''),
        transform: `translate(${pos.x}, ${pos.y})`,
        'data-table': table.fullName
      });

      // Soft shadow rect (works everywhere including SVG/PNG/PDF exports)
      tGroup.appendChild(
        svgEl(doc, 'rect', {
          x: 2,
          y: 4,
          width: tl.width,
          height: tl.height,
          rx: 9,
          ry: 9,
          fill: pal.tableShadow
        })
      );

      // Card body
      tGroup.appendChild(
        svgEl(doc, 'rect', {
          x: 0,
          y: 0,
          width: tl.width,
          height: tl.height,
          rx: 8,
          ry: 8,
          fill: pal.tableBg,
          stroke: isSearchMatch ? '#f59e0b' : isHighlighted ? pal.refHighlight : pal.tableBorder,
          'stroke-width': isSearchMatch || isHighlighted ? 2.2 : 1.25
        })
      );

      // Header background with rounded top corners
      tGroup.appendChild(
        svgEl(doc, 'path', {
          d: roundedTopRectPath(0.6, 0.6, tl.width - 1.2, m.headerHeight, 7.5),
          fill: headerBg
        })
      );

      // Table title text (baseline offset ~0.35*fontSize for exact cross-renderer centering)
      const headerTextY = Math.round(m.headerHeight / 2 + m.headerFontSize * 0.35);
      tGroup.appendChild(
        svgEl(
          doc,
          'text',
          {
            x: m.padX,
            y: headerTextY,
            fill: headerFg,
            'font-family': m.fontFamilyCss,
            'font-size': m.headerFontSize,
            'font-weight': '700'
          },
          table.fullName
        )
      );

      // Interactive header drag handle + color picker button on screen
      if (!isExport) {
        tGroup.appendChild(
          svgEl(doc, 'rect', {
            x: 0,
            y: 0,
            width: tl.width,
            height: m.headerHeight,
            fill: 'transparent',
            class: 'table-drag-handle',
            'data-table': table.fullName
          })
        );

        const dotX = tl.width - Math.round(m.padX * 0.9) - 6;
        const dotY = Math.round(m.headerHeight / 2);
        const colorBtn = svgEl(doc, 'g', {
          class: 'table-color-trigger',
          'data-table': table.fullName
        });
        colorBtn.appendChild(
          svgEl(doc, 'circle', {
            cx: dotX,
            cy: dotY,
            r: Math.max(5.5, Math.round(m.baseFont * 0.4)),
            fill: headerBg,
            stroke: headerFg,
            'stroke-width': 1.5,
            opacity: 0.9
          })
        );
        tGroup.appendChild(colorBtn);
      }

      // Empty table placeholder
      if (tl.columns.length === 0) {
        const emptyY = Math.round(m.headerHeight + m.rowHeight / 2 + m.baseFont * 0.35);
        tGroup.appendChild(
          svgEl(
            doc,
            'text',
            {
              x: m.padX,
              y: emptyY,
              fill: pal.textMuted,
              'font-family': m.fontFamilyCss,
              'font-size': Math.max(10, m.baseFont - 1),
              'font-style': 'italic'
            },
            DBStudio.i18n ? DBStudio.i18n.t('emptyTableCols') : '(empty)'
          )
        );
      }

      // Columns
      for (let i = 0; i < tl.columns.length; i++) {
        const mc = tl.columns[i];
        const col = mc.col;
        const rowY = mc.yOffset;
        const textBaselineY = Math.round(mc.yCenter + m.baseFont * 0.35);

        const isColHovered =
          !isExport &&
          state.hoveredColumn &&
          state.hoveredColumn.table === table.fullName &&
          state.hoveredColumn.column === col.name;

        const rowG = svgEl(doc, 'g', {
          class: 'table-col-row' + (isColHovered ? ' is-hovered' : ''),
          'data-table': table.fullName,
          'data-column': col.name
        });

        // Alternating row subtle tint or hover tint
        if (isColHovered || i % 2 === 1) {
          rowG.appendChild(
            svgEl(doc, 'rect', {
              x: 1,
              y: rowY,
              width: tl.width - 2,
              height: m.rowHeight,
              fill: isColHovered
                ? themeName === 'dark'
                  ? '#243047'
                  : '#e0f2fe'
                : pal.tableAltRow
            })
          );
        }

        // Row divider
        if (i > 0) {
          rowG.appendChild(
            svgEl(doc, 'line', {
              x1: 1,
              y1: rowY,
              x2: tl.width - 1,
              y2: rowY,
              stroke: pal.rowDivider,
              'stroke-width': 1
            })
          );
        }

        // Left PK / FK dot indicator
        const dotX = m.padX + Math.round(m.dotSlot * 0.32);
        const dotY = mc.yCenter;
        if (col.isPk) {
          rowG.appendChild(
            svgEl(doc, 'circle', {
              cx: dotX,
              cy: dotY,
              r: Math.max(3, Math.round(m.baseFont * 0.24)),
              fill: '#f59e0b'
            })
          );
        } else if (col.isFk) {
          rowG.appendChild(
            svgEl(doc, 'circle', {
              cx: dotX,
              cy: dotY,
              r: Math.max(2.6, Math.round(m.baseFont * 0.21)),
              fill: '#38bdf8'
            })
          );
        }

        // Column Name
        let curX = m.padX + m.dotSlot;
        rowG.appendChild(
          svgEl(
            doc,
            'text',
            {
              x: curX,
              y: textBaselineY,
              fill: pal.textPrimary,
              'font-family': m.fontFamilyCss,
              'font-size': m.baseFont,
              'font-weight': col.isPk ? '600' : '500'
            },
            col.name
          )
        );
        curX += mc.nameW + m.badgeGap * 1.4;

        // Badges (PK, FK, UQ, NN, AI)
        if (mc.badges.length > 0) {
          const badgeTop = Math.round(mc.yCenter - m.badgeHeight / 2);
          const badgeTextY = Math.round(mc.yCenter + m.badgeFontSize * 0.35);
          for (const b of mc.badges) {
            const bPal = pal.badge[b.kind] || pal.badge.pk;
            rowG.appendChild(
              svgEl(doc, 'rect', {
                x: curX,
                y: badgeTop,
                width: b.width,
                height: m.badgeHeight,
                rx: 4,
                ry: 4,
                fill: bPal.bg,
                stroke: bPal.border,
                'stroke-width': 0.8
              })
            );
            rowG.appendChild(
              svgEl(
                doc,
                'text',
                {
                  x: curX + b.width / 2,
                  y: badgeTextY,
                  'text-anchor': 'middle',
                  fill: bPal.fg,
                  'font-family': m.fontFamilyCss,
                  'font-size': m.badgeFontSize,
                  'font-weight': '700'
                },
                b.label
              )
            );
            curX += b.width + m.badgeGap;
          }
        }

        // Note indicator dot/icon if col.note exists
        if (col.note) {
          const noteR = Math.max(4, Math.round(m.baseFont * 0.32));
          rowG.appendChild(
            svgEl(doc, 'circle', {
              cx: curX + noteR,
              cy: mc.yCenter,
              r: noteR,
              fill: 'none',
              stroke: pal.textMuted,
              'stroke-width': 1.1
            })
          );
          rowG.appendChild(
            svgEl(
              doc,
              'text',
              {
                x: curX + noteR,
                y: Math.round(mc.yCenter + m.badgeFontSize * 0.32),
                'text-anchor': 'middle',
                fill: pal.textMuted,
                'font-family': m.fontFamilyCss,
                'font-size': Math.max(8, m.badgeFontSize - 1),
                'font-weight': '700'
              },
              'i'
            )
          );
        }

        // Column Type aligned to the right
        if (settings.showTypes !== false) {
          rowG.appendChild(
            svgEl(
              doc,
              'text',
              {
                x: tl.width - m.padX,
                y: textBaselineY,
                'text-anchor': 'end',
                fill: col.enumRef ? (themeName === 'dark' ? '#c4b5fd' : '#6d28d9') : pal.textSecondary,
                'font-family': m.fontFamilyCss,
                'font-size': m.baseFont,
                'font-weight': '400'
              },
              col.type
            )
          );
        }

        tGroup.appendChild(rowG);
      }

      layers.tables.appendChild(tGroup);
    }

    // 4. Render Enums
    if (settings.showEnums !== false) {
      for (const en of ast.enums || []) {
        const el = measured.enumLayouts[en.fullName];
        const pos = positions['enum:' + en.fullName];
        if (!el || !pos) continue;

        const eGroup = svgEl(doc, 'g', {
          class: 'diagram-enum',
          transform: `translate(${pos.x}, ${pos.y})`,
          'data-enum': en.fullName
        });

        eGroup.appendChild(
          svgEl(doc, 'rect', {
            x: 2,
            y: 4,
            width: el.width,
            height: el.height,
            rx: 9,
            ry: 9,
            fill: pal.tableShadow
          })
        );

        eGroup.appendChild(
          svgEl(doc, 'rect', {
            x: 0,
            y: 0,
            width: el.width,
            height: el.height,
            rx: 8,
            ry: 8,
            fill: pal.tableBg,
            stroke: pal.enumHeader,
            'stroke-width': 1.25,
            'stroke-dasharray': '5 3'
          })
        );

        eGroup.appendChild(
          svgEl(doc, 'path', {
            d: roundedTopRectPath(0.6, 0.6, el.width - 1.2, m.headerHeight, 7.5),
            fill: pal.enumHeader
          })
        );

        const headerTextY = Math.round(m.headerHeight / 2 + m.headerFontSize * 0.35);
        eGroup.appendChild(
          svgEl(
            doc,
            'text',
            {
              x: m.padX,
              y: headerTextY,
              fill: '#ffffff',
              'font-family': m.fontFamilyCss,
              'font-size': m.headerFontSize,
              'font-weight': '700'
            },
            'Enum: ' + en.fullName
          )
        );

        if (!isExport) {
          eGroup.appendChild(
            svgEl(doc, 'rect', {
              x: 0,
              y: 0,
              width: el.width,
              height: m.headerHeight,
              fill: 'transparent',
              class: 'enum-drag-handle',
              'data-enum': en.fullName
            })
          );
        }

        for (let i = 0; i < en.values.length; i++) {
          const val = en.values[i];
          const rowY = m.headerHeight + i * m.rowHeight;
          const textY = Math.round(rowY + m.rowHeight / 2 + m.baseFont * 0.35);

          if (i > 0) {
            eGroup.appendChild(
              svgEl(doc, 'line', {
                x1: 1,
                y1: rowY,
                x2: el.width - 1,
                y2: rowY,
                stroke: pal.rowDivider,
                'stroke-width': 1
              })
            );
          }

          eGroup.appendChild(
            svgEl(
              doc,
              'text',
              {
                x: m.padX,
                y: textY,
                fill: pal.textPrimary,
                'font-family': m.fontFamilyCss,
                'font-size': m.baseFont,
                'font-weight': '500'
              },
              val.name
            )
          );
        }

        layers.enums.appendChild(eGroup);
      }
    }

    return refGeometries;
  }

  function computeDiagramBounds(state, measured, layoutPositions, padding) {
    const pad = padding !== undefined ? padding : 40;
    const positions = layoutPositions.positions;
    const settings = state.settings;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const table of state.ast.tables || []) {
      const p = positions[table.fullName];
      const tl = measured.tableLayouts[table.fullName];
      if (!p || !tl) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + tl.width);
      maxY = Math.max(maxY, p.y + tl.height);
    }

    if (settings.showEnums !== false) {
      for (const en of state.ast.enums || []) {
        const p = positions['enum:' + en.fullName];
        const el = measured.enumLayouts[en.fullName];
        if (!p || !el) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + el.width);
        maxY = Math.max(maxY, p.y + el.height);
      }
    }

    if (settings.showGroups !== false) {
      for (const gl of layoutPositions.groupLayouts || []) {
        minX = Math.min(minX, gl.x);
        minY = Math.min(minY, gl.y);
        maxX = Math.max(maxX, gl.x + gl.width);
        maxY = Math.max(maxY, gl.y + gl.height);
      }
    }

    // Account for curved/elbow connectors sticking out past tables
    const refs = state.ast.refs || [];
    for (let i = 0; i < refs.length; i++) {
      const geom = computeRefGeometry(refs[i], measured, positions, state.refOffsets, i, settings);
      if (!geom) continue;
      minX = Math.min(minX, geom.x1 - 24, geom.x2 - 24, geom.midX - 24);
      maxX = Math.max(maxX, geom.x1 + 24, geom.x2 + 24, geom.midX + 24);
      minY = Math.min(minY, geom.y1 - 24, geom.y2 - 24);
      maxY = Math.max(maxY, geom.y1 + 24, geom.y2 + 24);
    }

    if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, width: 640, height: 400 };
    }

    const bx = Math.floor(minX - pad);
    const by = Math.floor(minY - pad);
    const width = Math.ceil(maxX - minX + pad * 2);
    const height = Math.ceil(maxY - minY + pad * 2);

    return { minX: bx, minY: by, width: Math.max(100, width), height: Math.max(100, height) };
  }

  DBStudio.renderer = {
    PALETTES,
    svgEl,
    normalizeHex,
    getContrastTextColor,
    computeRefGeometry,
    renderSceneInto,
    computeDiagramBounds
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.renderer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
