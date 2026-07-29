import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.mjs';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const BASE_RENDER_SCALE = 1.25;
const TEXT_TYPES = new Set(['text', 'date', 'existingText']);

const state = {
  pdfBytes: null,
  pdfDoc: null,
  pages: [],
  current: 0,
  scale: 1,
  tool: 'select',
  selected: null,
  selectedIds: new Set(),
  clipboard: [],
  copiedStyle: null,
  marquee: null,
  guides: [],
  dirty: false,
  fileName: 'document.pdf',
  autosaveTimer: null,
  history: [],
  future: [],
  drag: null,
  draw: null,
  panMode: false,
  gridSnap: false,
  lastTextStyle: { fontFamily: 'Helvetica', size: 18, bold: false, italic: false, underline: false, align: 'left', lineHeight: 1.2, letterSpacing: 0, listStyle: 'none', listIndent: 0, color: '#111318', backgroundEnabled: false, backgroundColor: '#ffffff', backgroundOpacity: 1, opacity: 1 },
  spacePan: false,
  pan: null,
  view: 'edit',
  pageSelection: new Set(),
  pendingStageCenter: true,
};

const els = {
  landing: $('#landing'),
  workspace: $('#workspace'),
  fileInput: $('#fileInput'),
  dropzone: $('#dropzone'),
  thumbs: $('#thumbs'),
  canvas: $('#pdfCanvas'),
  overlay: $('#overlay'),
  pageWrap: $('#pageWrap'),
  pageStage: $('#pageStage'),
  pageStageContent: $('#pageStageContent'),
  panBtn: $('#panBtn'),
  download: $('#downloadBtn'),
  undo: $('#undoBtn'),
  redo: $('#redoBtn'),
  zoomLabel: $('#zoomLabel'),
  imageInput: $('#imageInput'),
  toast: $('#toast'),
  editHint: $('#editHint'),
  editViewTab: $('#editViewTab'),
  pagesViewTab: $('#pagesViewTab'),
  pagesManager: $('#pagesManager'),
  pagesGrid: $('#pagesGrid'),
  pageCountLabel: $('#pageCountLabel'),
  pageSelectionText: $('#pageSelectionText'),
  workspaceTip: $('#workspaceTip'),
  contextMenu: $('#contextMenu'),
  saveProjectBtn: $('#saveProjectBtn'),
  openProjectBtn: $('#openProjectBtn'),
  projectInput: $('#projectInput'),
  restoreSessionBtn: $('#restoreSessionBtn'),
  busyOverlay: $('#busyOverlay'),
  busyTitle: $('#busyTitle'),
  busyDetail: $('#busyDetail'),
  objectProps: $('#objectProps'),
  multiProps: $('#multiProps'),
  emptyProps: $('#emptyProps'),
};

const thumbRenderData = new WeakMap();
const managerRenderData = new WeakMap();
const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const data = thumbRenderData.get(entry.target);
    thumbObserver.unobserve(entry.target);
    if (data) renderThumbCanvas(entry.target, data).catch((error) => console.warn('Thumbnail render failed', error));
  });
}, { root: els.thumbs, rootMargin: '220px 0px' }) : null;
const managerObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const data = managerRenderData.get(entry.target);
    managerObserver.unobserve(entry.target);
    if (data) renderManagerCanvas(entry.target, data).catch((error) => console.warn('Page preview render failed', error));
  });
}, { root: els.pagesManager, rootMargin: '350px 0px' }) : null;
function scheduleThumbRender(canvas, pageState) { thumbRenderData.set(canvas, pageState); thumbObserver ? thumbObserver.observe(canvas) : renderThumbCanvas(canvas, pageState); }
function scheduleManagerRender(canvas, pageState) { managerRenderData.set(canvas, pageState); managerObserver ? managerObserver.observe(canvas) : renderManagerCanvas(canvas, pageState); }

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function showBusy(title, detail = 'Please wait…') {
  els.busyTitle.textContent = title;
  els.busyDetail.textContent = detail;
  els.busyOverlay.classList.remove('hidden');
}
function updateBusy(detail) { els.busyDetail.textContent = detail; }
function hideBusy() { els.busyOverlay.classList.add('hidden'); }

function uid() {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
}

function pageRotation(page) {
  return ((page.baseRotation || 0) + (page.rotation || 0)) % 360;
}

function serialisablePages() {
  return state.pages.map(({ pageId, source, baseRotation, rotation, annotations }) => ({
    pageId,
    source,
    baseRotation,
    rotation,
    annotations,
  }));
}

function snap() {
  return JSON.stringify({ pages: serialisablePages(), current: state.current });
}

function pushHistory(snapshot) {
  state.history.push(snapshot);
  if (state.history.length > 100) state.history.shift();
  state.future = [];
  state.dirty = true;
  scheduleAutosave();
  updateUndo();
}

function checkpoint() {
  pushHistory(snap());
}

function restore(data) {
  const snapshot = JSON.parse(data);
  state.pages = snapshot.pages.map((page) => ({ ...page, pageId: page.pageId || uid(), detectedText: null }));
  state.pageSelection = new Set([...state.pageSelection].filter((pageId) => state.pages.some((page) => page.pageId === pageId)));
  state.current = Math.min(snapshot.current, state.pages.length - 1);
  clearSelection(false);
  state.dirty = true;
  scheduleAutosave();
  renderAll();
}

function updateUndo() {
  els.undo.disabled = !state.history.length;
  els.redo.disabled = !state.future.length;
}

async function loadPDF(file) {
  if (!file || file.type !== 'application/pdf') return toast('Please choose a PDF file.');
  if (file.size > 50 * 1024 * 1024) return toast('Docora supports files up to 50 MB.');

  showBusy('Opening PDF', 'Reading the document…');
  try {
    const buffer = await file.arrayBuffer();
    state.pdfBytes = new Uint8Array(buffer);
    state.fileName = file.name || 'document.pdf';
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
    state.pages = [];

    for (let index = 0; index < state.pdfDoc.numPages; index += 1) {
      updateBusy(`Preparing page ${index + 1} of ${state.pdfDoc.numPages}…`);
      const page = await state.pdfDoc.getPage(index + 1);
      state.pages.push({
        pageId: uid(),
        source: index,
        baseRotation: page.rotate || 0,
        rotation: 0,
        annotations: [],
        detectedText: null,
        detectedTextSource: null,
      });
    }

    state.current = 0;
    state.history = [];
    state.future = [];
    state.pageSelection = new Set();
    clearSelection(false);
    state.dirty = false;
    state.pendingStageCenter = true;
    setWorkspaceView('edit', false);
    els.landing.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    els.download.disabled = false;
    await renderAll();
    await saveSession(true);
    toast('PDF opened locally.');
  } catch (error) {
    console.error(error);
    toast(error?.name === 'PasswordException' ? 'This PDF is password protected.' : 'Could not open this PDF.');
  } finally {
    hideBusy();
  }
}

async function renderAll() {
  els.pageCountLabel.textContent = state.pages.length;
  await renderThumbs();
  if (state.view === 'pages') {
    await renderPageManager();
  } else {
    await renderPage();
  }
  updateUndo();
}

async function renderThumbs() {
  els.thumbs.innerHTML = '';

  state.pages.forEach((pageState, index) => {
    const item = document.createElement('div');
    item.className = `thumb${index === state.current ? ' active' : ''}`;
    item.draggable = true;
    item.dataset.i = index;

    const canvas = document.createElement('canvas');
    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.innerHTML = `<span>Page ${index + 1}</span><span class="thumb-controls"><button title="Rotate">↻</button></span>`;
    item.append(canvas, meta);
    els.thumbs.append(item);
    scheduleThumbRender(canvas, pageState);

    item.onclick = (event) => {
      if (event.target.tagName === 'BUTTON') {
        checkpoint();
        pageState.rotation = (pageState.rotation + 90) % 360;
        pageState.detectedText = null;
        state.pendingStageCenter = true;
        renderAll();
        return;
      }
      state.current = index;
      clearSelection(false);
      state.pendingStageCenter = true;
      renderAll();
    };

    item.ondragstart = (event) => event.dataTransfer.setData('text/plain', index);
    item.ondragover = (event) => event.preventDefault();
    item.ondrop = (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData('text/plain'));
      const to = index;
      if (from === to) return;
      checkpoint();
      const [moved] = state.pages.splice(from, 1);
      state.pages.splice(to, 0, moved);
      state.current = to;
      state.pendingStageCenter = true;
      renderAll();
    };
  });
}

async function renderThumbCanvas(canvas, pageState) {
  const page = await state.pdfDoc.getPage(pageState.source + 1);
  const rotation = pageRotation(pageState);
  const cssViewport = page.getViewport({ scale: 0.22, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const renderViewport = page.getViewport({ scale: 0.22 * dpr, rotation });

  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  canvas.style.width = `${cssViewport.width}px`;
  canvas.style.height = `${cssViewport.height}px`;

  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  await page.render({ canvasContext: context, viewport: renderViewport }).promise;
}

async function renderPage() {
  if (!state.pages.length) return;

  const pageState = state.pages[state.current];
  const page = await state.pdfDoc.getPage(pageState.source + 1);
  const rotation = pageRotation(pageState);
  const cssScale = BASE_RENDER_SCALE * state.scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssViewport = page.getViewport({ scale: cssScale, rotation });
  const renderViewport = page.getViewport({ scale: cssScale * dpr, rotation });

  els.canvas.width = Math.ceil(renderViewport.width);
  els.canvas.height = Math.ceil(renderViewport.height);
  els.canvas.style.width = `${cssViewport.width}px`;
  els.canvas.style.height = `${cssViewport.height}px`;
  els.pageWrap.style.width = `${cssViewport.width}px`;
  els.pageWrap.style.height = `${cssViewport.height}px`;
  updateVirtualStageSpace();

  const context = els.canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  await page.render({
    canvasContext: context,
    viewport: renderViewport,
    background: 'rgb(255,255,255)',
  }).promise;

  const extractedText = await detectTextItems(page, cssViewport, cssScale, pageState.source);
  if (extractedText.length || pageState.detectedTextSource !== 'ocr') {
    pageState.detectedText = extractedText;
    pageState.detectedTextSource = extractedText.length ? 'pdf' : null;
  }
  renderAnnotations();
  showProps(currentAnn() || null);
  els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;

  if (state.pendingStageCenter) {
    state.pendingStageCenter = false;
    requestAnimationFrame(centerPageInStage);
  }
}

async function getTextContentCompat(page) {
  const attempts = [
    () => page.getTextContent({ includeMarkedContent: false, disableNormalization: false }),
    () => page.getTextContent({ disableNormalization: false }),
    () => page.getTextContent(),
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const content = await attempt();
      if (content?.items?.some((item) => typeof item?.str === 'string' && item.str.trim())) return content;
      if (content?.items) return content;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return { items: [], styles: {} };
}

async function detectTextItems(page, viewport, cssScale, sourcePage) {
  try {
    const textContent = await getTextContentCompat(page);
    return textContent.items
      .map((item, index) => {
        const text = item.str?.trim();
        if (!text) return null;

        const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const angle = Math.atan2(transform[1], transform[0]) * 180 / Math.PI;
        if (Math.abs(angle) > 2) return null;

        const fontHeightPx = Math.max(7, Math.hypot(transform[2], transform[3]));
        const widthPx = Math.max(8, Math.abs(item.width * cssScale));
        const xPx = transform[4];
        const yPx = transform[5] - fontHeightPx;

        const x = clamp(xPx / viewport.width, 0, 0.99);
        const y = clamp(yPx / viewport.height, 0, 0.99);
        const w = clamp(widthPx / viewport.width, 0.012, 1 - x);
        const h = clamp((fontHeightPx * 1.18) / viewport.height, 0.012, 1 - y);
        const style = textContent.styles?.[item.fontName] || {};
        const family = inferFontFamily(style.fontFamily || '');
        const styleName = `${style.fontFamily || ''} ${item.fontName || ''}`.toLowerCase();

        return {
          id: `${sourcePage}-${index}-${text.slice(0, 20)}`,
          text,
          x,
          y,
          w,
          h,
          size: Math.max(6, Math.round((fontHeightPx / cssScale) * 10) / 10),
          fontFamily: family,
          bold: /bold|black|semibold|demi/.test(styleName),
          italic: /italic|oblique/.test(styleName),
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn('Text detection failed', error);
    return [];
  }
}

function inferFontFamily(source) {
  const font = source.toLowerCase();
  if (font.includes('mono') || font.includes('courier')) return 'Courier New';
  if (font.includes('serif') || font.includes('times')) return 'Times New Roman';
  return 'Helvetica';
}

function renderAnnotations() {
  els.overlay.innerHTML = '';
  const pageState = state.pages[state.current];

  pageState.annotations.forEach((annotation) => {
    const element = document.createElement('div');
    const isSelected = state.selectedIds.has(annotation.id) || state.selected === annotation.id;
    element.className = `annotation ${annotation.type}${isSelected ? ' selected' : ''}${annotation.locked ? ' locked' : ''}`;
    element.dataset.id = annotation.id;

    Object.assign(element.style, {
      left: `${annotation.x * 100}%`,
      top: `${annotation.y * 100}%`,
      width: `${annotation.w * 100}%`,
      height: `${annotation.h * 100}%`,
      opacity: annotation.opacity ?? 1,
      color: annotation.color || '#111318',
    });

    if (TEXT_TYPES.has(annotation.type)) {
      element.classList.add('text-annotation');
      Object.assign(element.style, {
        fontFamily: cssFontFamily(annotation.fontFamily),
        fontSize: `${(annotation.size || 18) * BASE_RENDER_SCALE * state.scale}px`,
        fontWeight: annotation.bold ? '700' : '400',
        fontStyle: annotation.italic ? 'italic' : 'normal',
        textDecoration: annotation.underline ? 'underline' : 'none',
        textAlign: annotation.align || 'left',
        lineHeight: String(annotation.lineHeight || 1.2),
        letterSpacing: `${annotation.letterSpacing || 0}px`,
        background: annotation.backgroundEnabled ? hexToRgba(annotation.backgroundColor || '#ffffff', annotation.backgroundOpacity ?? 1) : 'transparent',
      });

      const content = document.createElement('div');
      content.className = 'annotation-content';
      content.style.paddingLeft = `${Math.max(0, annotation.listIndent || 0) * 18 * state.scale}px`;
      content.textContent = formattedText(annotation);
      element.append(content);
      enableInlineTextEditing(element, content, annotation);
    } else if (annotation.type === 'checkbox') {
      element.textContent = '☑';
    } else if (annotation.type === 'image' || annotation.type === 'signature') {
      const image = new Image();
      image.src = annotation.data;
      element.append(image);
    } else if (annotation.type === 'draw') {
      element.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${annotation.points}" fill="none" stroke="${annotation.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    const handle = document.createElement('span');
    handle.className = 'resize';
    if (state.selectedIds.size <= 1 && !annotation.locked) element.append(handle);
    els.overlay.append(element);
    bindAnnotation(element, annotation, handle);
  });

  if (state.tool === 'editpdf') renderDetectedTextTargets(pageState);
  renderSmartGuides();
  renderMarquee();
}

function cssFontFamily(font) {
  const safe = String(font || 'Helvetica').replace(/["']/g, '');
  if (safe === 'Helvetica' || safe === 'Arial') return `Arial, Helvetica, sans-serif`;
  if (safe === 'Verdana') return `Verdana, Arial, sans-serif`;
  if (safe === 'Trebuchet MS') return `'Trebuchet MS', Arial, sans-serif`;
  if (safe === 'Times New Roman') return `'Times New Roman', Times, serif`;
  if (safe === 'Georgia') return `Georgia, 'Times New Roman', serif`;
  if (safe === 'Courier New') return `'Courier New', Courier, monospace`;
  return `Arial, Helvetica, sans-serif`;
}

let tesseractModulePromise = null;

async function loadTesseractModule() {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js');
  }
  return tesseractModulePromise;
}

async function detectTextWithOCR() {
  const pageState = state.pages[state.current];
  if (!pageState || !els.canvas.width || !els.canvas.height) return [];

  showBusy('Finding text', 'This page has no usable PDF text layer. Running local OCR…');
  try {
    const maxWidth = 1800;
    const ratio = Math.min(1, maxWidth / els.canvas.width);
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = Math.max(1, Math.round(els.canvas.width * ratio));
    ocrCanvas.height = Math.max(1, Math.round(els.canvas.height * ratio));
    const context = ocrCanvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);
    context.drawImage(els.canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);

    const module = await loadTesseractModule();
    const api = module.default || module;
    const result = await api.recognize(ocrCanvas, 'eng', {
      logger(message) {
        if (message?.status === 'recognizing text' && Number.isFinite(message.progress)) {
          updateBusy(`Recognising text… ${Math.round(message.progress * 100)}%`);
        }
      },
    });

    const words = result?.data?.words || [];
    const items = words
      .filter((word) => String(word?.text || '').trim() && (word.confidence ?? 100) >= 30 && word.bbox)
      .map((word, index) => {
        const { x0, y0, x1, y1 } = word.bbox;
        const x = clamp(x0 / ocrCanvas.width, 0, 0.99);
        const y = clamp(y0 / ocrCanvas.height, 0, 0.99);
        const w = clamp((x1 - x0) / ocrCanvas.width, 0.012, 1 - x);
        const h = clamp((y1 - y0) / ocrCanvas.height, 0.012, 1 - y);
        const cssHeight = h * Math.max(els.pageWrap.clientHeight, 1);
        return {
          id: `ocr-${pageState.source}-${index}-${String(word.text).slice(0, 20)}`,
          text: String(word.text).trim(),
          x, y, w, h,
          size: Math.max(6, Math.round((cssHeight / Math.max(BASE_RENDER_SCALE * state.scale, 0.01)) * 10) / 10),
          fontFamily: 'Helvetica',
          bold: false,
          italic: false,
        };
      });

    pageState.detectedText = items;
    pageState.detectedTextSource = items.length ? 'ocr' : null;
    renderAnnotations();
    if (items.length) {
      toast(`Found ${items.length} editable text item${items.length === 1 ? '' : 's'} with OCR.`);
    } else {
      toast('No editable text was found. This page may be an image with very low contrast.');
    }
    return items;
  } catch (error) {
    console.error('OCR failed', error);
    toast('Text recognition could not start. Check your connection and try again.');
    return [];
  } finally {
    hideBusy();
  }
}

function renderDetectedTextTargets(pageState) {
  const editedSourceIds = new Set(
    pageState.annotations
      .filter((annotation) => annotation.type === 'existingText')
      .map((annotation) => annotation.sourceTextId),
  );

  const items = pageState.detectedText || [];
  els.editHint.classList.remove('hidden');

  if (!items.length) {
    els.editHint.querySelector('small').textContent = 'No editable text detected on this page';
    return;
  }

  els.editHint.querySelector('small').textContent = 'Hover a text line and click it';

  items.forEach((item) => {
    if (editedSourceIds.has(item.id)) return;
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'pdf-text-target';
    target.title = `Edit “${item.text.slice(0, 80)}”`;
    Object.assign(target.style, {
      left: `${item.x * 100}%`,
      top: `${item.y * 100}%`,
      width: `${item.w * 100}%`,
      height: `${item.h * 100}%`,
    });
    target.onclick = (event) => {
      event.stopPropagation();
      convertDetectedText(item);
    };
    els.overlay.append(target);
  });
}

function convertDetectedText(item) {
  addAnn({
    type: 'existingText',
    sourceTextId: item.id,
    text: item.text,
    x: item.x,
    y: item.y,
    w: Math.max(item.w, 0.025),
    h: Math.max(item.h, 0.022),
    size: item.size,
    fontFamily: item.fontFamily || 'Helvetica',
    bold: item.bold || false,
    italic: item.italic || false,
    underline: false,
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    listStyle: 'none',
    listIndent: 0,
    color: '#111318',
    backgroundEnabled: true,
    backgroundColor: '#ffffff',
    backgroundOpacity: 1,
    opacity: 1,
  });
  toast('Text selected. Edit it in the Properties panel.');
}

function enableInlineTextEditing(element, content, annotation) {
  element.ondblclick = (event) => {
    event.stopPropagation();
    if (!TEXT_TYPES.has(annotation.type)) return;

    const before = annotation.text || '';
    content.textContent = before;
    content.contentEditable = 'true';
    content.classList.add('editing');
    content.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(content);
    selection.removeAllRanges();
    selection.addRange(range);

    content.onblur = () => {
      content.contentEditable = 'false';
      content.classList.remove('editing');
      const next = content.textContent || '';
      if (next !== before) {
        checkpoint();
        annotation.text = next;
        showProps(annotation);
        renderAnnotations();
      }
    };
  };
}

function bindAnnotation(element, annotation, handle) {
  element.onpointerdown = (event) => {
    if (event.target.isContentEditable) return;
    if (state.panMode || state.spacePan || event.button === 1) return;
    event.stopPropagation();

    const groupedIds = annotation.groupId
      ? state.pages[state.current].annotations.filter((item) => item.groupId === annotation.groupId).map((item) => item.id)
      : [annotation.id];

    if (event.shiftKey) {
      const next = new Set(state.selectedIds);
      groupedIds.forEach((id) => next.has(id) ? next.delete(id) : next.add(id));
      setSelection([...next], next.has(annotation.id) ? annotation.id : [...next][0], true);
      return;
    }

    if (!state.selectedIds.has(annotation.id)) setSelection(groupedIds, annotation.id, true);
    if (annotation.locked) return;

    const rect = els.overlay.getBoundingClientRect();
    const selected = selectedAnnotations().filter((item) => !item.locked);
    state.drag = {
      ids: selected.map((item) => item.id),
      startX: event.clientX,
      startY: event.clientY,
      starts: Object.fromEntries(selected.map((item) => [item.id, { x: item.x, y: item.y, w: item.w, h: item.h }])),
      rect,
      changed: false,
      before: snap(),
      altKey: event.altKey,
    };
  };

  handle.onpointerdown = (event) => {
    if (annotation.locked) return;
    event.stopPropagation();
    setSelection([annotation.id], annotation.id, true);
    const rect = els.overlay.getBoundingClientRect();
    state.drag = {
      ids: [annotation.id],
      resize: true,
      startX: event.clientX,
      startY: event.clientY,
      starts: { [annotation.id]: { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h } },
      rect,
      changed: false,
      before: snap(),
    };
  };
}

window.addEventListener('pointermove', (event) => {
  if (!state.drag) return;
  const dx = (event.clientX - state.drag.startX) / state.drag.rect.width;
  const dy = (event.clientY - state.drag.startY) / state.drag.rect.height;
  state.drag.changed = true;
  state.guides = [];

  if (state.drag.resize) {
    const annotation = currentAnn(state.drag.ids[0]);
    const origin = state.drag.starts[annotation.id];
    annotation.w = Math.max(0.03, Math.min(0.995 - annotation.x, origin.w + dx));
    annotation.h = Math.max(0.018, Math.min(0.995 - annotation.y, origin.h + dy));
  } else {
    const moving = state.drag.ids.map((id) => currentAnn(id)).filter(Boolean);
    const minX = Math.min(...moving.map((item) => state.drag.starts[item.id].x));
    const minY = Math.min(...moving.map((item) => state.drag.starts[item.id].y));
    const maxX = Math.max(...moving.map((item) => state.drag.starts[item.id].x + item.w));
    const maxY = Math.max(...moving.map((item) => state.drag.starts[item.id].y + item.h));
    const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const snapped = event.altKey ? { x: bounds.x + dx, y: bounds.y + dy, guides: [] } : snapPosition(bounds.x + dx, bounds.y + dy, bounds.w, bounds.h, state.drag.ids);
    state.guides = snapped.guides;
    const offsetX = clamp(snapped.x, 0, 1 - bounds.w) - bounds.x;
    const offsetY = clamp(snapped.y, 0, 1 - bounds.h) - bounds.y;
    moving.forEach((annotation) => {
      const origin = state.drag.starts[annotation.id];
      annotation.x = clamp(origin.x + offsetX, 0, 1 - annotation.w);
      annotation.y = clamp(origin.y + offsetY, 0, 1 - annotation.h);
    });
  }
  renderAnnotations();
});

window.addEventListener('pointerup', () => {
  if (!state.drag) return;
  if (state.drag.changed) pushHistory(state.drag.before);
  state.drag = null;
  state.guides = [];
  renderAnnotations();
});

function currentAnn(id = state.selected) {
  return state.pages[state.current]?.annotations.find((annotation) => annotation.id === id);
}

function selectedAnnotations() {
  const page = state.pages[state.current];
  if (!page) return [];
  return page.annotations.filter((annotation) => state.selectedIds.has(annotation.id));
}

function setSelection(ids = [], primary = null, rerender = true) {
  state.selectedIds = new Set(ids.filter(Boolean));
  state.selected = primary && state.selectedIds.has(primary) ? primary : [...state.selectedIds][0] || null;
  if (rerender) {
    renderAnnotations();
    showProps(currentAnn() || null);
  }
}

function clearSelection(rerender = true) {
  state.selectedIds = new Set();
  state.selected = null;
  if (rerender) {
    renderAnnotations();
    showProps(null);
  }
}

function formattedText(annotation) {
  const text = String(annotation.text || '');
  if (annotation.listStyle === 'bullet') return text.split('\n').map((line) => line.trim() ? `• ${line.replace(/^•\s*/, '')}` : '').join('\n');
  if (annotation.listStyle === 'number') return text.split('\n').map((line, index) => line.trim() ? `${index + 1}. ${line.replace(/^\d+[.)]\s*/, '')}` : '').join('\n');
  return text;
}

function hexToRgba(hex, alpha = 1) {
  const [r, g, b] = hexRgb(hex).map((value) => Math.round(value * 255));
  return `rgba(${r},${g},${b},${clamp(Number(alpha), 0, 1)})`;
}

function renderSmartGuides() {
  state.guides.forEach((guide) => {
    const line = document.createElement('div');
    line.className = `smart-guide ${guide.axis}`;
    if (guide.axis === 'v') line.style.left = `${guide.at * 100}%`;
    else line.style.top = `${guide.at * 100}%`;
    els.overlay.append(line);
  });
}

function renderMarquee() {
  if (!state.marquee) return;
  const box = document.createElement('div');
  box.className = 'selection-marquee';
  Object.assign(box.style, {
    left: `${state.marquee.x * 100}%`, top: `${state.marquee.y * 100}%`,
    width: `${state.marquee.w * 100}%`, height: `${state.marquee.h * 100}%`,
  });
  els.overlay.append(box);
}

function snapPosition(x, y, w, h, movingIds = []) {
  const threshold = 0.009;
  const xCandidates = [0, 0.5, 1];
  const yCandidates = [0, 0.5, 1];
  if (state.gridSnap) {
    for (let point = 0; point <= 1.0001; point += 0.025) { xCandidates.push(point); yCandidates.push(point); }
  }
  state.pages[state.current].annotations.forEach((item) => {
    if (movingIds.includes(item.id)) return;
    xCandidates.push(item.x, item.x + item.w / 2, item.x + item.w);
    yCandidates.push(item.y, item.y + item.h / 2, item.y + item.h);
  });
  const xPoints = [{ value: x, offset: 0 }, { value: x + w / 2, offset: w / 2 }, { value: x + w, offset: w }];
  const yPoints = [{ value: y, offset: 0 }, { value: y + h / 2, offset: h / 2 }, { value: y + h, offset: h }];
  let bestX = { distance: threshold + 1, value: x, guide: null };
  let bestY = { distance: threshold + 1, value: y, guide: null };
  xPoints.forEach((point) => xCandidates.forEach((candidate) => {
    const distance = Math.abs(point.value - candidate);
    if (distance < bestX.distance && distance <= threshold) bestX = { distance, value: candidate - point.offset, guide: candidate };
  }));
  yPoints.forEach((point) => yCandidates.forEach((candidate) => {
    const distance = Math.abs(point.value - candidate);
    if (distance < bestY.distance && distance <= threshold) bestY = { distance, value: candidate - point.offset, guide: candidate };
  }));
  const guides = [];
  if (bestX.guide != null) guides.push({ axis: 'v', at: bestX.guide });
  if (bestY.guide != null) guides.push({ axis: 'h', at: bestY.guide });
  return { x: bestX.value, y: bestY.value, guides };
}

els.overlay.onclick = (event) => {
  if (event.target !== els.overlay) return;
  clearSelection();
};

els.overlay.onpointerdown = (event) => {
  if (event.button !== 0) return;
  const rect = els.overlay.getBoundingClientRect();
  if (state.tool === 'draw') {
    state.draw = {
      pts: [[(event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100]],
      rect,
    };
    event.preventDefault();
    return;
  }
  if (state.tool === 'select' && !state.panMode && !state.spacePan && event.target === els.overlay) {
    const startX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const startY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    state.marquee = { startX, startY, x: startX, y: startY, w: 0, h: 0, additive: event.shiftKey, pointerId: event.pointerId };
    els.overlay.setPointerCapture?.(event.pointerId);
    if (!event.shiftKey) clearSelection(false);
    renderAnnotations();
    event.preventDefault();
  }
};

els.overlay.onpointermove = (event) => {
  if (state.draw) {
    state.draw.pts.push([
      (event.clientX - state.draw.rect.left) / state.draw.rect.width * 100,
      (event.clientY - state.draw.rect.top) / state.draw.rect.height * 100,
    ]);
    return;
  }
  if (!state.marquee) return;
  const rect = els.overlay.getBoundingClientRect();
  const currentX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const currentY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  state.marquee.x = Math.min(state.marquee.startX, currentX);
  state.marquee.y = Math.min(state.marquee.startY, currentY);
  state.marquee.w = Math.abs(currentX - state.marquee.startX);
  state.marquee.h = Math.abs(currentY - state.marquee.startY);
  renderAnnotations();
};

els.overlay.onpointerup = () => {
  if (state.draw) {
    const xs = state.draw.pts.map((point) => point[0]);
    const ys = state.draw.pts.map((point) => point[1]);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const points = state.draw.pts.map((point) => `${((point[0] - minX) / (maxX - minX || 1)) * 100},${((point[1] - minY) / (maxY - minY || 1)) * 100}`).join(' ');
    addAnn({ type: 'draw', x: minX / 100, y: minY / 100, w: Math.max(0.03, (maxX - minX) / 100), h: Math.max(0.03, (maxY - minY) / 100), points, color: '#6d5dfc', opacity: 1 });
    state.draw = null;
    return;
  }
  if (!state.marquee) return;
  const box = state.marquee;
  const matches = state.pages[state.current].annotations.filter((item) => item.x < box.x + box.w && item.x + item.w > box.x && item.y < box.y + box.h && item.y + item.h > box.y).map((item) => item.id);
  const next = box.additive ? new Set([...state.selectedIds, ...matches]) : new Set(matches);
  try { if (els.overlay.hasPointerCapture?.(box.pointerId)) els.overlay.releasePointerCapture(box.pointerId); } catch (_) {}
  state.marquee = null;
  setSelection([...next], matches.at(-1) || [...next][0] || null, true);
};

function addAnn(annotation) {
  checkpoint();
  annotation.id = uid();
  state.pages[state.current].annotations.push(annotation);
  setSelection([annotation.id], annotation.id, false);
  setTool('select', false);
  renderAnnotations();
  showProps(annotation);
}

function defaultPos() {
  return { x: 0.18, y: 0.18, w: 0.25, h: 0.06 };
}

function textDefaults(text = 'Edit this text') {
  return {
    ...defaultPos(),
    type: 'text',
    text,
    ...structuredClone(state.lastTextStyle),
  };
}

function setTool(tool, rerender = true) {
  state.tool = tool;
  $$('.tool').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  els.editHint.classList.toggle('hidden', tool !== 'editpdf');
  els.overlay.classList.toggle('editing-pdf', tool === 'editpdf');
  if (rerender) renderAnnotations();
}

$$('.tool').forEach((button) => {
  button.onclick = async () => {
    const tool = button.dataset.tool;
    setTool(tool);

    if (tool === 'editpdf') {
      let count = state.pages[state.current]?.detectedText?.length || 0;
      if (!count) {
        toast('No PDF text layer found — trying text recognition…');
        count = (await detectTextWithOCR()).length;
      }
      if (count) toast('Tap a highlighted text item to edit it.');
    }
    if (tool === 'text') addAnn(textDefaults());
    if (tool === 'whiteout') addAnn({ ...defaultPos(), type: 'whiteout', w: 0.28, h: 0.05, color: '#ffffff', opacity: 1 });
    if (tool === 'highlight') addAnn({ ...defaultPos(), type: 'highlight', w: 0.3, h: 0.035, color: '#ffe24b', opacity: 0.5 });
    if (tool === 'shape') addAnn({ ...defaultPos(), type: 'shape', w: 0.24, h: 0.12, color: '#5b5f69', opacity: 1 });
    if (tool === 'date') addAnn({ ...textDefaults(new Date().toLocaleDateString('en-GB')), type: 'date', size: 17 });
    if (tool === 'checkbox') addAnn({ ...defaultPos(), type: 'checkbox', w: 0.045, h: 0.045, size: 26, color: '#111318', opacity: 1 });
    if (tool === 'image') els.imageInput.click();
    if (tool === 'signature') openSignature();
  };
});

$('#exitEditMode').onclick = () => setTool('select');

els.imageInput.onchange = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => addAnn({ ...defaultPos(), type: 'image', w: 0.28, h: 0.18, data: reader.result, opacity: 1 });
  reader.readAsDataURL(file);
  event.target.value = '';
};

function showProps(annotation) {
  const multi = state.selectedIds.size > 1;
  els.emptyProps.classList.toggle('hidden', Boolean(annotation) || multi);
  els.objectProps.classList.toggle('hidden', !annotation || multi);
  els.multiProps.classList.toggle('hidden', !multi);
  if (multi) {
    $('#multiCount').textContent = `${state.selectedIds.size} elements`;
    return;
  }
  if (!annotation) return;

  const isText = TEXT_TYPES.has(annotation.type);
  const isExisting = annotation.type === 'existingText';

  $('#propType').value = isExisting ? 'Existing PDF text' : readableType(annotation.type);
  $('#textProps').classList.toggle('hidden', !isText);
  const hasGenericColour = !isText && !['image', 'signature'].includes(annotation.type);
  $('#genericProps').classList.toggle('hidden', !hasGenericColour);
  $('#existingTextBadge').classList.toggle('hidden', !isExisting);
  $('#existingTextNote').classList.toggle('hidden', !isExisting);

  $('#propText').value = annotation.text || '';
  $('#propFont').value = annotation.fontFamily || 'Helvetica';
  $('#propSize').value = annotation.size || 18;
  $('#propAlign').value = annotation.align || 'left';
  $('#propLineHeight').value = annotation.lineHeight || 1.2;
  $('#propLetterSpacing').value = annotation.letterSpacing || 0;
  $('#propListStyle').value = annotation.listStyle || 'none';
  const indent = Math.max(0, annotation.listIndent || 0);
  $('#outdentBtn').disabled = indent <= 0;
  $('#indentBtn').disabled = indent >= 4;
  ['left','center','right'].forEach((align) => $(`#align${align[0].toUpperCase()+align.slice(1)}Btn`)?.classList.toggle('active', (annotation.align || 'left') === align));
  $('#boldBtn').classList.toggle('active', Boolean(annotation.bold));
  $('#italicBtn').classList.toggle('active', Boolean(annotation.italic));
  $('#underlineBtn').classList.toggle('active', Boolean(annotation.underline));
  $('#propColor').value = toHex(annotation.color || '#111318');
  $('#genericColor').value = toHex(annotation.color || '#111318');
  $('#propBgColor').value = toHex(annotation.backgroundColor || '#ffffff');
  $('#propBgEnabled').checked = Boolean(annotation.backgroundEnabled);
  $('#propBgOpacity').value = annotation.backgroundOpacity ?? 1;
  $('#bgOpacityValue').textContent = `${Math.round((annotation.backgroundOpacity ?? 1) * 100)}%`;
  $('#lockObjBtn').textContent = annotation.locked ? 'Unlock' : 'Lock';
  $('#propOpacity').value = annotation.opacity ?? 1;
  $('#opacityValue').textContent = `${Math.round((annotation.opacity ?? 1) * 100)}%`;
}

function readableType(type) {
  const names = {
    text: 'Text',
    date: 'Date',
    whiteout: 'Whiteout',
    image: 'Image',
    signature: 'Signature',
    draw: 'Drawing',
    highlight: 'Highlight',
    shape: 'Shape',
    checkbox: 'Checkbox',
  };
  return names[type] || type;
}

const TEXT_STYLE_KEYS = new Set(['fontFamily','size','bold','italic','underline','align','lineHeight','letterSpacing','listStyle','listIndent','color','backgroundEnabled','backgroundColor','backgroundOpacity','opacity']);
function rememberTextStyle(annotation) {
  if (!annotation || !TEXT_TYPES.has(annotation.type)) return;
  TEXT_STYLE_KEYS.forEach((key) => { if (key in annotation) state.lastTextStyle[key] = structuredClone(annotation[key]); });
}
function updateProp(key, value) {
  const annotation = currentAnn();
  if (!annotation) return;
  checkpoint();
  annotation[key] = value;
  if (TEXT_STYLE_KEYS.has(key)) rememberTextStyle(annotation);
  renderAnnotations();
  showProps(annotation);
}

$('#propText').onchange = (event) => updateProp('text', event.target.value);
$('#propFont').onchange = (event) => updateProp('fontFamily', event.target.value);
$('#propSize').onchange = (event) => updateProp('size', clamp(Number(event.target.value) || 18, 6, 160));
$('#propAlign').onchange = (event) => updateProp('align', event.target.value);
$('#propLineHeight').onchange = (event) => updateProp('lineHeight', clamp(Number(event.target.value) || 1.2, 0.8, 3));
$('#propLetterSpacing').onchange = (event) => updateProp('letterSpacing', clamp(Number(event.target.value) || 0, -2, 12));
$('#propListStyle').onchange = (event) => updateProp('listStyle', event.target.value);
$('#outdentBtn').onclick = () => { const annotation=currentAnn(); if(annotation) updateProp('listIndent', Math.max(0,(annotation.listIndent||0)-1)); };
$('#indentBtn').onclick = () => { const annotation=currentAnn(); if(annotation) updateProp('listIndent', Math.min(4,(annotation.listIndent||0)+1)); };
$('#propColor').onchange = (event) => updateProp('color', event.target.value);
$('#genericColor').onchange = (event) => updateProp('color', event.target.value);
$('#propBgColor').onchange = (event) => updateProp('backgroundColor', event.target.value);
$('#propBgEnabled').onchange = (event) => updateProp('backgroundEnabled', event.target.checked);
let bgOpacitySnapshot = null;
$('#propBgOpacity').onpointerdown = () => { bgOpacitySnapshot = snap(); };
$('#propBgOpacity').oninput = (event) => {
  const annotation = currentAnn(); if (!annotation) return;
  if (!bgOpacitySnapshot) bgOpacitySnapshot = snap();
  annotation.backgroundOpacity = Number(event.target.value);
  rememberTextStyle(annotation);
  $('#bgOpacityValue').textContent = `${Math.round(annotation.backgroundOpacity * 100)}%`;
  renderAnnotations();
};
$('#propBgOpacity').onchange = () => { if (bgOpacitySnapshot) pushHistory(bgOpacitySnapshot); bgOpacitySnapshot = null; };
let opacityStartSnapshot = null;
$('#propOpacity').onpointerdown = () => { opacityStartSnapshot = snap(); };
$('#propOpacity').oninput = (event) => {
  const annotation = currentAnn();
  if (!annotation) return;
  if (!opacityStartSnapshot) opacityStartSnapshot = snap();
  annotation.opacity = Number(event.target.value);
  rememberTextStyle(annotation);
  $('#opacityValue').textContent = `${Math.round(annotation.opacity * 100)}%`;
  renderAnnotations();
};
$('#propOpacity').onchange = () => {
  if (opacityStartSnapshot) pushHistory(opacityStartSnapshot);
  opacityStartSnapshot = null;
};

$('#boldBtn').onclick = () => {
  const annotation = currentAnn();
  if (annotation) updateProp('bold', !annotation.bold);
};
$('#italicBtn').onclick = () => {
  const annotation = currentAnn();
  if (annotation) updateProp('italic', !annotation.italic);
};
$('#underlineBtn').onclick = () => {
  const annotation = currentAnn();
  if (annotation) updateProp('underline', !annotation.underline);
};
['left','center','right'].forEach((align) => {
  const button = $(`#align${align[0].toUpperCase()+align.slice(1)}Btn`);
  if (button) button.onclick = () => updateProp('align', align);
});

$('#deleteObjBtn').onclick = () => deleteSelectedAnnotations();

$('#duplicateBtn').onclick = () => {
  const annotation = currentAnn();
  if (!annotation) return;
  checkpoint();
  const duplicate = structuredClone(annotation);
  duplicate.id = uid();
  duplicate.sourceTextId = null;
  if (duplicate.type === 'existingText') duplicate.type = 'text';
  duplicate.x = Math.min(0.95 - duplicate.w, duplicate.x + 0.03);
  duplicate.y = Math.min(0.95 - duplicate.h, duplicate.y + 0.03);
  state.pages[state.current].annotations.push(duplicate);
  setSelection([duplicate.id], duplicate.id, true);
};


function copySelection(cut = false) {
  const selected = selectedAnnotations();
  if (!selected.length) return;
  state.clipboard = selected.map((item) => structuredClone(item));
  if (cut) deleteSelectedAnnotations();
  else toast(`${selected.length} element${selected.length === 1 ? '' : 's'} copied.`);
}

function pasteClipboard() {
  if (!state.clipboard.length) return toast('Nothing to paste.');
  checkpoint();
  const groupMap = new Map();
  const pasted = state.clipboard.map((item) => {
    const copy = structuredClone(item);
    copy.id = uid(); copy.sourceTextId = null;
    if (copy.type === 'existingText') copy.type = 'text';
    copy.x = clamp(copy.x + 0.025, 0, 1 - copy.w);
    copy.y = clamp(copy.y + 0.025, 0, 1 - copy.h);
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, `group-${uid()}`);
      copy.groupId = groupMap.get(copy.groupId);
    }
    state.pages[state.current].annotations.push(copy);
    return copy.id;
  });
  setSelection(pasted, pasted.at(-1), true);
}

function duplicateSelection() {
  const selected = selectedAnnotations();
  if (!selected.length) return;
  const previousClipboard = state.clipboard;
  state.clipboard = selected.map((item) => structuredClone(item));
  pasteClipboard();
  state.clipboard = previousClipboard;
}

function deleteSelectedAnnotations() {
  const ids = new Set(state.selectedIds.size ? state.selectedIds : state.selected ? [state.selected] : []);
  if (!ids.size) return;
  checkpoint();
  const page = state.pages[state.current];
  page.annotations = page.annotations.filter((item) => !ids.has(item.id) || item.locked);
  const lockedCount = [...ids].filter((id) => currentAnn(id)?.locked).length;
  clearSelection();
  if (lockedCount) toast('Locked elements were kept. Unlock them before deleting.');
}

function selectAllAnnotations() {
  const ids = state.pages[state.current].annotations.map((item) => item.id);
  setSelection(ids, ids.at(-1), true);
}

function moveLayer(direction) {
  const page = state.pages[state.current];
  const ids = new Set(state.selectedIds);
  if (!ids.size) return;
  checkpoint();
  const selected = page.annotations.filter((item) => ids.has(item.id));
  const rest = page.annotations.filter((item) => !ids.has(item.id));
  page.annotations = direction === 'front' ? [...rest, ...selected] : [...selected, ...rest];
  renderAnnotations();
}

function toggleLock() {
  const selected = selectedAnnotations();
  if (!selected.length) return;
  checkpoint();
  const shouldLock = selected.some((item) => !item.locked);
  selected.forEach((item) => { item.locked = shouldLock; });
  renderAnnotations(); showProps(currentAnn());
}

function groupSelection() {
  const selected = selectedAnnotations();
  if (selected.length < 2) return toast('Select at least two elements to group.');
  checkpoint();
  const groupId = `group-${uid()}`;
  selected.forEach((item) => { item.groupId = groupId; });
  renderAnnotations();
}

function ungroupSelection() {
  const selected = selectedAnnotations();
  if (!selected.length) return;
  checkpoint();
  selected.forEach((item) => { item.groupId = null; });
  renderAnnotations();
}

function alignObjects(mode) {
  const items = selectedAnnotations().filter((item) => !item.locked);
  if (items.length < 2) return;
  checkpoint();
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.w));
  const minY = Math.min(...items.map((item) => item.y));
  const maxY = Math.max(...items.map((item) => item.y + item.h));
  items.forEach((item) => {
    if (mode === 'left') item.x = minX;
    if (mode === 'center') item.x = (minX + maxX - item.w) / 2;
    if (mode === 'right') item.x = maxX - item.w;
    if (mode === 'top') item.y = minY;
    if (mode === 'middle') item.y = (minY + maxY - item.h) / 2;
    if (mode === 'bottom') item.y = maxY - item.h;
  });
  renderAnnotations();
}

function distributeObjects(axis) {
  const items = selectedAnnotations().filter((item) => !item.locked);
  if (items.length < 3) return toast('Select at least three elements to distribute.');
  checkpoint();
  const sorted = [...items].sort((a,b) => axis === 'x' ? a.x - b.x : a.y - b.y);
  if (axis === 'x') {
    const start = sorted[0].x; const end = sorted.at(-1).x + sorted.at(-1).w;
    const total = sorted.reduce((sum,item) => sum + item.w, 0);
    const gap = (end - start - total) / (sorted.length - 1);
    let cursor = start; sorted.forEach((item) => { item.x = cursor; cursor += item.w + gap; });
  } else {
    const start = sorted[0].y; const end = sorted.at(-1).y + sorted.at(-1).h;
    const total = sorted.reduce((sum,item) => sum + item.h, 0);
    const gap = (end - start - total) / (sorted.length - 1);
    let cursor = start; sorted.forEach((item) => { item.y = cursor; cursor += item.h + gap; });
  }
  renderAnnotations();
}

function applyCopiedStyle() {
  const annotation = currentAnn();
  if (!annotation || !state.copiedStyle) return toast('Copy a style first.');
  checkpoint(); Object.assign(annotation, structuredClone(state.copiedStyle)); renderAnnotations(); showProps(annotation);
}

function toHex(colour) {
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  if (/^#[0-9a-f]{3}$/i.test(colour)) return `#${colour.slice(1).split('').map((char) => char + char).join('')}`;
  return '#111318';
}

$('#rotateBtn').onclick = () => {
  checkpoint();
  const pageState = state.pages[state.current];
  pageState.rotation = (pageState.rotation + 90) % 360;
  pageState.detectedText = null;
  state.pendingStageCenter = true;
  renderAll();
};

$('#deletePageBtn').onclick = () => {
  if (state.pages.length === 1) return toast('A PDF must contain at least one page.');
  checkpoint();
  state.pages.splice(state.current, 1);
  state.current = Math.max(0, state.current - 1);
  state.pageSelection.clear();
  state.pendingStageCenter = true;
  renderAll();
};

function updateVirtualStageSpace() {
  const stage = els.pageStage;
  if (!stage || !els.pageWrap.offsetWidth) return;
  const padX = Math.max(260, Math.round(stage.clientWidth * 0.72));
  const padY = Math.max(240, Math.round(stage.clientHeight * 0.72));
  els.pageStageContent.style.setProperty('--free-pad-x', `${padX}px`);
  els.pageStageContent.style.setProperty('--free-pad-y', `${padY}px`);
}

function centrePointOnPage() {
  const stage = els.pageStage;
  const wrap = els.pageWrap;
  return {
    x: (stage.scrollLeft + stage.clientWidth / 2 - wrap.offsetLeft) / Math.max(wrap.offsetWidth, 1),
    y: (stage.scrollTop + stage.clientHeight / 2 - wrap.offsetTop) / Math.max(wrap.offsetHeight, 1),
  };
}

function scrollPagePointToCentre(point = { x: 0.5, y: 0.5 }) {
  const stage = els.pageStage;
  const wrap = els.pageWrap;
  stage.scrollLeft = wrap.offsetLeft + clamp(point.x, -0.6, 1.6) * wrap.offsetWidth - stage.clientWidth / 2;
  stage.scrollTop = wrap.offsetTop + clamp(point.y, -0.6, 1.6) * wrap.offsetHeight - stage.clientHeight / 2;
}

function centerPageInStage() {
  updateVirtualStageSpace();
  scrollPagePointToCentre({ x: 0.5, y: 0.5 });
}


function setWorkspaceView(view, render = true) {
  state.view = view === 'pages' ? 'pages' : 'edit';
  const pagesMode = state.view === 'pages';
  els.workspace.classList.toggle('pages-mode', pagesMode);
  els.pagesManager.classList.toggle('hidden', !pagesMode);
  els.editViewTab.classList.toggle('active', !pagesMode);
  els.pagesViewTab.classList.toggle('active', pagesMode);
  els.editViewTab.setAttribute('aria-selected', String(!pagesMode));
  els.pagesViewTab.setAttribute('aria-selected', String(pagesMode));
  if (!pagesMode) state.pendingStageCenter = true;
  if (pagesMode) clearSelection(false);
  if (render && state.pages.length) renderAll();
}

function pageById(pageId) {
  return state.pages.find((page) => page.pageId === pageId);
}

function clonePageState(pageState) {
  return {
    ...structuredClone(pageState),
    pageId: uid(),
    annotations: pageState.annotations.map((annotation) => ({ ...structuredClone(annotation), id: uid() })),
    detectedText: null,
  };
}

function updatePageSelectionUI() {
  const selectedCount = state.pageSelection.size;
  const total = state.pages.length;
  els.pageSelectionText.textContent = selectedCount ? `${selectedCount} of ${total} pages selected` : 'No pages selected';
  $('#rotateSelectedPagesBtn').disabled = !selectedCount;
  $('#duplicateSelectedPagesBtn').disabled = !selectedCount;
  $('#deleteSelectedPagesBtn').disabled = !selectedCount || selectedCount >= total;
  $('#selectAllPagesBtn').textContent = selectedCount === total && total ? 'All selected' : 'Select all';
}

async function renderPageManager() {
  if (!els.pagesGrid) return;
  els.pageCountLabel.textContent = state.pages.length;
  state.pageSelection = new Set([...state.pageSelection].filter((pageId) => pageById(pageId)));
  els.pagesGrid.innerHTML = '';

  const renderJobs = state.pages.map((pageState, index) => {
    const card = document.createElement('article');
    card.className = `page-card${state.pageSelection.has(pageState.pageId) ? ' selected' : ''}`;
    card.draggable = true;
    card.dataset.pageId = pageState.pageId;
    card.dataset.index = index;

    const top = document.createElement('div');
    top.className = 'page-card-top';
    const selection = document.createElement('label');
    selection.className = 'page-card-select';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.pageSelection.has(pageState.pageId);
    const selectionLabel = document.createElement('span');
    selectionLabel.textContent = `Page ${index + 1}`;
    selection.append(checkbox, selectionLabel);
    const handle = document.createElement('span');
    handle.className = 'page-drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';
    const statusWrap = document.createElement('div');
    statusWrap.style.display = 'flex';
    statusWrap.style.alignItems = 'center';
    statusWrap.style.gap = '7px';
    if (pageState.annotations.length) {
      const edited = document.createElement('span');
      edited.className = 'page-card-edited';
      edited.textContent = 'EDITED';
      statusWrap.append(edited);
    }
    statusWrap.append(handle);
    top.append(selection, statusWrap);

    const preview = document.createElement('div');
    preview.className = 'page-card-preview';
    const canvas = document.createElement('canvas');
    preview.append(canvas);

    const footer = document.createElement('div');
    footer.className = 'page-card-footer';
    const number = document.createElement('div');
    number.className = 'page-card-number';
    number.innerHTML = `<strong>Page ${index + 1}</strong><small>Double-click to edit</small>`;
    const actions = document.createElement('div');
    actions.className = 'page-card-actions';
    const rotate = document.createElement('button');
    rotate.type = 'button'; rotate.className = 'page-card-action'; rotate.title = 'Rotate page'; rotate.textContent = '↻';
    const duplicate = document.createElement('button');
    duplicate.type = 'button'; duplicate.className = 'page-card-action'; duplicate.title = 'Duplicate page'; duplicate.textContent = '⧉';
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'page-card-action danger'; remove.title = 'Delete page'; remove.textContent = '×';
    actions.append(rotate, duplicate, remove);
    footer.append(number, actions);
    card.append(top, preview, footer);
    els.pagesGrid.append(card);

    const setSelected = (checked) => {
      checked ? state.pageSelection.add(pageState.pageId) : state.pageSelection.delete(pageState.pageId);
      checkbox.checked = checked;
      card.classList.toggle('selected', checked);
      updatePageSelectionUI();
    };

    checkbox.onchange = () => setSelected(checkbox.checked);
    card.onclick = (event) => {
      if (event.target.closest('button,label')) return;
      setSelected(!state.pageSelection.has(pageState.pageId));
    };
    card.ondblclick = (event) => {
      if (event.target.closest('button,label')) return;
      state.current = state.pages.findIndex((page) => page.pageId === pageState.pageId);
      clearSelection(false);
      setWorkspaceView('edit');
    };
    rotate.onclick = async (event) => {
      event.stopPropagation();
      checkpoint();
      pageState.rotation = (pageState.rotation + 90) % 360;
      pageState.detectedText = null;
      await renderAll();
    };
    duplicate.onclick = (event) => {
      event.stopPropagation();
      checkpoint();
      const currentIndex = state.pages.findIndex((page) => page.pageId === pageState.pageId);
      state.pages.splice(currentIndex + 1, 0, clonePageState(pageState));
      renderAll();
    };
    remove.onclick = (event) => {
      event.stopPropagation();
      if (state.pages.length === 1) return toast('A PDF must contain at least one page.');
      checkpoint();
      const currentIndex = state.pages.findIndex((page) => page.pageId === pageState.pageId);
      state.pages.splice(currentIndex, 1);
      state.pageSelection.delete(pageState.pageId);
      state.current = clamp(state.current, 0, state.pages.length - 1);
      renderAll();
    };

    card.ondragstart = (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/page-id', pageState.pageId);
      event.dataTransfer.setData('text/plain', pageState.pageId);
      card.classList.add('dragging');
    };
    card.ondragend = () => {
      card.classList.remove('dragging');
      $$('.page-card').forEach((item) => item.classList.remove('drag-over'));
    };
    card.ondragover = (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    };
    card.ondragleave = () => card.classList.remove('drag-over');
    card.ondrop = (event) => {
      event.preventDefault();
      card.classList.remove('drag-over');
      const fromId = event.dataTransfer.getData('text/page-id') || event.dataTransfer.getData('text/plain');
      if (!fromId || fromId === pageState.pageId) return;
      const from = state.pages.findIndex((page) => page.pageId === fromId);
      const to = state.pages.findIndex((page) => page.pageId === pageState.pageId);
      if (from < 0 || to < 0) return;
      checkpoint();
      const [moved] = state.pages.splice(from, 1);
      const insertAt = from < to ? to - 1 : to;
      state.pages.splice(insertAt, 0, moved);
      state.current = state.pages.findIndex((page) => page.pageId === moved.pageId);
      renderAll();
    };

    scheduleManagerRender(canvas, pageState);
    return Promise.resolve();
  });

  updatePageSelectionUI();
  await Promise.allSettled(renderJobs);
}

async function renderManagerCanvas(canvas, pageState) {
  const page = await state.pdfDoc.getPage(pageState.source + 1);
  const rotation = pageRotation(pageState);
  const base = page.getViewport({ scale: 1, rotation });
  const targetWidth = 170;
  const cssScale = targetWidth / Math.max(base.width, 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssViewport = page.getViewport({ scale: cssScale, rotation });
  const renderViewport = page.getViewport({ scale: cssScale * dpr, rotation });
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
  canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  await page.render({ canvasContext: context, viewport: renderViewport, background: '#ffffff' }).promise;
}

els.editViewTab.onclick = () => setWorkspaceView('edit');
els.pagesViewTab.onclick = () => setWorkspaceView('pages');
$('#selectAllPagesBtn').onclick = () => {
  state.pageSelection = new Set(state.pages.map((page) => page.pageId));
  renderPageManager();
};
$('#clearPageSelectionBtn').onclick = () => {
  state.pageSelection.clear();
  renderPageManager();
};
$('#rotateSelectedPagesBtn').onclick = () => {
  if (!state.pageSelection.size) return;
  checkpoint();
  state.pages.forEach((page) => {
    if (!state.pageSelection.has(page.pageId)) return;
    page.rotation = (page.rotation + 90) % 360;
    page.detectedText = null;
  });
  renderAll();
};
$('#duplicateSelectedPagesBtn').onclick = () => {
  if (!state.pageSelection.size) return;
  checkpoint();
  const selected = state.pages.filter((page) => state.pageSelection.has(page.pageId));
  const newPages = [];
  state.pages.forEach((page) => {
    newPages.push(page);
    if (state.pageSelection.has(page.pageId)) newPages.push(clonePageState(page));
  });
  state.pages = newPages;
  state.pageSelection = new Set(selected.map((page) => page.pageId));
  renderAll();
};
$('#deleteSelectedPagesBtn').onclick = () => {
  if (!state.pageSelection.size) return;
  if (state.pageSelection.size >= state.pages.length) return toast('A PDF must contain at least one page.');
  checkpoint();
  state.pages = state.pages.filter((page) => !state.pageSelection.has(page.pageId));
  state.pageSelection.clear();
  state.current = clamp(state.current, 0, state.pages.length - 1);
  renderAll();
};

async function setZoom(nextScale, focusPoint = null) {
  const point = focusPoint || centrePointOnPage();
  state.scale = clamp(nextScale, 0.4, 4);
  await renderPage();
  requestAnimationFrame(() => scrollPagePointToCentre(point));
}

$('#zoomIn').onclick = () => setZoom(state.scale + 0.1);
$('#zoomOut').onclick = () => setZoom(state.scale - 0.1);
$('#centerViewBtn').onclick = centerPageInStage;
$('#fitViewBtn').onclick = async () => {
  if (!state.pages.length) return;
  const pageState = state.pages[state.current];
  const page = await state.pdfDoc.getPage(pageState.source + 1);
  const viewport = page.getViewport({ scale: BASE_RENDER_SCALE, rotation: pageRotation(pageState) });
  const availableWidth = Math.max(220, els.pageStage.clientWidth - 120);
  const availableHeight = Math.max(220, els.pageStage.clientHeight - 120);
  const fitScale = Math.min(availableWidth / viewport.width, availableHeight / viewport.height);
  state.pendingStageCenter = true;
  await setZoom(clamp(fitScale, 0.4, 4), { x: 0.5, y: 0.5 });
};

function updatePanUI() {
  const ready = state.panMode || state.spacePan;
  els.panBtn.classList.toggle('active', state.panMode);
  els.panBtn.setAttribute('aria-pressed', String(state.panMode));
  els.pageStage.classList.toggle('pan-ready', ready && !state.pan);
}

function stopPanning(pointerId) {
  if (!state.pan) return;
  try {
    if (pointerId != null && els.pageStage.hasPointerCapture(pointerId)) {
      els.pageStage.releasePointerCapture(pointerId);
    }
  } catch (_) {}
  state.pan = null;
  els.pageStage.classList.remove('panning');
  updatePanUI();
}

$('#gridBtn').onclick = () => {
  state.gridSnap = !state.gridSnap;
  $('#gridBtn').classList.toggle('active', state.gridSnap);
  els.pageStage.classList.toggle('grid-snap-on', state.gridSnap);
  toast(state.gridSnap ? 'Grid snapping enabled. Hold Alt while dragging to bypass it.' : 'Grid snapping disabled.');
};

els.panBtn.onclick = () => {
  state.panMode = !state.panMode;
  updatePanUI();
  toast(state.panMode ? 'Hand tool active — drag anywhere to move around the PDF.' : 'Hand tool off. Drag the dark canvas or use the mouse wheel.');
};

els.pageStage.addEventListener('pointerdown', (event) => {
  const darkCanvasDrag = event.button === 0 && (event.target === els.pageStage || event.target === els.pageStageContent);
  const temporaryPan = event.button === 1 || state.spacePan || darkCanvasDrag;
  if (!state.panMode && !temporaryPan) return;
  if (event.button !== 0 && event.button !== 1) return;
  if (event.target.closest?.('.annotation,.pdf-text-target,[contenteditable="true"]') && !state.spacePan && event.button !== 1) return;

  event.preventDefault();
  event.stopPropagation();
  els.pageStage.focus({ preventScroll: true });
  state.pan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: els.pageStage.scrollLeft,
    scrollTop: els.pageStage.scrollTop,
  };
  els.pageStage.setPointerCapture?.(event.pointerId);
  els.pageStage.classList.add('panning');
  els.pageStage.classList.remove('pan-ready');
}, true);

els.pageStage.addEventListener('pointermove', (event) => {
  if (!state.pan || state.pan.pointerId !== event.pointerId) return;
  event.preventDefault();
  els.pageStage.scrollLeft = state.pan.scrollLeft - (event.clientX - state.pan.startX);
  els.pageStage.scrollTop = state.pan.scrollTop - (event.clientY - state.pan.startY);
}, true);

els.pageStage.addEventListener('pointerup', (event) => stopPanning(event.pointerId), true);
els.pageStage.addEventListener('pointercancel', (event) => stopPanning(event.pointerId), true);
els.pageStage.addEventListener('lostpointercapture', () => stopPanning(), true);
els.pageStage.addEventListener('auxclick', (event) => {
  if (event.button === 1) event.preventDefault();
});

els.pageStage.addEventListener('wheel', (event) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const rect = els.pageWrap.getBoundingClientRect();
    const focusPoint = {
      x: (event.clientX - rect.left) / Math.max(rect.width, 1),
      y: (event.clientY - rect.top) / Math.max(rect.height, 1),
    };
    setZoom(state.scale + (event.deltaY < 0 ? 0.1 : -0.1), focusPoint);
    return;
  }

  event.preventDefault();
  const multiplier = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? els.pageStage.clientHeight : 1;
  if (event.shiftKey) {
    els.pageStage.scrollLeft += event.deltaY * multiplier + event.deltaX * multiplier;
  } else {
    els.pageStage.scrollTop += event.deltaY * multiplier;
    els.pageStage.scrollLeft += event.deltaX * multiplier;
  }
}, { passive: false });

new ResizeObserver(() => {
  if (state.view !== 'edit' || !state.pages.length) return;
  const point = centrePointOnPage();
  updateVirtualStageSpace();
  requestAnimationFrame(() => scrollPagePointToCentre(point));
}).observe(els.pageStage);

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName));
  if (typing) return;

  if (event.code === 'Space' && !event.repeat) {
    state.spacePan = true;
    updatePanUI();
    event.preventDefault();
  }
  if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    state.panMode = !state.panMode;
    updatePanUI();
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  state.spacePan = false;
  if (state.pan) stopPanning(state.pan.pointerId);
  updatePanUI();
  event.preventDefault();
});

window.addEventListener('blur', () => {
  state.spacePan = false;
  stopPanning(state.pan?.pointerId);
  updatePanUI();
});

updatePanUI();

els.undo.onclick = () => {
  if (!state.history.length) return;
  state.future.push(snap());
  restore(state.history.pop());
  updateUndo();
};
els.redo.onclick = () => {
  if (!state.future.length) return;
  state.history.push(snap());
  restore(state.future.pop());
  updateUndo();
};

$('#closeDocBtn').onclick = async () => { try { await state.pdfDoc?.destroy?.(); } catch (_) {} location.reload(); };

async function exportPDF() {
  showBusy('Exporting PDF', 'Preparing the edited document…');
  try {
    els.download.disabled = true;
    els.download.textContent = 'Preparing…';

    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
    const source = await PDFDocument.load(state.pdfBytes);
    const output = await PDFDocument.create();
    const fontkitEngine = window.fontkit || window.Fontkit;
    if (fontkitEngine) output.registerFontkit(fontkitEngine);
    const fontCache = new Map();

    for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
      const pageState = state.pages[pageIndex];
      updateBusy(`Exporting page ${pageIndex + 1} of ${state.pages.length}…`);
      const [copied] = await output.copyPages(source, [pageState.source]);
      output.addPage(copied);
      const page = output.getPage(output.getPageCount() - 1);
      page.setRotation(degrees(pageRotation(pageState)));
      const { width, height } = page.getSize();
      const pdfJsPage = await state.pdfDoc.getPage(pageState.source + 1);
      const exportViewport = pdfJsPage.getViewport({ scale: 1, rotation: pageRotation(pageState) });

      for (const annotation of pageState.annotations) {
        const { x, y, w, h } = normalisedRectToPdf(exportViewport, annotation);
        const opacity = annotation.opacity ?? 1;
        const colour = hexRgb(annotation.color || '#111318');

        if (TEXT_TYPES.has(annotation.type)) {
          const backgroundEnabled = annotation.backgroundEnabled || annotation.type === 'existingText';
          if (backgroundEnabled) {
            const background = hexRgb(annotation.backgroundColor || '#ffffff');
            page.drawRectangle({
              x: Math.max(0, x - 0.8),
              y: Math.max(0, y - 0.8),
              width: Math.min(width - x + 0.8, w + 1.6),
              height: Math.min(height - y + 0.8, h + 1.6),
              color: rgb(...background),
              opacity: opacity * (annotation.backgroundOpacity ?? 1),
            });
          }

          const fontSize = annotation.size || 18;
          const sourceText = formattedText(annotation);
          const resolved = await resolveExportFont(output, fontCache, annotation, StandardFonts, sourceText, fontkitEngine);
          await drawTextBlock(page, resolved.font, resolved.text, { x, y, w, h, fontSize, colour, opacity, align: annotation.align || 'left', lineHeight: annotation.lineHeight || 1.2, letterSpacing: annotation.letterSpacing || 0, underline: annotation.underline, indent: annotation.listIndent || 0 });
        } else if (annotation.type === 'whiteout') {
          page.drawRectangle({ x, y, width: w, height: h, color: rgb(...colour), opacity });
        } else if (annotation.type === 'highlight') {
          page.drawRectangle({ x, y, width: w, height: h, color: rgb(...colour), opacity });
        } else if (annotation.type === 'shape') {
          page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(...colour), borderWidth: 2, opacity });
        } else if (annotation.type === 'checkbox') {
          const { font } = await resolveExportFont(output, fontCache, { fontFamily: 'Helvetica' }, StandardFonts, 'X', fontkitEngine);
          page.drawText('X', { x, y, size: Math.max(14, h * 0.9), font, color: rgb(...colour), opacity });
        } else if (annotation.type === 'image' || annotation.type === 'signature') {
          const bytes = await fetch(annotation.data).then((response) => response.arrayBuffer());
          let image;
          try {
            image = await output.embedPng(bytes);
          } catch {
            image = await output.embedJpg(bytes);
          }
          page.drawImage(image, { x, y, width: w, height: h, opacity });
        } else if (annotation.type === 'draw') {
          const points = annotation.points.split(' ').map((point) => point.split(',').map(Number));
          for (let index = 1; index < points.length; index += 1) {
            page.drawLine({
              start: { x: x + points[index - 1][0] / 100 * w, y: y + (1 - points[index - 1][1] / 100) * h },
              end: { x: x + points[index][0] / 100 * w, y: y + (1 - points[index][1] / 100) * h },
              thickness: 2,
              color: rgb(...colour),
              opacity,
            });
          }
        }
      }
    }

    const bytes = await output.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const baseName = state.fileName.replace(/\.pdf$/i, '') || 'document';
    anchor.download = `${baseName}-edited.pdf`;
    state.dirty = false;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Your PDF is ready.');
  } catch (error) {
    console.error(error);
    toast('Export failed for this document.');
  } finally {
    hideBusy();
    els.download.disabled = false;
    els.download.textContent = 'Download PDF';
  }
}


async function drawTextBlock(page, font, text, options) {
  const { x, y, w, h, fontSize, colour, opacity, align, lineHeight, letterSpacing, underline, indent = 0 } = options;
  const indentOffset = Math.min(w * 0.45, Math.max(0, indent) * fontSize * 1.2);
  const blockX = x + indentOffset;
  const blockWidth = Math.max(fontSize, w - indentOffset);
  const rawLines = String(text).split('\n');
  const lines = [];
  rawLines.forEach((raw) => {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      const width = safeTextWidth(font, candidate, fontSize) + Math.max(0, candidate.length - 1) * letterSpacing;
      if (line && width > blockWidth) { lines.push(line); line = word; } else line = candidate;
    });
    lines.push(line);
  });
  const step = fontSize * lineHeight;
  let baseline = y + h - fontSize;
  for (const line of lines) {
    if (baseline < y - fontSize * .2) break;
    const width = safeTextWidth(font, line, fontSize) + Math.max(0, line.length - 1) * letterSpacing;
    let textX = blockX;
    if (align === 'center') textX = blockX + Math.max(0, (blockWidth - width) / 2);
    if (align === 'right') textX = blockX + Math.max(0, blockWidth - width);
    if (letterSpacing) {
      let cursor = textX;
      for (const char of line) {
        page.drawText(char, { x: cursor, y: baseline, size: fontSize, font, color: PDFLib.rgb(...colour), opacity });
        cursor += safeTextWidth(font, char, fontSize) + letterSpacing;
      }
    } else if (line) {
      page.drawText(line, { x: textX, y: baseline, size: fontSize, font, color: PDFLib.rgb(...colour), opacity });
    }
    if (underline && line) page.drawLine({ start: { x: textX, y: baseline - Math.max(.8, fontSize * .08) }, end: { x: Math.min(blockX + blockWidth, textX + width), y: baseline - Math.max(.8, fontSize * .08) }, thickness: Math.max(.7, fontSize * .045), color: PDFLib.rgb(...colour), opacity });
    baseline -= step;
  }
}

function normalisedRectToPdf(viewport, annotation) {
  const left = annotation.x * viewport.width;
  const top = annotation.y * viewport.height;
  const right = (annotation.x + annotation.w) * viewport.width;
  const bottom = (annotation.y + annotation.h) * viewport.height;
  const corners = [
    viewport.convertToPdfPoint(left, top),
    viewport.convertToPdfPoint(right, top),
    viewport.convertToPdfPoint(left, bottom),
    viewport.convertToPdfPoint(right, bottom),
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

async function resolveExportFont(document, cache, annotation, StandardFonts, originalText, fontkitEngine) {
  const family = annotation.fontFamily || 'Helvetica';
  const bold = Boolean(annotation.bold);
  const italic = Boolean(annotation.italic);
  const standardKey = `standard|${family}|${bold}|${italic}`;
  let standardFont = cache.get(standardKey);

  if (!standardFont) {
    const standardName = getStandardFontName(family, bold, italic, StandardFonts);
    standardFont = await document.embedFont(standardName);
    cache.set(standardKey, standardFont);
  }

  if (fontCanEncode(standardFont, originalText)) return { font: standardFont, text: originalText };

  if (fontkitEngine) {
    try {
      const style = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
      const unicodeKey = `unicode|${style}`;
      let unicodeFont = cache.get(unicodeKey);
      if (!unicodeFont) {
        const url = `https://cdn.jsdelivr.net/gh/notofonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-${style}.ttf`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
        const bytes = await response.arrayBuffer();
        unicodeFont = await document.embedFont(bytes, { subset: true });
        cache.set(unicodeKey, unicodeFont);
      }
      return { font: unicodeFont, text: originalText };
    } catch (error) {
      console.warn('Unicode font fallback unavailable', error);
    }
  }

  return { font: standardFont, text: sanitiseForStandardFont(originalText) };
}

function fontCanEncode(font, text) {
  try {
    font.encodeText(String(text));
    return true;
  } catch {
    return false;
  }
}

function sanitiseForStandardFont(text) {
  const replacements = {
    'ą': 'a', 'Ą': 'A', 'ć': 'c', 'Ć': 'C', 'ę': 'e', 'Ę': 'E', 'ł': 'l', 'Ł': 'L',
    'ń': 'n', 'Ń': 'N', 'ó': 'o', 'Ó': 'O', 'ś': 's', 'Ś': 'S', 'ż': 'z', 'Ż': 'Z', 'ź': 'z', 'Ź': 'Z',
  };
  return [...String(text)].map((character) => replacements[character] ?? character).join('');
}

function getStandardFontName(family, bold, italic, StandardFonts) {
  const serif = family === 'Times New Roman' || family === 'Georgia';
  const mono = family === 'Courier New';

  if (serif) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }

  if (mono) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }

  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

function safeTextWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(String(text).split('\n')[0], size);
  } catch {
    return Math.max(size, String(text).length * size * 0.52);
  }
}

function hexRgb(hex) {
  let value = String(hex || '#111318').replace('#', '');
  if (value.length === 3) value = value.split('').map((char) => char + char).join('');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

els.download.onclick = exportPDF;

function openSignature() {
  const modal = $('#signatureModal');
  const canvas = $('#signatureCanvas');
  const context = canvas.getContext('2d');
  modal.classList.remove('hidden');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.strokeStyle = '#15171c';
  let drawing = false;

  canvas.onpointerdown = (event) => {
    drawing = true;
    context.beginPath();
    const rect = canvas.getBoundingClientRect();
    context.moveTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height);
  };
  canvas.onpointermove = (event) => {
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    context.lineTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height);
    context.stroke();
  };
  canvas.onpointerup = () => { drawing = false; };
}

$('#closeSignature').onclick = () => $('#signatureModal').classList.add('hidden');
$('#clearSignature').onclick = () => $('#signatureCanvas').getContext('2d').clearRect(0, 0, 720, 260);
$('#useSignature').onclick = () => {
  const data = $('#signatureCanvas').toDataURL('image/png');
  $('#signatureModal').classList.add('hidden');
  addAnn({ ...defaultPos(), type: 'signature', w: 0.3, h: 0.1, data, opacity: 1 });
};

els.fileInput.onchange = (event) => loadPDF(event.target.files[0]);
['dragenter', 'dragover'].forEach((name) => els.dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach((name) => els.dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropzone.classList.remove('drag');
}));
els.dropzone.addEventListener('drop', (event) => loadPDF(event.dataTransfer.files[0]));

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const isEditing = target.matches?.('input, textarea, select') || target.isContentEditable;
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (command && key === 'z' && !isEditing) { event.preventDefault(); event.shiftKey ? els.redo.click() : els.undo.click(); return; }
  if (command && key === 'y' && !isEditing) { event.preventDefault(); els.redo.click(); return; }
  if (isEditing) return;
  if (command && key === 'c') { event.preventDefault(); copySelection(false); }
  if (command && key === 'x') { event.preventDefault(); copySelection(true); }
  if (command && key === 'v') { event.preventDefault(); pasteClipboard(); }
  if (command && key === 'd') { event.preventDefault(); duplicateSelection(); }
  if (command && key === 'a' && state.view === 'edit') { event.preventDefault(); selectAllAnnotations(); }
  if (command && key === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIds.size) { event.preventDefault(); deleteSelectedAnnotations(); }
  if (event.key === 'Escape') { hideContextMenu(); if (state.tool === 'editpdf') setTool('select'); else clearSelection(); }
});

// Final command bindings
$('#bringFrontBtn').onclick = () => moveLayer('front');
$('#sendBackBtn').onclick = () => moveLayer('back');
$('#lockObjBtn').onclick = toggleLock;
$('#copyStyleBtn').onclick = () => {
  const annotation = currentAnn();
  if (!annotation) return;
  const keys = ['fontFamily','size','bold','italic','underline','align','lineHeight','letterSpacing','listStyle','color','backgroundEnabled','backgroundColor','backgroundOpacity','opacity'];
  state.copiedStyle = Object.fromEntries(keys.filter((key) => key in annotation).map((key) => [key, structuredClone(annotation[key])]));
  toast('Style copied. Right-click another element and choose Apply style.');
};
$('#groupSelectionBtn').onclick = groupSelection;
$('#ungroupSelectionBtn').onclick = ungroupSelection;
$('#duplicateSelectionBtn').onclick = duplicateSelection;
$('#deleteSelectionBtn').onclick = deleteSelectedAnnotations;
$('#alignObjectsLeft').onclick = () => alignObjects('left');
$('#alignObjectsCenter').onclick = () => alignObjects('center');
$('#alignObjectsRight').onclick = () => alignObjects('right');
$('#alignObjectsTop').onclick = () => alignObjects('top');
$('#alignObjectsMiddle').onclick = () => alignObjects('middle');
$('#alignObjectsBottom').onclick = () => alignObjects('bottom');
$('#distributeHorizontal').onclick = () => distributeObjects('x');
$('#distributeVertical').onclick = () => distributeObjects('y');

function showContextMenu(event) {
  event.preventDefault();
  const annotationElement = event.target.closest?.('.annotation');
  if (annotationElement) {
    const id = annotationElement.dataset.id;
    if (!state.selectedIds.has(id)) setSelection([id], id, true);
  }
  const hasSelection = state.selectedIds.size > 0;
  const multi = state.selectedIds.size > 1;
  els.contextMenu.querySelectorAll('[data-action]').forEach((button) => {
    const action = button.dataset.action;
    const needsSelection = ['cut','copy','duplicate','bringFront','sendBack','lock','delete'].includes(action);
    if (needsSelection) button.disabled = !hasSelection;
    if (action === 'paste') button.disabled = !state.clipboard.length;
    if (action === 'group') button.disabled = !multi;
    if (action === 'ungroup') button.disabled = !selectedAnnotations().some((item) => item.groupId);
    if (action === 'applyStyle') button.disabled = !hasSelection || !state.copiedStyle;
  });
  els.contextMenu.classList.remove('hidden');
  const menuRect = els.contextMenu.getBoundingClientRect();
  els.contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - menuRect.width - 10)}px`;
  els.contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - menuRect.height - 10)}px`;
}
function hideContextMenu() { els.contextMenu.classList.add('hidden'); }
els.pageStage.addEventListener('contextmenu', showContextMenu);
els.contextMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  ({ cut: () => copySelection(true), copy: () => copySelection(false), paste: pasteClipboard, duplicate: duplicateSelection, selectAll: selectAllAnnotations, bringFront: () => moveLayer('front'), sendBack: () => moveLayer('back'), lock: toggleLock, group: groupSelection, ungroup: ungroupSelection, fit: () => $('#fitViewBtn').click(), centre: centerPageInStage, delete: deleteSelectedAnnotations, applyStyle: applyCopiedStyle }[action] || (() => {}))();
  hideContextMenu();
});
window.addEventListener('pointerdown', (event) => { if (!event.target.closest?.('#contextMenu')) hideContextMenu(); }, true);
els.pageStage.addEventListener('scroll', hideContextMenu, { passive: true });

// Project save, restore and local autosave
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('docora-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function sessionPut(key, value) { const db = await openDb(); return new Promise((resolve,reject) => { const tx=db.transaction('sessions','readwrite'); tx.objectStore('sessions').put(value,key); tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>reject(tx.error); }); }
async function sessionGet(key) { const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction('sessions','readonly'); const req=tx.objectStore('sessions').get(key); req.onsuccess=()=>{db.close();resolve(req.result);}; req.onerror=()=>reject(req.error); }); }
async function sessionDelete(key) { const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction('sessions','readwrite'); tx.objectStore('sessions').delete(key); tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>reject(tx.error); }); }
function scheduleAutosave() { clearTimeout(state.autosaveTimer); state.autosaveTimer=setTimeout(()=>saveSession(false),700); }
async function saveSession(force = false) {
  if (!state.pdfBytes || (!state.dirty && !force)) return;
  try { await sessionPut('last', { version: 1, fileName: state.fileName, pdfBytes: state.pdfBytes, snapshot: snap(), savedAt: Date.now() }); }
  catch (error) { console.warn('Autosave unavailable', error); }
}
async function restoreSession() {
  const saved = await sessionGet('last'); if (!saved?.pdfBytes) return;
  showBusy('Restoring session', 'Loading the locally saved document…');
  try {
    state.pdfBytes = new Uint8Array(saved.pdfBytes);
    state.fileName = saved.fileName || 'document.pdf';
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
    const snapshot = JSON.parse(saved.snapshot);
    state.pages = snapshot.pages.map((page) => ({ ...page, pageId: page.pageId || uid(), detectedText: null }));
    state.current = clamp(snapshot.current || 0, 0, state.pages.length - 1);
    state.history=[]; state.future=[]; state.pageSelection=new Set(); clearSelection(false); state.pendingStageCenter=true; state.dirty=false;
    setWorkspaceView('edit', false); els.landing.classList.add('hidden'); els.workspace.classList.remove('hidden'); els.download.disabled=false;
    await renderAll(); toast('Last session restored from this device.');
  } catch (error) { console.error(error); toast('The saved session could not be restored.'); }
  finally { hideBusy(); }
}
async function checkSavedSession() { try { const saved=await sessionGet('last'); els.restoreSessionBtn.classList.toggle('hidden', !saved?.pdfBytes); } catch (_) {} }
els.restoreSessionBtn.onclick = restoreSession;

function bytesToBase64(bytes) { let binary=''; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk)); return btoa(binary); }
function base64ToBytes(value) { const binary=atob(value); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return bytes; }
els.saveProjectBtn.onclick = () => {
  if (!state.pdfBytes) return;
  const project = { format:'docora-project', version:1, fileName:state.fileName, pdf:bytesToBase64(state.pdfBytes), snapshot:snap(), savedAt:new Date().toISOString() };
  const blob=new Blob([JSON.stringify(project)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`${state.fileName.replace(/\.pdf$/i,'') || 'document'}.docora`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500); state.dirty=false; toast('Editable project saved.');
};
els.openProjectBtn.onclick = () => els.projectInput.click();
els.projectInput.onchange = async (event) => {
  const file=event.target.files[0]; if(!file) return;
  showBusy('Opening project', 'Restoring the PDF and editing data…');
  try { const project=JSON.parse(await file.text()); if(project.format!=='docora-project') throw new Error('Invalid project'); state.pdfBytes=base64ToBytes(project.pdf); state.fileName=project.fileName||'document.pdf'; state.pdfDoc=await pdfjsLib.getDocument({data:state.pdfBytes.slice()}).promise; const snapshot=JSON.parse(project.snapshot); state.pages=snapshot.pages.map((page)=>({...page,pageId:page.pageId||uid(),detectedText:null,detectedTextSource:null})); state.current=clamp(snapshot.current||0,0,state.pages.length-1); state.history=[];state.future=[];state.pageSelection=new Set();clearSelection(false);state.pendingStageCenter=true;state.dirty=false;setWorkspaceView('edit',false);els.landing.classList.add('hidden');els.workspace.classList.remove('hidden');els.download.disabled=false;await renderAll();await saveSession(true);toast('Docora project opened.'); } catch(error){console.error(error);toast('This is not a valid Docora project.');} finally {hideBusy();event.target.value='';}
};
window.addEventListener('beforeunload', (event) => { if (!state.dirty) return; event.preventDefault(); event.returnValue=''; });
async function checkPendingLaunch() {
  if (new URLSearchParams(location.search).get('open') !== 'pending') return false;
  try {
    const pending = await sessionGet('pending');
    await sessionDelete('pending');
    history.replaceState({}, '', location.pathname);
    if (!pending?.bytes) return false;
    const file = new File([new Uint8Array(pending.bytes)], pending.name || 'document.pdf', { type: 'application/pdf' });
    await loadPDF(file);
    return true;
  } catch (error) {
    console.warn('Pending file could not be opened', error);
    return false;
  }
}
checkPendingLaunch().then((opened) => { if (!opened) checkSavedSession(); });

// Responsive drawers and touch-friendly editor behaviour
$('#pagesDrawerBtn').onclick = () => {
  document.body.classList.toggle('pages-drawer-open');
  document.body.classList.remove('props-drawer-open');
};
$('#propsDrawerBtn').onclick = () => {
  document.body.classList.toggle('props-drawer-open');
  document.body.classList.remove('pages-drawer-open');
};
window.matchMedia('(min-width: 1001px)').addEventListener?.('change', (event) => {
  if (event.matches) document.body.classList.remove('pages-drawer-open','props-drawer-open');
});
let touchStartDistance = null;
els.pageStage.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 2) return;
  touchStartDistance = Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);
}, {passive:true});
els.pageStage.addEventListener('touchmove', (event) => {
  if (event.touches.length !== 2 || !touchStartDistance) return;
  const nextDistance=Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);
  if (Math.abs(nextDistance-touchStartDistance)>18) { setZoom(state.scale + (nextDistance>touchStartDistance ? .1 : -.1), {x:.5,y:.5}); touchStartDistance=nextDistance; }
}, {passive:true});
els.pageStage.addEventListener('touchend',()=>{touchStartDistance=null;},{passive:true});
