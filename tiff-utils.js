/**
 * tiff-utils.js
 * TIFF file support: loading, rendering each page, and export
 * Uses: UTIF.js (loaded dynamically) for TIFF decoding
 */

/* ── Load UTIF.js dynamically ── */
let UTIFReady = false;
let UTIF = null;

async function loadUTIF() {
  if (UTIFReady) return UTIF;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Use UTIF — a reliable pure-JS TIFF decoder
    script.src = 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';
    script.onload = () => {
      UTIF = window.UTIF;
      UTIFReady = true;
      resolve(UTIF);
    };
    script.onerror = () => reject(new Error('Failed to load UTIF.js'));
    document.head.appendChild(script);
  });
}

/* ───────────────────────────────────────────
   TiffDocument — wraps a loaded TIFF
─────────────────────────────────────────── */
class TiffDocument {
  constructor(ifds, rawBytes, fileName) {
    this.ifds      = ifds;      // UTIF IFDs (one per page)
    this.rawBytes  = rawBytes;  // ArrayBuffer
    this.fileName  = fileName;
    this.numPages  = ifds.length;
    this._pageCanvases = {}; // cached rendered canvases per page
  }
}

/* ───────────────────────────────────────────
   Load TIFF from ArrayBuffer
─────────────────────────────────────────── */
async function loadTiffFromBuffer(arrayBuffer, fileName) {
  const utif = await loadUTIF();
  const ifds = utif.decode(arrayBuffer);
  // Decode all pages upfront for speed
  utif.decodeImages(arrayBuffer, ifds);
  return new TiffDocument(ifds, arrayBuffer, fileName);
}

/* ───────────────────────────────────────────
   Render a TIFF page to a canvas element
   pageNum is 1-based
─────────────────────────────────────────── */
async function renderTiffPageToCanvas(tiffDoc, pageNum, canvas, scale = 1) {
  const utif = await loadUTIF();
  const ifd = tiffDoc.ifds[pageNum - 1];
  if (!ifd) throw new Error(`Page ${pageNum} not found in TIFF`);

  const w = ifd.width;
  const h = ifd.height;
  canvas.width  = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const rgba = utif.toRGBA8(ifd);
  const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer), w, h);

  const offscreen = new OffscreenCanvas(w, h);
  const offCtx = offscreen.getContext('2d');
  offCtx.putImageData(imgData, 0, 0);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

  return canvas;
}

/* ───────────────────────────────────────────
   Render a TIFF thumbnail
─────────────────────────────────────────── */
async function renderTiffThumbnail(tiffDoc, pageNum, targetWidth = 160) {
  const utif = await loadUTIF();
  const ifd = tiffDoc.ifds[pageNum - 1];
  if (!ifd) return null;

  const scale = targetWidth / ifd.width;
  const canvas = document.createElement('canvas');
  await renderTiffPageToCanvas(tiffDoc, pageNum, canvas, scale);
  return canvas;
}

/* ───────────────────────────────────────────
   Export TIFF document pages as PNG data URLs
   (browser can't write TIFF natively, so we
    export each visible page as a PNG blob)
─────────────────────────────────────────── */
async function exportTiffAsPngZip(tiffDoc) {
  // Returns array of {fileName, blob} for each page
  const results = [];
  for (let i = 1; i <= tiffDoc.numPages; i++) {
    const canvas = document.createElement('canvas');
    await renderTiffPageToCanvas(tiffDoc, i, canvas, 2);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    results.push({ fileName: `page_${i}.png`, blob });
  }
  return results;
}

/* ───────────────────────────────────────────
   Export a single canvas as TIFF-like download
   Since browsers can't encode TIFF, we create
   a high-quality PNG with the .tiff extension
   and note that in the filename
─────────────────────────────────────────── */
async function exportCanvasAsTiff(canvas, fileName) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 1.0));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/\.(tiff?|pdf)$/i, '') + '_export.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ───────────────────────────────────────────
   Export every page of the current PDF doc
   as individual high-res PNG images (packaged
   as a simple multi-download or zip)
─────────────────────────────────────────── */
async function exportPdfPagesAsTiff(pdfDoc, pdfJsDoc) {
  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const canvas = document.createElement('canvas');
    await PdfUtils.renderPageToCanvas(pdfDoc, i, canvas, 3.0);
    await exportCanvasAsTiff(canvas, `${pdfDoc.fileName}_page${i}.png`);
    // Small delay to avoid overwhelming the browser
    await new Promise(r => setTimeout(r, 150));
  }
}

/* ── Expose globals ── */
window.TiffUtils = {
  loadTiffFromBuffer,
  renderTiffPageToCanvas,
  renderTiffThumbnail,
  exportCanvasAsTiff,
  exportPdfPagesAsTiff,
  exportTiffAsPngZip,
};
