import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("src/presentation/components/chat/WhatsAppMyStatusViewer.tsx", "utf8");
const avatar = fs.readFileSync("src/presentation/components/chat/WhatsAppStatusAvatar.tsx", "utf8");
const client = fs.readFileSync("src/presentation/components/chat/whatsapp2-client.ts", "utf8");
const css = fs.readFileSync("src/presentation/components/chat/WhatsAppMyStatusViewer.module.css", "utf8");

test("foto da Larissa é carregada da conta WhatsApp conectada, sem foto estática inventada", () => {
  assert.match(viewer, /getWhatsApp2Status\(\)/);
  assert.match(viewer, /status\.me\?\.wid/);
  assert.match(viewer, /wid=\{myWhatsAppWid\}/);
  assert.match(viewer, /label="Foto do perfil da Larissa"/);
  assert.match(viewer, /fallback=\{<UserRound size=\{22\} \/>}/);
});

test("cada pessoa que visualizou recebe a própria foto associada ao id retornado", () => {
  assert.match(viewer, /views\.viewers\.map\(\(person\) => \(/);
  assert.match(viewer, /wid=\{person\.id\}/);
  assert.match(viewer, /label=\{\`Foto de \$\{person\.name/);
  assert.match(viewer, /className=\{styles\.viewerAvatar\}/);
});

test("retrieval uses the existing WhatsApp profile route, not a new public endpoint", () => {
  assert.match(client, /export async function getWhatsApp2ProfilePhoto\(chatId: string\)/);
  assert.match(client, /\/chat\/profile\?chatId=\$\{encodeURIComponent\(chatId\)\}/);
  assert.match(avatar, /getWhatsApp2ProfilePhoto\(wid\)/);
  assert.match(avatar, /refreshWhatsApp2ProfilePhoto\(wid, rejected\)/);
});

test("avatares não travam a lista: lazy load, cache e concorrência limitada", () => {
  assert.match(avatar, /MAX_CONCURRENT_LOOKUPS = 4/);
  assert.match(avatar, /new IntersectionObserver\(/);
  assert.match(avatar, /rootMargin: "180px"/);
  assert.match(avatar, /const photos = new Map/);
  assert.match(avatar, /const inflight = new Map/);
  assert.match(avatar, /setUrl\(null\)/);
});

test("foto segura, fallback e render circular em ambas as superfícies", () => {
  assert.match(avatar, /parsed\.protocol === "https:"/);
  assert.match(avatar, /pps\.whatsapp\.net/);
  assert.match(avatar, /referrerPolicy="no-referrer"/);
  assert.match(avatar, /onError=\{onPhotoError\}/);
  assert.match(avatar, /: fallback/);
  assert.match(css, /\.avatar \{[^}]*overflow: hidden;/);
  assert.match(css, /\.viewerAvatar \{[^}]*overflow: hidden;/);
});
