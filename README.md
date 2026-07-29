# Docora v0.6 — Free Canvas & Page Organiser

A browser-based PDF editor prototype. Documents are processed locally in the browser.

## Run locally

Use VS Code with the **Live Server** extension, or publish the folder with GitHub Pages. Open `index.html` through an HTTP address rather than `file://`.

## New in v0.6

- Large virtual workspace around every PDF page, available at every zoom level.
- Vertical mouse-wheel navigation and horizontal Shift + wheel navigation.
- Drag the dark canvas with the left mouse button.
- Hand tool, Space + drag and middle-mouse drag remain available.
- Zoom keeps the same point of the document under the viewport centre.
- One-click **Centre** and **Fit page** controls.
- Separate **Organise pages** workspace with every page visible at once.
- Drag-and-drop reordering, multi-selection, batch rotate, duplicate and delete.
- Double-click a page card to return directly to that page in the editor.

## External libraries

The prototype loads PDF.js, pdf-lib and fontkit from public CDNs, so an internet connection is required when starting the app.
