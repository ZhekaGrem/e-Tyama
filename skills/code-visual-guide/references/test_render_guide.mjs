// Тести рендерера code-visual-guide. Запуск: node --test skills/code-visual-guide/references/
// Рендерер живе всередині guide_template.html (<script id="renderer">); тест витягує його звідти,
// тому джерело правди одне. Node потрібен лише тому, хто править скіл, не учню.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(HERE, "guide_template.html"), "utf8");
const EXAMPLE = readFileSync(join(HERE, "worked_example.md"), "utf8");

function loadRenderer() {
  const m = TEMPLATE.match(/<script id="renderer">([\s\S]*?)<\/script>/);
  assert.ok(m, "у шаблоні немає <script id=\"renderer\">");
  return new Function(m[1] + "\nreturn CodeGuide;")();
}
function exampleData() {
  const m = EXAMPLE.match(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(m, "у worked_example.md немає блоку ```json");
  return JSON.parse(m[1]);
}
const CG = loadRenderer();

// --- фікстура і шаблон ---------------------------------------------------------
test("worked_example має 12 елементів і валідний", () => {
  const data = exampleData();
  assert.equal(data.files[0].elements.length, 12);
  CG.validate(data);
});
test("шаблон має рівно один плейсхолдер — {{DATA}}", () => {
  const placeholders = [...TEMPLATE.matchAll(/\{\{[A-Z_]+\}\}/g)].map((m) => m[0]);
  assert.deepEqual(placeholders, ["{{DATA}}"]);
});
test("вставка JSON у шаблон лишає файл без плейсхолдерів", () => {
  const json = JSON.stringify(exampleData()).replace(/<\//g, "<\\/");
  const out = TEMPLATE.replace("{{DATA}}", json);
  assert.doesNotMatch(out, /\{\{[A-Z_]+\}\}/);
  assert.match(out, /"project":"shop"/);
});

// --- валідація ------------------------------------------------------------------
test("невідомий type відхиляється з переліком дозволених", () => {
  const d = exampleData(); d.files[0].elements[0].type = "helper";
  assert.throws(() => CG.validate(d), (e) => e instanceof CG.GuideError && /helper/.test(e.message) && /data \| operation \| syntax_sugar \| structure/.test(e.message));
});
test("explanation понад 15 слів відхиляється з назвою елемента", () => {
  const d = exampleData(); d.files[0].elements[1].explanation = Array(16).fill("слово").join(" ");
  assert.throws(() => CG.validate(d), /15/);
  assert.throws(() => CG.validate(d), /calculateTotal/);
});
test("відсутнє поле верхнього рівня називається", () => {
  const d = exampleData(); delete d.files;
  assert.throws(() => CG.validate(d), /files/);
});
test("order у чужому форматі відхиляється", () => {
  const d = exampleData(); d.files[0].elements[5].order = "step1";
  assert.throws(() => CG.validate(d), /order/);
});
test("callout з чужим kind відхиляється", () => {
  const d = exampleData();
  d.l1.callouts.push({ kind: 'x" onmouseover="alert(1)', where: "src/x.ts", note: "n" });
  assert.throws(() => CG.validate(d), (e) => e instanceof CG.GuideError && /callouts/.test(e.message) && /cycle \| orphan/.test(e.message));
});

// --- рендер -----------------------------------------------------------------------
const html = CG.render(exampleData());
test("усі п'ять кольорів палітри присутні", () => {
  for (const c of ["#3B82F6", "#10B981", "#F59E0B", "#6B7280", "#DC2626"]) assert.ok(html.includes(c), c);
});
test("один Mermaid-блок на L1 і по одному на файл", () => {
  assert.equal(html.split('<pre class="mermaid">').length - 1, 1 + exampleData().files.length);
});
test("Mermaid стилізує через classDef усередині діаграми", () => {
  assert.match(html, /classDef structure/);
  assert.match(html, /classDef operation/);
});
test("по одній SVG-стрічці на фрагмент, з обома просторами нумерації", () => {
  const frags = exampleData().files.filter((f) => f.l3_fragment).length;
  assert.equal(html.split("<svg").length - 1, frags);
  assert.ok(html.includes(">1<"), "① модуль");
  assert.ok(html.includes(">f3<"), "тіло функції");
});
test("цукор малюється трикутником і шестикутником", () => {
  assert.match(html, /<polygon class="sugar-tri" points="[^"]+"/);
  assert.match(html, /<polygon class="sugar-hex" points="[^"]+"/);
});
test("рядки коду пронумеровані й підсвічені за типом", () => {
  assert.ok(html.includes('<span class="ln">1</span>'));
  assert.ok(html.includes('class="line-structure"'));
  assert.ok(html.includes('class="line-operation"'));
});
test("еквіваленти цукру виведені", () => {
  assert.ok(html.includes("Promise.resolve"));
});
test("side effect дає червону рамку і callout", () => {
  const d = exampleData(); d.files[0].elements[1].side_effect = "пише в консоль";
  const out = CG.render(d);
  assert.ok(out.includes("callout-side-effect"));
  assert.ok(out.includes("stroke:#DC2626"));
});
test("цикл імпортів дає callout і червоне ребро", () => {
  const d = exampleData();
  d.l1.edges.push({ from: "src/types.ts", to: "src/checkout.ts" });
  d.l1.callouts.push({ kind: "cycle", where: "src/checkout.ts -> src/types.ts", note: "Цикл імпортів." });
  const out = CG.render(d);
  assert.ok(out.includes("callout-cycle"));
  assert.ok(CG.mermaidL1(d.l1).includes("linkStyle"));
});
test("сирота малюється пунктирним колом", () => {
  const d = exampleData();
  d.l1.nodes.push({ id: "src/unused.ts", kind: "file", summary: "Ніхто не імпортує." });
  d.l1.callouts.push({ kind: "orphan", where: "src/unused.ts", note: "Сирота." });
  assert.ok(CG.render(d).includes("callout-orphan"));
  assert.ok(CG.mermaidL1(d.l1).includes('(("src/unused.ts"))'));
});
test("l2_note показується, коли є", () => {
  const d = exampleData(); d.l2_note = "L2 показано для 1 з 2 файлів: entry, хаби.";
  assert.ok(CG.render(d).includes("L2 показано для 1 з 2"));
});
test("HTML екранується", () => {
  const d = exampleData(); d.files[0].elements[0].explanation = "<script>alert(1)</script>";
  const out = CG.render(d);
  assert.ok(!out.includes("<script>alert"));
  assert.ok(out.includes("&lt;script&gt;"));
});
test("depth 1 без фрагментів дає підпис замість L3 і загальний teach-back", () => {
  const d = exampleData(); d.depth = 1; delete d.files[0].l3_fragment;
  const out = CG.render(d);
  assert.ok(out.includes("L3 не будувався"));
  assert.match(CG.teachback(d), /три файли/);
});
