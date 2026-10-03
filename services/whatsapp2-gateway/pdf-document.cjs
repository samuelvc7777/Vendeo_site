"use strict";

const PDF_TEXT_MAX_BYTES = clampPositiveInt(
  process.env.WHATSAPP2_PDF_TEXT_MAX_BYTES,
  12 * 1024 * 1024,
  256 * 1024,
  50 * 1024 * 1024,
);
const PDF_TEXT_MAX_PAGES = clampPositiveInt(
  process.env.WHATSAPP2_PDF_TEXT_MAX_PAGES,
  20,
  1,
  100,
);
const PDF_TEXT_MAX_CHARS = clampPositiveInt(
  process.env.WHATSAPP2_PDF_TEXT_MAX_CHARS,
  8_000,
  1_000,
  20_000,
);
const PDF_TEXT_MIN_CHARS = clampPositiveInt(
  process.env.WHATSAPP2_PDF_TEXT_MIN_CHARS,
  12,
  1,
  200,
);

let pdfJsPromise = null;

function clampPositiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function trimMetadata(value, max = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizePageText(items) {
  const parts = [];
  for (const item of Array.isArray(items) ? items : []) {
    const value = String(item?.str ?? "");
    if (!value) continue;
    parts.push(value);
    if (item?.hasEOL) parts.push("\n");
    else parts.push(" ");
  }
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeStatus(status, overrides = {}) {
  return {
    source: "pdf_text_layer",
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

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfJsPromise;
}

async function extractPdfDocument(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return {
      textExtraction: makeStatus("invalid_pdf", { errorCode: "invalid_or_empty_buffer" }),
      pageCount: null,
      documentMetadata: null,
    };
  }

  const maxBytes = clampPositiveInt(options.maxBytes, PDF_TEXT_MAX_BYTES, 256 * 1024, 50 * 1024 * 1024);
  const maxPages = clampPositiveInt(options.maxPages, PDF_TEXT_MAX_PAGES, 1, 100);
  const maxChars = clampPositiveInt(options.maxChars, PDF_TEXT_MAX_CHARS, 1_000, 50_000);

  if (buffer.length > maxBytes) {
    return {
      textExtraction: makeStatus("too_large", {
        errorCode: "pdf_text_extraction_size_limit",
        truncated: true,
      }),
      pageCount: null,
      documentMetadata: null,
    };
  }

  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return {
      textExtraction: makeStatus("invalid_pdf", { errorCode: "pdf_magic_bytes_missing" }),
      pageCount: null,
      documentMetadata: null,
    };
  }

  let loadingTask = null;
  let document = null;
  try {
    const pdfjs = await loadPdfJs();
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      stopAtErrors: false,
    });
    document = await loadingTask.promise;

    const totalPages = Number(document.numPages || 0) || null;
    const pagesToRead = Math.min(totalPages || 0, maxPages);
    let extractedPages = 0;
    let combined = "";
    let charLimitReached = false;

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      const pageText = normalizePageText(content?.items);
      extractedPages += 1;

      if (!pageText) continue;
      const prefix = combined ? "\n\n" : "";
      const remaining = maxChars - combined.length - prefix.length;
      if (remaining <= 0) {
        charLimitReached = true;
        break;
      }

      combined += prefix + pageText.slice(0, remaining);
      if (pageText.length > remaining) {
        charLimitReached = true;
        break;
      }
    }

    const cleaned = combined.trim();
    let infoData = null;
    try {
      const metadata = await document.getMetadata();
      infoData = metadata?.info || metadata?.infoData || null;
    } catch {}

    const documentMetadata = infoData
      ? {
          title: trimMetadata(infoData.Title),
          author: trimMetadata(infoData.Author),
          subject: trimMetadata(infoData.Subject),
          creator: trimMetadata(infoData.Creator),
          producer: trimMetadata(infoData.Producer),
        }
      : null;

    const pageLimitReached = Boolean(totalPages && totalPages > pagesToRead);
    const truncated = charLimitReached || pageLimitReached;

    if (cleaned.length < PDF_TEXT_MIN_CHARS) {
      return {
        textExtraction: makeStatus("no_text", {
          extractedChars: cleaned.length,
          extractedPages,
          totalPages,
          truncated,
        }),
        pageCount: totalPages,
        documentMetadata,
      };
    }

    return {
      textExtraction: makeStatus("extracted", {
        text: cleaned,
        extractedChars: cleaned.length,
        extractedPages,
        totalPages,
        truncated,
      }),
      pageCount: totalPages,
      documentMetadata,
    };
  } catch (error) {
    const name = String(error?.name || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    const protectedPdf = name.includes("password") || message.includes("password");
    return {
      textExtraction: makeStatus(protectedPdf ? "protected" : "error", {
        errorCode: protectedPdf ? "pdf_password_protected" : "pdf_text_extraction_failed",
      }),
      pageCount: null,
      documentMetadata: null,
    };
  } finally {
    try {
      if (document) await document.destroy();
      else if (loadingTask) await loadingTask.destroy();
    } catch {}
  }
}

function isPdfAttachment(attachment, contentType, buffer) {
  const mime = String(contentType || attachment?.mimeType || "").toLowerCase().split(";")[0].trim();
  const fileName = String(attachment?.fileName || "").toLowerCase();
  const magic = Buffer.isBuffer(buffer) && buffer.length >= 5
    ? buffer.subarray(0, 5).toString("ascii")
    : "";
  return mime === "application/pdf" || fileName.endsWith(".pdf") || magic === "%PDF-";
}

function buildPdfBrainContext(attachment) {
  if (!attachment || !isPdfAttachment(attachment, attachment.mimeType, null)) return null;
  const fileName = String(attachment.fileName || "arquivo.pdf").trim() || "arquivo.pdf";
  const extraction = attachment.textExtraction || null;
  const totalPages = Number(extraction?.totalPages || attachment.pageCount || 0) || null;
  const pageLabel = totalPages ? ` (${totalPages} pág.${totalPages === 1 ? "" : "s"})` : "";

  if (extraction?.status === "extracted" && extraction.text) {
    const suffix = extraction.truncated
      ? "\n[extração truncada pelos limites de segurança]"
      : "";
    return `[PDF recebido: ${fileName}${pageLabel}]\nConteúdo extraído:\n${String(extraction.text).trim()}${suffix}`;
  }

  if (extraction?.status === "no_text") {
    const scope = extraction.truncated
      ? "não foi encontrado texto extraível nas páginas processadas"
      : "não foi encontrado texto extraível";
    return `[PDF recebido: ${fileName}${pageLabel} — ${scope}; o arquivo pode ser escaneado ou composto por imagens]`;
  }

  if (extraction?.status === "too_large") {
    return `[PDF recebido: ${fileName}${pageLabel} — conteúdo não extraído porque o arquivo excede o limite seguro de processamento]`;
  }

  if (extraction?.status === "protected") {
    return `[PDF recebido: ${fileName}${pageLabel} — conteúdo não extraído porque o PDF é protegido por senha]`;
  }

  return `[PDF recebido: ${fileName}${pageLabel} — conteúdo textual indisponível]`;
}

module.exports = {
  PDF_TEXT_MAX_BYTES,
  PDF_TEXT_MAX_PAGES,
  PDF_TEXT_MAX_CHARS,
  extractPdfDocument,
  isPdfAttachment,
  buildPdfBrainContext,
};
