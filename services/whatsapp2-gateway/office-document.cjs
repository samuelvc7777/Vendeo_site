"use strict";

const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");

const DOCUMENT_EXTRACT_MAX_BYTES = clampInt(
  process.env.WHATSAPP2_DOCUMENT_EXTRACT_MAX_BYTES,
  12 * 1024 * 1024,
  256 * 1024,
  50 * 1024 * 1024,
);
const DOCUMENT_TEXT_MAX_CHARS = clampInt(
  process.env.WHATSAPP2_DOCUMENT_TEXT_MAX_CHARS,
  8_000,
  1_000,
  20_000,
);
const DOCUMENT_ZIP_ENTRY_MAX_BYTES = clampInt(
  process.env.WHATSAPP2_DOCUMENT_ZIP_ENTRY_MAX_BYTES,
  4 * 1024 * 1024,
  128 * 1024,
  16 * 1024 * 1024,
);
const DOCUMENT_ZIP_MAX_ENTRIES = clampInt(
  process.env.WHATSAPP2_DOCUMENT_ZIP_MAX_ENTRIES,
  500,
  20,
  2_000,
);
const DOCUMENT_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES = clampInt(
  process.env.WHATSAPP2_DOCUMENT_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES,
  32 * 1024 * 1024,
  1024 * 1024,
  128 * 1024 * 1024,
);
const DOCUMENT_ZIP_MAX_COMPRESSION_RATIO = clampInt(
  process.env.WHATSAPP2_DOCUMENT_ZIP_MAX_COMPRESSION_RATIO,
  200,
  10,
  1000,
);
const DOCUMENT_MAX_SHEETS = clampInt(
  process.env.WHATSAPP2_DOCUMENT_MAX_SHEETS,
  12,
  1,
  50,
);
const DOCUMENT_MAX_ROWS_PER_SHEET = clampInt(
  process.env.WHATSAPP2_DOCUMENT_MAX_ROWS_PER_SHEET,
  30,
  1,
  200,
);
const DOCUMENT_MAX_COLUMNS_PER_ROW = clampInt(
  process.env.WHATSAPP2_DOCUMENT_MAX_COLUMNS_PER_ROW,
  20,
  1,
  100,
);
const DOCUMENT_MAX_SLIDES = clampInt(
  process.env.WHATSAPP2_DOCUMENT_MAX_SLIDES,
  30,
  1,
  100,
);
const TEXT_SOURCE_MAX_BYTES = clampInt(
  process.env.WHATSAPP2_TEXT_SOURCE_MAX_BYTES,
  512 * 1024,
  16 * 1024,
  4 * 1024 * 1024,
);
const TEXT_SOURCE_MAX_LINES = clampInt(
  process.env.WHATSAPP2_TEXT_SOURCE_MAX_LINES,
  240,
  20,
  2_000,
);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
});

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundedText(value, maxChars = DOCUMENT_TEXT_MAX_CHARS) {
  const text = cleanText(value);
  return {
    text: text ? text.slice(0, maxChars) : null,
    truncated: text.length > maxChars,
    originalChars: text.length,
  };
}

function extraction(status, source, overrides = {}) {
  return {
    source,
    status,
    text: null,
    extractedChars: 0,
    extractedPages: 0,
    totalPages: null,
    truncated: false,
    errorCode: null,
    ...overrides,
  };
}

function normalizeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectTextNodes(node, target = []) {
  if (node == null) return target;
  if (typeof node === "string" || typeof node === "number") return target;
  if (Array.isArray(node)) {
    for (const item of node) collectTextNodes(item, target);
    return target;
  }
  if (typeof node !== "object") return target;
  for (const [key, value] of Object.entries(node)) {
    if (key === "t") {
      for (const item of normalizeArray(value)) {
        if (typeof item === "string" || typeof item === "number") {
          const text = String(item).trim();
          if (text) target.push(text);
        } else {
          collectTextNodes(item, target);
        }
      }
      continue;
    }
    collectTextNodes(value, target);
  }
  return target;
}

function collectNodesByKey(node, key, target = []) {
  if (node == null) return target;
  if (Array.isArray(node)) {
    for (const item of node) collectNodesByKey(item, key, target);
    return target;
  }
  if (typeof node !== "object") return target;
  for (const [currentKey, value] of Object.entries(node)) {
    if (currentKey === key) {
      target.push(...normalizeArray(value));
    } else {
      collectNodesByKey(value, key, target);
    }
  }
  return target;
}

function extensionOf(fileName) {
  const value = String(fileName || "").trim().toLowerCase();
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index + 1) : "";
}

function detectDocumentKind(attachment, contentType) {
  const mime = String(contentType || attachment?.mimeType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const ext = extensionOf(attachment?.fileName);

  if (mime === "text/plain" || ext === "txt") return "txt";
  if (mime === "text/csv" || mime.includes("csv") || ext === "csv") return "csv";
  if (mime.includes("wordprocessingml.document") || ext === "docx") return "docx";
  if (mime.includes("spreadsheetml.sheet") || ext === "xlsx") return "xlsx";
  if (mime.includes("presentationml.presentation") || ext === "pptx") return "pptx";
  if (ext === "doc" || mime === "application/msword") return "doc";
  if (ext === "xls" || mime === "application/vnd.ms-excel") return "xls";
  if (ext === "ppt" || mime === "application/vnd.ms-powerpoint") return "ppt";
  return null;
}

function zipEntryUncompressedSize(entry) {
  const size = Number(entry?._data?.uncompressedSize);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function zipEntryCompressedSize(entry) {
  const size = Number(entry?._data?.compressedSize);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function hasUnsafeZipPath(entry) {
  const value = String(entry?.unsafeOriginalName || entry?.name || "")
    .replace(/\\/g, "/");
  return (
    value.includes("\u0000") ||
    value.startsWith("/") ||
    /^[a-z]:\//i.test(value) ||
    /(^|\/)\.\.(\/|$)/.test(value)
  );
}

async function readZipEntry(zip, name, { optional = false } = {}) {
  const entry = zip.file(name);
  if (!entry) {
    if (optional) return null;
    throw new Error("document_zip_entry_missing");
  }
  const announcedSize = zipEntryUncompressedSize(entry);
  if (announcedSize != null && announcedSize > DOCUMENT_ZIP_ENTRY_MAX_BYTES) {
    throw new Error("document_zip_entry_too_large");
  }
  const text = await entry.async("string");
  if (Buffer.byteLength(text, "utf8") > DOCUMENT_ZIP_ENTRY_MAX_BYTES) {
    throw new Error("document_zip_entry_too_large");
  }
  return text;
}

async function loadSafeZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new Error("document_invalid_buffer");
  }
  if (buffer.length > DOCUMENT_EXTRACT_MAX_BYTES) {
    throw new Error("document_input_too_large");
  }
  if (buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error("document_not_zip_container");
  }
  const zip = await JSZip.loadAsync(buffer, {
    checkCRC32: false,
    createFolders: false,
  });
  const entries = Object.values(zip.files);
  if (entries.length > DOCUMENT_ZIP_MAX_ENTRIES) {
    throw new Error("document_zip_too_many_entries");
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    if (hasUnsafeZipPath(entry)) {
      throw new Error("document_zip_unsafe_path");
    }
    if (entry?.dir) continue;

    const uncompressed = zipEntryUncompressedSize(entry);
    const compressed = zipEntryCompressedSize(entry);
    if (uncompressed != null) {
      if (uncompressed > DOCUMENT_ZIP_ENTRY_MAX_BYTES) {
        throw new Error("document_zip_entry_too_large");
      }
      totalUncompressed += uncompressed;
      if (totalUncompressed > DOCUMENT_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES) {
        throw new Error("document_zip_total_uncompressed_too_large");
      }
      if (
        compressed != null &&
        compressed > 0 &&
        uncompressed > 256 * 1024 &&
        uncompressed / compressed > DOCUMENT_ZIP_MAX_COMPRESSION_RATIO
      ) {
        throw new Error("document_zip_compression_ratio_too_high");
      }
    }
  }

  if (
    buffer.length > 0 &&
    totalUncompressed > 1024 * 1024 &&
    totalUncompressed / buffer.length > DOCUMENT_ZIP_MAX_COMPRESSION_RATIO
  ) {
    throw new Error("document_zip_total_compression_ratio_too_high");
  }

  return zip;
}

function decodeTextBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_SOURCE_MAX_BYTES));
  let text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  if (replacementCount > Math.max(4, text.length * 0.01)) {
    text = new TextDecoder("windows-1252", { fatal: false }).decode(sample);
  }
  return {
    text,
    sourceTruncated: buffer.length > sample.length,
  };
}

function limitLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const limited = lines.slice(0, TEXT_SOURCE_MAX_LINES).join("\n");
  return {
    text: limited,
    linesRead: Math.min(lines.length, TEXT_SOURCE_MAX_LINES),
    totalLinesKnown: lines.length,
    truncated: lines.length > TEXT_SOURCE_MAX_LINES,
  };
}

function detectCsvDelimiter(text) {
  const sampleLines = String(text || "").split(/\r?\n/).slice(0, 8);
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestScore = -1;
  for (const candidate of candidates) {
    let score = 0;
    for (const line of sampleLines) {
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '"') {
          if (quoted && line[i + 1] === '"') i += 1;
          else quoted = !quoted;
        } else if (!quoted && line[i] === candidate) {
          score += 1;
        }
      }
    }
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function parseCsvPreview(text) {
  const delimiter = detectCsvDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const pushField = () => {
    if (row.length < DOCUMENT_MAX_COLUMNS_PER_ROW) row.push(field.trim());
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  while (
    i < text.length &&
    rows.length < DOCUMENT_MAX_ROWS_PER_SHEET
  ) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      pushRow();
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field || row.length) pushRow();

  return {
    rows,
    delimiter,
    truncated: i < text.length,
  };
}

async function extractTxt(buffer) {
  const decoded = decodeTextBuffer(buffer);
  const lineBounded = limitLines(decoded.text);
  const bounded = boundedText(lineBounded.text);
  return {
    textExtraction: extraction(bounded.text ? "extracted" : "no_text", "plain_text", {
      text: bounded.text,
      extractedChars: bounded.text?.length || 0,
      truncated: decoded.sourceTruncated || lineBounded.truncated || bounded.truncated,
    }),
    documentStructure: {
      linesRead: lineBounded.linesRead,
      totalLinesKnown: decoded.sourceTruncated ? null : lineBounded.totalLinesKnown,
    },
  };
}

async function extractCsv(buffer) {
  const decoded = decodeTextBuffer(buffer);
  const preview = parseCsvPreview(decoded.text);
  const lines = preview.rows
    .map((row, index) => `${index + 1}: ${row.join(" | ")}`)
    .join("\n");
  const bounded = boundedText(lines);
  return {
    textExtraction: extraction(bounded.text ? "extracted" : "no_text", "csv_text", {
      text: bounded.text,
      extractedChars: bounded.text?.length || 0,
      truncated: decoded.sourceTruncated || preview.truncated || bounded.truncated,
    }),
    documentStructure: {
      rowsRead: preview.rows.length,
      columnsLimit: DOCUMENT_MAX_COLUMNS_PER_ROW,
      delimiter: preview.delimiter === "\t" ? "tab" : preview.delimiter,
    },
  };
}

async function extractDocx(buffer) {
  const zip = await loadSafeZip(buffer);
  const xml = await readZipEntry(zip, "word/document.xml");
  const parsed = xmlParser.parse(xml);
  const paragraphs = collectNodesByKey(parsed?.document?.body, "p", []);
  const lines = paragraphs
    .map((paragraph) => collectTextNodes(paragraph, []).join(" ").trim())
    .filter(Boolean);
  const bounded = boundedText(lines.join("\n"));
  return {
    textExtraction: extraction(
      bounded.text ? "extracted" : "no_text",
      "docx_xml",
      {
        text: bounded.text,
        extractedChars: bounded.text?.length || 0,
        truncated: bounded.truncated,
      },
    ),
    documentStructure: {
      paragraphsRead: lines.length,
    },
  };
}

function sharedStringValue(item) {
  return collectTextNodes(item, []).join(" ").trim();
}

function normalizeWorkbookTarget(target, fallbackIndex) {
  const raw = String(target || "").replace(/\\/g, "/").trim();
  if (!raw) return `xl/worksheets/sheet${fallbackIndex}.xml`;
  if (raw.startsWith("/xl/")) return raw.slice(1);
  if (raw.startsWith("xl/")) return raw;
  if (raw.startsWith("../")) return "xl/" + raw.replace(/^\.\.\//, "");
  return "xl/" + raw.replace(/^\.\//, "");
}

function cellColumn(ref) {
  return String(ref || "").replace(/[0-9]/g, "").toUpperCase();
}

async function extractXlsx(buffer) {
  const zip = await loadSafeZip(buffer);
  const workbookXml = await readZipEntry(zip, "xl/workbook.xml");
  const workbook = xmlParser.parse(workbookXml);
  const sheets = normalizeArray(workbook?.workbook?.sheets?.sheet);
  const relsXml = await readZipEntry(zip, "xl/_rels/workbook.xml.rels", { optional: true });
  const rels = relsXml
    ? normalizeArray(xmlParser.parse(relsXml)?.Relationships?.Relationship)
    : [];
  const relationshipTargets = new Map(
    rels
      .map((rel) => [
        String(rel?.["@_Id"] || rel?.["@_id"] || ""),
        String(rel?.["@_Target"] || rel?.["@_target"] || ""),
      ])
      .filter(([id, target]) => id && target),
  );

  let sharedStrings = [];
  const sharedXml = await readZipEntry(zip, "xl/sharedStrings.xml", { optional: true });
  if (sharedXml) {
    const parsedShared = xmlParser.parse(sharedXml);
    sharedStrings = normalizeArray(parsedShared?.sst?.si).map(sharedStringValue);
  }

  const lines = [];
  const sheetNames = [];
  let truncated = sheets.length > DOCUMENT_MAX_SHEETS;

  for (let sheetIndex = 0; sheetIndex < Math.min(sheets.length, DOCUMENT_MAX_SHEETS); sheetIndex += 1) {
    const sheetName = String(sheets[sheetIndex]?.["@_name"] || `Aba ${sheetIndex + 1}`).trim();
    sheetNames.push(sheetName);

    const relationshipId = String(
      sheets[sheetIndex]?.["@_id"] ||
      sheets[sheetIndex]?.["@_r:id"] ||
      "",
    );
    const relationshipTarget = relationshipTargets.get(relationshipId) || "";
    const normalizedTarget = normalizeWorkbookTarget(
      relationshipTarget,
      sheetIndex + 1,
    );
    const sheetXml = await readZipEntry(
      zip,
      normalizedTarget,
      { optional: true },
    );
    if (!sheetXml) continue;

    const sheet = xmlParser.parse(sheetXml);
    const rows = normalizeArray(sheet?.worksheet?.sheetData?.row);
    if (rows.length > DOCUMENT_MAX_ROWS_PER_SHEET) truncated = true;
    lines.push(`[Aba: ${sheetName}]`);

    for (const row of rows.slice(0, DOCUMENT_MAX_ROWS_PER_SHEET)) {
      const cells = normalizeArray(row?.c).slice(0, DOCUMENT_MAX_COLUMNS_PER_ROW);
      if (normalizeArray(row?.c).length > DOCUMENT_MAX_COLUMNS_PER_ROW) truncated = true;
      const values = [];
      for (const cell of cells) {
        const type = String(cell?.["@_t"] || "");
        let value = cell?.v ?? "";
        if (type === "s") {
          const index = Number.parseInt(String(value), 10);
          value = Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
        } else if (type === "inlineStr") {
          value = collectTextNodes(cell?.is, []).join(" ");
        }
        const clean = cleanText(value);
        if (clean) values.push(`${cellColumn(cell?.["@_r"])}=${clean}`);
      }
      if (values.length) lines.push(values.join(" | "));
    }
  }

  const bounded = boundedText(lines.join("\n"));
  return {
    textExtraction: extraction(
      bounded.text ? "extracted" : "no_text",
      "xlsx_xml",
      {
        text: bounded.text,
        extractedChars: bounded.text?.length || 0,
        truncated: truncated || bounded.truncated,
      },
    ),
    documentStructure: {
      sheetNames,
      sheetsRead: sheetNames.length,
      totalSheets: sheets.length,
      rowsPerSheetLimit: DOCUMENT_MAX_ROWS_PER_SHEET,
      columnsPerRowLimit: DOCUMENT_MAX_COLUMNS_PER_ROW,
    },
  };
}

function slideNumber(name) {
  const match = String(name).match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function extractPptx(buffer) {
  const zip = await loadSafeZip(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const lines = [];
  const slidesRead = Math.min(slideEntries.length, DOCUMENT_MAX_SLIDES);
  let truncated = slideEntries.length > DOCUMENT_MAX_SLIDES;

  for (let i = 0; i < slidesRead; i += 1) {
    const xml = await readZipEntry(zip, slideEntries[i]);
    const parsed = xmlParser.parse(xml);
    const text = collectTextNodes(parsed, []).join(" ").trim();
    if (text) lines.push(`[Slide ${i + 1}] ${text}`);
  }

  const bounded = boundedText(lines.join("\n"));
  truncated = truncated || bounded.truncated;
  return {
    textExtraction: extraction(
      bounded.text ? "extracted" : "no_text",
      "pptx_xml",
      {
        text: bounded.text,
        extractedChars: bounded.text?.length || 0,
        extractedPages: slidesRead,
        totalPages: slideEntries.length,
        truncated,
      },
    ),
    documentStructure: {
      slideCount: slideEntries.length,
      slidesRead,
    },
  };
}

async function extractOfficeDocument(buffer, attachment = {}, contentType = null) {
  const kind = detectDocumentKind(attachment, contentType);
  if (!kind) return null;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      textExtraction: extraction("error", `${kind}_parser`, {
        errorCode: "document_invalid_or_empty_buffer",
      }),
      documentStructure: null,
    };
  }

  if (buffer.length > DOCUMENT_EXTRACT_MAX_BYTES) {
    return {
      textExtraction: extraction("too_large", `${kind}_parser`, {
        errorCode: "document_text_extraction_size_limit",
        truncated: true,
      }),
      documentStructure: null,
    };
  }

  try {
    if (kind === "txt") return { kind, ...(await extractTxt(buffer)) };
    if (kind === "csv") return { kind, ...(await extractCsv(buffer)) };
    if (kind === "docx") return { kind, ...(await extractDocx(buffer)) };
    if (kind === "xlsx") return { kind, ...(await extractXlsx(buffer)) };
    if (kind === "pptx") return { kind, ...(await extractPptx(buffer)) };

    return {
      kind,
      textExtraction: extraction("unsupported_legacy_binary", `${kind}_legacy_binary`, {
        errorCode: "legacy_office_binary_not_parsed",
      }),
      documentStructure: null,
    };
  } catch (error) {
    const code = String(error?.message || "document_text_extraction_failed");
    return {
      kind,
      textExtraction: extraction("error", `${kind}_parser`, {
        errorCode: code.slice(0, 120),
      }),
      documentStructure: null,
    };
  }
}

function buildOfficeBrainContext(attachment) {
  const kind = detectDocumentKind(attachment, attachment?.mimeType);
  if (!kind) return null;

  const fileName = String(attachment?.fileName || `arquivo.${kind}`).trim();
  const extractionResult = attachment?.textExtraction || null;
  const structure = attachment?.documentStructure || null;
  const label = kind.toUpperCase();

  if (extractionResult?.status === "extracted" && extractionResult.text) {
    let structureLine = "";
    if (kind === "xlsx" && Array.isArray(structure?.sheetNames) && structure.sheetNames.length) {
      structureLine = `\nAbas: ${structure.sheetNames.join(", ")}.`;
    } else if (kind === "pptx" && Number(structure?.slideCount || 0) > 0) {
      structureLine = `\nSlides: ${structure.slideCount}.`;
    }

    const suffix = extractionResult.truncated
      ? "\n[extração truncada pelos limites de segurança]"
      : "";
    return `[${label} recebido: ${fileName}]${structureLine}\nConteúdo extraído:\n${String(extractionResult.text).trim()}${suffix}`;
  }

  if (extractionResult?.status === "no_text") {
    return `[${label} recebido: ${fileName} — não foi encontrado texto extraível]`;
  }
  if (extractionResult?.status === "too_large") {
    return `[${label} recebido: ${fileName} — conteúdo não extraído porque o arquivo excede o limite seguro de processamento]`;
  }
  if (extractionResult?.status === "unsupported_legacy_binary") {
    return `[${label} recebido: ${fileName} — formato Office legado recebido, mas o conteúdo não foi interpretado automaticamente]`;
  }
  if (extractionResult?.status === "error") {
    return `[${label} recebido: ${fileName} — não foi possível extrair o conteúdo com segurança]`;
  }

  return `[${label} recebido: ${fileName} — conteúdo ainda não interpretado]`;
}

module.exports = {
  DOCUMENT_EXTRACT_MAX_BYTES,
  DOCUMENT_TEXT_MAX_CHARS,
  DOCUMENT_ZIP_ENTRY_MAX_BYTES,
  DOCUMENT_ZIP_MAX_ENTRIES,
  DOCUMENT_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES,
  DOCUMENT_ZIP_MAX_COMPRESSION_RATIO,
  detectDocumentKind,
  extractOfficeDocument,
  buildOfficeBrainContext,
};
