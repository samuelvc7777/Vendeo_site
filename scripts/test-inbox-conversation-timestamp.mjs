import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const filePath = path.join(
  process.cwd(),
  "src/presentation/components/chat/InstagramDirect.tsx",
);
const source = fs.readFileSync(filePath, "utf8");
const sourceFile = ts.createSourceFile(
  filePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const rowClass = "flex items-center text-xs text-[#a8a8a8] mt-0.5 min-w-0";
let metadataRow;

function visit(node) {
  if (ts.isJsxElement(node)) {
    const classAttribute = node.openingElement.attributes.properties.find(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === "className" &&
        ts.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === rowClass,
    );
    if (classAttribute) metadataRow = node;
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);
assert.ok(metadataRow, "Não encontrei a linha de prévia/horário da conversa.");

let hasIndependentTimestamp = false;
function findIndependentActivityTimestamp(node) {
  if (ts.isJsxFragment(node)) {
    const directExpressions = node.children
      .filter(ts.isJsxExpression)
      .map((child) => child.expression)
      .filter(Boolean);
    const hasActivityBranch = node
      .getText(sourceFile)
      .includes("isAutoPilotWorking");
    const hasTimestamp = directExpressions.some((expression) =>
      expression.getText(sourceFile).includes("formatMessageTime"),
    );
    if (hasActivityBranch && hasTimestamp) hasIndependentTimestamp = true;
  }
  ts.forEachChild(node, findIndependentActivityTimestamp);
}

findIndependentActivityTimestamp(metadataRow);
assert.ok(
  hasIndependentTimestamp,
  "A linha oculta o horário quando o indicador do Piloto substitui a prévia.",
);

console.log("OK: a linha da conversa mantém o horário visível junto ao status do Piloto.");
