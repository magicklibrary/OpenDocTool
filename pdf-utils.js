/**
 * pdf-utils.js
 * PDF operations: loading, rendering, merge, split, remove pages, reorder, redact, export
 * Uses: pdf.js (rendering), pdf-lib (manipulation)
 *
 * KEY FIX: pdf-lib requires a plain ArrayBuffer (or Uint8Array) — but crucially,
 * when a Uint8Array is a view into a *shared* or *detached* buffer (e.g. after
 * SubArray slicing), pdf-lib fails with "No PDF header found".
 * Solution: always pass a FRESH Uint8Array copy: new Uint8Array(bytes) where bytes
 * may be a Uint8Array or ArrayBuffer. This ensures a clean owned buffer every time.
 */

/* ── PDF.js worker setup ── */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ── Load pdf-lib dynamically ── */
let PDFLibReady = false;
let PDFLib = null;

async function loadPDFLib() {
  if (PDFLibReady) return PDFLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
    script.onload = () => {
      PDFLib = window.PDFLib;
      PDFLibReady = true;
      resolve(PDFLib);
    };
    script.onerror = () => reject(new Error('Failed to load pdf-lib'));
    document.head.appendChild(script);
  });
}

/**
 * Normalise any byte input to a FRESH Uint8Array with its own buffer.
 * This prevents the "No PDF header found" error caused by detached/shared buffers.
 */
function toFreshBytes(input) {
  if (input instanceof Uint8Array) {
    // Copy into a fresh ArrayBuffer — never reuse a potentially-shared one
    const fresh = new Uint8Array(input.length);
    fresh.set(input);
    return fresh;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }
  // pdf-lib Uint8Array result from .save() — same as first case
  return new Uint8Array(input);
}

/* ───────────────────────────────────────────
   PdfDocument — wraps a loaded PDF document
─────────────────────────────────────────── */
class PdfDocument {
  constructor(pdfJsDoc, rawBytes, fileName) {
    this.pdfJsDoc  = pdfJsDoc;               // pdf.js PDFDocumentProxy
    this.rawBytes  = toFreshBytes(rawBytes);  // always a clean Uint8Array
    this.fileName  = fileName;
    this.numPages  = pdfJsDoc.numPages;
    this._pageOrder    = Array.from({ length: pdfJsDoc.numPages }, (_, i) => i + 1);
    this._deletedPages = new Set();
  }

  /** Re-build a pdf-lib doc from current page order (respecting deletions) */
  async buildPDFLibDoc() {
    const { PDFDocument } = await loadPDFLib();
    // Always pass a fresh copy so pdf-lib gets its own ArrayBuffer
    const srcDoc  = await PDFDocument.load(toFreshBytes(this.rawBytes), { ignoreEncryption: true });
    const destDoc = await PDFDocument.create();

    const activePages = this._pageOrder.filter(p => !this._deletedPages.has(p));
    const copied = await destDoc.copyPages(srcDoc, activePages.map(p => p - 1));
    copied.forEach(page => destDoc.addPage(page));

    return destDoc;
  }

  get activePages() {
    return this._pageOrder.filter(p => !this._deletedPages.has(p));
  }

  markDeleted(pageNum) { this._deletedPages.add(pageNum); }
  setOrder(newOrder)   { this._pageOrder = newOrder; }
}

/* ───────────────────────────────────────────
   Load a PDF from an ArrayBuffer
─────────────────────────────────────────── */
async function loadPdfFromBuffer(arrayBuffer, fileName) {
  const bytes    = toFreshBytes(arrayBuffer);
  const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  return new PdfDocument(pdfJsDoc, bytes, fileName);
}

/* ───────────────────────────────────────────
   Render a page to a <canvas> element
─────────────────────────────────────────── */
async function renderPageToCanvas(pdfDoc, pageNum, canvas, scale = 1.5) {
  const page     = await pdfDoc.pdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/* ───────────────────────────────────────────
   Render a thumbnail (small canvas)
─────────────────────────────────────────── */
async function renderThumbnail(pdfDoc, pageNum, targetWidth = 160) {
  const page   = await pdfDoc.pdfJsDoc.getPage(pageNum);
  const baseVP = page.getViewport({ scale: 1 });
  const scale  = targetWidth / baseVP.width;
  const viewport = page.getViewport({ scale });

  const canvas  = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/* ───────────────────────────────────────────
   Merge multiple PDFs into one PdfDocument
─────────────────────────────────────────── */
async function mergePdfs(fileList) {
  const { PDFDocument } = await loadPDFLib();
  const merged = await PDFDocument.create();

  for (const file of fileList) {
    const buf   = await file.arrayBuffer();
    const bytes = toFreshBytes(buf);
    let src;
    try {
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (err) {
      throw new Error(`Could not parse "${file.name}": ${err.message}`);
    }
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }

  const mergedBytes = toFreshBytes(await merged.save());
  const pdfJsDoc    = await pdfjsLib.getDocument({ data: mergedBytes.slice() }).promise;
  return new PdfDocument(pdfJsDoc, mergedBytes, 'merged.pdf');
}

/* ───────────────────────────────────────────
   Split PDF at splitAfterPage (1-based)
   Returns [part1Bytes, part2Bytes]
─────────────────────────────────────────── */
async function splitPdf(pdfDoc, splitAfterPage) {
  const { PDFDocument } = await loadPDFLib();
  const srcDoc = await PDFDocument.load(toFreshBytes(pdfDoc.rawBytes), { ignoreEncryption: true });
  const total  = srcDoc.getPageCount();

  const part1 = await PDFDocument.create();
  const part2 = await PDFDocument.create();

  const indices1 = Array.from({ length: splitAfterPage },           (_, i) => i);
  const indices2 = Array.from({ length: total - splitAfterPage },   (_, i) => i + splitAfterPage);

  if (indices1.length) {
    const pages = await part1.copyPages(srcDoc, indices1);
    pages.forEach(p => part1.addPage(p));
  }
  if (indices2.length) {
    const pages = await part2.copyPages(srcDoc, indices2);
    pages.forEach(p => part2.addPage(p));
  }

  return [toFreshBytes(await part1.save()), toFreshBytes(await part2.save())];
}

/* ───────────────────────────────────────────
   Remove a page from the document (in-memory)
─────────────────────────────────────────── */
async function removePage(pdfDoc, pageNum) {
  pdfDoc.markDeleted(pageNum);
  const newBytes = toFreshBytes(await exportPdfBytes(pdfDoc));
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
  return new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
}

/* ───────────────────────────────────────────
   Reorder pages
─────────────────────────────────────────── */
async function reorderPages(pdfDoc, newOrder) {
  const { PDFDocument } = await loadPDFLib();
  const srcDoc  = await PDFDocument.load(toFreshBytes(pdfDoc.rawBytes), { ignoreEncryption: true });
  const destDoc = await PDFDocument.create();
  const copied  = await destDoc.copyPages(srcDoc, newOrder.map(p => p - 1));
  copied.forEach(p => destDoc.addPage(p));

  const newBytes = toFreshBytes(await destDoc.save());
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
  return new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
}

/* ───────────────────────────────────────────
   Apply redactions from fabric.js canvas
─────────────────────────────────────────── */
async function applyRedactions(pdfDoc, currentPageNum, fabricCanvas, pdfCanvasEl, scale) {
  const { PDFDocument, rgb } = await loadPDFLib();

  const rects = fabricCanvas.getObjects('rect').filter(o => o.isRedaction);
  if (!rects.length) return pdfDoc;

  const srcDoc = await PDFDocument.load(toFreshBytes(pdfDoc.rawBytes), { ignoreEncryption: true });
  const page   = srcDoc.getPage(currentPageNum - 1);
  const { width: pdfW, height: pdfH } = page.getSize();

  const canvasW = pdfCanvasEl.width;
  const canvasH = pdfCanvasEl.height;

  rects.forEach(rect => {
    const scaleX = pdfW / canvasW;
    const scaleY = pdfH / canvasH;
    const x = rect.left * scaleX;
    const y = pdfH - (rect.top + rect.height * rect.scaleY) * scaleY;
    const w = rect.width  * rect.scaleX * scaleX;
    const h = rect.height * rect.scaleY * scaleY;
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(0, 0, 0) });
  });

  const newBytes = toFreshBytes(await srcDoc.save());
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
  return new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
}

/* ───────────────────────────────────────────
   Flatten a signature image (dataURL) onto a page
─────────────────────────────────────────── */
async function embedSignature(pdfDoc, pageNum, sigDataUrl, placement, pdfCanvasEl) {
  const { PDFDocument } = await loadPDFLib();
  const srcDoc = await PDFDocument.load(toFreshBytes(pdfDoc.rawBytes), { ignoreEncryption: true });

  const base64   = sigDataUrl.split(',')[1];
  const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  const page   = srcDoc.getPage(pageNum - 1);
  const { width: pdfW, height: pdfH } = page.getSize();
  const canvasW = pdfCanvasEl.width;
  const canvasH = pdfCanvasEl.height;

  const img    = await srcDoc.embedPng(imgBytes);
  const scaleX = pdfW / canvasW;
  const scaleY = pdfH / canvasH;

  const x = placement.left * scaleX;
  const y = pdfH - (placement.top + placement.height) * scaleY;
  const w = placement.width  * scaleX;
  const h = placement.height * scaleY;

  page.drawImage(img, { x, y, width: w, height: h });

  const newBytes = toFreshBytes(await srcDoc.save());
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
  return new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
}

/* ───────────────────────────────────────────
   Export PDF bytes from current doc state
─────────────────────────────────────────── */
async function exportPdfBytes(pdfDoc) {
  const destDoc = await pdfDoc.buildPDFLibDoc();
  return toFreshBytes(await destDoc.save());
}

/* ───────────────────────────────────────────
   Download helper
─────────────────────────────────────────── */
function downloadBytes(bytes, fileName, mimeType = 'application/pdf') {
  const blob = new Blob([bytes], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ── Expose globals ── */
window.PdfUtils = {
  loadPdfFromBuffer,
  renderPageToCanvas,
  renderThumbnail,
  mergePdfs,
  splitPdf,
  removePage,
  reorderPages,
  applyRedactions,
  embedSignature,
  exportPdfBytes,
  downloadBytes,
  loadPDFLib,
  toFreshBytes,
};
