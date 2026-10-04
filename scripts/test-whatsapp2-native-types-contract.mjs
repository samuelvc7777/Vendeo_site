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
const nativeUi = fs.readFileSync(
  path.join(root, "src", "presentation", "components", "chat", "WhatsAppNativeMessage.tsx"),
  "utf8",
);
const brain = fs.readFileSync(
  path.join(root, "supabase", "functions", "api", "brain_orchestrator.ts"),
  "utf8",
);
const nativeMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20261003200236_whatsapp2_native_message_metadata.sql"),
  "utf8",
);

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const nativeHelpers = new Function(
  "sanitizeAttachmentFilename",
  `${extract(gateway, "const WHATSAPP2_INTERNAL_MESSAGE_TYPES", "function mediaPreview")}
return {
  isInternalWhatsApp2Message,
  mediaKindForMessage,
  buildWhatsApp2Attachment,
  buildWhatsApp2MessageMetadata,
  nativeMessagePreview,
};`,
)(sanitizeAttachmentFilename);

test("single vCard is parsed into compact contact metadata", () => {
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "vcard",
    isForwarded: false,
    forwardingScore: 0,
    vCards: [
      "BEGIN:VCARD\nVERSION:3.0\nFN:Maria da Silva\nTEL;TYPE=CELL:+55 32 99999-1111\nEMAIL:maria@example.com\nORG:Vendeo\nEND:VCARD",
    ],
    _data: {},
  });

  assert.equal(metadata.nativeKind, "contact");
  assert.equal(metadata.contacts.length, 1);
  assert.equal(metadata.contacts[0].name, "Maria da Silva");
  assert.deepEqual(metadata.contacts[0].phones, ["+55 32 99999-1111"]);
  assert.deepEqual(metadata.contacts[0].emails, ["maria@example.com"]);
  assert.equal(metadata.contacts[0].organization, "Vendeo");
  assert.match(nativeHelpers.nativeMessagePreview(metadata), /Maria da Silva/);
});

test("multiple vCards stay bounded and get a human preview", () => {
  const cards = Array.from({ length: 25 }, (_, index) =>
    `BEGIN:VCARD\nFN:Contato ${index + 1}\nTEL:+55329999${String(index).padStart(4, "0")}\nEND:VCARD`
  );
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "multi_vcard",
    vCards: cards,
    _data: {},
  });
  assert.equal(metadata.nativeKind, "contact");
  assert.equal(metadata.contacts.length, 20);
  assert.match(nativeHelpers.nativeMessagePreview(metadata), /20 contatos/);
});

test("location preserves coordinates, address and live-location metadata", () => {
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "location",
    location: {
      latitude: -21.135,
      longitude: -44.261,
      name: "Praça",
      address: "Centro",
      url: "https://maps.example.test/place",
    },
    _data: { isLive: true, shareDuration: 900 },
  });
  assert.equal(metadata.nativeKind, "location");
  assert.equal(metadata.location.latitude, -21.135);
  assert.equal(metadata.location.longitude, -44.261);
  assert.equal(metadata.location.name, "Praça");
  assert.equal(metadata.location.address, "Centro");
  assert.equal(metadata.location.isLive, true);
  assert.equal(metadata.location.shareDuration, 900);
});

test("poll creation preserves question, options and multiple-answer flag", () => {
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "poll_creation",
    pollName: "Qual número?",
    pollOptions: [
      { name: "10", localId: 0 },
      { name: "20", localId: 1 },
    ],
    allowMultipleAnswers: true,
    pollInvalidated: false,
    _data: {},
  });
  assert.equal(metadata.nativeKind, "poll");
  assert.equal(metadata.poll.question, "Qual número?");
  assert.deepEqual(metadata.poll.options, [
    { id: 0, name: "10" },
    { id: 1, name: "20" },
  ]);
  assert.equal(metadata.poll.allowMultipleAnswers, true);
});

test("forwarding metadata survives even on ordinary text", () => {
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "chat",
    isForwarded: true,
    forwardingScore: 7,
    links: [],
    _data: {},
  });
  assert.equal(metadata.nativeKind, null);
  assert.equal(metadata.isForwarded, true);
  assert.equal(metadata.forwardingScore, 7);
});

test("link metadata is bounded and represented separately from text", () => {
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "chat",
    links: [{ link: "https://example.com/path", isSuspicious: false }],
    _data: {
      title: "Exemplo",
      description: "Descrição curta",
      canonicalUrl: "https://example.com/path",
    },
  });
  assert.equal(metadata.nativeKind, "link");
  assert.equal(metadata.links[0].url, "https://example.com/path");
  assert.equal(metadata.linkPreview.title, "Exemplo");
  assert.equal(metadata.linkPreview.description, "Descrição curta");
});

test("album, call log and interactive response have explicit native kinds", () => {
  assert.equal(
    nativeHelpers.buildWhatsApp2MessageMetadata({
      type: "album",
      _data: { expectedImageCount: 3 },
    }).nativeKind,
    "album",
  );
  assert.equal(
    nativeHelpers.buildWhatsApp2MessageMetadata({
      type: "call_log",
      body: "Chamada perdida",
      _data: {},
    }).nativeKind,
    "call",
  );
  const interactive = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "buttons_response",
    selectedButtonId: "confirmar",
    _data: {},
  });
  assert.equal(interactive.nativeKind, "interactive");
  assert.equal(interactive.interactive.selectedButtonId, "confirmar");
});

test("GIF and animated sticker keep their native media traits", () => {
  const gif = nativeHelpers.buildWhatsApp2Attachment({
    type: "video",
    hasMedia: true,
    isGif: true,
    body: "",
    _data: {},
  });
  assert.equal(gif.kind, "video");
  assert.equal(gif.isGif, true);

  const sticker = nativeHelpers.buildWhatsApp2Attachment({
    type: "sticker",
    hasMedia: true,
    isAnimated: true,
    body: "",
    _data: {},
  });
  assert.equal(sticker.kind, "sticker");
  assert.equal(sticker.isAnimated, true);
});

test("unknown non-media native types get a future-proof fallback instead of plain Mensagem", () => {
  const metadata = nativeHelpers.buildWhatsApp2MessageMetadata({
    type: "scheduled_event_creation",
    hasMedia: false,
    body: "",
    _data: {},
  });
  assert.equal(metadata.nativeKind, "unsupported");
  assert.equal(metadata.providerType, "scheduled_event_creation");
  assert.match(nativeHelpers.nativeMessagePreview(metadata), /scheduled_event_creation/);
});

test("internal protocol notifications are still excluded from human inbound flow", () => {
  for (const type of [
    "notification_template",
    "e2e_notification",
    "protocol",
    "ciphertext",
    "debug",
    "notification",
  ]) {
    assert.equal(nativeHelpers.isInternalWhatsApp2Message({ type }), true, type);
  }
});

test("native metadata is durable and poll votes have an atomic persistence path", () => {
  assert.match(nativeMigration, /add column if not exists message_metadata jsonb/i);
  assert.match(nativeMigration, /p_message_metadata jsonb/i);
  assert.match(nativeMigration, /apply_whatsapp2_poll_vote_atomic/i);
  assert.match(nativeMigration, /votesByVoter/i);
  assert.match(nativeMigration, /grant execute[\s\S]*service_role/i);
  assert.match(nativeMigration, /from public, anon, authenticated/i);
});

test("gateway keeps reaction/revoke/reply and adds poll-vote event without making a new message", () => {
  assert.match(gateway, /next\.on\("message_reaction"/);
  assert.match(gateway, /next\.on\("message_revoke_everyone"/);
  assert.match(gateway, /next\.on\("vote_update"/);
  assert.match(gateway, /resolveQuotedMessageId/);
  assert.match(gateway, /apply_instagram_message_reaction_atomic/);
  assert.match(gateway, /apply_whatsapp2_poll_vote_atomic/);
});

test("frontend renders native cards, forwarded labels, GIF semantics and live poll updates", () => {
  assert.match(frontend, /WhatsAppNativeMessage/);
  assert.match(frontend, /WhatsAppForwardedLabel/);
  assert.match(frontend, /event\.type === "vote_update"/);
  assert.match(frontend, /controls=!\{?msg\.attachment\?\.isGif|controls=\{!msg\.attachment\?\.isGif\}/);
  assert.match(frontend, /autoPlay=\{Boolean\(msg\.attachment\?\.isGif\)\}/);
  assert.match(nativeUi, /Cartão de contato/);
  assert.match(nativeUi, /Abrir no mapa/);
  assert.match(nativeUi, /Enquete/);
  assert.match(nativeUi, /Abrir link/);
  assert.match(nativeUi, /Tipo ainda não suportado/);
});

test("Brain reads native message metadata and creates compact contexts instead of raw JSON", () => {
  assert.match(brain, /message_metadata/);
  assert.match(brain, /\[contato recebido\]/);
  assert.match(brain, /\[localização recebida\]/);
  assert.match(brain, /\[enquete recebida\]/);
  assert.match(brain, /\[mensagem encaminhada/);
  assert.match(brain, /\[figurinha recebida\]/);
  assert.match(brain, /\[GIF recebido/);
  assert.match(brain, /mensagem nativa do WhatsApp ainda não suportada/);
  assert.match(brain, /nativeMetadata: rawNativeMetadata/);
});
