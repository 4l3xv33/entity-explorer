# eCFR BIS Entity List Pull Strategy

Source A in `data.json` is the BIS Entity List:

```text
https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-744/appendix-Supplement%20No.%204%20to%20Part%20744
```

Do not scrape the rendered HTML page. eCFR provides a public API with XML content and no API key requirement. Pull Title 15, Part 744 as XML, then extract `Supplement No. 4 to Part 744`.

## Endpoints

Discover current Title 15 metadata:

```bash
curl -sS https://www.ecfr.gov/api/versioner/v1/titles.json
```

Use the Title 15 `up_to_date_as_of` value as the content date. On 2026-06-18, the API returned:

```json
{
  "number": 15,
  "name": "Commerce and Foreign Trade",
  "latest_issue_date": "2026-06-11",
  "latest_amended_on": "2026-06-11",
  "up_to_date_as_of": "2026-06-16"
}
```

Fetch Part 744 XML:

```bash
curl -sS \
  "https://www.ecfr.gov/api/versioner/v1/full/2026-06-16/title-15.xml?part=744" \
  -o data/raw/ecfr_title15_part744.xml
```

`current` is not accepted as a date alias for this API route; use the discovered date.

## XML Structure

The downloaded XML has this relevant structure:

```xml
<DIV5 N="744" TYPE="PART">
  ...
  <DIV9 N="Supplement No. 4 to Part 744" TYPE="APPENDIX">
    <HEAD>Supplement No. 4 to Part 744—Entity List</HEAD>
    <P>...</P>
    <DIV>
      <DIV class="gpotbl_div">
        <TABLE>
          <THEAD>
            <TR>
              <TH>Country</TH>
              <TH>Entity</TH>
              <TH>License requirement</TH>
              <TH>License review policy</TH>
              <TH>Federal Register citation</TH>
            </TR>
          </THEAD>
          <TBODY>
            <TR>
              <TD>AFGHANISTAN</TD>
              <TD>Abdul Satar Ghoura, ...</TD>
              <TD>For all items subject to the EAR...</TD>
              <TD>Presumption of denial</TD>
              <TD>76 FR 71869, 11/21/11.</TD>
            </TR>
            ...
          </TBODY>
        </TABLE>
      </DIV>
    </DIV>
  </DIV9>
  <DIV9 N="Supplement No. 5 to Part 744" TYPE="APPENDIX">
    ...
  </DIV9>
</DIV5>
```

The parser should locate:

```text
.//*[@N='Supplement No. 4 to Part 744']
```

Then read all descendant `TR` rows with exactly five `TD` cells.

## Parsing Rules

1. Skip header rows because they use `TH`, not `TD`.
2. For each body row, collect the text of each `TD` with `itertext()`.
3. Normalize whitespace by splitting and joining.
4. The first column is `country`.
5. If `country` is blank, inherit the previous non-blank country.
6. Skip rows where the entity cell is empty or `[Reserved]`.
7. Preserve the full entity cell as `raw_entity_text`.
8. Keep license requirement, license review policy, and Federal Register citation as structured fields.
9. Defer aggressive parsing of entity name, aliases, and addresses until after basic indexing works.

The current XML snapshot parsed this way produced `3415` non-reserved rows.

## Minimal Parser Sketch

```python
import hashlib
import json
import xml.etree.ElementTree as ET


SOURCE_KEY = "BIS_ENTITY_LIST"
APPENDIX_ID = "Supplement No. 4 to Part 744"


def clean_text(element):
    return " ".join("".join(element.itertext()).split())


def parse_entity_list_xml(path, source_url):
    root = ET.parse(path).getroot()
    appendix = root.find(f".//*[@N='{APPENDIX_ID}']")
    if appendix is None:
        raise RuntimeError(f"Could not find {APPENDIX_ID}")

    current_country = None
    records = []

    for tr in appendix.findall(".//TR"):
        cells = tr.findall("./TD")
        if len(cells) != 5:
            continue

        country, entity, license_requirement, review_policy, fr_citation = [
            clean_text(cell) for cell in cells
        ]

        if country:
            current_country = country
        country = current_country

        if not entity or entity == "[Reserved]":
            continue

        raw_text = " | ".join(
            [country or "", entity, license_requirement, review_policy, fr_citation]
        )
        content_hash = hashlib.sha256(
            json.dumps(
                {
                    "source_key": SOURCE_KEY,
                    "country": country,
                    "entity": entity,
                    "license_requirement": license_requirement,
                    "review_policy": review_policy,
                    "fr_citation": fr_citation,
                },
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()

        records.append(
            {
                "source_key": SOURCE_KEY,
                "entity_name": entity,
                "country": country,
                "restrictions_text": license_requirement,
                "license_review_policy": review_policy,
                "federal_register_citation": fr_citation,
                "source_url": source_url,
                "raw_text": raw_text,
                "content_hash": content_hash,
            }
        )

    return records
```

## First Implementation Target

For the first version, store the full entity cell as `entity_name`. This will make search useful immediately because names, aliases, and addresses are all in that cell.

After the end-to-end pipeline works, add best-effort decomposition:

- `entity_name`: text before `, a.k.a.`, first address delimiter, or known alias marker
- `aliases`: lines after `a.k.a.` markers and em dash bullets
- `addresses`: remaining address-like text after aliases

Do that as an enrichment layer, not as a blocker for initial ingestion.

## Caveats

- The Entity List is large and has irregular human-authored text.
- Some rows contain aliases, footnotes, cross-references, and multiple addresses.
- Some cells contain inline tags such as `<E>` and `<br/>`; `itertext()` handles these well enough for the first pass.
- Country inheritance is required because many rows leave the country cell blank.
- Keep raw XML snapshots so parser changes can be tested against fixed inputs.

