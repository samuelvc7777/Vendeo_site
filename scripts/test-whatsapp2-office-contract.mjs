import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const gatewayRequire = createRequire(
  path.join(root, "services", "whatsapp2-gateway", "package.json"),
);
const JSZip = gatewayRequire("jszip");
const {
  DOCUMENT_EXTRACT_MAX_BYTES,
  extractOfficeDocument,
  buildOfficeBrainContext,
} = gatewayRequire("./office-document.cjs");

async function makeDocx() {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Contrato Vendeo</w:t></w:r></w:p>
          <w:tbl>
            <w:tr><w:tc><w:p><w:r><w:t>Valor da rifa</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function makeXlsx() {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Vendas" sheetId="1" r:id="rId5"/></sheets>
      </workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships>
        <Relationship Id="rId5" Target="worksheets/custom-sheet.xml"/>
      </Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <sst count="2" uniqueCount="2">
        <si><t>Produto</t></si>
        <si><t>Rifa mensal</t></si>
      </sst>`,
  );
  zip.file(
    "xl/worksheets/custom-sheet.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet>
        <sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="B1" t="inlineStr"><is><t>Valor</t></is></c>
          </row>
          <row r="2">
            <c r="A2" t="s"><v>1</v></c>
            <c r="B2"><v>20</v></c>
          </row>
        </sheetData>
      </worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function makePptx() {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:t>Apresentação Vendeo</a:t><a:t>Primeiro slide</a:t></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:t>Segundo slide</a:t></p:cSld></p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("TXT extracts bounded text and line metadata", async () => {
  const result = await extractOfficeDocument(
    Buffer.from("linha um\nlinha dois\nlinha três", "utf8"),
    { fileName: "notas.txt", mimeType: "text/plain" },
    "text/plain",
  );
  assert.equal(result.kind, "txt");
  assert.equal(result.textExtraction.status, "extracted");
  assert.match(result.textExtraction.text || "", /linha três/);
  assert.equal(result.documentStructure.linesRead, 3);
});

test("CSV detects Brazilian semicolon delimiter and returns compact rows", async () => {
  const result = await extractOfficeDocument(
    Buffer.from('nome;valor\n"rifa mensal";20\n"outro; item";30', "utf8"),
    { fileName: "dados.csv", mimeType: "text/csv" },
    "text/csv",
  );
  assert.equal(result.kind, "csv");
  assert.equal(result.textExtraction.status, "extracted");
  assert.equal(result.documentStructure.delimiter, ";");
  assert.match(result.textExtraction.text || "", /rifa mensal \| 20/);
  assert.match(result.textExtraction.text || "", /outro; item \| 30/);
});

test("DOCX extracts paragraphs including text nested inside tables", async () => {
  const result = await extractOfficeDocument(
    await makeDocx(),
    {
      fileName: "contrato.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );
  assert.equal(result.kind, "docx");
  assert.equal(result.textExtraction.status, "extracted");
  assert.match(result.textExtraction.text || "", /Contrato Vendeo/);
  assert.match(result.textExtraction.text || "", /Valor da rifa/);
  assert.ok(result.documentStructure.paragraphsRead >= 2);
});

test("XLSX follows workbook relationships and exposes sheet names plus bounded cells", async () => {
  const result = await extractOfficeDocument(
    await makeXlsx(),
    {
      fileName: "planilha.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
  assert.equal(result.kind, "xlsx");
  assert.equal(result.textExtraction.status, "extracted");
  assert.deepEqual(result.documentStructure.sheetNames, ["Vendas"]);
  assert.equal(result.documentStructure.totalSheets, 1);
  assert.match(result.textExtraction.text || "", /\[Aba: Vendas\]/);
  assert.match(result.textExtraction.text || "", /A=Produto/);
  assert.match(result.textExtraction.text || "", /A=Rifa mensal/);
  assert.match(result.textExtraction.text || "", /B=20/);

  const context = buildOfficeBrainContext({
    fileName: "planilha.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    textExtraction: result.textExtraction,
    documentStructure: result.documentStructure,
  });
  assert.match(context || "", /Abas: Vendas/);
});

test("PPTX extracts slide text and slide count without rendering", async () => {
  const result = await extractOfficeDocument(
    await makePptx(),
    {
      fileName: "slides.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
  );
  assert.equal(result.kind, "pptx");
  assert.equal(result.textExtraction.status, "extracted");
  assert.equal(result.documentStructure.slideCount, 2);
  assert.match(result.textExtraction.text || "", /\[Slide 1\] Apresentação Vendeo Primeiro slide/);
  assert.match(result.textExtraction.text || "", /\[Slide 2\] Segundo slide/);
});

test("legacy DOC/XLS/PPT remain downloadable but never pretend to be parsed", async () => {
  for (const [kind, mime] of [
    ["doc", "application/msword"],
    ["xls", "application/vnd.ms-excel"],
    ["ppt", "application/vnd.ms-powerpoint"],
  ]) {
    const result = await extractOfficeDocument(
      Buffer.from("legacy-binary-placeholder"),
      { fileName: `arquivo.${kind}`, mimeType: mime },
      mime,
    );
    assert.equal(result.kind, kind);
    assert.equal(result.textExtraction.status, "unsupported_legacy_binary");
    assert.equal(result.textExtraction.text, null);
    const context = buildOfficeBrainContext({
      fileName: `arquivo.${kind}`,
      mimeType: mime,
      textExtraction: result.textExtraction,
    });
    assert.match(context || "", /formato Office legado/i);
  }
});

test("oversized office input stops extraction before ZIP/XML parsing", async () => {
  const large = Buffer.alloc(DOCUMENT_EXTRACT_MAX_BYTES + 1);
  large.write("PK", 0, "ascii");
  const result = await extractOfficeDocument(
    large,
    {
      fileName: "grande.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );
  assert.equal(result.textExtraction.status, "too_large");
  assert.equal(result.textExtraction.text, null);
  assert.equal(result.textExtraction.truncated, true);
});

test("extracted office context is explicit when truncated", () => {
  const context = buildOfficeBrainContext({
    fileName: "contrato.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    textExtraction: {
      source: "docx_xml",
      status: "extracted",
      text: "Texto útil.",
      extractedChars: 11,
      extractedPages: 0,
      totalPages: null,
      truncated: true,
      errorCode: null,
    },
    documentStructure: { paragraphsRead: 999 },
  });
  assert.match(context || "", /Texto útil/);
  assert.match(context || "", /truncada/i);
});
