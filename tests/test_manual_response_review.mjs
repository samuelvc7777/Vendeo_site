import test from "node:test";
import assert from "node:assert/strict";
import { createPendingManualResponse, detectProtectedInboundIntent, detectUnsupportedUncertainty } from "../supabase/functions/api/manual_response_review.ts";

test("encaminha convites, pedidos de telefone/WhatsApp e mídia para revisão humana", () => {
  assert.equal(detectProtectedInboundIntent({ text: "bora sair comigo sábado?" })?.intent, "invitation");
  assert.equal(detectProtectedInboundIntent({ text: "vamos tomar um café qualquer dia" })?.intent, "invitation");
  assert.equal(detectProtectedInboundIntent({ text: "topa jantar comigo?" })?.intent, "invitation");
  assert.equal(detectProtectedInboundIntent({ text: "te convido pra jantar sexta" })?.intent, "invitation");
  assert.equal(detectProtectedInboundIntent({ text: "eu disse que pelo jeito da sua conversa você é pra casar" }), null);
  assert.equal(detectProtectedInboundIntent({ text: "me passa seu número de telefone" })?.intent, "phone_contact_request");
  assert.equal(detectProtectedInboundIntent({ text: "posso pegar seu telefone?" })?.intent, "phone_contact_request");
  assert.equal(detectProtectedInboundIntent({ text: "qual seu WhatsApp?" })?.intent, "phone_contact_request");
  assert.equal(detectProtectedInboundIntent({ text: "me chama no zap" })?.intent, "phone_contact_request");
  assert.equal(detectProtectedInboundIntent({ mediaType: "image", text: "[image:https://example.test/foto.jpg]" })?.intent, "photo_or_attachment");
  assert.equal(detectProtectedInboundIntent({ text: "oi, tudo bem?" }), null);
  assert.equal(detectProtectedInboundIntent({ text: "uso WhatsApp para falar com minha mãe" }), null);
});

test("identifica respostas que dizem não saber e devem aguardar revisão humana", () => {
  assert.equal(detectUnsupportedUncertainty("não sei se conheço BH tão bem assim kkk"), true);
  assert.equal(detectUnsupportedUncertainty("não faço ideia de onde fica"), true);
  assert.equal(detectUnsupportedUncertainty("não lembro se já fui"), true);
});

test("não escala respostas factuais e conversacionais", () => {
  assert.equal(detectUnsupportedUncertainty("sim, já fui pra BH algumas vezes"), false);
  assert.equal(detectUnsupportedUncertainty("eu gosto de jogar bola"), false);
  assert.equal(detectUnsupportedUncertainty(""), false);
});

test("prepara uma revisão com a mensagem recebida e mantém a razão objetiva", () => {
  const pending = createPendingManualResponse({
    inboundMessages: ["  oi  ", "  vc já foi pra BH?  "],
    inboundMessageIds: ["m-1", "m-2"],
    reason: "Falta confirmar se já foi.",
    now: new Date("2026-09-25T18:00:00.000Z"),
  });

  assert.deepEqual(pending, {
    inboundMessage: "vc já foi pra BH?",
    inboundMessages: ["oi", "vc já foi pra BH?"],
    inboundMessageIds: ["m-1", "m-2"],
    reason: "Falta confirmar se já foi.",
    createdAt: "2026-09-25T18:00:00.000Z",
  });
});

test("a frase do Leandro não aciona sozinha uma revisão humana", () => {
  const message = "Mais moro aqui no asfalto sabe";
  assert.equal(detectProtectedInboundIntent({ text: message }), null);
  assert.equal(detectUnsupportedUncertainty(message), false);
});

test("guarda a resposta retida e a origem para explicar a revisão", () => {
  const pending = createPendingManualResponse({
    inboundMessages: ["vc já foi pra BH?"],
    inboundMessageIds: ["m-3"],
    reason: "A resposta gerada contém incerteza factual.",
    source: "uncertain_response",
    candidateResponse: "não sei se já fui",
    now: new Date("2026-09-25T18:01:00Z"),
  });

  assert.equal(pending.source, "uncertain_response");
  assert.equal(pending.candidateResponse, "não sei se já fui");
});
