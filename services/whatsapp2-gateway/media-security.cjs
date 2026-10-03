"use strict";

const path = require("node:path");

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const MAX_MEDIA_BYTES = clampInt(
  process.env.WHATSAPP2_MAX_MEDIA_BYTES,
  16 * 1024 * 1024,
  1024 * 1024,
  100 * 1024 * 1024,
);
const MEDIA_DOWNLOAD_TIMEOUT_MS = clampInt(
  process.env.WHATSAPP2_MEDIA_DOWNLOAD_TIMEOUT_MS,
  45_000,
  5_000,
  120_000,
);
const MEDIA_URL_TIMEOUT_MS = clampInt(
  process.env.WHATSAPP2_MEDIA_URL_TIMEOUT_MS,
  20_000,
  3_000,
  60_000,
);

function normalizeMimeType(value) {
  const mime = String(value || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!mime || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) {
    return "application/octet-stream";
  }
  return mime.slice(0, 160);
}

function estimateBase64DecodedBytes(value) {
  const base64 = String(value || "").replace(/\s+/g, "");
  if (!base64) return 0;
  if (base64.length % 4 === 1) throw new Error("whatsapp2_media_invalid_base64");
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function assertMediaSizeWithinLimit({
  declaredBytes = null,
  base64 = null,
  actualBytes = null,
  maxBytes = MAX_MEDIA_BYTES,
} = {}) {
  const limit = Math.max(1, Number(maxBytes || MAX_MEDIA_BYTES));
  const declared = Number(declaredBytes);
  if (Number.isFinite(declared) && declared > limit) {
    const error = new Error("whatsapp2_media_too_large");
    error.code = "WHATSAPP2_MEDIA_TOO_LARGE";
    error.size = declared;
    error.maxBytes = limit;
    throw error;
  }

  if (base64 != null) {
    const estimated = estimateBase64DecodedBytes(base64);
    if (estimated > limit) {
      const error = new Error("whatsapp2_media_too_large");
      error.code = "WHATSAPP2_MEDIA_TOO_LARGE";
      error.size = estimated;
      error.maxBytes = limit;
      throw error;
    }
  }

  const actual = Number(actualBytes);
  if (Number.isFinite(actual) && actual > limit) {
    const error = new Error("whatsapp2_media_too_large");
    error.code = "WHATSAPP2_MEDIA_TOO_LARGE";
    error.size = actual;
    error.maxBytes = limit;
    throw error;
  }
}

function sanitizeAttachmentFilename(value, fallback = "file") {
  let name = String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[\r\n\t]/g, " ")
    .trim();

  name = name.replace(/\\/g, "/");
  name = path.posix.basename(name);
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  name = name.replace(/\.{2,}/g, ".");
  name = name.replace(/[ .]+$/g, "").trim();

  if (!name || name === "." || name === "..") name = String(fallback || "file");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    name = "_" + name;
  }

  const maxChars = 180;
  if (name.length > maxChars) {
    const ext = path.posix.extname(name).slice(0, 20);
    const stemLimit = Math.max(1, maxChars - ext.length);
    name = name.slice(0, stemLimit) + ext;
  }
  return name || "file";
}

function sniffMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) return "image/jpeg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG"
  ) return "image/png";
  const first6 = buffer.subarray(0, 6).toString("ascii");
  if (first6 === "GIF87a" || first6 === "GIF89a") return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp"
  ) {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["m4a ", "m4b ", "m4p ", "isom", "mp42", "mp41"].includes(brand)) {
      return brand.startsWith("m4") ? "audio/mp4" : "video/mp4";
    }
    return "video/mp4";
  }
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3])
  ) return "application/zip";

  return null;
}

function extensionFromName(fileName) {
  const ext = path.posix.extname(String(fileName || "").toLowerCase());
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

function resolveTrustedMimeType(reportedMime, buffer, fileName = null) {
  const reported = normalizeMimeType(reportedMime);
  const sniffed = sniffMimeType(buffer);
  if (!sniffed) return reported;

  const ext = extensionFromName(fileName);
  const zipOfficeMime = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }[ext];

  const knownOfficeZipMimes = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]);
  if (sniffed === "application/zip") {
    if (zipOfficeMime) {
      if (
        reported === zipOfficeMime ||
        reported === "application/zip" ||
        reported === "application/octet-stream"
      ) return zipOfficeMime;
    }
    if (knownOfficeZipMimes.has(reported)) return reported;
  }

  if (reported === "application/octet-stream") {
    return zipOfficeMime && sniffed === "application/zip" ? zipOfficeMime : sniffed;
  }
  if (reported === sniffed) return reported;

  const sameFamily =
    reported.split("/")[0] === sniffed.split("/")[0] &&
    ["image", "audio", "video"].includes(reported.split("/")[0]);
  if (sameFamily) return sniffed;

  // For a strong magic signature that conflicts with the provider claim,
  // trust the bytes rather than serving/storing content under a spoofed type.
  return sniffed;
}

async function downloadHttpMediaBounded(url, {
  maxBytes = MAX_MEDIA_BYTES,
  timeoutMs = MEDIA_URL_TIMEOUT_MS,
  fileName = null,
} = {}) {
  const source = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("whatsapp2_media_url_invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("whatsapp2_media_url_protocol_not_allowed");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`whatsapp2_media_url_http_${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    assertMediaSizeWithinLimit({
      declaredBytes: Number.isFinite(contentLength) ? contentLength : null,
      maxBytes,
    });

    const chunks = [];
    let total = 0;
    if (!response.body) throw new Error("whatsapp2_media_url_empty_body");
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      assertMediaSizeWithinLimit({ actualBytes: total, maxBytes });
      chunks.push(buffer);
    }
    const buffer = Buffer.concat(chunks, total);
    const reportedMime = normalizeMimeType(response.headers.get("content-type"));
    return {
      buffer,
      size: total,
      reportedMime,
      contentType: resolveTrustedMimeType(reportedMime, buffer, fileName),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("whatsapp2_media_url_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MAX_MEDIA_BYTES,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  MEDIA_URL_TIMEOUT_MS,
  normalizeMimeType,
  estimateBase64DecodedBytes,
  assertMediaSizeWithinLimit,
  sanitizeAttachmentFilename,
  sniffMimeType,
  resolveTrustedMimeType,
  downloadHttpMediaBounded,
};
