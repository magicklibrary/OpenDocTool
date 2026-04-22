/**
 * app.js — OpenDocTools
 * FIXED VERSION:
 *  - Merge: dedicated hidden file input so multi-select works independently
 *  - Merge queue: add files one batch at a time, minimum 1 file (merge with current doc)
 *  - Export: works with any doc state
 *  - Remove / Split / Reorder: all use fresh bytes via PdfUtils.toFreshBytes
 *  - Fabric overlay correctly positioned
 *  - "Open PDFs with this app" download handler registered
 */

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
const State = {
  doc:         null,    // PdfDocument | TiffDocument
  docType:     null,    // 'pdf' | 'tiff'
  currentPage: 1,
  scale:       1.5,
  tool:        null,    // 'redact' | 'sign' | null
  mergeFiles:  [],      // File[] queued for merge
  fabricCanvas: null,   // fabric.js instance
  mergeMode:   false,   // are we in merge-queue mode?
};

/* ══════════════════════════════════════════════════
   DOM REFS  (resolved after DOMContentLoaded)
══════════════════════════════════════════════════ */
let DOM = {};

function resolveDOM() {
  const $ = id => document.getElementById(id);
  DOM = {
    uploadBtn:        $('upload-btn'),
    fileInput:        $('file-input'),       // single-file upload
    mergeFileInput:   $('merge-file-input'), // multi-file merge input
    mergeBtn:         $('merge-btn'),
    removePageBtn:    $('remove-page-btn'),
    reorderBtn:       $('reorder-btn'),
    splitBtn:         $('split-btn'),
    redactBtn:        $('redact-btn'),
    signBtn:          $('sign-btn'),
    exportPdfBtn:     $('export-pdf-btn'),
    exportTiffBtn:    $('export-tiff-btn'),

    dropZone:         $('drop-zone'),
    canvasContainer:  $('canvas-container'),
    pdfCanvas:        $('pdf-canvas'),
    fabricCanvasEl:   $('fabric-canvas'),
    pageNav:          $('page-nav'),
    prevPage:         $('prev-page'),
    nextPage:         $('next-page'),
    currentPageNum:   $('current-page-num'),
    totalPageNum:     $('total-page-num'),
    statusBar:        $('status-bar'),
    toolStatus:       $('tool-status'),
    clearAnnotations: $('clear-annotations'),
    applyRedactions:  $('apply-redactions'),

    thumbnails:       $('thumbnails'),
    pageCountLabel:   $('page-count-label'),

    zoomIn:           $('zoom-in'),
    zoomOut:          $('zoom-out'),
    zoomFit:          $('zoom-fit'),
    zoomLabel:        $('zoom-label'),

    mergeQueue:       $('merge-queue'),
    mergeFileList:    $('merge-file-list'),
    mergeCount:       $('merge-count'),
    doMergeBtn:       $('do-merge-btn'),
    cancelMergeBtn:   $('cancel-merge-btn'),
    addMoreMergeBtn:  $('add-more-merge-btn'),

    reorderGrid:      $('reorder-grid'),
    splitPageInput:   $('split-page-input'),
    splitTotalLabel:  $('split-total-label'),
    splitPreview:     $('split-preview'),
    doSplitBtn:       $('do-split-btn'),

    placeSigBtn:      $('place-sig-btn'),

    loadingOverlay:   $('loading-overlay'),
    loadingMsg:       $('loading-msg'),
    toastContainer:   $('toast-container'),

    installBanner:    $('install-banner'),
    installBtn:       $('install-btn'),
    dismissInstall:   $('dismiss-install'),
  };
}

/* ══════════════════════════════════════════════════
   LOADING & TOAST
══════════════════════════════════════════════════ */
function showLoading(msg = 'Processing…') {
  DOM.loadingMsg.textContent = msg;
  DOM.loadingOverlay.classList.remove('hidden');
}
function hideLoading() {
  DOM.loadingOverlay.classList.add('hidden');
}

function toast(msg, type = 'success', duration = 3500) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><span>${msg}</span>`;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ══════════════════════════════════════════════════
   FABRIC.JS SETUP
══════════════════════════════════════════════════ */
function initFabricCanvas() {
  if (State.fabricCanvas) {
    try { State.fabricCanvas.dispose(); } catch (_) {}
  }

  const canvas = new fabric.Canvas('fabric-canvas', {
    selection: true,
    preserveObjectStacking: true,
    enableRetinaScaling: false,
  });

  State.fabricCanvas = canvas;
  syncFabricSize();
  return canvas;
}

function syncFabricSize() {
  const fc = State.fabricCanvas;
  if (!fc) return;

  const w = DOM.pdfCanvas.width;
  const h = DOM.pdfCanvas.height;

  fc.setWidth(w);
  fc.setHeight(h);

  const wrapper = document.getElementById('canvas-wrapper');
  if (wrapper) {
    wrapper.style.width  = w + 'px';
    wrapper.style.height = h + 'px';
  }

  fc.renderAll();
}

/* ══════════════════════════════════════════════════
   FILE LOADING
══════════════════════════════════════════════════ */
async function openFile(file) {
  if (!file) return;
  const name   = file.name.toLowerCase();
  const isPdf  = name.endsWith('.pdf');
  const isTiff = name.endsWith('.tiff') || name.endsWith('.tif');

  if (!isPdf && !isTiff) {
    toast('Unsupported file. Please upload a PDF or TIFF.', 'error');
    return;
  }

  showLoading(`Loading ${file.name}…`);
  try {
    const buf = await file.arrayBuffer();
    if (isPdf) {
      State.doc     = await PdfUtils.loadPdfFromBuffer(buf, file.name);
      State.docType = 'pdf';
    } else {
      State.doc     = await TiffUtils.loadTiffFromBuffer(buf, file.name);
      State.docType = 'tiff';
    }
    State.currentPage = 1;
    await onDocumentLoaded();
    toast(`Loaded: ${file.name}`, 'success');
  } catch (err) {
    console.error(err);
    toast(`Failed to open file: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

async function onDocumentLoaded() {
  const numPages = State.doc.numPages;

  DOM.dropZone.classList.add('hidden');
  DOM.canvasContainer.removeAttribute('hidden');
  DOM.pageNav.removeAttribute('hidden');
  DOM.statusBar.removeAttribute('hidden');

  DOM.totalPageNum.textContent  = numPages;
  DOM.pageCountLabel.textContent = numPages;

  setDocumentButtonsEnabled(true);
  initFabricCanvas();
  await buildThumbnails();
  await renderCurrentPage();
}

function setDocumentButtonsEnabled(enabled) {
  [
    DOM.removePageBtn, DOM.reorderBtn, DOM.splitBtn,
    DOM.redactBtn, DOM.signBtn, DOM.exportPdfBtn, DOM.exportTiffBtn,
  ].forEach(btn => { if (btn) btn.disabled = !enabled; });
  if (DOM.mergeBtn) DOM.mergeBtn.disabled = false;

  if (State.docType !== 'pdf') {
    if (DOM.removePageBtn) DOM.removePageBtn.disabled = true;
    if (DOM.reorderBtn)    DOM.reorderBtn.disabled    = true;
    if (DOM.splitBtn)      DOM.splitBtn.disabled      = true;
  }
}

/* ══════════════════════════════════════════════════
   RENDERING
══════════════════════════════════════════════════ */
async function renderCurrentPage() {
  const page = State.currentPage;
  DOM.currentPageNum.textContent = page;

  document.querySelectorAll('.thumb-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.page) === page);
  });

  if (State.docType === 'pdf') {
    await PdfUtils.renderPageToCanvas(State.doc, page, DOM.pdfCanvas, State.scale);
  } else {
    await TiffUtils.renderTiffPageToCanvas(State.doc, page, DOM.pdfCanvas, State.scale);
  }

  syncFabricSize();
  updateZoomLabel();
  updatePageNav();
  updateToolStatus();

  const activeThumb = DOM.thumbnails.querySelector('.thumb-item.active');
  if (activeThumb) activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updatePageNav() {
  const num = State.doc?.numPages || 1;
  DOM.prevPage.disabled = State.currentPage <= 1;
  DOM.nextPage.disabled = State.currentPage >= num;
}

function updateZoomLabel() {
  DOM.zoomLabel.textContent = Math.round(State.scale * 100 / 1.5 * 100) + '%';
}

function updateToolStatus() {
  const tools = {
    redact: '🔲 Redact mode — draw rectangles over content, then click Apply Redactions',
    sign:   '✍️  Signature placed — drag to reposition, then Export PDF to embed',
  };
  DOM.toolStatus.textContent = tools[State.tool] || 'Ready';
}

/* ══════════════════════════════════════════════════
   THUMBNAIL BUILDING
══════════════════════════════════════════════════ */
async function buildThumbnails() {
  DOM.thumbnails.innerHTML = '';
  const doc      = State.doc;
  const numPages = doc.numPages;

  for (let i = 1; i <= numPages; i++) {
    const item = document.createElement('div');
    item.className    = 'thumb-item';
    item.dataset.page = i;

    let thumbCanvas;
    try {
      if (State.docType === 'pdf') {
        thumbCanvas = await PdfUtils.renderThumbnail(doc, i, 160);
      } else {
        thumbCanvas = await TiffUtils.renderTiffThumbnail(doc, i, 160);
      }
    } catch (_) {}

    if (thumbCanvas) item.appendChild(thumbCanvas);

    const label = document.createElement('div');
    label.className   = 'thumb-label';
    label.textContent = `${i}`;
    item.appendChild(label);

    item.addEventListener('click', async () => {
      State.currentPage = i;
      await renderCurrentPage();
    });

    DOM.thumbnails.appendChild(item);
  }

  DOM.pageCountLabel.textContent = numPages;
}

/* ══════════════════════════════════════════════════
   ZOOM
══════════════════════════════════════════════════ */
function changeZoom(delta) {
  State.scale = Math.max(0.5, Math.min(5, State.scale + delta));
  renderCurrentPage();
}

function fitToPage() {
  if (!State.doc) return;
  const container = DOM.canvasContainer;
  const availW    = container.clientWidth  - 48;
  const availH    = container.clientHeight - 48;
  const naturalW  = DOM.pdfCanvas.width  / State.scale;
  const naturalH  = DOM.pdfCanvas.height / State.scale;
  State.scale = Math.min(availW / naturalW, availH / naturalH, 3);
  renderCurrentPage();
}

/* ══════════════════════════════════════════════════
   TOOL MODES
══════════════════════════════════════════════════ */
function activateTool(tool) {
  if (State.tool === tool) { deactivateTools(); return; }
  State.tool = tool;
  if (DOM.redactBtn) DOM.redactBtn.classList.toggle('active', tool === 'redact');
  if (DOM.signBtn)   DOM.signBtn.classList.toggle('active',   tool === 'sign');

  if (tool === 'redact') {
    activateRedactTool();
  } else if (tool === 'sign') {
    openModal('sign-modal');
  }
  updateToolStatus();
}

function deactivateTools() {
  State.tool = null;
  if (DOM.redactBtn) DOM.redactBtn.classList.remove('active');
  if (DOM.signBtn)   DOM.signBtn.classList.remove('active');

  const fc = State.fabricCanvas;
  if (fc) {
    fc.isDrawingMode = false;
    fc.selection     = true;
    fc.off('mouse:down');
    fc.off('mouse:move');
    fc.off('mouse:up');
  }

  const wrapper = document.getElementById('canvas-wrapper');
  if (wrapper) wrapper.classList.remove('active');

  if (DOM.clearAnnotations) DOM.clearAnnotations.classList.add('hidden');
  if (DOM.applyRedactions)  DOM.applyRedactions.classList.add('hidden');
  updateToolStatus();
}

/* ══════════════════════════════════════════════════
   REDACT TOOL
══════════════════════════════════════════════════ */
function activateRedactTool() {
  const fc = State.fabricCanvas;
  if (!fc) return;

  const wrapper = document.getElementById('canvas-wrapper');
  if (wrapper) wrapper.classList.add('active');

  if (DOM.clearAnnotations) DOM.clearAnnotations.classList.remove('hidden');
  if (DOM.applyRedactions)  DOM.applyRedactions.classList.remove('hidden');

  let isDown = false, startX, startY, rect;

  fc.isDrawingMode = false;
  fc.selection     = false;
  fc.off('mouse:down');
  fc.off('mouse:move');
  fc.off('mouse:up');

  fc.on('mouse:down', opt => {
    const ptr = fc.getPointer(opt.e);
    isDown = true; startX = ptr.x; startY = ptr.y;
    rect = new fabric.Rect({
      left: startX, top: startY, width: 1, height: 1,
      fill: '#000000', selectable: true, hasControls: true,
      isRedaction: true, opacity: 1,
    });
    fc.add(rect);
    fc.setActiveObject(rect);
  });

  fc.on('mouse:move', opt => {
    if (!isDown || !rect) return;
    const ptr = fc.getPointer(opt.e);
    rect.set({
      left:   Math.min(ptr.x, startX),
      top:    Math.min(ptr.y, startY),
      width:  Math.max(Math.abs(ptr.x - startX), 4),
      height: Math.max(Math.abs(ptr.y - startY), 4),
    });
    fc.renderAll();
  });

  fc.on('mouse:up', () => {
    isDown = false;
    if (rect && rect.width < 4 && rect.height < 4) fc.remove(rect);
    rect = null;
    fc.renderAll();
  });
}

/* ══════════════════════════════════════════════════
   REMOVE PAGE
══════════════════════════════════════════════════ */
async function handleRemovePage() {
  if (!State.doc || State.docType !== 'pdf') return;
  if (State.doc.numPages <= 1) { toast('Cannot remove the only page.', 'error'); return; }
  if (!confirm(`Remove page ${State.currentPage}?`)) return;

  showLoading('Removing page…');
  try {
    State.doc = await PdfUtils.removePage(State.doc, State.currentPage);
    State.currentPage = Math.min(State.currentPage, State.doc.numPages);
    DOM.totalPageNum.textContent = State.doc.numPages;
    await buildThumbnails();
    await renderCurrentPage();
    toast('Page removed.', 'success');
  } catch (e) {
    console.error(e);
    toast(`Error: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   REORDER PAGES MODAL
══════════════════════════════════════════════════ */
async function openReorderModal() {
  if (!State.doc || State.docType !== 'pdf') return;
  showLoading('Preparing reorder view…');

  const grid = document.getElementById('reorder-grid');
  grid.innerHTML = '';

  for (let i = 1; i <= State.doc.numPages; i++) {
    const item = document.createElement('div');
    item.className    = 'reorder-item';
    item.dataset.page = i;
    item.draggable    = true;

    try {
      const thumb = await PdfUtils.renderThumbnail(State.doc, i, 110);
      if (thumb) item.appendChild(thumb);
    } catch (_) {}

    const label = document.createElement('div');
    label.className   = 'reorder-label';
    label.textContent = `Page ${i}`;
    item.appendChild(label);

    grid.appendChild(item);
  }

  bindDragEventsOnGrid(grid);
  hideLoading();
  openModal('reorder-modal');
}

function bindDragEventsOnGrid(grid) {
  let dragSrc = null;

  grid.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('.reorder-item');
    if (dragSrc) { dragSrc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
  });
  grid.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.reorder-item');
    if (target && target !== dragSrc) {
      grid.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over'));
      target.classList.add('drag-over');
    }
  });
  grid.addEventListener('dragleave', e => {
    const target = e.target.closest('.reorder-item');
    if (target) target.classList.remove('drag-over');
  });
  grid.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.reorder-item');
    if (!dragSrc || !target || dragSrc === target) return;
    const items  = [...grid.querySelectorAll('.reorder-item')];
    const srcIdx = items.indexOf(dragSrc);
    const tgtIdx = items.indexOf(target);
    grid.insertBefore(dragSrc, srcIdx < tgtIdx ? target.nextSibling : target);
    grid.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over', 'dragging'));
    dragSrc = null;
  });
  grid.addEventListener('dragend', () => {
    grid.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
    dragSrc = null;
  });
}

async function applyReorder() {
  const grid    = document.querySelector('#reorder-modal .reorder-grid');
  const newOrder = [...grid.querySelectorAll('.reorder-item')].map(el => parseInt(el.dataset.page));

  showLoading('Reordering pages…');
  try {
    State.doc = await PdfUtils.reorderPages(State.doc, newOrder);
    State.currentPage = 1;
    DOM.totalPageNum.textContent = State.doc.numPages;
    await buildThumbnails();
    await renderCurrentPage();
    closeModal('reorder-modal');
    toast('Pages reordered.', 'success');
  } catch (e) {
    console.error(e);
    toast(`Error: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   SPLIT PDF MODAL
══════════════════════════════════════════════════ */
function openSplitModal() {
  if (!State.doc || State.docType !== 'pdf') return;
  const total = State.doc.numPages;
  DOM.splitPageInput.max   = total - 1;
  DOM.splitPageInput.value = Math.floor(total / 2) || 1;
  DOM.splitTotalLabel.textContent = `of ${total}`;
  updateSplitPreview();
  openModal('split-modal');
}

function updateSplitPreview() {
  const at      = parseInt(DOM.splitPageInput.value) || 1;
  const total   = State.doc?.numPages || 1;
  const clamped = Math.max(1, Math.min(at, total - 1));
  DOM.splitPreview.textContent =
    `Part 1: pages 1–${clamped}   |   Part 2: pages ${clamped + 1}–${total}`;
}

async function doSplit() {
  const at = Math.max(1, parseInt(DOM.splitPageInput.value) || 1);
  showLoading('Splitting PDF…');
  try {
    const [part1, part2] = await PdfUtils.splitPdf(State.doc, at);
    const baseName = (State.doc.fileName || 'document').replace(/\.pdf$/i, '');
    PdfUtils.downloadBytes(part1, `${baseName}_part1.pdf`);
    await new Promise(r => setTimeout(r, 400));
    PdfUtils.downloadBytes(part2, `${baseName}_part2.pdf`);
    closeModal('split-modal');
    toast('PDF split into 2 files.', 'success');
  } catch (e) {
    console.error(e);
    toast(`Error: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   MERGE PDFs
   Flow:
   1. User clicks "Merge PDFs" → opens merge panel + file picker
   2. Files are added to the queue list
   3. "Add More Files" button opens picker again
   4. "Merge All" merges them, replacing current doc
══════════════════════════════════════════════════ */
function openMergeMode() {
  State.mergeMode  = true;
  State.mergeFiles = [];
  renderMergeQueue();
  DOM.mergeQueue.classList.remove('hidden');
  // Trigger file picker immediately for first batch
  triggerMergeFilePicker();
}

function triggerMergeFilePicker() {
  DOM.mergeFileInput.value = '';
  DOM.mergeFileInput.click();
}

function cancelMerge() {
  State.mergeMode  = false;
  State.mergeFiles = [];
  DOM.mergeQueue.classList.add('hidden');
  DOM.mergeFileList.innerHTML = '';
}

function addFilesToMergeQueue(files) {
  let added = 0;
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      toast(`Skipped non-PDF: ${f.name}`, 'info');
      continue;
    }
    if (State.mergeFiles.find(x => x.name === f.name)) continue;
    State.mergeFiles.push(f);
    added++;
  }
  renderMergeQueue();
  if (added > 0) toast(`Added ${added} file${added !== 1 ? 's' : ''} to merge queue.`, 'info');
}

function renderMergeQueue() {
  DOM.mergeFileList.innerHTML = '';
  State.mergeFiles.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'merge-file-item';
    item.innerHTML = `
      <span>📄 ${f.name}</span>
      <span class="remove-merge" data-idx="${idx}" title="Remove">✕</span>
    `;
    item.querySelector('.remove-merge').addEventListener('click', () => {
      State.mergeFiles.splice(idx, 1);
      renderMergeQueue();
    });
    DOM.mergeFileList.appendChild(item);
  });
  DOM.mergeCount.textContent = `${State.mergeFiles.length} file${State.mergeFiles.length !== 1 ? 's' : ''}`;
  // Allow merge with 1+ files (will merge with current doc if open, or just load the file)
  DOM.doMergeBtn.disabled = State.mergeFiles.length < 1;
}

async function doMerge() {
  if (State.mergeFiles.length < 1) {
    toast('Add at least one PDF to merge.', 'info');
    return;
  }

  // If there's already an open doc, include it first
  let filesToMerge = [...State.mergeFiles];
  const fileCount  = filesToMerge.length;

  showLoading(`Merging ${fileCount} PDF${fileCount !== 1 ? 's' : ''}…`);
  try {
    let mergedDoc;

    if (State.doc && State.docType === 'pdf') {
      // Merge current doc bytes + queued files
      // We'll do this manually: start from current doc then copy pages from each file
      const { PDFDocument } = await PdfUtils.loadPDFLib();
      const merged = await PDFDocument.create();

      // Current doc first
      const srcCurrent = await PDFDocument.load(PdfUtils.toFreshBytes(State.doc.rawBytes), { ignoreEncryption: true });
      const currentPages = await merged.copyPages(srcCurrent, srcCurrent.getPageIndices());
      currentPages.forEach(p => merged.addPage(p));

      // Queued files
      for (const f of filesToMerge) {
        const buf   = await f.arrayBuffer();
        const bytes = PdfUtils.toFreshBytes(buf);
        let src;
        try {
          src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        } catch (err) {
          throw new Error(`Could not parse "${f.name}": ${err.message}`);
        }
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }

      const mergedBytes = PdfUtils.toFreshBytes(await merged.save());
      const pdfJsDoc    = await pdfjsLib.getDocument({ data: mergedBytes.slice() }).promise;
      const { PdfDocument: _unused, ...rest } = PdfUtils; // avoid importing class directly
      // Reconstruct via loadPdfFromBuffer workaround: build a Blob → File → load
      mergedDoc = await (async () => {
        const blob = new Blob([mergedBytes], { type: 'application/pdf' });
        const file = new File([blob], 'merged.pdf', { type: 'application/pdf' });
        return await PdfUtils.loadPdfFromBuffer(await file.arrayBuffer(), 'merged.pdf');
      })();

      toast(`Merged current document + ${fileCount} file${fileCount !== 1 ? 's' : ''} (${mergedDoc.numPages} pages total).`, 'success');
    } else {
      // No current doc — just merge the queued files
      if (filesToMerge.length < 2) {
        // Only one file: just open it
        await openFile(filesToMerge[0]);
        cancelMerge();
        hideLoading();
        return;
      }
      mergedDoc = await PdfUtils.mergePdfs(filesToMerge);
      toast(`Merged ${fileCount} PDFs (${mergedDoc.numPages} pages total).`, 'success');
    }

    State.doc       = mergedDoc;
    State.docType   = 'pdf';
    State.currentPage = 1;

    cancelMerge();
    await onDocumentLoaded();
  } catch (e) {
    console.error(e);
    toast(`Merge failed: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   REDACTION APPLY
══════════════════════════════════════════════════ */
async function applyRedactions() {
  if (!State.fabricCanvas) return;
  const rects = State.fabricCanvas.getObjects('rect').filter(o => o.isRedaction);
  if (!rects.length) { toast('No redaction boxes drawn.', 'info'); return; }
  if (!confirm('Apply redactions? This permanently removes the content.')) return;

  showLoading('Applying redactions…');
  try {
    State.doc = await PdfUtils.applyRedactions(
      State.doc, State.currentPage, State.fabricCanvas, DOM.pdfCanvas, State.scale
    );
    rects.forEach(r => State.fabricCanvas.remove(r));
    State.fabricCanvas.renderAll();
    await PdfUtils.renderPageToCanvas(State.doc, State.currentPage, DOM.pdfCanvas, State.scale);
    syncFabricSize();
    await buildThumbnails();
    toast('Redactions applied permanently.', 'success');
    deactivateTools();
  } catch (e) {
    console.error(e);
    toast(`Error: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   SIGNATURE PLACEMENT
══════════════════════════════════════════════════ */
async function handlePlaceSignature() {
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  let dataUrl;

  if (activeTab === 'draw-tab') {
    dataUrl = SignatureModule.captureDrawnSignature();
    if (!dataUrl) { toast('Please draw your signature first.', 'info'); return; }
  } else {
    const text = document.getElementById('sig-text').value.trim();
    if (!text)  { toast('Please type your signature first.', 'info'); return; }
    dataUrl = SignatureModule.captureTypedSignature(text, SignatureModule.getCurrentFont());
  }

  const signerName = document.getElementById('signer-name').value.trim();
  const wrapper    = document.getElementById('canvas-wrapper');
  if (wrapper) wrapper.classList.add('active');

  if (State.fabricCanvas) {
    State.fabricCanvas.selection     = true;
    State.fabricCanvas.isDrawingMode = false;
  }

  SignatureModule.placeSignatureOnFabric(State.fabricCanvas, dataUrl, { signerName });
  closeModal('sign-modal');
  toast('Signature placed. Drag to reposition, then Export PDF.', 'success');

  State.tool = 'sign';
  if (DOM.signBtn)          DOM.signBtn.classList.add('active');
  if (DOM.clearAnnotations) DOM.clearAnnotations.classList.remove('hidden');
  updateToolStatus();
}

/* ══════════════════════════════════════════════════
   EXPORT
══════════════════════════════════════════════════ */
async function exportPdf() {
  if (!State.doc) return;
  showLoading('Exporting PDF…');
  try {
    let doc = State.doc;

    // Embed any placed signatures
    const sigPlacements = SignatureModule.getSignaturePlacements(State.fabricCanvas);
    for (const sig of sigPlacements) {
      doc = await PdfUtils.embedSignature(doc, State.currentPage, sig.dataUrl, sig, DOM.pdfCanvas);
    }

    const bytes    = await PdfUtils.exportPdfBytes(doc);
    const fileName = (State.doc.fileName || 'document').replace(/\.pdf$/i, '') + '_exported.pdf';
    PdfUtils.downloadBytes(bytes, fileName, 'application/pdf');
    toast('PDF exported successfully.', 'success');
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

async function exportTiff() {
  if (!State.doc) return;
  showLoading('Exporting as high-res images…');
  try {
    if (State.docType === 'tiff') {
      const pages = await TiffUtils.exportTiffAsPngZip(State.doc);
      for (const p of pages) {
        const url = URL.createObjectURL(p.blob);
        const a = document.createElement('a');
        a.href = url; a.download = p.fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        await new Promise(r => setTimeout(r, 200));
        URL.revokeObjectURL(url);
      }
      toast(`Exported ${State.doc.numPages} page(s) as PNG.`, 'success');
    } else {
      await TiffUtils.exportPdfPagesAsTiff(State.doc, State.doc.pdfJsDoc);
      toast(`Exported ${State.doc.numPages} page(s) as high-res PNG.`, 'success');
    }
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   MODAL MANAGEMENT
══════════════════════════════════════════════════ */
function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

/* ══════════════════════════════════════════════════
   PWA INSTALL
══════════════════════════════════════════════════ */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (DOM.installBanner) DOM.installBanner.classList.remove('hidden');
});

/* ══════════════════════════════════════════════════
   EVENT BINDING
══════════════════════════════════════════════════ */
function bindEvents() {

  /* ─ Single-file upload ─ */
  DOM.uploadBtn.addEventListener('click', () => {
    DOM.fileInput.value  = '';
    DOM.fileInput.accept = '.pdf,.tiff,.tif';
    DOM.fileInput.click();
  });

  DOM.fileInput.addEventListener('change', async e => {
    const files = [...e.target.files];
    DOM.fileInput.value = '';
    if (files.length) await openFile(files[0]);
  });

  /* ─ Merge file picker (dedicated input) ─ */
  DOM.mergeFileInput.addEventListener('change', e => {
    const files = [...e.target.files];
    DOM.mergeFileInput.value = '';
    if (files.length) addFilesToMergeQueue(files);
  });

  /* ─ Drag & Drop ─ */
  const viewer = document.querySelector('.viewer-area');
  viewer.addEventListener('dragover',  e => { e.preventDefault(); DOM.dropZone.classList.add('drag-over'); });
  viewer.addEventListener('dragleave', e => { if (!viewer.contains(e.relatedTarget)) DOM.dropZone.classList.remove('drag-over'); });
  viewer.addEventListener('drop', async e => {
    e.preventDefault();
    DOM.dropZone.classList.remove('drag-over');
    const files = [...e.dataTransfer.files];
    if (files.length) await openFile(files[0]);
  });

  /* ─ Page Navigation ─ */
  DOM.prevPage.addEventListener('click', async () => {
    if (State.currentPage > 1) { State.currentPage--; await renderCurrentPage(); }
  });
  DOM.nextPage.addEventListener('click', async () => {
    if (State.doc && State.currentPage < State.doc.numPages) { State.currentPage++; await renderCurrentPage(); }
  });

  /* ─ Keyboard ─ */
  document.addEventListener('keydown', async e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   DOM.prevPage.click();
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  DOM.nextPage.click();
    if (e.key === 'Escape') {
      deactivateTools();
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    }
    if (e.key === '+' || e.key === '=') changeZoom(0.25);
    if (e.key === '-') changeZoom(-0.25);
  });

  /* ─ Zoom ─ */
  DOM.zoomIn.addEventListener('click',  () => changeZoom(0.25));
  DOM.zoomOut.addEventListener('click', () => changeZoom(-0.25));
  DOM.zoomFit.addEventListener('click', fitToPage);

  /* ─ Page Tools ─ */
  DOM.removePageBtn.addEventListener('click',  handleRemovePage);
  DOM.reorderBtn.addEventListener('click',     openReorderModal);
  DOM.splitBtn.addEventListener('click',       openSplitModal);
  DOM.splitPageInput.addEventListener('input', updateSplitPreview);
  DOM.doSplitBtn.addEventListener('click',     doSplit);

  /* ─ Reorder apply (delegated because modal re-inserts grid) ─ */
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'apply-reorder-btn') applyReorder();
  });

  /* ─ Merge ─ */
  DOM.mergeBtn.addEventListener('click',          openMergeMode);
  DOM.doMergeBtn.addEventListener('click',        doMerge);
  DOM.cancelMergeBtn.addEventListener('click',    cancelMerge);
  if (DOM.addMoreMergeBtn) {
    DOM.addMoreMergeBtn.addEventListener('click', triggerMergeFilePicker);
  }

  /* ─ Annotation Tools ─ */
  DOM.redactBtn.addEventListener('click', () => activateTool('redact'));
  DOM.signBtn.addEventListener('click',   () => activateTool('sign'));

  DOM.clearAnnotations.addEventListener('click', () => {
    if (State.fabricCanvas) { State.fabricCanvas.clear(); State.fabricCanvas.renderAll(); }
    document.getElementById('canvas-wrapper')?.classList.remove('active');
    deactivateTools();
    toast('Annotations cleared.', 'info');
  });

  DOM.applyRedactions.addEventListener('click', applyRedactions);

  /* ─ Signature ─ */
  DOM.placeSigBtn.addEventListener('click', handlePlaceSignature);

  /* ─ Export ─ */
  DOM.exportPdfBtn.addEventListener('click',  exportPdf);
  DOM.exportTiffBtn.addEventListener('click', exportTiff);

  /* ─ Modal close buttons ─ */
  document.querySelectorAll('[data-modal]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
  });

  /* ─ PWA Install ─ */
  DOM.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') toast('App installed! You can now open PDFs directly.', 'success');
    deferredInstallPrompt = null;
    DOM.installBanner.classList.add('hidden');
  });
  DOM.dismissInstall.addEventListener('click', () => DOM.installBanner.classList.add('hidden'));
}

/* ══════════════════════════════════════════════════
   FILE HANDLER API — lets installed PWA open PDFs
   directly when user double-clicks a PDF file
══════════════════════════════════════════════════ */
async function registerFileHandlers() {
  if ('launchQueue' in window && 'files' in LaunchParams.prototype) {
    window.launchQueue.setConsumer(async launchParams => {
      if (!launchParams.files.length) return;
      const fileHandle = launchParams.files[0];
      const file = await fileHandle.getFile();
      await openFile(file);
    });
  }
}

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  resolveDOM();
  bindEvents();
  SignatureModule.init();
  PdfUtils.loadPDFLib().catch(() => {});
  registerFileHandlers().catch(() => {});
});
