/**
 * pdf-utils.js
 * PDF operations: loading, rendering, merge, split, remove pages, reorder, redact, export
 * Uses: pdf.js (rendering), pdf-lib (manipulation)
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

/* ───────────────────────────────────────────
   PdfDocument — wraps a loaded PDF document
─────────────────────────────────────────── */
class PdfDocument {
  constructor(pdfJsDoc, rawBytes, fileName) {
    this.pdfJsDoc  = pdfJsDoc;    // pdf.js PDFDocumentProxy
    this.rawBytes  = rawBytes;    // Uint8Array
    this.fileName  = fileName;
    this.numPages  = pdfJsDoc.numPages;
    this._pageOrder = Array.from({ length: pdfJsDoc.numPages }, (_, i) => i + 1); // 1-based
    this._deletedPages = new Set();
    this._annotationsBitmap = null; // pre-rendered annotation overlay (for redactions)
  }

  /** Re-build a pdf-lib doc from current page order (respecting deletions) */
  async buildPDFLibDoc() {
    const { PDFDocument } = await loadPDFLib();
    const srcDoc = await PDFDocument.load(this.rawBytes, { ignoreEncryption: true });
    const destDoc = await PDFDocument.create();

    const activePages = this._pageOrder.filter(p => !this._deletedPages.has(p));
    const copied = await destDoc.copyPages(srcDoc, activePages.map(p => p - 1));
    copied.forEach(page => destDoc.addPage(page));

    return destDoc;
  }

  /** Active pages in current order */
  get activePages() {
    return this._pageOrder.filter(p => !this._deletedPages.has(p));
  }

  markDeleted(pageNum) { this._deletedPages.add(pageNum); }
  setOrder(newOrder) { this._pageOrder = newOrder; }
}

/* ───────────────────────────────────────────
   Load a PDF from an ArrayBuffer
─────────────────────────────────────────── */
async function loadPdfFromBuffer(arrayBuffer, fileName) {
  const bytes = new Uint8Array(arrayBuffer);
  const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
  return new PdfDocument(pdfJsDoc, bytes, fileName);
}

/* ───────────────────────────────────────────
   Render a page to a <canvas> element
   Returns the canvas
─────────────────────────────────────────── */
async function renderPageToCanvas(pdfDoc, pageNum, canvas, scale = 1.5) {
  const page = await pdfDoc.pdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
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
  const page = await pdfDoc.pdfJsDoc.getPage(pageNum);
  const baseVP = page.getViewport({ scale: 1 });
  const scale = targetWidth / baseVP.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
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
    const buf = await file.arrayBuffer();
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }

  const mergedBytes = await merged.save();
  const pdfJsDoc = await pdfjsLib.getDocument({ data: mergedBytes }).promise;
  return new PdfDocument(pdfJsDoc, mergedBytes, 'merged.pdf');
}

/* ───────────────────────────────────────────
   Split PDF at splitAfterPage (1-based)
   Returns [part1Bytes, part2Bytes]
─────────────────────────────────────────── */
async function splitPdf(pdfDoc, splitAfterPage) {
  const { PDFDocument } = await loadPDFLib();
  const srcDoc = await PDFDocument.load(pdfDoc.rawBytes, { ignoreEncryption: true });
  const total = srcDoc.getPageCount();

  const part1 = await PDFDocument.create();
  const part2 = await PDFDocument.create();

  const indices1 = Array.from({ length: splitAfterPage }, (_, i) => i);
  const indices2 = Array.from({ length: total - splitAfterPage }, (_, i) => i + splitAfterPage);

  if (indices1.length) {
    const pages = await part1.copyPages(srcDoc, indices1);
    pages.forEach(p => part1.addPage(p));
  }
  if (indices2.length) {
    const pages = await part2.copyPages(srcDoc, indices2);
    pages.forEach(p => part2.addPage(p));
  }

  return [await part1.save(), await part2.save()];
}

/* ───────────────────────────────────────────
   Remove a page from the document (in-memory)
─────────────────────────────────────────── */
async function removePage(pdfDoc, pageNum) {
  pdfDoc.markDeleted(pageNum);
  // Rebuild from remaining pages
  const newBytes = await exportPdfBytes(pdfDoc);
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes }).promise;
  const newDoc = new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
  return newDoc;
}

/* ───────────────────────────────────────────
   Reorder pages
─────────────────────────────────────────── */
async function reorderPages(pdfDoc, newOrder) {
  const { PDFDocument } = await loadPDFLib();
  const srcDoc = await PDFDocument.load(pdfDoc.rawBytes, { ignoreEncryption: true });
  const destDoc = await PDFDocument.create();
  const copied = await destDoc.copyPages(srcDoc, newOrder.map(p => p - 1));
  copied.forEach(p => destDoc.addPage(p));

  const newBytes = await destDoc.save();
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes }).promise;
  return new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
}

/* ───────────────────────────────────────────
   Apply redactions from fabric.js canvas
   Bakes black rectangles into the PDF bytes
─────────────────────────────────────────── */
async function applyRedactions(pdfDoc, currentPageNum, fabricCanvas, pdfCanvasEl, scale) {
  const { PDFDocument, rgb, degrees } = await loadPDFLib();

  // Get redaction rects from fabric canvas
  const rects = fabricCanvas.getObjects('rect').filter(o => o.isRedaction);
  if (!rects.length) return pdfDoc;

  const srcDoc = await PDFDocument.load(pdfDoc.rawBytes, { ignoreEncryption: true });
  const page = srcDoc.getPage(currentPageNum - 1);
  const { width: pdfW, height: pdfH } = page.getSize();

  const canvasW = pdfCanvasEl.width;
  const canvasH = pdfCanvasEl.height;

  rects.forEach(rect => {
    // Fabric coords → PDF coords
    const scaleX = pdfW / canvasW;
    const scaleY = pdfH / canvasH;

    const x = rect.left * scaleX;
    const y = pdfH - (rect.top + rect.height * rect.scaleY) * scaleY;
    const w = rect.width * rect.scaleX * scaleX;
    const h = rect.height * rect.scaleY * scaleY;

    page.drawRectangle({ x, y, width: w, height: h, color: rgb(0, 0, 0) });
  });

  const newBytes = await srcDoc.save();
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes }).promise;
  const newDoc = new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
  return newDoc;
}

/* ───────────────────────────────────────────
   Flatten a signature image (dataURL) onto a page
─────────────────────────────────────────── */
async function embedSignature(pdfDoc, pageNum, sigDataUrl, placement, pdfCanvasEl) {
  const { PDFDocument } = await loadPDFLib();
  const srcDoc = await PDFDocument.load(pdfDoc.rawBytes, { ignoreEncryption: true });

  // Convert dataURL to bytes
  const base64 = sigDataUrl.split(',')[1];
  const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  const page = srcDoc.getPage(pageNum - 1);
  const { width: pdfW, height: pdfH } = page.getSize();
  const canvasW = pdfCanvasEl.width;
  const canvasH = pdfCanvasEl.height;

  const img = await srcDoc.embedPng(imgBytes);
  const scaleX = pdfW / canvasW;
  const scaleY = pdfH / canvasH;

  const x = placement.left * scaleX;
  const y = pdfH - (placement.top + placement.height) * scaleY;
  const w = placement.width * scaleX;
  const h = placement.height * scaleY;

  page.drawImage(img, { x, y, width: w, height: h });

  const newBytes = await srcDoc.save();
  const newJsDoc = await pdfjsLib.getDocument({ data: newBytes }).promise;
  return new PdfDocument(newJsDoc, newBytes, pdfDoc.fileName);
}

/* ───────────────────────────────────────────
   Export PDF bytes from current doc state
─────────────────────────────────────────── */
async function exportPdfBytes(pdfDoc) {
  const destDoc = await pdfDoc.buildPDFLibDoc();
  return await destDoc.save();
}

/* ───────────────────────────────────────────
   Download helper
─────────────────────────────────────────── */
function downloadBytes(bytes, fileName, mimeType = 'application/pdf') {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
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
};
