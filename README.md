# Docora 1.0 — production package

Docora is a browser-based PDF editing workspace created as a sister product to Billora.

## Included

- SEO-focused marketing homepage
- Full-screen PDF editor under `/editor/`
- Existing text detection and visual replacement
- Text formatting: fonts, size, bold, italic, underline, alignment, lists, indentation, line height, letter spacing, colour and background
- Text, images, signatures, whiteout, drawing, highlights, shapes, dates and checkboxes
- Multiple selection by drag box and Shift-click
- Copy, cut, paste, duplicate, delete and select-all
- Right-click context menu
- Grouping, layering, object locking, alignment and distribution
- Smart alignment guides and optional grid snapping; hold `Alt` while dragging to temporarily disable snapping
- Free panning, scrollbars, wheel scrolling and zoom around the pointer
- Separate all-pages organiser with reorder, rotate, duplicate and delete actions
- Undo/redo history
- Local autosave and last-session recovery
- Editable `.docora` project export/import
- Responsive desktop, tablet and mobile layouts
- Loading and export progress feedback for larger documents
- Last-used text styling remembered for newly added text
- Privacy, terms, help and 404 pages
- Sitemap, robots, Open Graph image, manifest and app icons

## Run locally

The editor uses JavaScript modules and must be served through HTTP rather than opened directly as a `file://` page.

### Visual Studio Code

Open this folder and use the **Live Server** extension.

### Node.js

```bash
npx serve .
```

Then open the address shown in the terminal.

## Deployment

The package can be uploaded directly to GitHub Pages, Cloudflare Pages, Netlify or standard static hosting.

This production package is configured for:

```text
https://docora.uk
```

The canonical URL, Open Graph image URLs, structured data, `robots.txt`, `sitemap.xml` and GitHub Pages `CNAME` file already use the final domain. Upload the package contents to the repository root, then set `docora.uk` as the custom domain in GitHub Pages.

## External dependencies

PDF.js, pdf-lib and fontkit are loaded from pinned CDN URLs. The PDF document itself is processed in the browser and is not uploaded by Docora. Loading CDN files can still expose standard network metadata to those CDN providers.

For a fully self-hosted dependency build, download the pinned library files, place them under a local `vendor/` folder, update the script/import paths, and adjust the privacy notice accordingly.

## Important PDF limitation

PDF is a final-layout format rather than a normal word-processing document. Docora can detect and visually replace many existing text items, but no browser editor can guarantee native editing of every PDF. Scans, text converted to vector outlines, unusual embedded fonts, protected files and complex backgrounds may require whiteout-and-replace or OCR.

## Production checks before launch

1. Confirm that the live domain resolves to `https://docora.uk/`.
2. Review the privacy and terms pages for the final business and hosting setup.
3. Test on Chrome, Edge, Firefox and Safari.
4. Test at least one scanned PDF, one long PDF and one document with Polish characters.
5. Confirm the exported PDF visually before relying on it.
6. Connect the domain, enable HTTPS, submit `sitemap.xml` to Google Search Console and verify the Open Graph image.

## Keyboard shortcuts

- `Ctrl/Cmd + C`, `X`, `V` — copy, cut, paste
- `Ctrl/Cmd + D` — duplicate
- `Ctrl/Cmd + A` — select all elements on the current page
- `Ctrl/Cmd + G` — group
- `Shift + Ctrl/Cmd + G` — ungroup
- `Delete` — delete selected unlocked elements
- `Ctrl/Cmd + Z`, `Y` — undo and redo
- `H` — toggle the hand tool
- `Space + drag` — temporary hand tool
- `Ctrl/Cmd + wheel` — zoom
- `Shift + wheel` — horizontal scroll
- `Alt + drag` — temporarily bypass smart guides and grid snapping

## Branding

Footer attribution:

```text
© Goodform. All rights reserved. goodform.org.uk
```

Docora v1.0.1 mobile editor fixes: visible hand tool on phones, touch panning, robust PDF text extraction with OCR fallback, and Billora footer link.
