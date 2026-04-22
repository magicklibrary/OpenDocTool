/**
 * app.js — OpenDocTools
 * Main application controller: ties together PDF/TIFF utilities, signature module,
 * fabric.js canvas overlay, page navigation, toolbar, modals, and export.
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
  reorderPages: [],     // 1-based page numbers in drag order
  fabricCanvas: null,   // fabric.js instance
};

/* ══════════════════════════════════════════════════
   DOM REFS
══════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const DOM = {
  uploadBtn:      $('upload-btn'),
  fileInput:      $('file-input'),
  mergeBtn:       $('merge-btn'),
  removePageBtn:  $('remove-page-btn'),
  reorderBtn:     $('reorder-btn'),
  splitBtn:       $('split-btn'),
  redactBtn:      $('redact-btn'),
  signBtn:        $('sign-btn'),
  exportPdfBtn:   $('export-pdf-btn'),
  exportTiffBtn:  $('export-tiff-btn'),

  dropZone:       $('drop-zone'),
  canvasContainer: $('canvas-container'),
  pdfCanvas:      $('pdf-canvas'),
  fabricCanvasEl: $('fabric-canvas'),
  pageNav:        $('page-nav'),
  prevPage:       $('prev-page'),
  nextPage:       $('next-page'),
  currentPageNum: $('current-page-num'),
  totalPageNum:   $('total-page-num'),
  statusBar:      $('status-bar'),
  toolStatus:     $('tool-status'),
  clearAnnotations: $('clear-annotations'),
  applyRedactions:  $('apply-redactions'),

  thumbnails:     $('thumbnails'),
  pageCountLabel: $('page-count-label'),

  zoomIn:         $('zoom-in'),
  zoomOut:        $('zoom-out'),
  zoomFit:        $('zoom-fit'),
  zoomLabel:      $('zoom-label'),

  mergeQueue:     $('merge-queue'),
  mergeFileList:  $('merge-file-list'),
  mergeCount:     $('merge-count'),
  doMergeBtn:     $('do-merge-btn'),
  cancelMergeBtn: $('cancel-merge-btn'),

  reorderGrid:    $('reorder-grid'),
  reorderModal:   $('reorder-modal'),
  applyReorderBtn: $('apply-reorder-btn'),

  splitModal:     $('split-modal'),
  splitPageInput: $('split-page-input'),
  splitTotalLabel: $('split-total-label'),
  splitPreview:   $('split-preview'),
  doSplitBtn:     $('do-split-btn'),

  signModal:      $('sign-modal'),
  placeSigBtn:    $('place-sig-btn'),

  loadingOverlay: $('loading-overlay'),
  loadingMsg:     $('loading-msg'),
  toastContainer: $('toast-container'),

  installBanner:  $('install-banner'),
  installBtn:     $('install-btn'),
  dismissInstall: $('dismiss-install'),
};

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
    State.fabricCanvas.dispose();
  }
  const canvas = new fabric.Canvas('fabric-canvas', {
    selection: true,
    preserveObjectStacking: true,
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
  DOM.fabricCanvasEl.style.width  = w + 'px';
  DOM.fabricCanvasEl.style.height = h + 'px';
  fc.renderAll();
}

/* ══════════════════════════════════════════════════
   FILE LOADING
══════════════════════════════════════════════════ */
async function openFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  const isPdf  = name.endsWith('.pdf');
  const isTiff = name.endsWith('.tiff') || name.endsWith('.tif');

  if (!isPdf && !isTiff) {
    toast('Unsupported file format. Please upload PDF or TIFF.', 'error');
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

  // Show canvas area, hide drop zone
  DOM.dropZone.classList.add('hidden');
  DOM.canvasContainer.removeAttribute('hidden');
  DOM.pageNav.removeAttribute('hidden');
  DOM.statusBar.removeAttribute('hidden');

  // Update page count
  DOM.totalPageNum.textContent = numPages;
  DOM.pageCountLabel.textContent = numPages;

  // Enable toolbar buttons
  setDocumentButtonsEnabled(true);

  // Init fabric
  initFabricCanvas();

  // Build thumbnails
  await buildThumbnails();

  // Render first page
  await renderCurrentPage();
}

function setDocumentButtonsEnabled(enabled) {
  const btns = [
    DOM.removePageBtn, DOM.reorderBtn, DOM.splitBtn,
    DOM.redactBtn, DOM.signBtn, DOM.exportPdfBtn, DOM.exportTiffBtn,
  ];
  btns.forEach(btn => btn.disabled = !enabled);
  DOM.mergeBtn.disabled = false;

  if (State.docType !== 'pdf') {
    DOM.removePageBtn.disabled = true;
    DOM.reorderBtn.disabled = true;
    DOM.splitBtn.disabled = true;
  }
}

/* ══════════════════════════════════════════════════
   RENDERING
══════════════════════════════════════════════════ */
async function renderCurrentPage() {
  const page = State.currentPage;
  DOM.currentPageNum.textContent = page;

  // Highlight active thumbnail
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
    redact: '🔲 Redact mode — draw rectangles to mark content for redaction',
    sign:   '✍️  Signature mode — open Sign modal to add your signature',
    null:   'Ready',
  };
  DOM.toolStatus.textContent = tools[State.tool] || 'Ready';
}

/* ══════════════════════════════════════════════════
   THUMBNAIL BUILDING
══════════════════════════════════════════════════ */
async function buildThumbnails() {
  DOM.thumbnails.innerHTML = '';
  const doc = State.doc;
  const numPages = doc.numPages;

  for (let i = 1; i <= numPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumb-item';
    item.dataset.page = i;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', `Page ${i}`);

    let thumbCanvas;
    if (State.docType === 'pdf') {
      thumbCanvas = await PdfUtils.renderThumbnail(doc, i, 160);
    } else {
      thumbCanvas = await TiffUtils.renderTiffThumbnail(doc, i, 160);
    }

    if (thumbCanvas) item.appendChild(thumbCanvas);

    const label = document.createElement('div');
    label.className = 'thumb-label';
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
  const newScale = Math.max(0.5, Math.min(5, State.scale + delta));
  State.scale = newScale;
  renderCurrentPage();
}

function fitToPage() {
  if (!State.doc) return;
  const container = DOM.canvasContainer;
  const availW = container.clientWidth  - 48;
  const availH = container.clientHeight - 48;
  const canvas = DOM.pdfCanvas;
  // Use natural size at scale=1
  const naturalW = canvas.width  / State.scale;
  const naturalH = canvas.height / State.scale;
  const fX = availW / naturalW;
  const fY = availH / naturalH;
  State.scale = Math.min(fX, fY, 3);
  renderCurrentPage();
}

/* ══════════════════════════════════════════════════
   TOOL MODES
══════════════════════════════════════════════════ */
function activateTool(tool) {
  if (State.tool === tool) {
    // Toggle off
    deactivateTools();
    return;
  }
  State.tool = tool;
  DOM.redactBtn.classList.toggle('active', tool === 'redact');
  DOM.signBtn.classList.toggle('active',   tool === 'sign');

  if (tool === 'redact') {
    activateRedactTool();
  } else if (tool === 'sign') {
    openModal('sign-modal');
  }

  updateToolStatus();
}

function deactivateTools() {
  State.tool = null;
  DOM.redactBtn.classList.remove('active');
  DOM.signBtn.classList.remove('active');
  DOM.fabricCanvasEl.classList.remove('active');
  if (State.fabricCanvas) {
    State.fabricCanvas.isDrawingMode = false;
    State.fabricCanvas.selection = true;
  }
  DOM.clearAnnotations.classList.add('hidden');
  DOM.applyRedactions.classList.add('hidden');
  updateToolStatus();
}

/* ══════════════════════════════════════════════════
   REDACT TOOL
══════════════════════════════════════════════════ */
function activateRedactTool() {
  const fc = State.fabricCanvas;
  if (!fc) return;

  DOM.fabricCanvasEl.classList.add('active');
  DOM.clearAnnotations.classList.remove('hidden');
  DOM.applyRedactions.classList.remove('hidden');

  let isDown = false, startX, startY, rect;

  fc.isDrawingMode = false;
  fc.selection = false;

  fc.off('mouse:down').off('mouse:move').off('mouse:up');

  fc.on('mouse:down', opt => {
    if (!State.tool === 'redact') return;
    const ptr = fc.getPointer(opt.e);
    isDown = true;
    startX = ptr.x; startY = ptr.y;

    rect = new fabric.Rect({
      left: startX, top: startY,
      width: 0, height: 0,
      fill: '#000000',
      selectable: true,
      hasControls: true,
      isRedaction: true,
      opacity: 0.92,
    });
    fc.add(rect);
  });

  fc.on('mouse:move', opt => {
    if (!isDown || !rect) return;
    const ptr = fc.getPointer(opt.e);
    const w = Math.abs(ptr.x - startX);
    const h = Math.abs(ptr.y - startY);
    rect.set({
      left: Math.min(ptr.x, startX),
      top:  Math.min(ptr.y, startY),
      width: Math.max(w, 4),
      height: Math.max(h, 4),
    });
    fc.renderAll();
  });

  fc.on('mouse:up', () => {
    isDown = false;
    if (rect && rect.width < 4) {
      fc.remove(rect);
    }
    rect = null;
  });
}

/* ══════════════════════════════════════════════════
   REMOVE PAGE
══════════════════════════════════════════════════ */
async function handleRemovePage() {
  if (!State.doc || State.docType !== 'pdf') return;
  if (State.doc.numPages <= 1) {
    toast('Cannot remove the only page.', 'error');
    return;
  }
  if (!confirm(`Remove page ${State.currentPage}?`)) return;

  showLoading('Removing page…');
  try {
    State.doc = await PdfUtils.removePage(State.doc, State.currentPage);
    State.currentPage = Math.min(State.currentPage, State.doc.numPages);
    await buildThumbnails();
    await renderCurrentPage();
    DOM.totalPageNum.textContent = State.doc.numPages;
    toast('Page removed.', 'success');
  } catch (e) {
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
  DOM.reorderGrid.innerHTML = '';
  State.reorderPages = [...Array(State.doc.numPages).keys()].map(i => i + 1);

  for (let i = 1; i <= State.doc.numPages; i++) {
    const item = document.createElement('div');
    item.className = 'reorder-item';
    item.dataset.page = i;
    item.draggable = true;

    const thumb = await PdfUtils.renderThumbnail(State.doc, i, 110);
    if (thumb) item.appendChild(thumb);

    const label = document.createElement('div');
    label.className = 'reorder-label';
    label.textContent = `Page ${i}`;
    item.appendChild(label);

    bindDragEvents(item);
    DOM.reorderGrid.appendChild(item);
  }
  hideLoading();
  openModal('reorder-modal');
}

function bindDragEvents(item) {
  let dragSrc = null;

  DOM.reorderGrid.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('.reorder-item');
    if (dragSrc) dragSrc.classList.add('dragging');
  }, { once: false });

  item.addEventListener('dragover', e => {
    e.preventDefault();
    document.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });

  item.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragSrc || dragSrc === item) return;
    const grid = DOM.reorderGrid;
    const items = [...grid.querySelectorAll('.reorder-item')];
    const srcIdx = items.indexOf(dragSrc);
    const tgtIdx = items.indexOf(item);
    if (srcIdx < tgtIdx) {
      grid.insertBefore(dragSrc, item.nextSibling);
    } else {
      grid.insertBefore(dragSrc, item);
    }
    document.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over', 'dragging'));
  });

  item.addEventListener('dragend', () => {
    document.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
  });
}

async function applyReorder() {
  const items = [...DOM.reorderGrid.querySelectorAll('.reorder-item')];
  const newOrder = items.map(el => parseInt(el.dataset.page));
  showLoading('Reordering pages…');
  try {
    State.doc = await PdfUtils.reorderPages(State.doc, newOrder);
    State.currentPage = 1;
    await buildThumbnails();
    await renderCurrentPage();
    closeModal('reorder-modal');
    toast('Pages reordered.', 'success');
  } catch (e) {
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
  DOM.splitPageInput.value = Math.floor(total / 2);
  DOM.splitTotalLabel.textContent = `of ${total}`;
  updateSplitPreview();
  openModal('split-modal');
}

function updateSplitPreview() {
  const at    = parseInt(DOM.splitPageInput.value) || 1;
  const total = State.doc?.numPages || 1;
  const clamped = Math.max(1, Math.min(at, total - 1));
  DOM.splitPreview.textContent =
    `Part 1: pages 1–${clamped}   |   Part 2: pages ${clamped + 1}–${total}`;
}

async function doSplit() {
  const at = parseInt(DOM.splitPageInput.value);
  showLoading('Splitting PDF…');
  try {
    const [part1, part2] = await PdfUtils.splitPdf(State.doc, at);
    PdfUtils.downloadBytes(part1, 'split_part1.pdf');
    await new Promise(r => setTimeout(r, 400));
    PdfUtils.downloadBytes(part2, 'split_part2.pdf');
    closeModal('split-modal');
    toast('PDF split into 2 files.', 'success');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   MERGE PDFs
══════════════════════════════════════════════════ */
function openMergeMode() {
  DOM.mergeQueue.classList.remove('hidden');
  DOM.fileInput.accept = '.pdf';
  DOM.fileInput.multiple = true;
  DOM.fileInput.click();
}

function cancelMerge() {
  State.mergeFiles = [];
  DOM.mergeQueue.classList.add('hidden');
  DOM.mergeFileList.innerHTML = '';
  DOM.fileInput.accept = '.pdf,.tiff,.tif';
  DOM.fileInput.multiple = true;
}

function addFilesToMergeQueue(files) {
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      toast(`Skipped non-PDF: ${f.name}`, 'info');
      continue;
    }
    // Avoid duplicates by name
    if (State.mergeFiles.find(x => x.name === f.name)) continue;
    State.mergeFiles.push(f);
  }
  renderMergeQueue();
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
  DOM.doMergeBtn.disabled = State.mergeFiles.length < 2;
}

async function doMerge() {
  if (State.mergeFiles.length < 2) {
    toast('Add at least 2 PDFs to merge.', 'info');
    return;
  }
  showLoading(`Merging ${State.mergeFiles.length} PDFs…`);
  try {
    State.doc = await PdfUtils.mergePdfs(State.mergeFiles);
    State.docType = 'pdf';
    State.currentPage = 1;
    cancelMerge();
    await onDocumentLoaded();
    toast(`Merged ${State.mergeFiles.length > 0 ? 'files' : ''} into 1 document.`, 'success');
  } catch (e) {
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
  if (!rects.length) {
    toast('No redaction boxes drawn.', 'info');
    return;
  }
  if (!confirm('Apply redactions? This permanently removes the content.')) return;

  showLoading('Applying redactions…');
  try {
    State.doc = await PdfUtils.applyRedactions(
      State.doc, State.currentPage, State.fabricCanvas, DOM.pdfCanvas, State.scale
    );
    // Clear redaction rects from fabric
    rects.forEach(r => State.fabricCanvas.remove(r));
    State.fabricCanvas.renderAll();

    // Re-render
    await PdfUtils.renderPageToCanvas(State.doc, State.currentPage, DOM.pdfCanvas, State.scale);
    await buildThumbnails();
    toast('Redactions applied permanently.', 'success');
    deactivateTools();
  } catch (e) {
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
    if (!text) { toast('Please type your signature first.', 'info'); return; }
    dataUrl = SignatureModule.captureTypedSignature(text, SignatureModule.getCurrentFont());
  }

  const signerName = document.getElementById('signer-name').value.trim();

  // Enable fabric overlay
  DOM.fabricCanvasEl.classList.add('active');
  State.fabricCanvas.selection = true;
  State.fabricCanvas.isDrawingMode = false;

  SignatureModule.placeSignatureOnFabric(State.fabricCanvas, dataUrl, { signerName });
  closeModal('sign-modal');
  toast('Signature placed. Drag to reposition, then Export PDF.', 'success');
  State.tool = 'sign';
  DOM.signBtn.classList.add('active');
  DOM.clearAnnotations.classList.remove('hidden');
  updateToolStatus();
}

/* ══════════════════════════════════════════════════
   EXPORT
══════════════════════════════════════════════════ */
async function exportPdf() {
  if (!State.doc) return;
  showLoading('Exporting PDF…');
  try {
    // Flatten signatures from fabric canvas before export
    const sigPlacements = SignatureModule.getSignaturePlacements(State.fabricCanvas);
    let doc = State.doc;

    for (const sig of sigPlacements) {
      doc = await PdfUtils.embedSignature(doc, State.currentPage, sig.dataUrl, sig, DOM.pdfCanvas);
    }

    const bytes = await PdfUtils.exportPdfBytes(doc);
    const fileName = (State.doc.fileName || 'document').replace(/\.pdf$/i, '') + '_exported.pdf';
    PdfUtils.downloadBytes(bytes, fileName, 'application/pdf');
    toast('PDF exported successfully.', 'success');
  } catch (e) {
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
      await TiffUtils.exportTiffAsPngZip(State.doc);
      toast(`Exported ${State.doc.numPages} page(s) as PNG images.`, 'success');
    } else {
      await TiffUtils.exportPdfPagesAsTiff(State.doc, State.doc.pdfJsDoc);
      toast(`Exported ${State.doc.numPages} page(s) as high-res images.`, 'success');
    }
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════
   MODAL MANAGEMENT
══════════════════════════════════════════════════ */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

/* ══════════════════════════════════════════════════
   PWA INSTALL
══════════════════════════════════════════════════ */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  DOM.installBanner.classList.remove('hidden');
});

DOM.installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') toast('App installed!', 'success');
  deferredInstallPrompt = null;
  DOM.installBanner.classList.add('hidden');
});

DOM.dismissInstall.addEventListener('click', () => {
  DOM.installBanner.classList.add('hidden');
});

/* ══════════════════════════════════════════════════
   EVENT BINDING
══════════════════════════════════════════════════ */
function bindEvents() {

  /* ─ File Upload ─ */
  DOM.uploadBtn.addEventListener('click', () => {
    // If merge mode is NOT active, reset to single file
    if (DOM.mergeQueue.classList.contains('hidden')) {
      DOM.fileInput.multiple = false;
      DOM.fileInput.accept   = '.pdf,.tiff,.tif';
      DOM.fileInput.click();
    }
  });

  DOM.fileInput.addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    DOM.fileInput.value = ''; // Reset for re-selection

    if (!DOM.mergeQueue.classList.contains('hidden')) {
      // Merge mode: add to queue
      addFilesToMergeQueue(files);
    } else {
      await openFile(files[0]);
    }
  });

  /* ─ Drag & Drop ─ */
  const viewer = document.querySelector('.viewer-area');
  viewer.addEventListener('dragover', e => {
    e.preventDefault();
    DOM.dropZone.classList.add('drag-over');
  });
  viewer.addEventListener('dragleave', () => DOM.dropZone.classList.remove('drag-over'));
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

  /* ─ Keyboard Navigation ─ */
  document.addEventListener('keydown', async e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') DOM.prevPage.click();
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') DOM.nextPage.click();
    if (e.key === 'Escape') { deactivateTools(); document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')); }
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
  DOM.applyReorderBtn.addEventListener('click', applyReorder);
  DOM.doSplitBtn.addEventListener('click',     doSplit);
  DOM.splitPageInput.addEventListener('input', updateSplitPreview);

  /* ─ Merge ─ */
  DOM.mergeBtn.addEventListener('click', openMergeMode);
  DOM.doMergeBtn.addEventListener('click', doMerge);
  DOM.cancelMergeBtn.addEventListener('click', cancelMerge);

  /* ─ Annotation Tools ─ */
  DOM.redactBtn.addEventListener('click', () => activateTool('redact'));
  DOM.signBtn.addEventListener('click',   () => activateTool('sign'));
  DOM.clearAnnotations.addEventListener('click', () => {
    if (State.fabricCanvas) {
      State.fabricCanvas.clear();
      State.fabricCanvas.renderAll();
    }
    deactivateTools();
    toast('Annotations cleared.', 'info');
  });
  DOM.applyRedactions.addEventListener('click', applyRedactions);

  /* ─ Signature Modal ─ */
  DOM.placeSigBtn.addEventListener('click', handlePlaceSignature);

  /* ─ Export ─ */
  DOM.exportPdfBtn.addEventListener('click',  exportPdf);
  DOM.exportTiffBtn.addEventListener('click', exportTiff);

  /* ─ Modal Close ─ */
  document.querySelectorAll('.modal-close, [data-modal]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.modal;
      if (id) closeModal(id);
    });
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });
}

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  SignatureModule.init();

  // Preload pdf-lib silently
  PdfUtils.loadPDFLib().catch(() => {});
});
