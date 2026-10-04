import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const gatewayRoot = path.join(root, "services", "whatsapp2-gateway");
const require = createRequire(path.join(gatewayRoot, "package.json"));
const JSZip = require("jszip");
const security = require(path.join(gatewayRoot, "media-security.cjs"));
const office = require(path.join(gatewayRoot, "office-document.cjs"));
const gateway = fs.readFileSync(path.join(gatewayRoot, "index.cjs"), "utf8");

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source end marker: ${endMarker}`);
  return source.slice(start, end);
}

async function withServer(handler, work) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("global media limit is bounded and configurable with a safe default", () => {
  assert.equal(security.MAX_MEDIA_BYTES, 16 * 1024 * 1024);
  assert.ok(security.MEDIA_DOWNLOAD_TIMEOUT_MS >= 5_000);
  assert.ok(security.MEDIA_URL_TIMEOUT_MS >= 3_000);
});

test("base64 decoded size is estimated before Buffer allocation", () => {
  const binary = Buffer.alloc(1024, 7);
  const base64 = binary.toString("base64");
  assert.equal(security.estimateBase64DecodedBytes(base64), binary.length);

  assert.throws(
    () => security.assertMediaSizeWithinLimit({
      base64: Buffer.alloc(2048).toString("base64"),
      maxBytes: 1024,
    }),
    /whatsapp2_media_too_large/,
  );

  const inboundDownload = extract(
    gateway,
    "async function downloadMessageMediaPayload",
    "async function persistWhatsApp2MediaUnlocked",
  );
  const bufferIndex = inboundDownload.indexOf('Buffer.from(base64, "base64")');
  const guardIndex = inboundDownload.indexOf("assertMediaSizeWithinLimit");
  assert.ok(guardIndex >= 0 && guardIndex < bufferIndex);

  const outboundSend = extract(
    gateway,
    "async function sendMediaInternalUnlocked",
    "async function sendMediaInternal",
  );
  const outboundBuffer = outboundSend.indexOf('Buffer.from(String(mediaBase64), "base64")');
  const outboundGuard = outboundSend.indexOf("assertMediaSizeWithinLimit");
  assert.ok(outboundGuard >= 0 && outboundGuard < outboundBuffer);
});

test("WA-JS blob size is checked before blobToBase64", () => {
  const source = extract(
    gateway,
    "async function downloadMessageMediaPayload",
    "async function persistWhatsApp2MediaUnlocked",
  );
  const sizeGuard = source.indexOf("blob.size");
  const conversion = source.indexOf("blobToBase64");
  assert.ok(sizeGuard >= 0 && conversion > sizeGuard);
  assert.match(source.slice(sizeGuard, conversion), /maxBytes/);
});

test("unsafe filenames cannot escape a storage/download filename boundary", () => {
  assert.equal(
    security.sanitizeAttachmentFilename("../../../../Windows/System32/evil.pdf"),
    "evil.pdf",
  );
  assert.equal(
    security.sanitizeAttachmentFilename("..\\..\\segredo.docx"),
    "segredo.docx",
  );
  const headerLikeName = security.sanitizeAttachmentFilename(
    "relatorio\r\nContent-Type: text/html.pdf",
  );
  assert.doesNotMatch(headerLikeName, /[\r\n\\/:]/);
  assert.ok(headerLikeName.endsWith(".pdf"));
  assert.equal(security.sanitizeAttachmentFilename("CON"), "_CON");
  const longName = security.sanitizeAttachmentFilename("x".repeat(400) + ".pdf");
  assert.ok(longName.length <= 180);
  assert.ok(longName.endsWith(".pdf"));
});

test("strong byte signatures override spoofed provider MIME", () => {
  const pdf = Buffer.from("%PDF-1.7\nbody", "ascii");
  assert.equal(
    security.resolveTrustedMimeType("image/jpeg", pdf, "foto.jpg"),
    "application/pdf",
  );

  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]);
  assert.equal(
    security.resolveTrustedMimeType("image/jpeg", png, "imagem.jpg"),
    "image/png",
  );
});

test("OOXML keeps its specific MIME even though its container signature is ZIP", () => {
  const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const docxMime =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  assert.equal(
    security.resolveTrustedMimeType(docxMime, zipHeader, "contrato.docx"),
    docxMime,
  );
  assert.equal(
    security.resolveTrustedMimeType("application/octet-stream", zipHeader, "contrato.docx"),
    docxMime,
  );
});

test("HTTP media download rejects oversized Content-Length before reading the body", async () => {
  await withServer((req, res) => {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": "4096",
    });
    res.end(Buffer.alloc(4096));
  }, async (baseUrl) => {
    await assert.rejects(
      security.downloadHttpMediaBounded(`${baseUrl}/large.bin`, {
        maxBytes: 1024,
        timeoutMs: 1000,
      }),
      /whatsapp2_media_too_large/,
    );
  });
});

test("HTTP media download enforces a streaming byte cap without Content-Length", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.write(Buffer.alloc(700));
    res.end(Buffer.alloc(700));
  }, async (baseUrl) => {
    await assert.rejects(
      security.downloadHttpMediaBounded(`${baseUrl}/stream.bin`, {
        maxBytes: 1024,
        timeoutMs: 1000,
      }),
      /whatsapp2_media_too_large/,
    );
  });
});

test("HTTP media download has an abort timeout", async () => {
  await withServer((req, res) => {
    const timer = setTimeout(() => {
      if (!res.destroyed) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("late");
      }
    }, 250);
    res.on("close", () => clearTimeout(timer));
  }, async (baseUrl) => {
    await assert.rejects(
      security.downloadHttpMediaBounded(`${baseUrl}/slow.txt`, {
        maxBytes: 1024,
        timeoutMs: 40,
      }),
      /whatsapp2_media_url_timeout/,
    );
  });
});

test("HTTP media MIME is derived from bytes when server header is spoofed", async () => {
  await withServer((req, res) => {
    const pdf = Buffer.from("%PDF-1.4\nfixture", "ascii");
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": String(pdf.length),
    });
    res.end(pdf);
  }, async (baseUrl) => {
    const result = await security.downloadHttpMediaBounded(`${baseUrl}/fake.jpg`, {
      maxBytes: 1024,
      timeoutMs: 1000,
      fileName: "fake.jpg",
    });
    assert.equal(result.reportedMime, "image/jpeg");
    assert.equal(result.contentType, "application/pdf");
  });
});

test("Office parser rejects high-ratio compressed XML before expansion", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document><w:body><w:p><w:r><w:t>${"A".repeat(700_000)}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const result = await office.extractOfficeDocument(
    buffer,
    {
      fileName: "bomb.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );
  assert.equal(result.textExtraction.status, "error");
  assert.match(
    result.textExtraction.errorCode || "",
    /compression_ratio_too_high|total_uncompressed_too_large/,
  );
});

test("Office parser rejects ZIP path traversal metadata", async () => {
  const zip = new JSZip();
  zip.file(
    "../word/document.xml",
    "<w:document><w:body><w:p><w:r><w:t>unsafe</w:t></w:r></w:p></w:body></w:document>",
  );
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const result = await office.extractOfficeDocument(
    buffer,
    {
      fileName: "unsafe.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );
  assert.equal(result.textExtraction.status, "error");
  assert.match(result.textExtraction.errorCode || "", /unsafe_path/);
});

test("Office ZIP limits are globally bounded, not only per entry", () => {
  assert.ok(
    office.DOCUMENT_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES <= 128 * 1024 * 1024,
  );
  assert.ok(office.DOCUMENT_ZIP_MAX_COMPRESSION_RATIO <= 1000);
  const officeSource = fs.readFileSync(
    path.join(gatewayRoot, "office-document.cjs"),
    "utf8",
  );
  assert.match(officeSource, /totalUncompressed/);
  assert.match(officeSource, /DOCUMENT_ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES/);
  assert.match(officeSource, /DOCUMENT_ZIP_MAX_COMPRESSION_RATIO/);
  assert.match(officeSource, /processEntities:\s*false/);
});

test("inbound pool refills individual free slots instead of waiting on Promise.all batches", () => {
  const source = extract(
    gateway,
    "async function processInboundQueue",
    "function startInboundWorker",
  );
  assert.match(source, /inboundJobsInFlight/);
  assert.match(source, /availableSlots/);
  assert.match(source, /p_limit:\s*availableSlots/);
  assert.match(source, /setImmediate\(\(\) => void processInboundQueue\(\)\)/);
  assert.doesNotMatch(source, /await Promise\.all\(\(jobs/);
});

test("heavy media remains single-flight while text jobs can use independent inbound slots", () => {
  assert.match(gateway, /const WHATSAPP2_MEDIA_CONCURRENCY = 1/);
  assert.match(gateway, /const WHATSAPP2_INBOUND_CONCURRENCY = 3/);
  assert.match(gateway, /runWithHeavyMediaSlot/);
  assert.match(gateway, /inboundJobsInFlight/);
});

test("media failures stay isolated behind retry/backoff and do not crash the worker", () => {
  const source = extract(
    gateway,
    "async function processInboundQueue",
    "function startInboundWorker",
  );
  assert.match(source, /try\s*\{[\s\S]*processWhatsApp2InboundJob/);
  assert.match(source, /reschedule_whatsapp2_inbound_job/);
  assert.match(source, /backoffSeconds/);
  assert.match(source, /finally\s*\{[\s\S]*inboundJobsInFlight/);
});

test("download timeouts do not immediately fall through to a second heavy download", () => {
  const source = extract(
    gateway,
    "async function downloadMessageMediaPayload",
    "async function persistWhatsApp2MediaUnlocked",
  );
  assert.match(source, /whatsapp2_media_\(\?:download\|base64\)_timeout|download\|base64/);
  assert.match(source, /throw error/);
});

test("gateway maps size and timeout failures to explicit HTTP statuses", () => {
  assert.match(gateway, /WHATSAPP2_MEDIA_TOO_LARGE/);
  assert.match(gateway, /\? 413/);
  assert.match(gateway, /\? 504/);
});
