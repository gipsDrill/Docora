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
  history: [],
  future: [],
  drag: null,
  draw: null,
  panMode: false,
  spacePan: false,
  pan: null,
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
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function uid() {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
}

function pageRotation(page) {
  return ((page.baseRotation || 0) + (page.rotation || 0)) % 360;
}

function serialisablePages() {
  return state.pages.map(({ source, baseRotation, rotation, annotations }) => ({
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
  if (state.history.length > 60) state.history.shift();
  state.future = [];
  updateUndo();
}

function checkpoint() {
  pushHistory(snap());
}

function restore(data) {
  const snapshot = JSON.parse(data);
  state.pages = snapshot.pages.map((page) => ({ ...page, detectedText: null }));
  state.current = Math.min(snapshot.current, state.pages.length - 1);
  state.selected = null;
  renderAll();
}

function updateUndo() {
  els.undo.disabled = !state.history.length;
  els.redo.disabled = !state.future.length;
}

async function loadPDF(file) {
  if (!file || file.type !== 'application/pdf') return toast('Please choose a PDF file.');
  if (file.size > 50 * 1024 * 1024) return toast('This beta supports files up to 50 MB.');

  try {
    const buffer = await file.arrayBuffer();
    state.pdfBytes = new Uint8Array(buffer);
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
    state.pages = [];

    for (let index = 0; index < state.pdfDoc.numPages; index += 1) {
      const page = await state.pdfDoc.getPage(index + 1);
      state.pages.push({
        source: index,
        baseRotation: page.rotate || 0,
        rotation: 0,
        annotations: [],
        detectedText: null,
      });
    }

    state.current = 0;
    state.history = [];
    state.future = [];
    els.landing.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    els.download.disabled = false;
    await renderAll();
    toast('PDF opened locally.');
  } catch (error) {
    console.error(error);
    toast('Could not open this PDF.');
  }
}

async function renderAll() {
  await renderThumbs();
  await renderPage();
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
    renderThumbCanvas(canvas, pageState);

    item.onclick = (event) => {
      if (event.target.tagName === 'BUTTON') {
        checkpoint();
        pageState.rotation = (pageState.rotation + 90) % 360;
        pageState.detectedText = null;
        renderAll();
        return;
      }
      state.current = index;
      state.selected = null;
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

  const context = els.canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  await page.render({
    canvasContext: context,
    viewport: renderViewport,
    background: 'rgb(255,255,255)',
  }).promise;

  pageState.detectedText = await detectTextItems(page, cssViewport, cssScale, pageState.source);
  renderAnnotations();
  showProps(currentAnn() || null);
  els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
}

async function detectTextItems(page, viewport, cssScale, sourcePage) {
  try {
    const textContent = await page.getTextContent({ includeMarkedContent: false });
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
    element.className = `annotation ${annotation.type}${state.selected === annotation.id ? ' selected' : ''}`;
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
        background: annotation.backgroundEnabled ? (annotation.backgroundColor || '#ffffff') : 'transparent',
      });

      const content = document.createElement('div');
      content.className = 'annotation-content';
      content.textContent = annotation.text || '';
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
    element.append(handle);
    els.overlay.append(element);
    bindAnnotation(element, annotation, handle);
  });

  if (state.tool === 'editpdf') renderDetectedTextTargets(pageState);
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
    color: '#111318',
    backgroundEnabled: true,
    backgroundColor: '#ffffff',
    opacity: 1,
  });
  toast('Text selected. Edit it in the Properties panel.');
}

function enableInlineTextEditing(element, content, annotation) {
  element.ondblclick = (event) => {
    event.stopPropagation();
    if (!TEXT_TYPES.has(annotation.type)) return;

    const before = annotation.text || '';
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
    event.stopPropagation();
    state.selected = annotation.id;
    showProps(annotation);
    renderAnnotations();

    const rect = els.overlay.getBoundingClientRect();
    state.drag = {
      id: annotation.id,
      startX: event.clientX,
      startY: event.clientY,
      x: annotation.x,
      y: annotation.y,
      rect,
      changed: false,
      before: snap(),
    };
    // Global pointer listeners keep dragging active even outside the object.
  };

  handle.onpointerdown = (event) => {
    event.stopPropagation();
    const rect = els.overlay.getBoundingClientRect();
    state.drag = {
      id: annotation.id,
      resize: true,
      startX: event.clientX,
      startY: event.clientY,
      w: annotation.w,
      h: annotation.h,
      rect,
      changed: false,
      before: snap(),
    };
    // Global pointer listeners keep resizing active even outside the handle.
  };
}

window.addEventListener('pointermove', (event) => {
  if (!state.drag) return;
  const annotation = currentAnn(state.drag.id);
  if (!annotation) return;

  const dx = (event.clientX - state.drag.startX) / state.drag.rect.width;
  const dy = (event.clientY - state.drag.startY) / state.drag.rect.height;
  state.drag.changed = true;

  if (state.drag.resize) {
    annotation.w = Math.max(0.03, Math.min(0.98 - annotation.x, state.drag.w + dx));
    annotation.h = Math.max(0.018, Math.min(0.98 - annotation.y, state.drag.h + dy));
  } else {
    annotation.x = Math.max(0, Math.min(1 - annotation.w, state.drag.x + dx));
    annotation.y = Math.max(0, Math.min(1 - annotation.h, state.drag.y + dy));
  }
  renderAnnotations();
});

window.addEventListener('pointerup', () => {
  if (!state.drag) return;
  if (state.drag.changed) pushHistory(state.drag.before);
  state.drag = null;
});

function currentAnn(id = state.selected) {
  return state.pages[state.current]?.annotations.find((annotation) => annotation.id === id);
}

els.overlay.onclick = (event) => {
  if (event.target !== els.overlay) return;
  state.selected = null;
  showProps(null);
  renderAnnotations();
};

els.overlay.onpointerdown = (event) => {
  if (state.tool !== 'draw') return;
  const rect = els.overlay.getBoundingClientRect();
  state.draw = {
    pts: [[(event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100]],
    rect,
  };
  event.preventDefault();
};

els.overlay.onpointermove = (event) => {
  if (!state.draw) return;
  state.draw.pts.push([
    (event.clientX - state.draw.rect.left) / state.draw.rect.width * 100,
    (event.clientY - state.draw.rect.top) / state.draw.rect.height * 100,
  ]);
};

els.overlay.onpointerup = () => {
  if (!state.draw) return;
  const xs = state.draw.pts.map((point) => point[0]);
  const ys = state.draw.pts.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const points = state.draw.pts
    .map((point) => `${((point[0] - minX) / (maxX - minX || 1)) * 100},${((point[1] - minY) / (maxY - minY || 1)) * 100}`)
    .join(' ');

  addAnn({
    type: 'draw',
    x: minX / 100,
    y: minY / 100,
    w: Math.max(0.03, (maxX - minX) / 100),
    h: Math.max(0.03, (maxY - minY) / 100),
    points,
    color: '#6d5dfc',
    opacity: 1,
  });
  state.draw = null;
};

function addAnn(annotation) {
  checkpoint();
  annotation.id = uid();
  state.pages[state.current].annotations.push(annotation);
  state.selected = annotation.id;
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
    size: 18,
    fontFamily: 'Helvetica',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    color: '#111318',
    backgroundEnabled: false,
    backgroundColor: '#ffffff',
    opacity: 1,
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
  button.onclick = () => {
    const tool = button.dataset.tool;
    setTool(tool);

    if (tool === 'editpdf') {
      const count = state.pages[state.current]?.detectedText?.length || 0;
      toast(count ? 'Hover and click existing text to edit it.' : 'No editable text detected on this page.');
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
  $('#emptyProps').classList.toggle('hidden', Boolean(annotation));
  $('#objectProps').classList.toggle('hidden', !annotation);
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
  $('#boldBtn').classList.toggle('active', Boolean(annotation.bold));
  $('#italicBtn').classList.toggle('active', Boolean(annotation.italic));
  $('#underlineBtn').classList.toggle('active', Boolean(annotation.underline));
  $('#propColor').value = toHex(annotation.color || '#111318');
  $('#genericColor').value = toHex(annotation.color || '#111318');
  $('#propBgColor').value = toHex(annotation.backgroundColor || '#ffffff');
  $('#propBgEnabled').checked = Boolean(annotation.backgroundEnabled);
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

function updateProp(key, value) {
  const annotation = currentAnn();
  if (!annotation) return;
  checkpoint();
  annotation[key] = value;
  renderAnnotations();
  showProps(annotation);
}

$('#propText').onchange = (event) => updateProp('text', event.target.value);
$('#propFont').onchange = (event) => updateProp('fontFamily', event.target.value);
$('#propSize').onchange = (event) => updateProp('size', clamp(Number(event.target.value) || 18, 6, 160));
$('#propAlign').onchange = (event) => updateProp('align', event.target.value);
$('#propColor').onchange = (event) => updateProp('color', event.target.value);
$('#genericColor').onchange = (event) => updateProp('color', event.target.value);
$('#propBgColor').onchange = (event) => updateProp('backgroundColor', event.target.value);
$('#propBgEnabled').onchange = (event) => updateProp('backgroundEnabled', event.target.checked);
let opacityStartSnapshot = null;
$('#propOpacity').onpointerdown = () => { opacityStartSnapshot = snap(); };
$('#propOpacity').oninput = (event) => {
  const annotation = currentAnn();
  if (!annotation) return;
  if (!opacityStartSnapshot) opacityStartSnapshot = snap();
  annotation.opacity = Number(event.target.value);
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

$('#deleteObjBtn').onclick = () => {
  const pageState = state.pages[state.current];
  const index = pageState.annotations.findIndex((annotation) => annotation.id === state.selected);
  if (index < 0) return;
  checkpoint();
  pageState.annotations.splice(index, 1);
  state.selected = null;
  renderAnnotations();
  showProps(null);
};

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
  state.selected = duplicate.id;
  renderAnnotations();
  showProps(duplicate);
};

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
  renderAll();
};

$('#deletePageBtn').onclick = () => {
  if (state.pages.length === 1) return toast('A PDF must contain at least one page.');
  checkpoint();
  state.pages.splice(state.current, 1);
  state.current = Math.max(0, state.current - 1);
  renderAll();
};

async function setZoom(nextScale) {
  const stage = els.pageStage;
  const previousWidth = Math.max(stage.scrollWidth, 1);
  const previousHeight = Math.max(stage.scrollHeight, 1);
  const centreX = (stage.scrollLeft + stage.clientWidth / 2) / previousWidth;
  const centreY = (stage.scrollTop + stage.clientHeight / 2) / previousHeight;

  state.scale = clamp(nextScale, 0.5, 2.5);
  await renderPage();

  requestAnimationFrame(() => {
    stage.scrollLeft = Math.max(0, centreX * stage.scrollWidth - stage.clientWidth / 2);
    stage.scrollTop = Math.max(0, centreY * stage.scrollHeight - stage.clientHeight / 2);
  });
}

$('#zoomIn').onclick = () => setZoom(state.scale + 0.1);
$('#zoomOut').onclick = () => setZoom(state.scale - 0.1);

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

els.panBtn.onclick = () => {
  state.panMode = !state.panMode;
  updatePanUI();
  toast(state.panMode ? 'Hand tool active — drag to move around the PDF.' : 'Hand tool off.');
};

els.pageStage.addEventListener('pointerdown', (event) => {
  const temporaryPan = event.button === 1 || state.spacePan;
  if (!state.panMode && !temporaryPan) return;
  if (event.button !== 0 && event.button !== 1) return;

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
  if (!event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  event.preventDefault();
  els.pageStage.scrollLeft += event.deltaY;
}, { passive: false });

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

$('#closeDocBtn').onclick = () => location.reload();

async function exportPDF() {
  try {
    els.download.disabled = true;
    els.download.textContent = 'Preparing…';

    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
    const source = await PDFDocument.load(state.pdfBytes);
    const output = await PDFDocument.create();
    const fontkitEngine = window.fontkit || window.Fontkit;
    if (fontkitEngine) output.registerFontkit(fontkitEngine);
    const fontCache = new Map();

    for (const pageState of state.pages) {
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
              opacity,
            });
          }

          const fontSize = annotation.size || 18;
          const resolved = await resolveExportFont(output, fontCache, annotation, StandardFonts, annotation.text || '', fontkitEngine);
          const font = resolved.font;
          const text = resolved.text;
          const textWidth = safeTextWidth(font, text, fontSize);
          let textX = x;
          if (annotation.align === 'center') textX = x + Math.max(0, (w - textWidth) / 2);
          if (annotation.align === 'right') textX = x + Math.max(0, w - textWidth);
          const textY = y + Math.max(1, (h - fontSize) * 0.42);

          page.drawText(text, {
            x: textX,
            y: textY,
            size: fontSize,
            font,
            color: rgb(...colour),
            opacity,
            maxWidth: w,
            lineHeight: fontSize * 1.2,
          });

          if (annotation.underline && text.trim()) {
            page.drawLine({
              start: { x: textX, y: textY - Math.max(0.8, fontSize * 0.08) },
              end: { x: Math.min(x + w, textX + textWidth), y: textY - Math.max(0.8, fontSize * 0.08) },
              thickness: Math.max(0.7, fontSize * 0.045),
              color: rgb(...colour),
              opacity,
            });
          }
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
    anchor.download = 'docora-edited.pdf';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Your PDF is ready.');
  } catch (error) {
    console.error(error);
    toast('Export failed for this document.');
  } finally {
    els.download.disabled = false;
    els.download.textContent = 'Download PDF';
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !isEditing) {
    event.preventDefault();
    event.shiftKey ? els.redo.click() : els.undo.click();
  }
  if (event.key === 'Delete' && state.selected && !isEditing) $('#deleteObjBtn').click();
  if (event.key === 'Escape' && state.tool === 'editpdf') setTool('select');
});
