(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function slugify(str) {
    return (
      String(str || 'diagram')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'diagram'
    );
  }

  function resolveExportTheme(bgOption, currentTheme) {
    if (bgOption === 'light') return 'light';
    if (bgOption === 'dark') return 'dark';
    if (bgOption === 'transparent') return currentTheme === 'light' ? 'light' : 'dark';
    return currentTheme === 'light' ? 'light' : 'dark';
  }

  function buildExportSVGDocument(doc, state, measured, layoutPositions, options) {
    const opts = options || {};
    const bgOption = opts.bgTheme || 'current';
    const effectiveTheme = resolveExportTheme(bgOption, state.theme);
    const pal = DBStudio.renderer.PALETTES[effectiveTheme];
    const bounds = DBStudio.renderer.computeDiagramBounds(state, measured, layoutPositions, 40);

    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(bounds.width));
    svg.setAttribute('height', String(bounds.height));
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute('data-font-size', String(measured.metrics.baseFont));

    // Background rect (unless transparent)
    if (bgOption !== 'transparent') {
      svg.appendChild(
        DBStudio.renderer.svgEl(doc, 'rect', {
          x: 0,
          y: 0,
          width: bounds.width,
          height: bounds.height,
          fill: pal.canvasBg
        })
      );
    }

    const rootGroup = DBStudio.renderer.svgEl(doc, 'g', {
      transform: `translate(${-bounds.minX}, ${-bounds.minY})`
    });

    const layers = {
      groups: DBStudio.renderer.svgEl(doc, 'g', { id: 'export-groups' }),
      refs: DBStudio.renderer.svgEl(doc, 'g', { id: 'export-refs' }),
      tables: DBStudio.renderer.svgEl(doc, 'g', { id: 'export-tables' }),
      enums: DBStudio.renderer.svgEl(doc, 'g', { id: 'export-enums' })
    };

    rootGroup.appendChild(layers.groups);
    rootGroup.appendChild(layers.refs);
    rootGroup.appendChild(layers.tables);
    rootGroup.appendChild(layers.enums);
    svg.appendChild(rootGroup);

    DBStudio.renderer.renderSceneInto(doc, layers, state, measured, layoutPositions, {
      isExport: true,
      theme: effectiveTheme
    });

    return { svg, bounds, effectiveTheme };
  }

  function buildExportSVGString(state, measured, layoutPositions, options) {
    const doc = global.document;
    const { svg, bounds, effectiveTheme } = buildExportSVGDocument(
      doc,
      state,
      measured,
      layoutPositions,
      options
    );
    const serializer = new XMLSerializer();
    const xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(svg);
    return { svgString: xmlStr, svgElement: svg, bounds, effectiveTheme };
  }

  function renderSVGToCanvas(svgString, width, height, scale) {
    return new Promise((resolve, reject) => {
      const s = Math.max(1, Number(scale) || 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * s);
      canvas.height = Math.round(height * s);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = function () {
        try {
          ctx.save();
          ctx.scale(s, s);
          ctx.drawImage(img, 0, 0, width, height);
          ctx.restore();
          URL.revokeObjectURL(url);
          resolve(canvas);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to rasterize SVG diagram'));
      };

      img.src = url;
    });
  }

  function base64ToUint8Array(base64) {
    let binStr;
    if (typeof atob === 'function') {
      binStr = atob(base64);
    } else {
      binStr = Buffer.from(base64, 'base64').toString('binary');
    }
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  }

  function asciiBytes(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  /**
   * Builds a standalone valid PDF 1.4 file embedding a high-res JPEG canvas image,
   * sized exactly to the diagram CSS pixel dimensions converted to PDF points (72/96 = 0.75).
   */
  function buildPDFFromJPEGBytes(jpegBytes, imgWidthPx, imgHeightPx, logicalWidthPx, logicalHeightPx) {
    const pageW = (logicalWidthPx * 0.75).toFixed(2);
    const pageH = (logicalHeightPx * 0.75).toFixed(2);

    const chunks = [];
    let offset = 0;
    const objOffsets = [0]; // index 0 unused

    function pushBytes(u8) {
      chunks.push(u8);
      offset += u8.length;
    }
    function pushAscii(str) {
      pushBytes(asciiBytes(str));
    }

    pushAscii('%PDF-1.4\n');

    // 1: Catalog
    objOffsets[1] = offset;
    pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // 2: Pages
    objOffsets[2] = offset;
    pushAscii('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    // 3: Page
    objOffsets[3] = offset;
    pushAscii(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
    );

    // 4: Image XObject
    objOffsets[4] = offset;
    pushAscii(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidthPx} /Height ${imgHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    pushBytes(jpegBytes);
    pushAscii('\nendstream\nendobj\n');

    // 5: Content Stream
    const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    objOffsets[5] = offset;
    pushAscii(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

    // xref
    const xrefStart = offset;
    pushAscii('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) {
      const offStr = String(objOffsets[i]).padStart(10, '0');
      pushAscii(`${offStr} 00000 n \n`);
    }

    pushAscii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  async function exportPNGBlob(state, measured, layoutPositions, options) {
    const scale = Number((options && options.scale) || 1);
    const { svgString, bounds } = buildExportSVGString(state, measured, layoutPositions, options);
    const canvas = await renderSVGToCanvas(svgString, bounds.width, bounds.height, scale);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve({ blob, width: canvas.width, height: canvas.height });
        else reject(new Error('Failed to generate PNG blob'));
      }, 'image/png');
    });
  }

  async function exportPDFBlob(state, measured, layoutPositions, options) {
    const opts = Object.assign({}, options);
    if (opts.bgTheme === 'transparent') {
      opts.bgTheme = 'light';
    }
    const { svgString, bounds } = buildExportSVGString(state, measured, layoutPositions, opts);
    // Render crisp 2x canvas for sharp PDF text
    const pdfScale = 2;
    const canvas = await renderSVGToCanvas(svgString, bounds.width, bounds.height, pdfScale);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.96);
    const base64 = dataUrl.split(',')[1];
    const jpegBytes = base64ToUint8Array(base64);
    const pdfBytes = buildPDFFromJPEGBytes(
      jpegBytes,
      canvas.width,
      canvas.height,
      bounds.width,
      bounds.height
    );
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  function triggerDownload(blobOrText, filename, mimeType) {
    const blob =
      blobOrText instanceof Blob
        ? blobOrText
        : new Blob([blobOrText], { type: mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  DBStudio.exporter = {
    slugify,
    resolveExportTheme,
    buildExportSVGDocument,
    buildExportSVGString,
    renderSVGToCanvas,
    buildPDFFromJPEGBytes,
    exportPNGBlob,
    exportPDFBlob,
    triggerDownload
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.exporter;
  }
})(typeof window !== 'undefined' ? window : globalThis);
