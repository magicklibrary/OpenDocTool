# OpenDocTools

> Open-source, browser-based PDF & TIFF editor. No servers. No uploads. 100% private.

[![License: MIT](https://img.shields.io/badge/License-MIT-00d4aa.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-blueviolet)](https://web.dev/progressive-web-apps/)
[![No Backend](https://img.shields.io/badge/Backend-None-success)](https://github.com/yourusername/open-doc-tools)

---

## Overview

**OpenDocTools** is a fully client-side document editor that runs entirely in the browser. Upload PDF or TIFF files, edit them, annotate, sign, and export — without any file ever leaving your device.

Built with vanilla JavaScript and battle-tested open-source libraries, it works offline as an installable Progressive Web App (PWA).

---

## Features

| Feature | Description |
|---|---|
| **PDF & TIFF Viewer** | Smooth rendering with zoom, page navigation, and thumbnail sidebar |
| **Merge PDFs** | Combine any number of PDF files into one in seconds |
| **Remove Pages** | Delete unwanted pages instantly |
| **Reorder Pages** | Drag-and-drop page reordering |
| **Split PDF** | Split a document into two separate files at any page |
| **Redaction** | Draw permanent black-box redactions over sensitive content |
| **Signatures** | Draw or type a signature, then drag it anywhere on the document |
| **Multi-signer** | Add name metadata per signer for multi-user signing workflows |
| **Export PDF** | Save the final edited document as a PDF |
| **Export TIFF/PNG** | Export all pages as high-resolution PNG images |
| **Offline support** | Works without internet once loaded (Service Worker caching) |
| **Installable** | Install as a desktop or mobile app via PWA prompt |
| **Zero tracking** | No analytics, no telemetry, no server calls |

---

## How to Use

### Upload a File
Click **Upload File** in the toolbar (or drag-and-drop a PDF/TIFF onto the viewer area).

### Merge Multiple PDFs
1. Click **Merge PDFs** in the toolbar.
2. Select one or more PDF files — they are added to a merge queue in the sidebar.
3. Keep clicking **Merge PDFs** to add more files one batch at a time.
4. Click **Merge All** to combine them into a single document.

### Remove a Page
Navigate to the page you want to remove, then click **Remove Page**.

### Reorder Pages
Click **Reorder Pages** to open the drag-and-drop grid. Drag thumbnails into the desired order, then click **Apply Order**.

### Split a PDF
Click **Split PDF**, choose the page number to split after, and download the two resulting files.

### Redact Content
1. Click **Redact** in the toolbar.
2. Draw black rectangles over content to hide.
3. Click **Apply Redactions** in the status bar to bake them permanently into the PDF.

### Add a Signature
1. Click **Sign** in the toolbar.
2. In the modal: **Draw** your signature on the canvas, or **Type** your name and choose a font style.
3. Optionally enter a **Signer Name** for record-keeping metadata.
4. Click **Place on Document** — the signature image appears on the page and can be dragged/resized.
5. Export the PDF to embed it permanently.

### Export
- **Export PDF** — saves the document with all edits, page changes, and embedded signatures.
- **Export TIFF** — exports each page as a high-resolution PNG image (browser limitation: true multi-page TIFF encoding is not yet natively supported in browsers).

---

## Local Setup

No build tools required. This is plain HTML/CSS/JS.

```bash
# Clone the repository
git clone https://github.com/yourusername/open-doc-tools.git
cd open-doc-tools

# Option 1: Open directly in browser
open index.html

# Option 2: Serve locally (recommended for PWA features)
npx serve .
# or
python3 -m http.server 8080
```

Then visit `http://localhost:8080` in your browser.

> **Note:** Service workers (offline support) require the app to be served over HTTP or HTTPS, not opened as a local `file://` URL.

---

## Deployment (GitHub Pages)

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Set the source to the `main` branch, root folder.
4. Your app will be live at `https://yourusername.github.io/open-doc-tools/`

GitHub Pages serves over HTTPS, so all PWA features (offline, install prompt) will work correctly.

---

## Libraries Used

| Library | Version | Purpose |
|---|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | PDF rendering in canvas |
| [pdf-lib](https://pdf-lib.js.org/) | 1.17.1 | PDF creation, manipulation, redaction |
| [fabric.js](http://fabricjs.com/) | 5.3.1 | Interactive canvas overlay (redaction, signature placement) |
| [UTIF.js](https://github.com/photopea/UTIF.js) | 3.1.0 | TIFF file decoding |

All libraries are loaded from CDN and cached by the service worker for offline use.

---

## Project Structure

```
open-doc-tools/
├── index.html        ← App shell and layout
├── style.css         ← Styles and design system
├── app.js            ← Main controller, event binding, UI logic
├── pdf-utils.js      ← PDF load, render, merge, split, redact, export
├── tiff-utils.js     ← TIFF load, render, export
├── signature.js      ← Signature draw/type capture and placement
├── manifest.json     ← PWA manifest
├── service-worker.js ← Offline caching strategy
└── README.md         ← This file
```

---

## Browser Support

| Browser | Support |
|---|---|
| Chrome / Edge 90+ | ✅ Full support |
| Firefox 90+ | ✅ Full support |
| Safari 15.4+ | ✅ Full support |
| Mobile Chrome | ✅ Full support |
| Mobile Safari | ✅ Supported (PWA install via "Add to Home Screen") |

---

## Security & Privacy

- **No file uploads** — all processing is done locally in your browser.
- **No server** — there is no backend. Zero.
- **No tracking** — no analytics, no cookies, no telemetry.
- **No external APIs** — only CDN-hosted open-source libraries.

---

## Contributing

Contributions are welcome! Feel free to:

- Open issues for bugs or feature requests
- Submit pull requests with improvements
- Share the tool with others who need a private document editor

---

## License

**MIT License** — free to use, modify, and distribute.

See [LICENSE](LICENSE) for details.

---

*Made with ❤️ for people who value privacy and open-source software.*
