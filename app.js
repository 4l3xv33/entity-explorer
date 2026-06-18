const ECFR_PART_744 = {
  titleNumber: 15,
  part: 744,
  metadataUrl: "https://www.ecfr.gov/api/versioner/v1/titles.json",
  xmlUrl(date) {
    return `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-15.xml?part=744`;
  },
};

const OFAC = {
  sdnUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml",
  consolidatedUrl: "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml",
  cmicProgram: "CMIC-EO13959",
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
    sourceType: "OFAC",
    list: "sdn",
  },
  J: {
    key: "EO_14032_ANNEX",
    sourceType: "OFAC",
    list: "consolidated",
    program: OFAC.cmicProgram,
  },
};

const LIVE_SOURCES = { ...ECFR_SUPPLEMENTS, ...OFAC_SOURCES };

const state = {
  sources: [],
  availableLetters: new Set(Object.keys(LIVE_SOURCES)),
  selectedLetters: new Set(Object.keys(LIVE_SOURCES)),
  records: [],
  loadedAt: null,
  ecfrDate: null,
  ofacError: null,
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
  state.ofacError = null;

  try {
    const [sources, ecfrDate] = await Promise.all([loadSources(), loadEcfrDate()]);
    state.sources = sources;
    state.ecfrDate = ecfrDate;
    renderSources();
    renderFilters();

    const [ecfrRecords, ofacRecords] = await Promise.all([
      loadEcfrRecords(ecfrDate, sources),
      loadOfacRecords(sources).catch((error) => {
        state.ofacError = error;
        return [];
      }),
    ]);

    state.records = [...ecfrRecords, ...ofacRecords];
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

async function loadOfacRecords(sources) {
  const [sdnXml, consolidatedXml] = await Promise.all([
    fetchText(OFAC.sdnUrl),
    fetchText(OFAC.consolidatedUrl),
  ]);

  return [
    ...parseOfacRecords(sdnXml, sources, "C"),
    ...parseOfacRecords(consolidatedXml, sources, "J", OFAC.cmicProgram),
  ];
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

function parseOfacRecords(xmlText, sources, letter, requiredProgram = null) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("OFAC returned XML that could not be parsed.");
  }

  const config = OFAC_SOURCES[letter];
  const source = sources.find((item) => item.letter === letter);
  const entries = Array.from(doc.getElementsByTagNameNS("*", "sdnEntry"));

  return entries.flatMap((entry) => {
    const programs = childTexts(entry, "program");
    if (requiredProgram && !programs.includes(requiredProgram)) {
      return [];
    }

    const uid = childText(entry, "uid");
    const entity = formatOfacName(entry);
    if (!entity) {
      return [];
    }

    const aliases = Array.from(entry.getElementsByTagNameNS("*", "aka"))
      .map(formatOfacName)
      .filter(Boolean);
    const addresses = Array.from(entry.getElementsByTagNameNS("*", "address"))
      .map(formatOfacAddress)
      .filter(Boolean);
    const ids = Array.from(entry.getElementsByTagNameNS("*", "id"))
      .map(formatOfacId)
      .filter(Boolean);
    const remarks = childText(entry, "remarks");
    const country = firstCountry(entry, addresses);
    const rawText = [
      entity,
      childText(entry, "sdnType"),
      programs.join(" "),
      aliases.join(" "),
      addresses.join(" "),
      ids.join(" "),
      remarks,
    ].join(" ");

    return [{
      id: `${letter}-${uid || entity}`,
      letter,
      sourceKey: config.key,
      sourceType: config.sourceType,
      sourceName: source?.name || config.key,
      citation: source?.citation || "",
      sourceUrl: source?.url || "",
      country,
      entity,
      licenseRequirement: "",
      licenseReviewPolicy: "",
      federalRegisterCitation: "",
      programs,
      aliases,
      addresses,
      ids,
      remarks,
      rawText,
    }];
  });
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

function childText(element, tagName) {
  const child = element.getElementsByTagNameNS("*", tagName)[0];
  return child ? cleanPlainText(child.textContent) : "";
}

function childTexts(element, tagName) {
  return Array.from(element.getElementsByTagNameNS("*", tagName))
    .map((child) => cleanPlainText(child.textContent))
    .filter(Boolean);
}

function cleanPlainText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatOfacName(element) {
  const firstName = childText(element, "firstName");
  const lastName = childText(element, "lastName");
  const title = childText(element, "title");
  return [title, firstName, lastName].filter(Boolean).join(" ");
}

function formatOfacAddress(address) {
  return [
    childText(address, "address1"),
    childText(address, "address2"),
    childText(address, "address3"),
    childText(address, "city"),
    childText(address, "stateOrProvince"),
    childText(address, "postalCode"),
    childText(address, "country"),
  ].filter(Boolean).join(", ");
}

function formatOfacId(id) {
  const type = childText(id, "idType");
  const number = childText(id, "idNumber");
  const country = childText(id, "idCountry");

  if (!type && !number) {
    return "";
  }

  return [type, number, country].filter(Boolean).join(": ");
}

function firstCountry(entry, addresses) {
  const addressCountry = Array.from(entry.getElementsByTagNameNS("*", "address"))
    .map((address) => childText(address, "country"))
    .find(Boolean);

  if (addressCountry) {
    return addressCountry;
  }

  const idCountry = Array.from(entry.getElementsByTagNameNS("*", "id"))
    .map((id) => childText(id, "idCountry"))
    .find(Boolean);

  return idCountry || "";
}

function renderSources() {
  els.sourceList.innerHTML = state.sources.map((source) => {
    const config = LIVE_SOURCES[source.letter];
    const label = config ? `Live ${config.sourceType}` : "Not client-fetchable";
    const badgeClass = config ? "active" : "inactive";

    return `
      <article class="source-card">
        <div class="source-citation">${escapeHtml(source.citation)}</div>
        <div class="source-name">${escapeHtml(source.name)}</div>
        <span class="badge ${badgeClass}">${label}</span>
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
  const ofacNote = state.ofacError ? " OFAC data could not be loaded in this browser session." : "";
  els.statusText.textContent = `Loaded ${state.records.length.toLocaleString()} records from eCFR and OFAC. eCFR Title 15 is current as of ${date}. Last refreshed ${loadedAt}.${ofacNote}`;
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
