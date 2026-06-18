# Restricted Entity Search

Static GitHub Pages app for searching the eCFR-backed lists in `data.json`.

## How It Works

This app has no backend and no build step.

- `index.html` loads the page.
- `app.js` loads `data.json`.
- The browser fetches eCFR Title 15 metadata from:
  `https://www.ecfr.gov/api/versioner/v1/titles.json`
- The browser fetches current Title 15 Part 744 XML from:
  `https://www.ecfr.gov/api/versioner/v1/full/{date}/title-15.xml?part=744`
- The browser parses and searches:
  - A: `Supplement No. 4 to Part 744`, BIS Entity List
  - B: `Supplement No. 7 to Part 744`, BIS Military End User List
  - L: `Supplement No. 6 to Part 744`, Unverified List

All search happens in memory in the browser.

## GitHub Pages

Push these files to GitHub:

- `index.html`
- `styles.css`
- `app.js`
- `data.json`

Then enable GitHub Pages for the repository:

1. Go to repository settings.
2. Open Pages.
3. Select the branch to publish.
4. Select the repository root as the publish directory.

## Notes

The app marks only eCFR-backed sources as `Live eCFR`. The other sources remain visible but are marked `Not client-fetchable` because they do not currently have equivalent eCFR-hosted list data.

Opening `index.html` directly from disk may fail in some browsers because `fetch("data.json")` is restricted under `file://`. GitHub Pages works because it serves the files over HTTPS.

