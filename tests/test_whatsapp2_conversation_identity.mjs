import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const moduleSource = fs.readFileSync(
  new URL("../src/domain/entities/WhatsAppConversationIdentity.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpile(moduleSource, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
});
const runtimeModule = { exports: {} };
vm.runInNewContext(compiled, { module: runtimeModule, exports: runtimeModule.exports });
const {
  groupWhatsAppConversationRows,
  reconcileWhatsAppControlState,
} = runtimeModule.exports;

function assertControlState(actual, expected) {
  assert.equal(actual.archived, expected.archived);
  assert.equal(actual.isLocked, expected.isLocked);
  assert.equal(actual.status, expected.status);
}

test("agrupa um LID com o JID de telefone somente após resolução confirmada", () => {
  const groups = groupWhatsAppConversationRows(
    [
      { id: "wa2:5511999999999@c.us", providerId: "5511999999999@c.us" },
      { id: "wa2:opaque-contact@lid", providerId: "opaque-contact@lid" },
    ],
    [{ id: "wa2:5511999999999@c.us", contact_id: "5511999999999@c.us" }],
    new Map([["opaque-contact@lid", "+5511999999999"]]),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].gatewayRows.length, 2);
  assert.equal(groups[0].canonicalRows.length, 1);
});

test("não une IDs LID diferentes quando o WhatsApp não confirmou o telefone", () => {
  const groups = groupWhatsAppConversationRows(
    [
      { id: "wa2:first@lid", providerId: "first@lid" },
      { id: "wa2:second@lid", providerId: "second@lid" },
    ],
    [],
  );

  assert.equal(groups.length, 2);
});

test("não converte IDs de grupos em identidade telefônica", () => {
  const groups = groupWhatsAppConversationRows(
    [
      { id: "wa2:5511999999999@g.us", providerId: "5511999999999@g.us" },
      { id: "wa2:5511999999999@c.us", providerId: "5511999999999@c.us" },
    ],
    [],
  );

  assert.equal(groups.length, 2);
});

test("um falso do snapshot não apaga o estado arquivado/trancado canônico", () => {
  assertControlState(
    reconcileWhatsAppControlState(
      [{ archived: false, isLocked: false }],
      ["archived"],
      "active",
    ),
    { archived: true, isLocked: false, status: "archived" },
  );
  assertControlState(
    reconcileWhatsAppControlState(
      [{ archived: false, isLocked: false }],
      ["locked"],
      "active",
    ),
    { archived: false, isLocked: true, status: "locked" },
  );
});

test("trancada tem precedência sobre arquivada na mesma identidade", () => {
  assertControlState(
    reconcileWhatsAppControlState(
      [{ archived: true, isLocked: true }],
      ["archived"],
      "active",
    ),
    { archived: false, isLocked: true, status: "locked" },
  );
});
