(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});
  const STORAGE_KEY = 'dbdiagram_oss_studio_v1';

  const HEADER_SWATCHES = [
    '#2563eb',
    '#1d4ed8',
    '#0284c7',
    '#0d9488',
    '#059669',
    '#10b981',
    '#d97706',
    '#ea580c',
    '#dc2626',
    '#db2777',
    '#7c3aed',
    '#4f46e5',
    '#334155',
    '#1e293b'
  ];

  const state = {
    projectName: 'E-commerce Completo',
    theme: 'dark',
    lang: 'pt',
    settings: {
      diagramFontSize: 14,
      diagramFontFamily: 'sans',
      headerFontScale: 1.15,
      editorFontSize: 14,
      lineStyle: 'orthogonal',
      showTypes: true,
      showBadges: true,
      showEnums: true,
      showGroups: true,
      showGrid: true
    },
    ast: { tables: [], enums: [], tableGroups: [], refs: [], errors: [], project: {} },
    measured: null,
    positions: {},
    hasCustomLayout: false,
    refOffsets: {},
    viewport: { panX: 20, panY: 20, zoom: 1 },
    editorWidthPct: 38,
    editorCollapsed: false,
    hoveredTable: null,
    hoveredColumn: null,
    hoveredRefKey: null,
    highlightedTable: null,
    exportTab: 'png',
    exportTheme: 'current',
    exportScale: 1,
    exportSqlDialect: 'postgresql'
  };

  let editorCtrl = null;
  let parseTimer = null;
  let activeDrag = null;
  let colorTargetTable = null;
  let searchHighlightTimer = null;

  // DOM helper
  function $(id) {
    return document.getElementById(id);
  }

  function t(key, vars) {
    return DBStudio.i18n.t(key, vars);
  }

  function showToast(msg, isError) {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' is-error' : '');
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 250);
    }, 2600);
  }

  function saveState() {
    try {
      const payload = {
        projectName: state.projectName,
        dbml: editorCtrl ? editorCtrl.getValue() : '',
        theme: state.theme,
        lang: state.lang,
        settings: state.settings,
        positions: state.positions,
        hasCustomLayout: state.hasCustomLayout,
        refOffsets: state.refOffsets,
        viewport: state.viewport,
        editorWidthPct: state.editorWidthPct
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_e) {
      // Ignore storage quota errors
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const icon = $('theme-icon');
    if (icon) {
      icon.textContent = state.theme === 'dark' ? '☀️' : '🌙';
    }
    const canvasWrap = $('canvas-wrap');
    if (canvasWrap) {
      canvasWrap.classList.toggle('no-grid', state.settings.showGrid === false);
    }
  }

  function applyTranslations() {
    DBStudio.i18n.setLang(state.lang);
    document.documentElement.lang = state.lang === 'pt' ? 'pt-BR' : 'en';

    const nodes = document.querySelectorAll('[data-i18n]');
    nodes.forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });

    const titleNodes = document.querySelectorAll('[data-i18n-title]');
    titleNodes.forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });

    const placeholderNodes = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderNodes.forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });

    const langBadge = $('lang-badge');
    if (langBadge) langBadge.textContent = state.lang.toUpperCase();

    updateStatusBar();
    updateSyntaxStatus();
  }

  function syncFontControlsUI() {
    const fs = state.settings.diagramFontSize;
    if ($('input-font-size')) $('input-font-size').value = String(fs);
    if ($('range-font-size')) $('range-font-size').value = String(fs);
    if ($('pop-font-size-val')) $('pop-font-size-val').textContent = fs + 'px';
    if ($('select-font-family')) $('select-font-family').value = state.settings.diagramFontFamily;
    if ($('select-header-scale')) $('select-header-scale').value = String(state.settings.headerFontScale);
    if ($('editor-font-val')) $('editor-font-val').textContent = state.settings.editorFontSize + 'px';

    document.querySelectorAll('.font-preset-btn').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-size')) === fs);
    });
  }

  function syncViewOptionsUI() {
    if ($('select-line-style')) $('select-line-style').value = state.settings.lineStyle;
    if ($('chk-show-types')) $('chk-show-types').checked = state.settings.showTypes !== false;
    if ($('chk-show-badges')) $('chk-show-badges').checked = state.settings.showBadges !== false;
    if ($('chk-show-enums')) $('chk-show-enums').checked = state.settings.showEnums !== false;
    if ($('chk-show-groups')) $('chk-show-groups').checked = state.settings.showGroups !== false;
    if ($('chk-show-grid')) $('chk-show-grid').checked = state.settings.showGrid !== false;
  }

  function updateViewportTransform() {
    const vp = $('diagram-viewport');
    if (vp) {
      vp.setAttribute(
        'transform',
        `translate(${state.viewport.panX}, ${state.viewport.panY}) scale(${state.viewport.zoom})`
      );
    }
    const zoomLabel = $('zoom-label');
    if (zoomLabel) {
      zoomLabel.textContent = Math.round(state.viewport.zoom * 100) + '%';
    }
    // Sync background dot grid with zoom & pan
    const canvasWrap = $('canvas-wrap');
    if (canvasWrap) {
      const step = Math.max(10, 24 * state.viewport.zoom);
      canvasWrap.style.backgroundSize = `${step}px ${step}px`;
      canvasWrap.style.backgroundPosition = `${state.viewport.panX}px ${state.viewport.panY}px`;
    }
  }

  function updateStatusBar() {
    const tablesCount = state.ast.tables ? state.ast.tables.length : 0;
    const refsCount = state.ast.refs ? state.ast.refs.length : 0;
    const enumsCount = state.ast.enums ? state.ast.enums.length : 0;
    if ($('status-tables')) $('status-tables').textContent = t('tablesCount', { n: tablesCount });
    if ($('status-refs')) $('status-refs').textContent = t('refsCount', { n: refsCount });
    if ($('status-enums')) $('status-enums').textContent = t('enumsCount', { n: enumsCount });
  }

  function updateSyntaxStatus() {
    const errs = state.ast.errors || [];
    const badge = $('syntax-status');
    const errPanel = $('editor-errors');
    if (badge) {
      if (errs.length === 0) {
        badge.className = 'syntax-badge is-valid';
        badge.textContent = '✓ ' + t('syntaxValid');
      } else {
        badge.className = 'syntax-badge is-error';
        badge.textContent = '⚠ ' + t('syntaxErrors', { n: errs.length });
      }
    }
    if (errPanel) {
      if (errs.length === 0) {
        errPanel.hidden = true;
        errPanel.innerHTML = '';
      } else {
        errPanel.hidden = false;
        errPanel.innerHTML = errs
          .slice(0, 5)
          .map(
            (e) =>
              `<button type="button" class="error-item" data-line="${e.line}">` +
              `<span class="error-line">L${e.line}</span> ` +
              `<span class="error-msg">${escapeHtml(e.message)}</span>` +
              `</button>`
          )
          .join('');
      }
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getLayers() {
    return {
      groups: $('layer-groups'),
      refs: $('layer-refs'),
      tables: $('layer-tables'),
      enums: $('layer-enums')
    };
  }

  function renderDiagramOnly() {
    if (!state.measured) return;
    const layoutPositions = DBStudio.layout.computePositions(
      state.ast,
      state.measured,
      state.positions,
      false
    );
    state.positions = layoutPositions.positions;
    state.layoutPositions = layoutPositions;

    DBStudio.renderer.renderSceneInto(document, getLayers(), state, state.measured, layoutPositions, {
      isExport: false
    });

    const emptyEl = $('canvas-empty');
    if (emptyEl) {
      emptyEl.hidden = (state.ast.tables || []).length > 0 || (state.ast.enums || []).length > 0;
    }
    updateViewportTransform();
  }

  function remeasureAndRender(forceAutoLayout) {
    state.measured = DBStudio.layout.measureAllNodes(state.ast, state.settings);
    const shouldReset = Boolean(forceAutoLayout) || !state.hasCustomLayout;
    const layoutPositions = DBStudio.layout.computePositions(
      state.ast,
      state.measured,
      shouldReset ? null : state.positions,
      shouldReset
    );
    state.positions = layoutPositions.positions;
    state.layoutPositions = layoutPositions;
    if (forceAutoLayout) {
      state.hasCustomLayout = false;
    }

    DBStudio.renderer.renderSceneInto(document, getLayers(), state, state.measured, layoutPositions, {
      isExport: false
    });

    const emptyEl = $('canvas-empty');
    if (emptyEl) {
      emptyEl.hidden = (state.ast.tables || []).length > 0 || (state.ast.enums || []).length > 0;
    }
    updateViewportTransform();
  }

  function parseAndRender(forceAutoLayout) {
    const dbmlText = editorCtrl ? editorCtrl.getValue() : '';
    state.ast = DBStudio.parser.parseDBML(dbmlText);
    if (editorCtrl) {
      editorCtrl.setErrors(state.ast.errors);
    }
    remeasureAndRender(forceAutoLayout);
    updateSyntaxStatus();
    updateStatusBar();
    saveState();
  }

  function setDiagramFontSize(newSize) {
    const clamped = Math.max(8, Math.min(36, Math.round(Number(newSize) || 14)));
    state.settings.diagramFontSize = clamped;
    syncFontControlsUI();
    remeasureAndRender(false);
    saveState();
    if (!$('modal-export').hidden) {
      refreshExportModal();
    }
  }

  function fitToScreen() {
    if (!state.measured || !state.layoutPositions) return;
    const svg = $('diagram-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const bounds = DBStudio.renderer.computeDiagramBounds(state, state.measured, state.layoutPositions, 48);
    const scaleX = rect.width / bounds.width;
    const scaleY = rect.height / bounds.height;
    const zoom = Math.max(0.2, Math.min(1.5, Math.min(scaleX, scaleY)));

    state.viewport.zoom = zoom;
    state.viewport.panX = (rect.width - bounds.width * zoom) / 2 - bounds.minX * zoom;
    state.viewport.panY = (rect.height - bounds.height * zoom) / 2 - bounds.minY * zoom;
    updateViewportTransform();
    saveState();
  }

  function zoomAroundCenter(factor) {
    const svg = $('diagram-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    zoomAroundPoint(cx, cy, factor);
  }

  function zoomAroundPoint(screenX, screenY, factor) {
    const oldZoom = state.viewport.zoom;
    const newZoom = Math.max(0.2, Math.min(3.0, oldZoom * factor));
    const ratio = newZoom / oldZoom;
    state.viewport.panX = screenX - (screenX - state.viewport.panX) * ratio;
    state.viewport.panY = screenY - (screenY - state.viewport.panY) * ratio;
    state.viewport.zoom = newZoom;
    updateViewportTransform();
    saveState();
  }

  function loadSample(sampleKey) {
    const sample = DBStudio.samples[sampleKey];
    if (!sample) return;
    state.projectName = sample.name;
    if ($('input-project-name')) $('input-project-name').value = sample.name;
    state.hasCustomLayout = false;
    state.positions = {};
    state.refOffsets = {};
    editorCtrl.setValue(sample.dbml, true);
    parseAndRender(true);
    setTimeout(fitToScreen, 20);
  }

  // Tooltip helper
  function showCanvasTooltip(clientX, clientY, html) {
    const tip = $('canvas-tooltip');
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14;
    let left = clientX + pad;
    let top = clientY + pad;
    const tipRect = tip.getBoundingClientRect();
    if (left + tipRect.width > window.innerWidth - 10) {
      left = clientX - tipRect.width - pad;
    }
    if (top + tipRect.height > window.innerHeight - 10) {
      top = clientY - tipRect.height - pad;
    }
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function hideCanvasTooltip() {
    const tip = $('canvas-tooltip');
    if (tip) tip.hidden = true;
  }

  // Popover management
  function closeAllPopovers(exceptId) {
    document.querySelectorAll('.popover-panel').forEach((p) => {
      if (p.id !== exceptId) p.hidden = true;
    });
  }

  function togglePopover(panelId, anchorBtn) {
    const panel = $(panelId);
    if (!panel) return;
    const willOpen = panel.hidden;
    closeAllPopovers(panelId);
    panel.hidden = !willOpen;
    if (willOpen && anchorBtn) {
      const rect = anchorBtn.getBoundingClientRect();
      const panelWidth = panel.offsetWidth || 280;
      const left = Math.min(window.innerWidth - panelWidth - 12, Math.max(10, rect.left));
      panel.style.top = rect.bottom + 8 + 'px';
      panel.style.left = left + 'px';
    }
  }

  // Table header color popover
  function openHeaderColorPopover(tableName, clientX, clientY) {
    colorTargetTable = tableName;
    const pop = $('popover-header-color');
    if (!pop) return;
    closeAllPopovers('popover-header-color');

    const tbl = (state.ast.tables || []).find((tb) => tb.fullName === tableName);
    const current = tbl && tbl.headerColor ? DBStudio.renderer.normalizeHex(tbl.headerColor, '#2563eb') : '#2563eb';
    if ($('input-custom-header-color')) $('input-custom-header-color').value = current;

    pop.hidden = false;
    const pw = pop.offsetWidth || 230;
    const ph = pop.offsetHeight || 160;
    pop.style.left = Math.min(window.innerWidth - pw - 12, Math.max(12, clientX - pw / 2)) + 'px';
    pop.style.top = Math.min(window.innerHeight - ph - 12, Math.max(54, clientY + 14)) + 'px';
  }

  function applyTableHeaderColor(hex) {
    if (!colorTargetTable || !editorCtrl) return;
    const updated = DBStudio.parser.updateTableHeaderColor(editorCtrl.getValue(), colorTargetTable, hex);
    editorCtrl.setValue(updated, true);
    parseAndRender(false);
  }

  // Export modal logic
  function refreshExportModal() {
    const fs = state.settings.diagramFontSize;
    const fam = state.settings.diagramFontFamily;
    const famLabel =
      fam === 'mono' ? 'Monospace' : fam === 'classic' ? 'Arial/Helvetica' : 'Sans-serif';

    if ($('export-font-summary')) {
      $('export-font-summary').textContent = `${fs}px · ${famLabel}`;
    }

    const tab = state.exportTab;
    document.querySelectorAll('.export-tab-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });

    const isVisual = tab === 'png' || tab === 'svg' || tab === 'pdf';
    if ($('export-visual-options')) $('export-visual-options').hidden = !isVisual;
    if ($('export-png-scale-wrap')) $('export-png-scale-wrap').hidden = tab !== 'png';
    if ($('export-sql-options')) $('export-sql-options').hidden = tab !== 'sql';
    if ($('export-visual-preview-wrap')) $('export-visual-preview-wrap').hidden = !isVisual;
    if ($('export-code-preview-wrap')) $('export-code-preview-wrap').hidden = isVisual;

    const copyBtn = $('btn-export-copy');
    if (copyBtn) {
      copyBtn.hidden = tab === 'pdf';
    }

    if (isVisual) {
      if (!state.measured || !state.layoutPositions || (state.ast.tables || []).length === 0) {
        if ($('export-dimensions-val')) $('export-dimensions-val').textContent = '—';
        if ($('export-preview-stage')) $('export-preview-stage').innerHTML = '';
        return;
      }

      const bgTheme = tab === 'pdf' && state.exportTheme === 'transparent' ? 'light' : state.exportTheme;
      const res = DBStudio.exporter.buildExportSVGString(
        state,
        state.measured,
        state.layoutPositions,
        { bgTheme }
      );

      const scale = tab === 'png' ? Number(state.exportScale) || 1 : 1;
      const outW = Math.round(res.bounds.width * scale);
      const outH = Math.round(res.bounds.height * scale);

      if ($('export-dimensions-val')) {
        $('export-dimensions-val').textContent = `${outW} × ${outH} px`;
      }

      const stage = $('export-preview-stage');
      if (stage) {
        stage.classList.toggle('is-checker', bgTheme === 'transparent');
        stage.innerHTML = '';
        const previewSvg = res.svgElement.cloneNode(true);
        previewSvg.removeAttribute('width');
        previewSvg.removeAttribute('height');
        previewSvg.style.width = '100%';
        previewSvg.style.height = '100%';
        previewSvg.style.maxHeight = '290px';
        stage.appendChild(previewSvg);
      }
    } else {
      let code = '';
      if (tab === 'sql') {
        code = DBStudio.sql.toSQL(state.ast, state.exportSqlDialect);
      } else if (tab === 'dbml') {
        code = editorCtrl ? editorCtrl.getValue() : '';
      } else if (tab === 'json') {
        code = JSON.stringify(
          {
            version: 1,
            projectName: state.projectName,
            settings: state.settings,
            positions: state.positions,
            refOffsets: state.refOffsets,
            dbml: editorCtrl ? editorCtrl.getValue() : ''
          },
          null,
          2
        );
      }
      if ($('export-code-preview')) {
        $('export-code-preview').textContent = code;
      }
    }
  }

  async function executeExportDownload() {
    const tab = state.exportTab;
    const slug = DBStudio.exporter.slugify(state.projectName);

    if ((tab === 'png' || tab === 'svg' || tab === 'pdf') && (state.ast.tables || []).length === 0) {
      showToast(t('toastEmptyExport'), true);
      return;
    }

    try {
      if (tab === 'svg') {
        const res = DBStudio.exporter.buildExportSVGString(
          state,
          state.measured,
          state.layoutPositions,
          { bgTheme: state.exportTheme }
        );
        DBStudio.exporter.triggerDownload(res.svgString, slug + '.svg', 'image/svg+xml;charset=utf-8');
        showToast(t('toastExported'));
      } else if (tab === 'png') {
        const { blob } = await DBStudio.exporter.exportPNGBlob(
          state,
          state.measured,
          state.layoutPositions,
          { bgTheme: state.exportTheme, scale: state.exportScale }
        );
        DBStudio.exporter.triggerDownload(blob, slug + '.png');
        showToast(t('toastExported'));
      } else if (tab === 'pdf') {
        const pdfBlob = await DBStudio.exporter.exportPDFBlob(
          state,
          state.measured,
          state.layoutPositions,
          { bgTheme: state.exportTheme }
        );
        DBStudio.exporter.triggerDownload(pdfBlob, slug + '.pdf');
        showToast(t('toastExported'));
      } else if (tab === 'sql') {
        const sql = DBStudio.sql.toSQL(state.ast, state.exportSqlDialect);
        DBStudio.exporter.triggerDownload(sql, slug + '.sql', 'text/sql;charset=utf-8');
        showToast(t('toastExported'));
      } else if (tab === 'dbml') {
        DBStudio.exporter.triggerDownload(editorCtrl.getValue(), slug + '.dbml', 'text/plain;charset=utf-8');
        showToast(t('toastExported'));
      } else if (tab === 'json') {
        const json = $('export-code-preview').textContent;
        DBStudio.exporter.triggerDownload(json, slug + '.json', 'application/json;charset=utf-8');
        showToast(t('toastExported'));
      }
    } catch (err) {
      showToast(err.message || 'Erro ao exportar', true);
    }
  }

  async function executeExportCopy() {
    const tab = state.exportTab;
    try {
      if (tab === 'png') {
        if ((state.ast.tables || []).length === 0) {
          showToast(t('toastEmptyExport'), true);
          return;
        }
        const { blob } = await DBStudio.exporter.exportPNGBlob(
          state,
          state.measured,
          state.layoutPositions,
          { bgTheme: state.exportTheme, scale: state.exportScale }
        );
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast(t('toastCopied'));
        } else {
          showToast(t('toastCopyError'), true);
        }
      } else if (tab === 'svg') {
        const res = DBStudio.exporter.buildExportSVGString(
          state,
          state.measured,
          state.layoutPositions,
          { bgTheme: state.exportTheme }
        );
        await navigator.clipboard.writeText(res.svgString);
        showToast(t('toastCopied'));
      } else {
        const text = $('export-code-preview') ? $('export-code-preview').textContent : '';
        await navigator.clipboard.writeText(text);
        showToast(t('toastCopied'));
      }
    } catch (_e) {
      showToast(t('toastCopyError'), true);
    }
  }

  // Import logic
  function handleImportedFileContent(filename, text) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (ext === 'json') {
      try {
        const data = JSON.parse(text);
        if (!data || typeof data.dbml !== 'string') {
          showToast(t('jsonInvalidError'), true);
          return false;
        }
        if (data.projectName) {
          state.projectName = data.projectName;
          if ($('input-project-name')) $('input-project-name').value = data.projectName;
        }
        if (data.settings) {
          Object.assign(state.settings, data.settings);
          syncFontControlsUI();
          syncViewOptionsUI();
          editorCtrl.setFontSize(state.settings.editorFontSize);
        }
        state.positions = data.positions || {};
        state.hasCustomLayout = Object.keys(state.positions).length > 0;
        state.refOffsets = data.refOffsets || {};
        editorCtrl.setValue(data.dbml, true);
        parseAndRender(!state.hasCustomLayout);
        setTimeout(fitToScreen, 20);
        showToast(t('toastImported'));
        return true;
      } catch (_e) {
        showToast(t('jsonInvalidError'), true);
        return false;
      }
    }

    if (ext === 'sql') {
      const converted = DBStudio.sql.fromSQL(text);
      if (!converted) {
        showToast(t('sqlImportError'), true);
        return false;
      }
      state.hasCustomLayout = false;
      state.positions = {};
      state.refOffsets = {};
      editorCtrl.setValue(converted, true);
      parseAndRender(true);
      setTimeout(fitToScreen, 20);
      showToast(t('toastImported'));
      return true;
    }

    // Default .dbml / .txt
    state.hasCustomLayout = false;
    state.positions = {};
    state.refOffsets = {};
    editorCtrl.setValue(text, true);
    parseAndRender(true);
    setTimeout(fitToScreen, 20);
    showToast(t('toastImported'));
    return true;
  }

  // Search modal
  function openSearchModal() {
    const modal = $('modal-search');
    if (!modal) return;
    modal.hidden = false;
    const inp = $('input-search-table');
    if (inp) {
      inp.value = '';
      inp.focus();
    }
    renderSearchResults('');
  }

  function renderSearchResults(query) {
    const list = $('search-results-list');
    if (!list) return;
    const q = (query || '').trim().toLowerCase();
    const items = [];

    for (const tb of state.ast.tables || []) {
      if (!q || tb.fullName.toLowerCase().includes(q)) {
        items.push({ kind: 'table', name: tb.fullName, cols: tb.columns.length });
      }
    }
    for (const en of state.ast.enums || []) {
      if (!q || en.fullName.toLowerCase().includes(q)) {
        items.push({ kind: 'enum', name: en.fullName, cols: en.values.length });
      }
    }

    if (items.length === 0) {
      list.innerHTML = `<div class="search-empty">${escapeHtml(t('noResults'))}</div>`;
      return;
    }

    list.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="search-result-item" data-kind="${it.kind}" data-name="${escapeHtml(it.name)}">` +
          `<span class="search-kind-pill">${it.kind === 'enum' ? 'ENUM' : 'TABLE'}</span>` +
          `<span class="search-name">${escapeHtml(it.name)}</span>` +
          `<span class="search-meta">${it.cols}</span>` +
          `</button>`
      )
      .join('');
  }

  function focusNodeOnCanvas(kind, name) {
    const svg = $('diagram-svg');
    if (!svg || !state.measured) return;
    const key = kind === 'enum' ? 'enum:' + name : name;
    const pos = state.positions[key];
    const layout =
      kind === 'enum' ? state.measured.enumLayouts[name] : state.measured.tableLayouts[name];
    if (!pos || !layout) return;

    const rect = svg.getBoundingClientRect();
    const targetZoom = Math.max(0.85, Math.min(1.25, state.viewport.zoom));
    state.viewport.zoom = targetZoom;
    state.viewport.panX = rect.width / 2 - (pos.x + layout.width / 2) * targetZoom;
    state.viewport.panY = rect.height / 2 - (pos.y + layout.height / 2) * targetZoom;

    if (kind === 'table') {
      state.highlightedTable = name;
      clearTimeout(searchHighlightTimer);
      searchHighlightTimer = setTimeout(() => {
        state.highlightedTable = null;
        renderDiagramOnly();
      }, 2200);
    }

    renderDiagramOnly();
  }

  // Event setup
  function setupInteractions() {
    // 1. Header Swatches
    const swatchContainer = $('header-color-swatches');
    if (swatchContainer) {
      swatchContainer.innerHTML = HEADER_SWATCHES.map(
        (hex) =>
          `<button type="button" class="swatch-btn" data-color="${hex}" style="background:${hex}" title="${hex}"></button>`
      ).join('');
      swatchContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.swatch-btn');
        if (!btn) return;
        applyTableHeaderColor(btn.getAttribute('data-color'));
        $('popover-header-color').hidden = true;
      });
    }
    if ($('input-custom-header-color')) {
      $('input-custom-header-color').addEventListener('input', (e) => {
        applyTableHeaderColor(e.target.value);
      });
    }
    if ($('btn-reset-header-color')) {
      $('btn-reset-header-color').addEventListener('click', () => {
        applyTableHeaderColor(null);
        $('popover-header-color').hidden = true;
      });
    }

    // 2. Project Name
    if ($('input-project-name')) {
      $('input-project-name').addEventListener('input', (e) => {
        state.projectName = e.target.value || t('defaultProjectName');
        saveState();
      });
    }

    // 3. Samples Dropdown
    $('btn-samples').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopover('popover-samples', $('btn-samples'));
    });
    $('popover-samples').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sample]');
      if (!btn) return;
      loadSample(btn.getAttribute('data-sample'));
      $('popover-samples').hidden = true;
    });

    // 4. Font Size Controls (Toolbar + Typography Popover)
    $('btn-font-dec').addEventListener('click', () => {
      setDiagramFontSize(state.settings.diagramFontSize - 1);
    });
    $('btn-font-inc').addEventListener('click', () => {
      setDiagramFontSize(state.settings.diagramFontSize + 1);
    });
    $('input-font-size').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (val >= 8 && val <= 36) {
        setDiagramFontSize(val);
      }
    });
    $('input-font-size').addEventListener('blur', () => {
      syncFontControlsUI();
    });

    $('btn-typography').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopover('popover-typography', $('btn-typography'));
    });
    $('range-font-size').addEventListener('input', (e) => {
      setDiagramFontSize(Number(e.target.value));
    });
    document.querySelectorAll('.font-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setDiagramFontSize(Number(btn.getAttribute('data-size')));
      });
    });
    $('select-font-family').addEventListener('change', (e) => {
      state.settings.diagramFontFamily = e.target.value;
      remeasureAndRender(false);
      saveState();
    });
    $('select-header-scale').addEventListener('change', (e) => {
      state.settings.headerFontScale = Number(e.target.value);
      remeasureAndRender(false);
      saveState();
    });

    // Editor font size inside typography popover & editor header
    function changeEditorFont(delta) {
      state.settings.editorFontSize = Math.max(11, Math.min(24, state.settings.editorFontSize + delta));
      editorCtrl.setFontSize(state.settings.editorFontSize);
      syncFontControlsUI();
      saveState();
    }
    $('btn-editor-font-dec').addEventListener('click', () => changeEditorFont(-1));
    $('btn-editor-font-inc').addEventListener('click', () => changeEditorFont(1));
    $('btn-ed-small-dec').addEventListener('click', () => changeEditorFont(-1));
    $('btn-ed-small-inc').addEventListener('click', () => changeEditorFont(1));

    // 5. Auto-Layout & View Options
    $('btn-auto-layout').addEventListener('click', () => {
      state.refOffsets = {};
      remeasureAndRender(true);
      fitToScreen();
      saveState();
      showToast(t('toastLayoutDone'));
    });

    $('btn-view-options').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopover('popover-view', $('btn-view-options'));
    });
    $('select-line-style').addEventListener('change', (e) => {
      state.settings.lineStyle = e.target.value;
      renderDiagramOnly();
      saveState();
    });
    $('chk-show-types').addEventListener('change', (e) => {
      state.settings.showTypes = e.target.checked;
      remeasureAndRender(false);
      saveState();
    });
    $('chk-show-badges').addEventListener('change', (e) => {
      state.settings.showBadges = e.target.checked;
      remeasureAndRender(false);
      saveState();
    });
    $('chk-show-enums').addEventListener('change', (e) => {
      state.settings.showEnums = e.target.checked;
      remeasureAndRender(false);
      saveState();
    });
    $('chk-show-groups').addEventListener('change', (e) => {
      state.settings.showGroups = e.target.checked;
      renderDiagramOnly();
      saveState();
    });
    $('chk-show-grid').addEventListener('change', (e) => {
      state.settings.showGrid = e.target.checked;
      applyTheme();
      saveState();
    });
    $('btn-reset-routes').addEventListener('click', () => {
      state.refOffsets = {};
      renderDiagramOnly();
      saveState();
      showToast(t('toastRoutesReset'));
    });

    // 6. Theme & Language
    $('btn-theme-toggle').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      renderDiagramOnly();
      saveState();
    });
    $('btn-lang-toggle').addEventListener('click', () => {
      state.lang = state.lang === 'pt' ? 'en' : 'pt';
      applyTranslations();
      renderDiagramOnly();
      saveState();
    });

    // 7. Editor toolbar actions
    $('btn-format-dbml').addEventListener('click', () => {
      const formatted = DBStudio.parser.formatDBML(editorCtrl.getValue());
      editorCtrl.setValue(formatted, true);
      parseAndRender(false);
      showToast(t('toastFormatted'));
    });
    $('btn-copy-dbml').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(editorCtrl.getValue());
        showToast(t('toastCopied'));
      } catch (_e) {
        showToast(t('toastCopyError'), true);
      }
    });
    $('editor-errors').addEventListener('click', (e) => {
      const item = e.target.closest('.error-item');
      if (!item) return;
      editorCtrl.jumpToLine(Number(item.getAttribute('data-line')));
    });

    // 8. Canvas Zoom & Focus controls
    $('btn-zoom-in').addEventListener('click', () => zoomAroundCenter(1.18));
    $('btn-zoom-out').addEventListener('click', () => zoomAroundCenter(1 / 1.18));
    $('btn-zoom-reset').addEventListener('click', () => {
      const rect = $('diagram-svg').getBoundingClientRect();
      zoomAroundPoint(rect.width / 2, rect.height / 2, 1 / state.viewport.zoom);
    });
    $('btn-zoom-fit').addEventListener('click', fitToScreen);
    $('btn-toggle-editor').addEventListener('click', () => {
      state.editorCollapsed = !state.editorCollapsed;
      $('workspace').classList.toggle('is-editor-collapsed', state.editorCollapsed);
      setTimeout(fitToScreen, 40);
    });

    // 9. Split Pane Resizer
    const resizer = $('split-resizer');
    const editorPane = $('editor-pane');
    const workspace = $('workspace');
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = editorPane.getBoundingClientRect().width;
      const totalW = workspace.getBoundingClientRect().width;
      resizer.classList.add('is-dragging');

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const pct = Math.max(20, Math.min(65, ((startW + dx) / totalW) * 100));
        state.editorWidthPct = pct;
        editorPane.style.width = pct + '%';
      }
      function onUp() {
        resizer.classList.remove('is-dragging');
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        saveState();
      }
      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
    });

    // 10. SVG Canvas Pointer & Wheel Interactions
    const svg = $('diagram-svg');

    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAroundPoint(sx, sy, factor);
      },
      { passive: false }
    );

    svg.addEventListener('pointerdown', (e) => {
      closeAllPopovers();
      if (e.button !== 0 && e.button !== 1) return;

      // Color trigger click
      const colorTrig = e.target.closest('.table-color-trigger');
      if (colorTrig && e.button === 0) {
        e.stopPropagation();
        openHeaderColorPopover(colorTrig.getAttribute('data-table'), e.clientX, e.clientY);
        return;
      }

      // Ref midpoint drag
      const refHandle = e.target.closest('.ref-midpoint-handle');
      if (refHandle && e.button === 0) {
        e.stopPropagation();
        const refKey = refHandle.getAttribute('data-ref-key');
        activeDrag = {
          kind: 'ref',
          refKey,
          startX: e.clientX,
          initialOffset: state.refOffsets[refKey] || 0
        };
        svg.setPointerCapture(e.pointerId);
        return;
      }

      // Table drag
      const tableHandle = e.target.closest('.table-drag-handle');
      if (tableHandle && e.button === 0) {
        e.stopPropagation();
        const tblName = tableHandle.getAttribute('data-table');
        const p = state.positions[tblName] || { x: 0, y: 0 };
        activeDrag = {
          kind: 'table',
          key: tblName,
          startX: e.clientX,
          startY: e.clientY,
          origX: p.x,
          origY: p.y
        };
        svg.setPointerCapture(e.pointerId);
        return;
      }

      // Enum drag
      const enumHandle = e.target.closest('.enum-drag-handle');
      if (enumHandle && e.button === 0) {
        e.stopPropagation();
        const enumKey = 'enum:' + enumHandle.getAttribute('data-enum');
        const p = state.positions[enumKey] || { x: 0, y: 0 };
        activeDrag = {
          kind: 'table',
          key: enumKey,
          startX: e.clientX,
          startY: e.clientY,
          origX: p.x,
          origY: p.y
        };
        svg.setPointerCapture(e.pointerId);
        return;
      }

      // TableGroup drag (moves all member tables together)
      const groupHandle = e.target.closest('.group-drag-handle');
      if (groupHandle && e.button === 0) {
        e.stopPropagation();
        const grpName = groupHandle.getAttribute('data-group-name');
        const grp = (state.ast.tableGroups || []).find((g) => g.name === grpName);
        if (grp && grp.resolvedTables && grp.resolvedTables.length > 0) {
          const snapshot = {};
          for (const mName of grp.resolvedTables) {
            if (state.positions[mName]) {
              snapshot[mName] = { x: state.positions[mName].x, y: state.positions[mName].y };
            }
          }
          activeDrag = {
            kind: 'group',
            snapshot,
            startX: e.clientX,
            startY: e.clientY
          };
          svg.setPointerCapture(e.pointerId);
          return;
        }
      }

      // Otherwise pan canvas
      activeDrag = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origPanX: state.viewport.panX,
        origPanY: state.viewport.panY
      };
      svg.classList.add('is-panning');
      svg.setPointerCapture(e.pointerId);
    });

    svg.addEventListener('pointermove', (e) => {
      if (activeDrag) {
        hideCanvasTooltip();
        if (activeDrag.kind === 'pan') {
          state.viewport.panX = activeDrag.origPanX + (e.clientX - activeDrag.startX);
          state.viewport.panY = activeDrag.origPanY + (e.clientY - activeDrag.startY);
          updateViewportTransform();
        } else if (activeDrag.kind === 'table') {
          const dx = (e.clientX - activeDrag.startX) / state.viewport.zoom;
          const dy = (e.clientY - activeDrag.startY) / state.viewport.zoom;
          state.positions[activeDrag.key] = {
            x: Math.round(activeDrag.origX + dx),
            y: Math.round(activeDrag.origY + dy)
          };
          state.hasCustomLayout = true;
          renderDiagramOnly();
        } else if (activeDrag.kind === 'group') {
          const dx = (e.clientX - activeDrag.startX) / state.viewport.zoom;
          const dy = (e.clientY - activeDrag.startY) / state.viewport.zoom;
          for (const k of Object.keys(activeDrag.snapshot)) {
            state.positions[k] = {
              x: Math.round(activeDrag.snapshot[k].x + dx),
              y: Math.round(activeDrag.snapshot[k].y + dy)
            };
          }
          state.hasCustomLayout = true;
          renderDiagramOnly();
        } else if (activeDrag.kind === 'ref') {
          const dx = (e.clientX - activeDrag.startX) / state.viewport.zoom;
          state.refOffsets[activeDrag.refKey] = Math.round(activeDrag.initialOffset + dx);
          renderDiagramOnly();
        }
        return;
      }

      // Hover highlighting & tooltips
      const refEl = e.target.closest('.diagram-ref');
      const colEl = e.target.closest('.table-col-row');
      const tblEl = e.target.closest('.diagram-table');

      let needsRender = false;
      const newHoveredRef = refEl ? refEl.getAttribute('data-ref-key') : null;
      const newHoveredTable = tblEl ? tblEl.getAttribute('data-table') : null;
      const newHoveredCol = colEl
        ? { table: colEl.getAttribute('data-table'), column: colEl.getAttribute('data-column') }
        : null;

      if (newHoveredRef !== state.hoveredRefKey) {
        state.hoveredRefKey = newHoveredRef;
        needsRender = true;
      }
      if (newHoveredTable !== state.hoveredTable) {
        state.hoveredTable = newHoveredTable;
        needsRender = true;
      }
      const prevColKey = state.hoveredColumn
        ? state.hoveredColumn.table + '.' + state.hoveredColumn.column
        : null;
      const nextColKey = newHoveredCol ? newHoveredCol.table + '.' + newHoveredCol.column : null;
      if (prevColKey !== nextColKey) {
        state.hoveredColumn = newHoveredCol;
        needsRender = true;
      }

      if (needsRender) {
        renderDiagramOnly();
      }

      // Show contextual tooltip
      if (refEl) {
        const refObj = (state.ast.refs || []).find((r) => r.key === newHoveredRef);
        if (refObj) {
          let extra = '';
          if (refObj.deleteAction) extra += ` · ON DELETE ${escapeHtml(refObj.deleteAction.toUpperCase())}`;
          if (refObj.updateAction) extra += ` · ON UPDATE ${escapeHtml(refObj.updateAction.toUpperCase())}`;
          showCanvasTooltip(
            e.clientX,
            e.clientY,
            `<strong>${escapeHtml(refObj.fromTable + '.' + refObj.fromColumn)}</strong> ` +
              `<span class="tip-op">${escapeHtml(refObj.op)}</span> ` +
              `<strong>${escapeHtml(refObj.toTable + '.' + refObj.toColumn)}</strong>` +
              (extra ? `<div class="tip-sub">${extra}</div>` : '') +
              `<div class="tip-hint">${escapeHtml(t('dragLineHint'))}</div>`
          );
          return;
        }
      }

      if (colEl && newHoveredCol) {
        const tbl = (state.ast.tables || []).find((tb) => tb.fullName === newHoveredCol.table);
        const col = tbl && tbl.columns.find((c) => c.name === newHoveredCol.column);
        if (col && (col.note || col.defaultValue !== null)) {
          let html = `<strong>${escapeHtml(col.name)}</strong> <span class="tip-sub">${escapeHtml(col.type)}</span>`;
          if (col.defaultValue !== null) {
            html += `<div class="tip-sub">Default: <code>${escapeHtml(col.defaultValue)}</code></div>`;
          }
          if (col.note) {
            html += `<div class="tip-note">${escapeHtml(col.note)}</div>`;
          }
          showCanvasTooltip(e.clientX, e.clientY, html);
          return;
        }
      }

      const headerEl = e.target.closest('.table-drag-handle');
      if (headerEl) {
        const tbl = (state.ast.tables || []).find((tb) => tb.fullName === headerEl.getAttribute('data-table'));
        if (tbl && tbl.note) {
          showCanvasTooltip(
            e.clientX,
            e.clientY,
            `<strong>${escapeHtml(tbl.fullName)}</strong><div class="tip-note">${escapeHtml(tbl.note)}</div>`
          );
          return;
        }
      }

      hideCanvasTooltip();
    });

    svg.addEventListener('pointerup', (e) => {
      if (activeDrag) {
        activeDrag = null;
        svg.classList.remove('is-panning');
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch (_err) {}
        saveState();
      }
    });

    svg.addEventListener('pointerleave', () => {
      hideCanvasTooltip();
      if (state.hoveredTable || state.hoveredRefKey || state.hoveredColumn) {
        state.hoveredTable = null;
        state.hoveredRefKey = null;
        state.hoveredColumn = null;
        renderDiagramOnly();
      }
    });

    svg.addEventListener('dblclick', (e) => {
      const refHandle = e.target.closest('.ref-midpoint-handle');
      if (refHandle) {
        const key = refHandle.getAttribute('data-ref-key');
        delete state.refOffsets[key];
        renderDiagramOnly();
        saveState();
      }
    });

    // 11. Export Modal
    $('btn-open-export').addEventListener('click', () => {
      closeAllPopovers();
      $('modal-export').hidden = false;
      refreshExportModal();
    });

    document.querySelectorAll('.export-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.exportTab = btn.getAttribute('data-tab');
        refreshExportModal();
      });
    });

    $('select-export-theme').addEventListener('change', (e) => {
      state.exportTheme = e.target.value;
      refreshExportModal();
    });
    $('select-export-scale').addEventListener('change', (e) => {
      state.exportScale = Number(e.target.value) || 1;
      refreshExportModal();
    });
    $('select-sql-dialect').addEventListener('change', (e) => {
      state.exportSqlDialect = e.target.value;
      refreshExportModal();
    });
    $('btn-export-download').addEventListener('click', executeExportDownload);
    $('btn-export-copy').addEventListener('click', executeExportCopy);

    // 12. Import Modal
    $('btn-open-import').addEventListener('click', () => {
      closeAllPopovers();
      $('modal-import').hidden = false;
    });
    document.querySelectorAll('.import-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-import-tab');
        document.querySelectorAll('.import-tab-btn').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        $('import-panel-sql').hidden = tab !== 'sql';
        $('import-panel-file').hidden = tab !== 'file';
      });
    });

    $('btn-convert-sql').addEventListener('click', () => {
      const sql = $('textarea-import-sql').value;
      const converted = DBStudio.sql.fromSQL(sql);
      if (!converted) {
        showToast(t('sqlImportError'), true);
        return;
      }
      state.hasCustomLayout = false;
      state.positions = {};
      state.refOffsets = {};
      editorCtrl.setValue(converted, true);
      parseAndRender(true);
      setTimeout(fitToScreen, 20);
      $('modal-import').hidden = true;
      showToast(t('toastImported'));
    });

    const fileInput = $('input-import-file');
    const dropZone = $('import-dropzone');
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('is-dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('is-dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (!file) return;
      file.text().then((txt) => {
        if (handleImportedFileContent(file.name, txt)) {
          $('modal-import').hidden = true;
        }
      });
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        if (handleImportedFileContent(file.name, txt)) {
          $('modal-import').hidden = true;
        }
        fileInput.value = '';
      });
    });

    // 13. Search Modal
    $('btn-open-search').addEventListener('click', openSearchModal);
    $('input-search-table').addEventListener('input', (e) => {
      renderSearchResults(e.target.value);
    });
    $('search-results-list').addEventListener('click', (e) => {
      const item = e.target.closest('.search-result-item');
      if (!item) return;
      focusNodeOnCanvas(item.getAttribute('data-kind'), item.getAttribute('data-name'));
      $('modal-search').hidden = true;
    });
    $('input-search-table').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = $('search-results-list').querySelector('.search-result-item');
        if (first) {
          focusNodeOnCanvas(first.getAttribute('data-kind'), first.getAttribute('data-name'));
          $('modal-search').hidden = true;
        }
      }
    });

    // 14. Modal close buttons & backdrop clicks & global shortcuts
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close-modal');
        if ($(id)) $(id).hidden = true;
      });
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) bd.hidden = true;
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.popover-panel') && !e.target.closest('[data-popover-trigger]')) {
        closeAllPopovers();
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearchModal();
      } else if (e.key === 'Escape') {
        closeAllPopovers();
        document.querySelectorAll('.modal-backdrop').forEach((m) => {
          m.hidden = true;
        });
      }
    });
  }

  function init() {
    const saved = loadState();
    let initialDbml = DBStudio.samples.ecommerce.dbml;

    if (saved) {
      if (saved.projectName) state.projectName = saved.projectName;
      if (saved.theme) state.theme = saved.theme;
      if (saved.lang) state.lang = saved.lang;
      if (saved.settings) Object.assign(state.settings, saved.settings);
      if (saved.positions) state.positions = saved.positions;
      if (typeof saved.hasCustomLayout === 'boolean') state.hasCustomLayout = saved.hasCustomLayout;
      if (saved.refOffsets) state.refOffsets = saved.refOffsets;
      if (saved.viewport) Object.assign(state.viewport, saved.viewport);
      if (typeof saved.editorWidthPct === 'number') state.editorWidthPct = saved.editorWidthPct;
      if (typeof saved.dbml === 'string' && saved.dbml.trim().length > 0) {
        initialDbml = saved.dbml;
      }
    }

    if ($('input-project-name')) $('input-project-name').value = state.projectName;
    if ($('editor-pane')) $('editor-pane').style.width = state.editorWidthPct + '%';

    editorCtrl = DBStudio.editor.createEditorController({
      textarea: $('dbml-textarea'),
      highlightPre: $('editor-highlight'),
      gutter: $('editor-gutter'),
      cursorPosEl: $('status-cursor'),
      onChange: () => {
        clearTimeout(parseTimer);
        parseTimer = setTimeout(() => parseAndRender(false), 120);
      }
    });

    editorCtrl.setFontSize(state.settings.editorFontSize);
    editorCtrl.setValue(initialDbml, true);

    applyTheme();
    applyTranslations();
    syncFontControlsUI();
    syncViewOptionsUI();
    setupInteractions();

    parseAndRender(!state.hasCustomLayout);
    if (!saved) {
      setTimeout(fitToScreen, 30);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
