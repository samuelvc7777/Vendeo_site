import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(import.meta.url);
const {
  extractPdfDocument,
  buildPdfBrainContext,
} = require(path.join(root, "services", "whatsapp2-gateway", "pdf-document.cjs"));

function escapePdfText(value) {
  return String(value).replace(/([\\()])/g, "\\$1");
}

function makePdf(text = "") {
  const stream = text
    ? `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("text PDF extracts bounded useful text and page metadata", async () => {
  const result = await extractPdfDocument(makePdf("Contrato teste Vendeo PDF"));
  assert.equal(result.textExtraction.status, "extracted");
  assert.match(result.textExtraction.text || "", /Contrato teste Vendeo PDF/);
  assert.equal(result.textExtraction.totalPages, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.textExtraction.truncated, false);
});

test("PDF without text layer is explicit and never invents OCR text", async () => {
  const result = await extractPdfDocument(makePdf(""));
  assert.equal(result.textExtraction.status, "no_text");
  assert.equal(result.textExtraction.text, null);
  const context = buildPdfBrainContext({
    fileName: "scan.pdf",
    mimeType: "application/pdf",
    pageCount: result.pageCount,
    textExtraction: result.textExtraction,
  });
  assert.match(context || "", /não foi encontrado texto extraível/i);
  assert.doesNotMatch(context || "", /Conteúdo extraído:/i);
});

test("oversized PDF refuses text extraction before parsing", async () => {
  const base = makePdf("large");
  const oversized = Buffer.concat([base, Buffer.alloc(300_000)]);
  const result = await extractPdfDocument(oversized, { maxBytes: 256 * 1024 });
  assert.equal(result.textExtraction.status, "too_large");
  assert.equal(result.textExtraction.text, null);
  assert.equal(result.textExtraction.truncated, true);
});

test("Brain context exposes extracted text and truncation explicitly", () => {
  const context = buildPdfBrainContext({
    fileName: "relatorio.pdf",
    mimeType: "application/pdf",
    pageCount: 42,
    textExtraction: {
      source: "pdf_text_layer",
      status: "extracted",
      text: "Resumo útil do documento.",
      extractedChars: 25,
      extractedPages: 20,
      totalPages: 42,
      truncated: true,
      errorCode: null,
    },
  });
  assert.match(context || "", /relatorio\.pdf/);
  assert.match(context || "", /Resumo útil do documento/);
  assert.match(context || "", /truncada/i);
});

test("Task 4 stays PDF-only and does not pretend DOCX is PDF", () => {
  assert.equal(
    buildPdfBrainContext({
      fileName: "arquivo.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      textExtraction: null,
    }),
    null,
  );
});

test("production Brain reads attachment metadata from canonical message queries", () => {
  const brain = fs.readFileSync(
    path.join(root, "supabase", "functions", "api", "brain_orchestrator.ts"),
    "utf8",
  );
  const selectLines = brain
    .split(/\r?\n/)
    .filter((line) => line.includes(".select(") && line.includes("media_type"));
  assert.ok(selectLines.length >= 4);
  for (const line of selectLines) {
    assert.match(line, /attachment_metadata/);
    assert.match(line, /provider_type/);
  }
  assert.match(brain, /Conteúdo extraído:/);
  assert.match(brain, /não foi encontrado texto extraível/);
});
