# Docora v0.1

A browser-based, privacy-first PDF editor prototype.

## Run locally

PDF.js requires an HTTP server. From this folder run:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Included in this first working build

- drag-and-drop PDF upload
- local browser processing
- page thumbnails
- drag-and-drop page reordering
- rotate/delete pages
- text, whiteout, images, signature, drawing, highlight, rectangle, date, checkbox
- object dragging/resizing
- properties panel
- undo/redo
- PDF export without watermark
- responsive interface foundation

## Technical stack

- PDF.js for rendering
- pdf-lib for export/modification
- Vanilla HTML/CSS/JavaScript

## Notes

This is the first product foundation, not the final production release. The next engineering pass should add stronger mobile controls, autosave via IndexedDB, multi-page continuous view, true redaction, accessibility testing, encrypted PDF handling and broader regression testing.
