# Entity Explorer

https://4l3xv33.github.io/entity-explorer/

Static GitHub Pages app for searching client-fetchable restricted entity lists in `data.json`.

## How It Works

This app has no backend and no build step.

- `index.html` loads the page.
- `app.js` loads `data.json`.
- The browser fetches public XML directly from official government sources.
- The browser parses the XML and searches records in memory.

All search happens in memory in the browser.

## Current Data Sources

### eCFR

The app uses eCFR where the list data is actually published inside Title 15, Part 744.

- Metadata:
  `https://www.ecfr.gov/api/versioner/v1/titles.json`
- XML:
  `https://www.ecfr.gov/api/versioner/v1/full/{date}/title-15.xml?part=744`
- Parsed lists:
  - A: `Supplement No. 4 to Part 744`, BIS Entity List
  - B: `Supplement No. 7 to Part 744`, BIS Military End User List
  - L: `Supplement No. 6 to Part 744`, Unverified List

### OFAC

The app uses OFAC XML downloads for sanctions records.

- C: OFAC SDN List:
  `https://www.treasury.gov/ofac/downloads/sdn.xml`
- J: EO 14032 / Chinese Military-Industrial Complex sanctions:
  `https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml`

For J, the app parses the consolidated OFAC XML and keeps records whose program list contains `CMIC-EO13959`.

## What This Can and Cannot Do

This static app can use sources that meet both conditions:

- The source publishes machine-readable data, preferably XML or JSON.
- The source can be fetched from a browser running on GitHub Pages.

Currently supported:

- A: BIS Entity List
- B: BIS Military End User List
- C: OFAC SDN List
- J: EO 14032 / CMIC sanctions from OFAC consolidated XML
- L: Unverified List

Currently not supported client-side:

- D: Denied Persons List
- E: Chinese Military Companies List
- F: Debarred Parties List
- G: PRC Telecommunications Companies List
- H: Military-Civil Fusion Affiliated Institutions List
- I: PRC Semiconductor Companies List
- K: FCC Covered List
- M: UFLPA Entity List
- N: Biotechnology Company of Concern List
- O: Catch-all provision

Those may require a backend fetcher, a generated static data snapshot, PDF parsing, portal-specific handling, or a source-specific API that is not currently wired into this app.

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

The app marks supported sources as either `Live eCFR` or `Live OFAC`. The other sources remain visible but are marked `Not client-fetchable` because they are not currently wired to a browser-fetchable machine-readable source.

Opening `index.html` directly from disk may fail in some browsers because `fetch("data.json")` is restricted under `file://`. GitHub Pages works because it serves the files over HTTPS.
