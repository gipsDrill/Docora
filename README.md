# Docora v0.5 — Pan and zoom navigation

A private browser-based PDF editor. Files are processed locally in the browser.

## Run locally

Use VS Code with the Live Server extension, or publish the folder on GitHub Pages.
Open `index.html` through an HTTP address such as `http://127.0.0.1:5500`.

## New in v0.5

- Full horizontal and vertical scrolling after zooming.
- Visible, high-contrast scrollbars around the PDF workspace.
- Hand tool for click-and-drag panning.
- Temporary panning with Space + left drag or the middle mouse button.
- Shift + mouse wheel for horizontal movement.
- Zoom keeps the current viewport area centred.
- Edit PDF mode for selecting and replacing existing detectable text.
- Font family, size, bold, italic and underline controls.
- Text colour and optional text background colour.
- Text alignment and opacity controls.
- Double-click text objects for quick inline editing.
- High-resolution PDF rendering retained.
- Improved export with matching standard PDF font variants.

## Important technical limitation

PDF is a final-layout format, not a source document format. Existing-text editing works on selectable text layers. Scanned pages, text converted to outlines, complex clipping, rotated text and some custom font encodings may not be detected. Existing text is visually replaced by covering its original area and drawing the edited content above it; plain backgrounds give the best result.
