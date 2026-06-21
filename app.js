const ECFR_PART_744 = {
  titleNumber: 15,
  part: 744,
  metadataUrl: "https://www.ecfr.gov/api/versioner/v1/titles.json",
  xmlUrl(date) {
    return `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-15.xml?part=744`;
  },
};

const OFAC_API = {
  sdnUrl: "https://sanctionslistservice.ofac.treas.gov/entities?list=SDN%20List",
  cmicUrl: "https://sanctionslistservice.ofac.treas.gov/entities?program=CMIC-EO13959",
};

const SNAPSHOTS = {
  dplUrl: "data/snapshots/dpl.csv",
  ddtcStatutoryDebarredUrl: "data/snapshots/ddtc-debarred-statutory.csv",
  ddtcAdministrativeDebarredUrl: "data/snapshots/ddtc-debarred-administrative.csv",
  fccCoveredListUrl: "data/snapshots/fcc-coveredlist.html",
};

const ECFR_SUPPLEMENTS = {
  A: {
    key: "BIS_ENTITY_LIST",
    sourceType: "eCFR",
    appendix: "Supplement No. 4 to Part 744",
    columns: ["country", "entity", "licenseRequirement", "licenseReviewPolicy", "federalRegisterCitation"],
  },
  B: {
    key: "BIS_MILITARY_END_USER_LIST",
    sourceType: "eCFR",
    appendix: "Supplement No. 7 to Part 744",
    columns: ["country", "entity", "federalRegisterCitation"],
  },
  L: {
    key: "UNVERIFIED_LIST",
    sourceType: "eCFR",
    appendix: "Supplement No. 6 to Part 744",
    columns: ["country", "entity", "federalRegisterCitation"],
  },
};

const OFAC_SOURCES = {
  C: {
    key: "OFAC_SDN_LIST",
    sourceType: "OFAC API",
    url: OFAC_API.sdnUrl,
  },
  J: {
    key: "EO_14032_ANNEX",
    sourceType: "OFAC API",
    url: OFAC_API.cmicUrl,
  },
};

const SNAPSHOT_SOURCES = {
  D: {
    key: "DENIED_PERSONS_LIST",
    sourceType: "Snapshot",
    url: SNAPSHOTS.dplUrl,
  },
  F: {
    key: "DEBARRED_PARTIES_LIST",
    sourceType: "Snapshot",
    url: SNAPSHOTS.ddtcStatutoryDebarredUrl,
  },
  G: {
    key: "PRC_TELECOMMUNICATIONS_COMPANIES_LIST",
    sourceType: "Snapshot",
    url: SNAPSHOTS.fccCoveredListUrl,
  },
};

const LIVE_SOURCES = { ...ECFR_SUPPLEMENTS, ...OFAC_SOURCES, ...SNAPSHOT_SOURCES };

const state = {
  sources: [],
  availableLetters: new Set(Object.keys(LIVE_SOURCES)),
  selectedLetters: new Set(Object.keys(LIVE_SOURCES)),
  records: [],
  loadedAt: null,
  ecfrDate: null,
  ofacApiError: null,
  snapshotError: null,
  error: null,
};

const els = {
  statusText: document.querySelector("#statusText"),
  refreshButton: document.querySelector("#refreshButton"),
  sourceList: document.querySelector("#sourceList"),
  searchInput: document.querySelector("#searchInput"),
  sourceFilters: document.querySelector("#sourceFilters"),
  recordCount: document.querySelector("#recordCount"),
  resultsList: document.querySelector("#resultsList"),
};

els.refreshButton.addEventListener("click", () => loadAll({ force: true }));
els.searchInput.addEventListener("input", renderResults);

loadAll();

async function loadAll() {
  setLoading(true);
  state.error = null;
  state.ofacApiError = null;
  state.snapshotError = null;

  try {
    const [sources, ecfrDate] = await Promise.all([loadSources(), loadEcfrDate()]);
    state.sources = sources;
    state.ecfrDate = ecfrDate;
    renderSources();
    renderFilters();

    const [ecfrRecords, ofacRecords, snapshotRecords] = await Promise.all([
      loadEcfrRecords(ecfrDate, sources),
      loadOfacApiRecords(sources).catch((error) => {
        state.ofacApiError = error;
        return [];
      }),
      loadSnapshotRecords(sources).catch((error) => {
        state.snapshotError = error;
        return [];
      }),
    ]);

    state.records = [...ecfrRecords, ...ofacRecords, ...snapshotRecords];
    state.loadedAt = new Date();
    updateStatus();
    renderResults();
  } catch (error) {
    state.error = error;
    els.statusText.textContent = "Could not load eCFR data.";
    els.resultsList.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  } finally {
    setLoading(false);
  }
}

async function loadSources() {
  const response = await fetch("data.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load data.json: HTTP ${response.status}`);
  }

  const registry = await response.json();
  return registry.SIRA_Act_Section_2_e_3 || [];
}

async function loadEcfrDate() {
  const titles = await fetchJson(ECFR_PART_744.metadataUrl);
  const title = titles.titles.find((item) => item.number === ECFR_PART_744.titleNumber);
  if (!title || !title.up_to_date_as_of) {
    throw new Error("Could not determine current eCFR Title 15 date.");
  }
  return title.up_to_date_as_of;
}

async function loadEcfrRecords(ecfrDate, sources) {
  const xmlText = await fetchText(ECFR_PART_744.xmlUrl(ecfrDate));
  return parseEcfrRecords(xmlText, sources);
}

async function loadOfacApiRecords(sources) {
  const [sdnXml, cmicXml] = await Promise.all([
    fetchText(OFAC_API.sdnUrl),
    fetchText(OFAC_API.cmicUrl),
  ]);

  return [
    ...parseOfacApiRecords(sdnXml, sources, "C"),
    ...parseOfacApiRecords(cmicXml, sources, "J"),
  ];
}

async function loadSnapshotRecords(sources) {
  const [dplRecords, statutoryDebarredRecords, administrativeDebarredRecords, fccCoveredRecords] = await Promise.all([
    loadSnapshotSource(SNAPSHOTS.dplUrl, (csvText) => parseDplCsv(csvText, sources)),
    loadSnapshotSource(SNAPSHOTS.ddtcStatutoryDebarredUrl, (csvText) => parseDdtcStatutoryDebarredCsv(csvText, sources)),
    loadSnapshotSource(SNAPSHOTS.ddtcAdministrativeDebarredUrl, (csvText) => parseDdtcAdministrativeDebarredCsv(csvText, sources)),
    loadSnapshotSource(SNAPSHOTS.fccCoveredListUrl, (htmlText) => parseFccCoveredListHtml(htmlText, sources)),
  ]);

  return [...dplRecords, ...statutoryDebarredRecords, ...administrativeDebarredRecords, ...fccCoveredRecords];
}

async function loadSnapshotSource(url, parseRecords) {
  try {
    return parseRecords(await fetchText(url));
  } catch (error) {
    state.snapshotError = error;
    return [];
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

function parseEcfrRecords(xmlText, sources) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("eCFR returned XML that could not be parsed.");
  }

  return Object.entries(ECFR_SUPPLEMENTS).flatMap(([letter, config]) => {
    const source = sources.find((item) => item.letter === letter);
    const appendix = Array.from(doc.querySelectorAll("DIV9"))
      .find((node) => node.getAttribute("N") === config.appendix);

    if (!appendix) {
      return [];
    }

    let currentCountry = "";
    return Array.from(appendix.querySelectorAll("TR")).flatMap((row, index) => {
      const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD");
      if (cells.length !== config.columns.length) {
        return [];
      }

      const values = cells.map(cleanCellText);
      if (values[0]) {
        currentCountry = values[0];
      }
      values[0] = currentCountry;

      const rowData = Object.fromEntries(config.columns.map((column, i) => [column, values[i] || ""]));
      if (!rowData.entity || rowData.entity === "[Reserved]") {
        return [];
      }

      return [{
        id: `${letter}-${index}`,
        letter,
        sourceKey: config.key,
        sourceType: config.sourceType,
        sourceName: source?.name || config.key,
        citation: source?.citation || "",
        sourceUrl: source?.url || "",
        country: rowData.country,
        entity: rowData.entity,
        licenseRequirement: rowData.licenseRequirement || "",
        licenseReviewPolicy: rowData.licenseReviewPolicy || "",
        federalRegisterCitation: rowData.federalRegisterCitation || "",
        programs: [],
        aliases: [],
        addresses: [],
        ids: [],
        remarks: "",
        rawText: Object.values(rowData).join(" "),
      }];
    });
  });
}

function parseOfacApiRecords(xmlText, sources, letter) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("OFAC API returned XML that could not be parsed.");
  }

  const config = OFAC_SOURCES[letter];
  const source = sources.find((item) => item.letter === letter);
  const entitiesContainer = firstByTag(doc, "entities");
  const entities = entitiesContainer ? directChildrenByTag(entitiesContainer, "entity") : [];

  return entities.flatMap((entityElement) => {
    const entity = primaryOfacName(entityElement);
    if (!entity) {
      return [];
    }

    const programs = childTextsFromContainer(entityElement, "sanctionsPrograms", "sanctionsProgram");
    const sanctionsLists = childTextsFromContainer(entityElement, "sanctionsLists", "sanctionsList");
    const aliases = ofacAliases(entityElement);
    const addresses = ofacAddresses(entityElement);
    const ids = ofacIdentityDocuments(entityElement);
    const features = ofacFeatures(entityElement);
    const country = ofacCountry(entityElement);
    const rawText = [
      entity,
      programs.join(" "),
      sanctionsLists.join(" "),
      aliases.join(" "),
      addresses.join(" "),
      ids.join(" "),
      features.join(" "),
    ].join(" ");

    return [{
      id: `${letter}-${entityElement.getAttribute("id") || entity}`,
      letter,
      sourceKey: config.key,
      sourceType: config.sourceType,
      sourceName: source?.name || config.key,
      citation: source?.citation || "",
      sourceUrl: config.url,
      country,
      entity,
      licenseRequirement: "",
      licenseReviewPolicy: "",
      federalRegisterCitation: "",
      programs: [...sanctionsLists, ...programs],
      aliases,
      addresses,
      ids,
      remarks: features.join("; "),
      rawText,
    }];
  });
}

function parseDplCsv(csvText, sources) {
  const source = sources.find((item) => item.letter === "D");
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  const [header, ...dataRows] = rows;
  if (!header?.length) {
    return [];
  }

  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));

  return dataRows.flatMap((row, index) => {
    const entity = cleanPlainText(row[indexes.Name_and_Address]);
    if (!entity) {
      return [];
    }

    const effectiveDate = cleanPlainText(row[indexes.Effective_Date]);
    const expirationDate = cleanPlainText(row[indexes.Expiration_Date]);
    const federalRegisterCitation = cleanPlainText(row[indexes["Appropriate Federal Register Citations"]]);
    const typeOfDenial = cleanPlainText(row[indexes["Type of Denial"]]);
    const remarks = [
      effectiveDate ? `Effective: ${effectiveDate}` : "",
      expirationDate ? `Expires: ${expirationDate}` : "",
      typeOfDenial ? `Type: ${typeOfDenial}` : "",
    ].filter(Boolean).join("; ");

    return [{
      id: `D-${index}`,
      letter: "D",
      sourceKey: "DENIED_PERSONS_LIST",
      sourceType: "Snapshot",
      sourceName: source?.name || "Denied Persons List",
      citation: source?.citation || "",
      sourceUrl: SNAPSHOTS.dplUrl,
      country: countryFromDplEntity(entity),
      entity,
      licenseRequirement: typeOfDenial,
      licenseReviewPolicy: "",
      federalRegisterCitation,
      programs: [],
      aliases: [],
      addresses: [],
      ids: [],
      remarks,
      rawText: [entity, effectiveDate, expirationDate, federalRegisterCitation, typeOfDenial].join(" "),
    }];
  });
}

function parseDdtcStatutoryDebarredCsv(csvText, sources) {
  const source = sources.find((item) => item.letter === "F");
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  const [header, ...dataRows] = rows;
  if (!header?.length) {
    return [];
  }

  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));

  return dataRows.flatMap((row, index) => {
    const entity = cleanPlainText(row[indexes["Party Name"]]);
    if (!entity) {
      return [];
    }

    const dateOfBirth = cleanPlainText(row[indexes["Date Of Birth"]]);
    const federalRegisterCitation = cleanPlainText(row[indexes["Federal Register Notice"]]);
    const noticeDate = cleanPlainText(row[indexes["Notice Date"]]);
    const correctedNotice = cleanPlainText(row[indexes["Corrected Notice"]]);
    const correctedNoticeDate = cleanPlainText(row[indexes["Corrected Notice Date"]]);
    const remarks = [
      "Statutory debarment",
      dateOfBirth ? `DOB: ${dateOfBirth}` : "",
      noticeDate ? `Notice date: ${noticeDate}` : "",
      correctedNotice ? `Corrected notice: ${correctedNotice}` : "",
      correctedNoticeDate ? `Corrected notice date: ${correctedNoticeDate}` : "",
    ].filter(Boolean).join("; ");

    return [{
      id: `F-statutory-${index}`,
      letter: "F",
      sourceKey: "DEBARRED_PARTIES_LIST",
      sourceType: "Snapshot",
      sourceName: source?.name || "Debarred Parties List",
      citation: source?.citation || "",
      sourceUrl: SNAPSHOTS.ddtcStatutoryDebarredUrl,
      country: "",
      entity,
      licenseRequirement: "Statutory debarment",
      licenseReviewPolicy: "",
      federalRegisterCitation,
      programs: ["DDTC Statutory Debarment"],
      aliases: [],
      addresses: [],
      ids: [],
      remarks,
      rawText: [entity, dateOfBirth, federalRegisterCitation, noticeDate, correctedNotice, correctedNoticeDate].join(" "),
    }];
  });
}

function parseDdtcAdministrativeDebarredCsv(csvText, sources) {
  const source = sources.find((item) => item.letter === "F");
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  const [header, ...dataRows] = rows;
  if (!header?.length) {
    return [];
  }

  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));

  return dataRows.flatMap((row, index) => {
    const entity = cleanPlainText(row[indexes.Name]);
    if (!entity) {
      return [];
    }

    const date = cleanPlainText(row[indexes.Date]);
    const chargingLetter = cleanPlainText(row[indexes["Charging Letter"]]);
    const debarmentOrder = cleanPlainText(row[indexes["Debarment Order"]]);
    const federalRegisterCitation = cleanPlainText(row[indexes["Federal Register Notice"]]);
    const remarks = [
      "Administrative debarment",
      date ? `Date: ${date}` : "",
      chargingLetter ? `Charging letter: ${chargingLetter}` : "",
      debarmentOrder ? `Debarment order: ${debarmentOrder}` : "",
    ].filter(Boolean).join("; ");

    return [{
      id: `F-administrative-${index}`,
      letter: "F",
      sourceKey: "DEBARRED_PARTIES_LIST",
      sourceType: "Snapshot",
      sourceName: source?.name || "Debarred Parties List",
      citation: source?.citation || "",
      sourceUrl: SNAPSHOTS.ddtcAdministrativeDebarredUrl,
      country: "",
      entity,
      licenseRequirement: "Administrative debarment",
      licenseReviewPolicy: "",
      federalRegisterCitation,
      programs: ["DDTC Administrative Debarment"],
      aliases: [],
      addresses: [],
      ids: [],
      remarks,
      rawText: [entity, date, chargingLetter, debarmentOrder, federalRegisterCitation].join(" "),
    }];
  });
}

function parseFccCoveredListHtml(htmlText, sources) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const source = sources.find((item) => item.letter === "G");
  const heading = Array.from(doc.querySelectorAll("h3"))
    .find((item) => cleanPlainText(item.textContent) === "Covered List");
  const table = heading ? nextElementByTag(heading, "TABLE") : doc.querySelector(".page__body table");
  if (!table) {
    return [];
  }

  return Array.from(table.querySelectorAll("tbody tr")).flatMap((row, index) => {
    const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD");
    if (cells.length < 2) {
      return [];
    }

    const description = cleanCellText(cells[0]);
    const dateOfInclusion = cleanCellText(cells[1]);
    const entity = fccCoveredEntityName(cells[0], description);
    if (!entity || !description) {
      return [];
    }

    return [{
      id: `G-${index}`,
      letter: "G",
      sourceKey: "PRC_TELECOMMUNICATIONS_COMPANIES_LIST",
      sourceType: "Snapshot",
      sourceName: source?.name || "PRC Telecommunications Companies List",
      citation: source?.citation || "",
      sourceUrl: SNAPSHOTS.fccCoveredListUrl,
      country: "",
      entity,
      licenseRequirement: "",
      licenseReviewPolicy: "",
      federalRegisterCitation: "",
      programs: ["FCC Covered List"],
      aliases: [],
      addresses: [],
      ids: [],
      remarks: dateOfInclusion ? `Date of inclusion: ${dateOfInclusion}` : "",
      rawText: [entity, description, dateOfInclusion].join(" "),
    }];
  });
}

function fccCoveredEntityName(cell, description) {
  const namedEntities = Array.from(cell.querySelectorAll("strong"))
    .map(cleanCellText)
    .filter(Boolean);
  if (namedEntities.length) {
    return namedEntities.join("; ");
  }

  return description
    .split(/\s+(?:produced|provided|supplied)\s+(?:by|in)\s+| —| - /)[0]
    .replace(/\s+/g, " ")
    .trim();
}

function nextElementByTag(element, tagName) {
  let current = element.nextElementSibling;
  while (current) {
    if (current.tagName === tagName) {
      return current;
    }
    current = current.nextElementSibling;
  }
  return null;
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function countryFromDplEntity(entity) {
  const parts = entity.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

function cleanCellText(cell) {
  return Array.from(cell.childNodes)
    .map(nodeText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeText(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  if (node.tagName === "BR") {
    return " ";
  }

  return Array.from(node.childNodes).map(nodeText).join(" ");
}

function firstByTag(root, tagName) {
  return root.getElementsByTagNameNS("*", tagName)[0] || null;
}

function directChildByTag(element, tagName) {
  return directChildrenByTag(element, tagName)[0] || null;
}

function directChildrenByTag(element, tagName) {
  return Array.from(element.children).filter((child) => child.localName === tagName);
}

function cleanPlainText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function directText(element, tagName) {
  const child = directChildByTag(element, tagName);
  return child ? cleanPlainText(child.textContent) : "";
}

function childTextsFromContainer(element, containerTag, childTag) {
  const container = directChildByTag(element, containerTag);
  if (!container) {
    return [];
  }

  return directChildrenByTag(container, childTag)
    .map((child) => cleanPlainText(child.textContent))
    .filter(Boolean);
}

function primaryOfacName(entityElement) {
  const names = directChildByTag(entityElement, "names");
  if (!names) {
    return "";
  }

  const nameElements = directChildrenByTag(names, "name");
  const primary = nameElements.find((name) => directText(name, "isPrimary") === "true") || nameElements[0];
  return primary ? ofacNameText(primary) : "";
}

function ofacAliases(entityElement) {
  const names = directChildByTag(entityElement, "names");
  if (!names) {
    return [];
  }

  return directChildrenByTag(names, "name")
    .filter((name) => directText(name, "isPrimary") !== "true")
    .map(ofacNameText)
    .filter(Boolean);
}

function ofacNameText(nameElement) {
  const translations = firstByTag(nameElement, "translations");
  if (!translations) {
    return "";
  }

  const translationElements = directChildrenByTag(translations, "translation");
  const primary = translationElements.find((translation) => directText(translation, "isPrimary") === "true") || translationElements[0];
  return primary ? cleanPlainText(firstByTag(primary, "formattedFullName")?.textContent) : "";
}

function ofacAddresses(entityElement) {
  const addresses = directChildByTag(entityElement, "addresses");
  if (!addresses) {
    return [];
  }

  return directChildrenByTag(addresses, "address").map((address) => {
    const country = directText(address, "country");
    const parts = Array.from(address.getElementsByTagNameNS("*", "addressPart"))
      .map((part) => cleanPlainText(firstByTag(part, "value")?.textContent))
      .filter(Boolean);

    if (country) {
      parts.push(country);
    }

    return parts.join(", ");
  }).filter(Boolean);
}

function ofacIdentityDocuments(entityElement) {
  const documents = directChildByTag(entityElement, "identityDocuments");
  if (!documents) {
    return [];
  }

  return directChildrenByTag(documents, "identityDocument").map((document) => {
    const type = directText(document, "type");
    const number = directText(document, "documentNumber");
    const country = directText(document, "issuingCountry");
    return [type, number, country].filter(Boolean).join(": ");
  }).filter(Boolean);
}

function ofacFeatures(entityElement) {
  const features = directChildByTag(entityElement, "features");
  if (!features) {
    return [];
  }

  return directChildrenByTag(features, "feature").map((feature) => {
    const type = directText(feature, "type");
    const value = directText(feature, "value");
    return [type, value].filter(Boolean).join(": ");
  }).filter(Boolean);
}

function ofacCountry(entityElement) {
  const addresses = directChildByTag(entityElement, "addresses");
  if (addresses) {
    const country = directChildrenByTag(addresses, "address")
      .map((address) => directText(address, "country"))
      .find(Boolean);
    if (country) {
      return country;
    }
  }

  const documents = directChildByTag(entityElement, "identityDocuments");
  if (!documents) {
    return "";
  }

  return directChildrenByTag(documents, "identityDocument")
    .map((document) => directText(document, "issuingCountry"))
    .find(Boolean) || "";
}

function renderSources() {
  els.sourceList.innerHTML = state.sources
    .filter((source) => source.letter !== "O")
    .map((source) => {
      const config = LIVE_SOURCES[source.letter];
      const label = config ? `Live ${config.sourceType}` : "Not client-fetchable";
      const badgeClass = config ? "active" : "inactive";
      const rawUrl = config?.url || source.url;

      return `
        <article class="source-card">
          <div class="source-citation">${escapeHtml(source.citation)}</div>
          <div class="source-name">${escapeHtml(source.name)}</div>
          <div class="source-actions">
            <span class="badge ${badgeClass}">${label}</span>
            ${rawUrl ? `<a class="raw-link" href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener">raw data</a>` : ""}
          </div>
        </article>
      `;
    }).join("");
}

function renderFilters() {
  const filters = state.sources
    .filter((source) => state.availableLetters.has(source.letter))
    .map((source) => `
      <label class="filter">
        <input type="checkbox" value="${escapeHtml(source.letter)}" checked>
        <span>${escapeHtml(source.letter)} ${escapeHtml(source.name)}</span>
      </label>
    `)
    .join("");

  els.sourceFilters.innerHTML = filters;
  els.sourceFilters.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      state.selectedLetters = new Set(
        Array.from(els.sourceFilters.querySelectorAll("input:checked")).map((item) => item.value)
      );
      renderResults();
    });
  });
}

function renderResults() {
  const query = els.searchInput.value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);

  const searchable = state.records.filter((record) => state.selectedLetters.has(record.letter));
  const results = terms.length
    ? searchable.filter((record) => {
        const haystack = searchableText(record);

        return terms.every((term) => haystack.includes(term));
      })
    : searchable.slice(0, 50);

  els.recordCount.textContent = `${state.records.length.toLocaleString()} records`;

  if (!state.records.length && !state.error) {
    els.resultsList.innerHTML = '<div class="empty">Loading records...</div>';
    return;
  }

  if (!query) {
    els.resultsList.innerHTML = `
      <div class="empty">Showing the first ${Math.min(50, searchable.length)} records. Enter a query to search across entities.</div>
      ${results.map(renderRecord).join("")}
    `;
    return;
  }

  if (!results.length) {
    els.resultsList.innerHTML = '<div class="empty">No matches found.</div>';
    return;
  }

  els.resultsList.innerHTML = results.slice(0, 100).map(renderRecord).join("");
}

function searchableText(record) {
  return [
    record.sourceName,
    record.country,
    record.entity,
    record.licenseRequirement,
    record.licenseReviewPolicy,
    record.federalRegisterCitation,
    record.programs?.join(" "),
    record.aliases?.join(" "),
    record.addresses?.join(" "),
    record.ids?.join(" "),
    record.remarks,
  ].join(" ").toLowerCase();
}

function renderRecord(record) {
  return `
    <article class="result-card">
      <div class="result-meta">
        <span>${escapeHtml(record.letter)}</span>
        <span>${escapeHtml(record.sourceName)}</span>
        <span>${escapeHtml(record.country)}</span>
      </div>
      <div class="result-title">${escapeHtml(record.entity)}</div>
      <div class="result-fields">
        ${renderField("Programs", record.programs?.join(", "))}
        ${renderField("Aliases", record.aliases?.slice(0, 8).join("; "))}
        ${renderField("Addresses", record.addresses?.slice(0, 5).join("; "))}
        ${renderField("IDs", record.ids?.slice(0, 8).join("; "))}
        ${renderField("Remarks", record.remarks)}
        ${renderField("License requirement", record.licenseRequirement)}
        ${renderField("Review policy", record.licenseReviewPolicy)}
        ${renderField("Federal Register", record.federalRegisterCitation)}
      </div>
    </article>
  `;
}

function renderField(label, value) {
  if (!value) {
    return "";
  }

  return `<div><span class="field-label">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`;
}

function updateStatus() {
  const date = state.ecfrDate || "unknown date";
  const loadedAt = state.loadedAt ? state.loadedAt.toLocaleTimeString() : "now";
  const ofacNote = state.ofacApiError ? " OFAC API data could not be loaded in this browser session." : "";
  const snapshotNote = state.snapshotError ? " Snapshot data could not be loaded in this browser session." : "";
  els.statusText.textContent = `Loaded ${state.records.length.toLocaleString()} records from eCFR, OFAC API, and local snapshots. eCFR Title 15 is current as of ${date}. Last refreshed ${loadedAt}.${ofacNote}${snapshotNote}`;
}

function setLoading(isLoading) {
  els.refreshButton.disabled = isLoading;
  els.refreshButton.textContent = isLoading ? "Loading..." : "Refresh";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
