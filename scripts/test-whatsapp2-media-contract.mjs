import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(import.meta.url);
const { sanitizeAttachmentFilename } = require(
  path.join(root, "services", "whatsapp2-gateway", "media-security.cjs"),
);
const gateway = fs.readFileSync(
  path.join(root, "services", "whatsapp2-gateway", "index.cjs"),
  "utf8",
);
const frontend = fs.readFileSync(
  path.join(root, "src", "presentation", "components", "chat", "InstagramDirect.tsx"),
  "utf8",
);
const wa2Client = fs.readFileSync(
  path.join(root, "src", "presentation", "components", "chat", "whatsapp2-client.ts"),
  "utf8",
);
const brain = fs.readFileSync(
  path.join(root, "supabase", "functions", "api", "brain_orchestrator.ts"),
  "utf8",
);
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(here, "fixtures", "whatsapp2-media-contract-fixtures.json"),
    "utf8",
  ),
);
const migrationsDir = path.join(root, "supabase", "migrations");
const migrationSources = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
  .join("\n");

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source end marker: ${endMarker}`);
  return source.slice(start, end);
}

const serializeMessage = new Function(
  "sanitizeAttachmentFilename",
  `${extract(gateway, "function mediaKindForMessage", "function mediaPreview")}
${extract(gateway, "function serializeMessage", "function normalizeChatId")}
return serializeMessage;`,
)(sanitizeAttachmentFilename);
const mediaKindForMessage = new Function(
  `${extract(gateway, "function mediaKindForMessage", "function mediaPreview")}\nreturn mediaKindForMessage;`,
)();
const mimeExtension = new Function(
  `${extract(gateway, "function mimeExtension", "function mediaKindForMessage")}\nreturn mimeExtension;`,
)();
const resolveQuotedMessageId = new Function(
  `${extract(gateway, "async function resolveQuotedMessageId", "async function transcribeStoredAudio")}\nreturn resolveQuotedMessageId;`,
)();

function fixture(name) {
  const value = fixtures.providerFixtures.find((item) => item.name === name);
  assert.ok(value, `missing provider fixture ${name}`);
  return value;
}

function readAny(object, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  return undefined;
}

test("fixture catalog covers native media plus all requested edge cases", () => {
  const names = new Set(fixtures.providerFixtures.map((item) => item.name));
  for (const required of [
    "text", "jpeg", "png", "video", "audio", "ptt", "pdf", "docx", "xlsx",
    "pptx", "txt", "csv", "zip", "gif", "sticker", "animated-sticker",
    "vcard", "multi-vcard", "location", "live-location", "link", "album",
    "poll", "revoked", "unknown-media",
  ]) {
    assert.ok(names.has(required), `missing provider fixture: ${required}`);
  }

  const edgeNames = new Set(fixtures.edgeCases.map((item) => item.name));
  for (const required of [
    "missing-mime", "wrong-mime", "no-extension", "extension-mismatch",
    "special-filename", "very-large", "expired-download", "unavailable-media",
    "duplicate-message", "duplicate-message-again", "empty-media-data",
    "document-without-caption",
  ]) {
    assert.ok(edgeNames.has(required), `missing edge fixture: ${required}`);
  }
});

test("current core media classifier still recognizes audio/image/video/sticker", () => {
  assert.equal(mediaKindForMessage({ type: "audio" }), "audio");
  assert.equal(mediaKindForMessage({ type: "ptt" }), "audio");
  assert.equal(mediaKindForMessage({ type: "image" }), "image");
  assert.equal(mediaKindForMessage({ type: "video" }), "video");
  assert.equal(mediaKindForMessage({ type: "sticker" }), "sticker");
});

test("document family is classified as a durable attachment", () => {
  for (const name of ["pdf", "docx", "xlsx", "pptx", "txt", "csv", "zip"]) {
    const kind = mediaKindForMessage(fixture(name));
    assert.ok(
      kind === "document" || kind === "file",
      `${name} must classify as document/file, got ${String(kind)}`,
    );
  }
});

test("unknown media becomes a generic unsupported attachment instead of disappearing", () => {
  const item = fixture("unknown-media");
  const kind = mediaKindForMessage(item);
  assert.ok(
    ["unsupported", "document", "file"].includes(kind),
    `unknown media must have generic attachment kind, got ${String(kind)}`,
  );
});

test("document edge cases stay classifiable despite missing/wrong MIME or filename quirks", () => {
  for (const item of fixtures.edgeCases.filter((edge) =>
    [
      "missing-mime",
      "wrong-mime",
      "no-extension",
      "extension-mismatch",
      "special-filename",
      "empty-media-data",
      "document-without-caption",
    ].includes(edge.name)
  )) {
    const kind = mediaKindForMessage(item);
    assert.ok(
      kind === "document" || kind === "file",
      `${item.name} must remain a durable document/file attachment, got ${String(kind)}`,
    );
  }
});

test("provider serializer preserves attachment metadata needed downstream", () => {
  const item = fixture("pdf");
  const serialized = serializeMessage({
    id: { _serialized: "fixture-pdf-1" },
    from: "contact@lid",
    to: "me@lid",
    body: item.body,
    type: item.type,
    timestamp: 1234567890,
    fromMe: false,
    hasMedia: true,
    hasQuotedMsg: false,
    ack: 0,
    mimetype: item.mimetype,
    filename: item.filename,
    size: item.size,
    caption: item.caption,
    pageCount: item.pageCount,
    isGif: false,
    isAnimated: false,
    isViewOnce: false,
  });

  assert.ok(serialized.attachment);
  assert.equal(serialized.attachment.mimeType, item.mimetype);
  assert.equal(serialized.attachment.fileName, item.filename);
  assert.equal(serialized.attachment.fileSize, item.size);
  assert.equal(serialized.attachment.caption, null);
  assert.equal(serialized.attachment.pageCount, item.pageCount);
  assert.equal(serialized.attachment.providerType, "document");
  assert.equal(serialized.attachment.kind, "document");
});

test("quoted message id resolution survives provider objects", async () => {
  const value = await resolveQuotedMessageId({
    hasQuotedMsg: true,
    async getQuotedMessage() {
      return { id: { _serialized: "quoted-provider-id" } };
    },
  });
  assert.equal(value, "quoted-provider-id");
});

test("generic media downloader uses WA-JS and falls back to whatsapp-web.js", () => {
  const source = extract(
    gateway,
    "async function downloadMessageMediaPayload",
    "async function persistWhatsApp2MediaUnlocked",
  );
  assert.match(source, /WPP\.chat\.downloadMedia\(id\)/);
  assert.match(source, /message\.downloadMedia\(\)/);
  assert.match(source, /application\/octet-stream/);
  assert.match(source, /if \(!media\?\.data\) throw new Error\("Mídia indisponível"\)/);
});

test("MIME-to-extension mapping covers documents instead of degrading them to .bin", () => {
  const cases = [
    ["application/pdf", "pdf"],
    ["text/plain", "txt"],
    ["text/csv", "csv"],
    ["application/zip", "zip"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ];
  for (const [mime, expected] of cases) {
    assert.equal(mimeExtension(mime, "bin"), expected, `${mime} should map to .${expected}`);
  }
});

test("durable inbound queue remains idempotent by provider message id", () => {
  assert.match(migrationSources, /message_id text primary key/i);
  assert.match(migrationSources, /on conflict \(message_id\) do nothing/i);
});

test("durable queue accepts document/generic attachment media types", () => {
  const universalMigration = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith("whatsapp2_universal_attachment_contract.sql"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");

  assert.match(universalMigration, /drop constraint if exists whatsapp2_inbound_jobs_media_type_check/i);
  assert.match(universalMigration, /'document'/i);
  assert.match(universalMigration, /'file'/i);
  assert.match(universalMigration, /'unsupported'/i);
});

test("durable schema preserves raw provider type and attachment metadata", () => {
  assert.match(
    migrationSources,
    /provider_type|raw_provider_type|attachment_metadata|media_metadata/i,
    "schema must preserve the raw provider type or attachment metadata",
  );
  assert.match(
    migrationSources,
    /mime_type|mimetype|attachment_metadata|media_metadata/i,
    "schema must preserve MIME",
  );
  assert.match(
    migrationSources,
    /file_name|filename|attachment_metadata|media_metadata/i,
    "schema must preserve filename",
  );
  assert.match(
    migrationSources,
    /file_size|media_size|attachment_metadata|media_metadata/i,
    "schema must preserve file size",
  );
});

test("internal WhatsApp protocol notifications are not admitted as human messages", () => {
  const admission = extract(
    gateway,
    "async function enqueueWhatsApp2Inbound",
    "async function syncWhatsApp2Message",
  );
  assert.match(admission, /isInternalWhatsApp2Message\(message\)/);

  const classifier = extract(
    gateway,
    "const WHATSAPP2_INTERNAL_MESSAGE_TYPES",
    "function mediaKindForMessage",
  );
  for (const internalType of [
    "notification_template",
    "e2e_notification",
    "protocol",
    "ciphertext",
    "debug",
    "notification",
  ]) {
    assert.match(classifier, new RegExp(internalType, "i"));
  }
});

test("frontend DirectMessage contract includes document/generic attachments", () => {
  assert.match(
    frontend,
    /mediaType\?[^\n]*(?:document|file|unsupported)/i,
    "DirectMessage mediaType must include document/file/unsupported",
  );
});

test("WhatsApp 2 gateway client exposes MIME, filename and file size metadata", () => {
  assert.match(wa2Client, /mimeType|mimetype/i, "gateway client message needs MIME metadata");
  assert.match(wa2Client, /fileName|filename/i, "gateway client message needs filename metadata");
  assert.match(wa2Client, /fileSize|\bsize\b/i, "gateway client message needs file size metadata");
});

test("WhatsApp 2 mapper exposes downloadable document media", () => {
  const source = extract(
    frontend,
    "function mapWhatsApp2Message",
    "const avatarRefreshRequests",
  );
  assert.match(source, /document|file/i);
  assert.match(source, /getWhatsApp2MediaUrl\(messageId\)/);
  assert.match(source, /message\.type === "document"/i);
  assert.match(source, /message\.hasMedia/);
  assert.match(source, /mediaUrl:/);
  assert.match(source, /downloadable:/);
});

function currentMessageRenderRegion() {
  const renderStart = frontend.indexOf("/* 1. Mídia do tipo Áudio");
  const renderEnd = frontend.indexOf("/* Horário da Mensagem", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  return frontend.slice(renderStart, renderEnd);
}

test("frontend has a dedicated document card with open/download action", () => {
  const renderRegion = currentMessageRenderRegion();
  assert.match(renderRegion, /document|file/i, "document renderer is missing");
  assert.match(renderRegion, /download|Baixar|Abrir/i, "document open/download action is missing");
});

test("frontend has a generic attachment fallback for unsupported media", () => {
  const renderRegion = currentMessageRenderRegion();
  assert.match(renderRegion, /unsupported|arquivo|attachment/i, "generic attachment fallback is missing");
});

test("Brain already has a canonical file type with media URL", () => {
  const source = extract(
    brain,
    "export function normalizeToCanonicalMessage",
    "export interface BuildContextParams",
  );
  assert.match(source, /"file"/);
  assert.match(source, /mediaUrl:/);
});

test("Brain canonicalizer recognizes WhatsApp document values without losing them as text", () => {
  const source = extract(
    brain,
    "export function normalizeToCanonicalMessage",
    "export interface BuildContextParams",
  );
  assert.match(
    source,
    /raw\.media_type === "document"|raw\.mediaType === "document"|raw\.type === "document"/,
    "provider document must normalize to canonical file/document",
  );
});

test("large attachment path has an explicit byte limit before base64 is converted to Buffer", () => {
  const source = extract(
    gateway,
    "async function downloadMessageMediaPayload",
    "async function persistWhatsApp2MediaUnlocked",
  );
  const bufferIndex = source.indexOf('Buffer.from(base64, "base64")');
  assert.ok(bufferIndex >= 0, "expected current base64 Buffer conversion");
  const beforeBuffer = source.slice(0, bufferIndex);
  assert.match(
    beforeBuffer,
    /MAX_[A-Z0-9_]*(?:MEDIA|FILE|ATTACHMENT)[A-Z0-9_]*_BYTES|size\s*>|content-length/i,
    "a size guard must run before decoding the entire attachment",
  );
});

test("download/unavailable-media failures stay bounded instead of crashing the queue", () => {
  const queueSource = extract(
    gateway,
    "async function processInboundQueue",
    "function startInboundWorker",
  );
  assert.match(queueSource, /try\s*\{[\s\S]*processWhatsApp2InboundJob/);
  assert.match(queueSource, /reschedule_whatsapp2_inbound_job/);
  assert.match(queueSource, /backoffSeconds/);
});

test("empty or future media cannot silently become the plain preview 'Mensagem'", () => {
  const admission = extract(
    gateway,
    "async function enqueueWhatsApp2Inbound",
    "async function syncWhatsApp2Message",
  );
  assert.match(
    admission,
    /unsupported|provider_type|raw_provider_type|attachment/i,
    "unknown media must retain a generic attachment identity",
  );
  assert.doesNotMatch(
    admission,
    /const preview = kind \? mediaPreview\(kind\) : \(text \|\| "Mensagem"\)/,
    "unknown media currently collapses to plain 'Mensagem'",
  );
});
