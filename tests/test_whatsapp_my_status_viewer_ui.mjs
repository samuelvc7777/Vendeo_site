import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("src/presentation/components/chat/WhatsAppMyStatusViewer.tsx", "utf8");
const css = fs.readFileSync("src/presentation/components/chat/WhatsAppMyStatusViewer.module.css", "utf8");

test("visualizador em tela cheia com progresso sequencial, sem player nativo", () => {
  assert.match(viewer, /createPortal\(/);
  assert.match(css, /\.root\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/);
  assert.match(css, /height:\s*100dvh;/);
  assert.match(viewer, /className=\{styles\.segments\}/);
  assert.match(viewer, /PHOTO_DURATION_MS = 6500/);
  assert.match(viewer, /onTimeUpdate=/);
  assert.match(viewer, /onEnded=\{next\}/);
  assert.doesNotMatch(viewer, /<video[\s\S]{0,180}\bcontrols\b/);
});
test("mantem origem das publicacoes e fluxo de publicar / atualizar", () => {
  assert.match(viewer, /getWhatsApp2ActiveStatuses\(/);
  assert.match(viewer, /getWhatsApp2MediaUrl\(selected\.id\)/);
  assert.match(viewer, /getWhatsApp2StatusViews\(selected\.id\)/);
  assert.match(viewer, /onClick=\{onPublish\}/);
  assert.match(viewer, /void refresh\(\)/);
  assert.match(viewer, /onClick=\{onClose\}/);
});
test("gaveta de viewers preserva zero real e indisponibilidade como distintos", () => {
  assert.match(viewer, /sheetOpen/);
  assert.match(viewer, /setSheetOpen\(true\)/);
  assert.match(viewer, /views\?\.available && views\.count !== null/);
  assert.match(viewer, /views\.viewers\.map\(/);
  assert.match(viewer, /Nenhuma visualização confirmada/);
  assert.match(viewer, /Visualizações indisponíveis/);
  assert.doesNotMatch(viewer, /views\?\.count\s*\|\|\s*0/);
});
test("navegacao por toque, teclado e fechamento acessivel", () => {
  assert.match(viewer, /onTouchStart=/);
  assert.match(viewer, /onTouchEnd=\{onTouchEnd\}/);
  assert.match(viewer, /event\.key === "Escape"/);
  assert.match(viewer, /event\.key === "ArrowRight"/);
  assert.match(viewer, /aria-label="Abrir visualizações do status"/);
});
