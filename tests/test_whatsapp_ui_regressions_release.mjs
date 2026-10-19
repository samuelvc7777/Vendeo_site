import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const inbox=fs.readFileSync("src/presentation/components/chat/InstagramDirect.tsx","utf8");
const brain=fs.readFileSync("src/presentation/components/chat/BrainPrivateChat.tsx","utf8");
const viewer=fs.readFileSync("src/presentation/components/chat/WhatsAppMyStatusViewer.tsx","utf8");
const client=fs.readFileSync("src/presentation/components/chat/whatsapp2-client.ts","utf8");
const profile=fs.readFileSync("src/presentation/components/chat/WhatsAppContactInfo.tsx","utf8");

test("Brain: botão e painel privado dentro da conversa preservados",()=>{
 assert.match(inbox,/import \{ BrainPrivateChat \} from "\.\/BrainPrivateChat"/);
 assert.match(inbox,/onClick=\{\(\) => setPrivateBrainChatConversationId\(activeChat\.id\)\}/);
 assert.match(inbox,/aria-label="Conversar com Brian sobre este cliente"/);
 assert.match(inbox,/<BrainPrivateChat[\s\S]*visibleMessages=/);
 assert.match(inbox,/setPrivateBrainChatConversationId\(null\)/);
 assert.match(brain,/brainOperatorFetch\("\/operator\/brain\/private-chat"/);
 assert.match(brain,/Chat privado/);
 assert.match(brain,/cliente n\u00e3o v\u00ea/);
});

test("Meu Status mostra publica\u00e7\u00f5es e visualiza\u00e7\u00f5es mantendo bot\u00e3o publicar",()=>{
 assert.match(inbox,/aria-label="Ver meus Status publicados e quem visualizou"/);
 assert.match(inbox,/aria-label="Publicar novo Status"/);
 assert.match(inbox,/<WhatsAppMyStatusViewer[\s\S]*open=\{isMyStatusViewerOpen\}/);
 assert.match(viewer,/createPortal\(/);
 assert.match(viewer,/document\.body/);
 assert.match(viewer,/getWhatsApp2StatusViews\((?:statusId|selected\.id)\)/);
 assert.match(client,/request\("\/status\/active"\)/);
});

test("opera\u00e7\u00f5es j\u00e1 publicadas n\u00e3o desaparecem no pr\u00f3ximo deploy",()=>{
 assert.match(inbox,/Reiniciar IA desta conversa/);
 assert.match(inbox,/whatsappFinalizedCount/);
 assert.match(inbox,/onContactSaved=/);
 assert.match(profile,/Salvar no WhatsApp/);
 assert.match(client,/\/chat\/contact\/save/);
});
