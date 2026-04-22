/**
 * signature.js
 * Handles draw-signature and type-signature UI, captures as PNG data URL,
 * and places on document via fabric.js overlay.
 */

const SignatureModule = (() => {

  /* ── DOM refs ── */
  let sigCanvas, sigCtx;
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let currentColor = '#0a0a0a';
  let currentWidth = 2;
  let currentFont = "'Dancing Script', cursive";

  /* ── Init signature draw canvas ── */
  function initDrawCanvas() {
    sigCanvas = document.getElementById('sig-canvas');
    if (!sigCanvas) return;
    sigCtx = sigCanvas.getContext('2d');
    clearCanvas();
    bindDrawEvents();
  }

  function clearCanvas() {
    if (!sigCtx) return;
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigCtx.fillStyle = '#f8f8f0';
    sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
  }

  function bindDrawEvents() {
    // Mouse
    sigCanvas.addEventListener('mousedown', startDraw);
    sigCanvas.addEventListener('mousemove', draw);
    sigCanvas.addEventListener('mouseup', stopDraw);
    sigCanvas.addEventListener('mouseleave', stopDraw);

    // Touch
    sigCanvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(getTouchPos(e)); }, { passive: false });
    sigCanvas.addEventListener('touchmove',  e => { e.preventDefault(); draw(getTouchPos(e)); }, { passive: false });
    sigCanvas.addEventListener('touchend',   stopDraw);
  }

  function getTouchPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const t = e.touches[0];
    return {
      clientX: t.clientX - rect.left + sigCanvas.offsetLeft,
      clientY: t.clientY - rect.top  + sigCanvas.offsetTop,
    };
  }

  function getPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const scaleX = sigCanvas.width / rect.width;
    const scaleY = sigCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  function startDraw(e) {
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    sigCtx.beginPath();
    sigCtx.moveTo(lastX, lastY);
  }

  function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    sigCtx.strokeStyle = currentColor;
    sigCtx.lineWidth = currentWidth;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
    lastX = pos.x;
    lastY = pos.y;
  }

  function stopDraw() { isDrawing = false; sigCtx && sigCtx.beginPath(); }

  /* ── Capture drawn signature as PNG dataURL ── */
  function captureDrawnSignature() {
    if (!sigCanvas) return null;
    // Crop to bounding box of drawn marks
    const data = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height);
    let minX = sigCanvas.width, minY = sigCanvas.height, maxX = 0, maxY = 0;
    for (let y = 0; y < sigCanvas.height; y++) {
      for (let x = 0; x < sigCanvas.width; x++) {
        const alpha = data.data[(y * sigCanvas.width + x) * 4 + 3];
        if (alpha > 10) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    // Check for empty canvas (background only)
    if (minX >= maxX || minY >= maxY) return null;

    const pad = 8;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(sigCanvas, minX - pad, minY - pad, w, h, 0, 0, w, h);
    return offscreen.toDataURL('image/png');
  }

  /* ── Render typed signature to PNG dataURL ── */
  function captureTypedSignature(text, font) {
    if (!text.trim()) return null;
    const offscreen = document.createElement('canvas');
    offscreen.width  = 500;
    offscreen.height = 120;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0)'; // transparent bg
    ctx.clearRect(0, 0, 500, 120);

    ctx.font = `56px ${font}`;
    ctx.fillStyle = '#0a0a0a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 250, 60, 480);

    return offscreen.toDataURL('image/png');
  }

  /* ── Place signature on fabric canvas as moveable image ── */
  function placeSignatureOnFabric(fabricCanvas, dataUrl, metadata) {
    if (!fabricCanvas || !dataUrl) return;

    fabric.Image.fromURL(dataUrl, img => {
      // Scale to a reasonable size
      const maxW = Math.min(fabricCanvas.width * 0.35, 240);
      if (img.width > maxW) img.scaleToWidth(maxW);

      img.set({
        left: (fabricCanvas.width - img.getScaledWidth()) / 2,
        top:  (fabricCanvas.height - img.getScaledHeight()) / 2,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        borderColor: '#00d4aa',
        cornerColor: '#00d4aa',
        cornerSize: 10,
        transparentCorners: false,
        lockUniScaling: false,
        isSignature: true,
        signerName: metadata?.signerName || '',
        timestamp: new Date().toISOString(),
      });

      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.renderAll();
    });
  }

  /* ── Get all placed signature placements for embedding ── */
  function getSignaturePlacements(fabricCanvas) {
    return fabricCanvas.getObjects('image')
      .filter(o => o.isSignature)
      .map(img => ({
        left: img.left,
        top:  img.top,
        width:  img.getScaledWidth(),
        height: img.getScaledHeight(),
        dataUrl: img.getSrc(),
        signerName: img.signerName,
        timestamp: img.timestamp,
      }));
  }

  /* ── Bind Modal Controls ── */
  function bindModalControls() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(tabId).classList.add('active');
      });
    });

    // Color change
    const colorPicker = document.getElementById('sig-color');
    if (colorPicker) {
      colorPicker.addEventListener('input', e => { currentColor = e.target.value; });
    }

    // Width change
    const widthSlider = document.getElementById('sig-width');
    if (widthSlider) {
      widthSlider.addEventListener('input', e => { currentWidth = parseInt(e.target.value); });
    }

    // Clear drawn sig
    const clearBtn = document.getElementById('clear-sig');
    if (clearBtn) clearBtn.addEventListener('click', clearCanvas);

    // Typed signature preview
    const sigText = document.getElementById('sig-text');
    const preview = document.getElementById('type-sig-preview');
    if (sigText && preview) {
      sigText.addEventListener('input', () => {
        preview.textContent = sigText.value || 'Your Signature';
      });
    }

    // Font buttons
    document.querySelectorAll('.sig-font-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sig-font-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFont = btn.dataset.font;
        if (preview) preview.style.fontFamily = currentFont;
      });
    });
  }

  /* ── Initialize ── */
  function init() {
    initDrawCanvas();
    bindModalControls();
  }

  return {
    init,
    clearCanvas,
    captureDrawnSignature,
    captureTypedSignature,
    placeSignatureOnFabric,
    getSignaturePlacements,
    getCurrentFont: () => currentFont,
  };
})();

window.SignatureModule = SignatureModule;
