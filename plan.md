# Local Restricted Entity Search Plan

This project should be built as a small, portable ETL/search system:

- `data.json` remains the registry of statutory list definitions.
- A scheduled ingest job fetches each public source.
- Source-specific parsers normalize records into one entity schema.
- SQLite with FTS5 stores the local searchable database.
- A small API and web UI serve search results.

The key design choice is to avoid a single generic scraper. These sources have different formats, update cadences, and levels of machine readability. Build one ingest adapter per source, but keep the normalized output schema shared.

## Target Architecture

```text
list-search/
  data.json
  plan.md
  docker-compose.yml
  Dockerfile
  requirements.txt
  app/
    main.py
    db.py
    ingest.py
    models.py
    sources/
      base.py
      ecfr.py
      ofac.py
      bis.py
      fcc.py
      dhs.py
      ddtc.py
      dod.py
      manual.py
  web/
    index.html
    app.js
    styles.css
  data/
    search.db
    raw/
```

## Containers

Use one Docker image with different commands:

- `api`: FastAPI app serving search endpoints and static web assets.
- `worker`: one-shot ingest job that can run manually or under cron.
- Optional `scheduler`: lightweight cron container that runs `worker` daily.

Recommended `docker-compose.yml` services:

- `api`
  - exposes `8000`
  - mounts `./data:/app/data`
  - command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- `worker`
  - mounts `./data:/app/data`
  - command: `python -m app.ingest`
- `scheduler`
  - same image
  - runs `python -m app.ingest` on a schedule

## Database

Start with SQLite plus FTS5. This keeps the app portable and avoids running Elasticsearch/OpenSearch before the dataset requires it.

Tables:

```sql
sources(
  id integer primary key,
  source_key text unique not null,
  letter text not null,
  citation text not null,
  name text not null,
  statutory_text text not null,
  url text,
  notes text,
  fetch_strategy text not null,
  last_fetched_at text,
  last_status text,
  last_error text
);

entities(
  id integer primary key,
  source_key text not null,
  external_id text,
  entity_name text not null,
  entity_type text,
  country text,
  addresses_json text not null default '[]',
  aliases_json text not null default '[]',
  programs_json text not null default '[]',
  restrictions_text text,
  federal_register_citation text,
  source_url text,
  raw_text text not null,
  content_hash text not null,
  first_seen_at text not null,
  last_seen_at text not null,
  is_active integer not null default 1,
  unique(source_key, content_hash)
);

entity_fts using fts5(
  entity_name,
  aliases,
  country,
  addresses,
  programs,
  restrictions_text,
  raw_text,
  content='entities',
  content_rowid='id'
);

ingest_runs(
  id integer primary key,
  started_at text not null,
  finished_at text,
  status text not null,
  source_key text,
  records_seen integer default 0,
  records_changed integer default 0,
  error text
);
```

## Normalized Entity Model

Each adapter should emit this shape:

```json
{
  "source_key": "BIS_ENTITY_LIST",
  "source_name": "BIS Entity List",
  "entity_name": "Example Entity",
  "entity_type": "organization",
  "country": "China",
  "addresses": [],
  "aliases": [],
  "programs": [],
  "restrictions_text": null,
  "federal_register_citation": null,
  "source_url": "https://...",
  "raw_text": "Original source text for auditability"
}
```

Keep `raw_text`. For compliance-sensitive search, auditability matters more than a perfectly decomposed first version.

## API

Minimum endpoints:

- `GET /health`
- `GET /sources`
- `GET /search?q=...&source=...&country=...&limit=50`
- `GET /entities/{id}`
- `POST /admin/ingest` for manual local refresh, protected by a local admin token or disabled by default

Search behavior:

- Use SQLite FTS5 `bm25()` ranking.
- Search across names, aliases, addresses, programs, restrictions, and raw text.
- Return source metadata and the matched entity fields.
- Include `last_fetched_at` and `source_url` in results.

## Source-by-Source Ingest Plan

### A. BIS Entity List

- Source: `https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-744/appendix-Supplement%20No.%204%20to%20Part%20744`
- Strategy: `ecfr_table_text`
- Priority: High
- Notes:
  - The eCFR page is authoritative but unofficial and continuously updated.
  - The page contains a large table-like structure with columns for country, entity, license requirement, license review policy, and Federal Register citation.
  - Start with a robust text parser that groups records by country and Federal Register citation.
  - Preserve each full record as `raw_text`.
  - Later improvement: use the eCFR API or XML if it gives cleaner structure than HTML.

### B. BIS Military End User List

- Source: `https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-744/appendix-Supplement%20No.%207%20to%20Part%20744`
- Strategy: `ecfr_table_text`
- Priority: High
- Notes:
  - Same eCFR family as the Entity List, but much smaller.
  - Good first eCFR adapter target because it is simpler than Supplement No. 4.
  - Normalize country, entity name, address text, and Federal Register citation.

### C. OFAC SDN List

- Registry URL: `https://sanctionssearch.ofac.treas.gov/`
- Better ingest source: OFAC downloadable SDN data files, such as CSV or XML from Treasury/OFAC.
- Strategy: `ofac_download`
- Priority: High
- Notes:
  - Do not scrape the interactive sanctions search page.
  - Prefer official downloadable XML because it carries structured aliases, addresses, programs, vessels, aircraft, and IDs better than flattened CSV.
  - Store all SDN records, but allow filtering to programs or entity types later.
  - This adapter will likely produce the best normalized data.

### D. Denied Persons List

- Source: `https://www.bis.gov/licensing/end-user-guidance/denied-persons-list`
- Strategy: `bis_page_or_download`
- Priority: High
- Notes:
  - First check the page for linked downloadable files.
  - Prefer CSV/XLS/PDF download over scraping rendered page text.
  - If only HTML is available, parse page tables or linked document content.
  - Normalize name, address, denial order details, effective date, and expiration date if available.

### E. Chinese Military Companies List

- Source: `https://www.defense.gov/Spotlights/Chinese-Military-Companies/`
- Strategy: `dod_page_documents`
- Priority: Medium
- Notes:
  - Expect this page to link to PDFs or releases rather than expose a clean data API.
  - Fetch the page, discover linked PDF/XLS/CSV documents, download the latest relevant document, and parse it.
  - Keep document URL and publication date in source metadata.
  - If the document format is PDF, use `pypdf` or `pdfplumber`, then manually harden parsing after inspecting samples.

### F. Debarred Parties List

- Source: `https://www.pmddtc.state.gov/ddtc_public?id=ddtc_public_portal_debarred_list`
- Strategy: `ddtc_page_or_static_export`
- Priority: Medium
- Notes:
  - This may be a dynamic portal.
  - First attempt to identify a static export or backend JSON endpoint.
  - If unavailable, consider a Playwright-based fetcher as a last resort, but keep it isolated because browser automation adds container weight and fragility.

### G. PRC Telecommunications Companies List

- Source: `https://www.fcc.gov/supplychain/coveredlist`
- Strategy: `fcc_covered_list`
- Priority: Medium
- Notes:
  - This overlaps with item K.
  - Use one FCC adapter and tag records as both `PRC Telecommunications Companies List` and `FCC Covered List` if the source content supports both statutory references.
  - Parse company names, covered equipment/services text, dates, and FCC public notice references.

### H. Military-Civil Fusion Affiliated Institutions List

- Source: none in `data.json`
- Strategy: `manual_or_monitor`
- Priority: Low until public list is identified
- Notes:
  - Keep the source row visible in `/sources`.
  - Mark as `not_fetchable`.
  - Add monitoring queries or a manual URL override field later.
  - Do not fabricate records.

### I. PRC Semiconductor Companies List

- Source: none in `data.json`
- Strategy: `manual_or_monitor`
- Priority: Low until public list is identified
- Notes:
  - Keep the source row visible in `/sources`.
  - Mark as `not_fetchable`.
  - Add records only when a public source is identified or manually curated with provenance.

### J. EO 14032 Annex

- Source: `https://ofac.treasury.gov/sanctions-programs-and-country-information/chinese-military-industrial-complex-sanctions`
- Strategy: `ofac_program_filter`
- Priority: Medium
- Notes:
  - This should probably be derived from OFAC data rather than scraped from the program page.
  - Use the OFAC adapter and filter for relevant Chinese Military-Industrial Complex sanctions program markers.
  - Store the program page as source documentation.

### K. FCC Covered List

- Source: `https://www.fcc.gov/supplychain/coveredlist`
- Strategy: `fcc_covered_list`
- Priority: Medium
- Notes:
  - Same underlying source as item G.
  - Implement once, map to both list definitions as needed.
  - Preserve source-specific statutory text to distinguish the two citations.

### L. Unverified List

- Source: `https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-744/appendix-Supplement%20No.%206%20to%20Part%20744`
- Better ingest source: eCFR XML API for Title 15, Part 744, extracting `Supplement No. 6 to Part 744`.
- Strategy: `ecfr_table_text`
- Priority: High
- Notes:
  - This can use the same eCFR API pull as the Entity List and MEU List.
  - The XML table has three columns: country, listed person and address, and Federal Register citation.
  - Blank country cells inherit the previous non-blank country.
  - Normalize entity name, country, address, Federal Register citation, and effective date if available.

### M. UFLPA Entity List

- Source: `https://www.dhs.gov/uflpa-entity-list`
- Strategy: `dhs_page_table`
- Priority: High
- Notes:
  - DHS often publishes this as a web page with sections and entity names.
  - Parse entity names, aliases if present, list section/category, effective date, and source section.
  - This is a good early adapter because the page is usually human-readable and the dataset is relatively small.

### N. Biotechnology Company of Concern List

- Source: none in `data.json`
- Strategy: `manual_or_monitor`
- Priority: Low until public list is identified
- Notes:
  - Keep source visible.
  - Mark as `not_fetchable`.
  - Add a monitoring task for official updates.

### O. Other Designated Restricted Entity Lists

- Source: none in `data.json`
- Strategy: `registry_extension`
- Priority: Low
- Notes:
  - This is a catch-all statutory provision, not a specific list.
  - Treat it as a way to add future list definitions to `data.json`.
  - Do not create records directly under this source unless a specific designating authority and list URL are documented.

## Adapter Interface

Each source adapter should implement:

```python
class SourceAdapter:
    source_key: str

    async def fetch(self) -> FetchResult:
        ...

    def parse(self, fetched: FetchResult) -> list[EntityRecord]:
        ...
```

`FetchResult` should include:

- final URL
- HTTP status
- fetched timestamp
- response headers
- raw body path under `data/raw/`
- content hash

`EntityRecord` should be validated with Pydantic before insertion.

## Raw Data Policy

For each run:

- Save raw fetched content under `data/raw/{source_key}/{timestamp}/`.
- Hash raw files.
- Store parser version in `ingest_runs`.
- Keep enough provenance to reproduce why a record appeared in search.

This is important because government pages can change without clean changelogs.

## Refresh and Change Tracking

Default schedule:

- Daily fetch for high-priority public lists.
- Weekly fetch for lower-priority or mostly static pages.
- Manual re-run command for local testing.

Change behavior:

- Compute `content_hash` from normalized fields plus source key.
- Mark records missing from the latest successful run as inactive rather than deleting them.
- Track `first_seen_at` and `last_seen_at`.
- Store raw source snapshots so parser bugs can be fixed without losing historical inputs.

## Build Order

1. Scaffold Docker image, dependencies, FastAPI app, and SQLite schema.
2. Load `data.json` into the `sources` table.
3. Implement `/health`, `/sources`, and an empty `/search`.
4. Implement SQLite FTS5 insert/search path using a small fixture.
5. Implement DHS UFLPA adapter.
6. Implement eCFR MEU adapter.
7. Implement eCFR Entity List adapter.
8. Implement OFAC SDN XML adapter.
9. Implement BIS Unverified and Denied Persons adapters.
10. Implement FCC Covered List adapter and map it to both G and K.
11. Implement DOD Chinese Military Companies adapter.
12. Investigate DDTC Debarred Parties dynamic portal.
13. Add scheduler container.
14. Add a simple web UI.
15. Add tests and parser fixtures for every adapter.

## Testing Plan

Unit tests:

- `data.json` validates and every letter is unique.
- Each adapter parses saved fixture files.
- Normalization produces required fields.
- FTS search returns expected records.
- Missing URL sources are marked `not_fetchable`.

Integration tests:

- Run ingest against local fixtures.
- Re-run ingest and confirm no duplicate active records.
- Remove a fixture record and confirm it becomes inactive.
- Search API returns source metadata and entity provenance.

Manual tests:

- `docker compose up api`
- `docker compose run --rm worker`
- Search common names such as `Huawei`, `ZTE`, `Xinjiang`, and `AVIC`.

## Risks

- Some government sites are dynamic and may require browser automation or a hidden API.
- PDF parsing can be brittle.
- eCFR table-like text may need iterative parser hardening.
- Some statutory lists do not currently have a central public list URL.
- Data should be treated as search assistance, not legal advice or a compliance determination.

## Recommended First Implementation Slice

Build the platform with one simple adapter first:

1. SQLite schema and FTS.
2. FastAPI `/search`.
3. DHS UFLPA adapter.
4. Docker Compose.

Then add eCFR MEU, which exercises the harder table parser on a smaller dataset before attempting the much larger Entity List.
