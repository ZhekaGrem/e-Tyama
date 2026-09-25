// Генерує HTML-вітрини для всього треку (правило C: .md первинний, HTML — вітрина).
//   <тема>/<prefix>_learn.md → <тема>/<prefix>_learn.html  (ім'я як у джерела — *_learn.html ловить .gitignore)
//   roadmap.md               → roadmap.html
//   README.md                → index.html (+ теми, яких README ще не згадує)
// Mermaid підключається один раз з <трек>/_assets/mermaid.min.js — сторінки легкі й працюють офлайн.
// Якщо файлу немає, генератор один раз завантажує його з cdnjs.
// Використання: node build.mjs <тека треку>
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve, relative } from "node:path";
import { Marked } from "marked";

if (!process.argv[2]) { console.error("usage: node build.mjs <тека треку>"); process.exit(1); }
const track = resolve(process.argv[2]);
const assets = join(track, "_assets");
const stamp = new Date().toISOString().slice(0, 10);
const MERMAID_VERSION = "11.15.0";
const MERMAID_URL = `https://cdnjs.cloudflare.com/ajax/libs/mermaid/${MERMAID_VERSION}/mermaid.min.js`;

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rel = (fromDir, to) => relative(fromDir, to).split("\\").join("/") || ".";
const key = p => resolve(p).toLowerCase(); // Windows: шляхи нечутливі до регістру
const stripTags = s => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();

// ---------------------------------------------------------------- Знайти сторінки
const topics = [];
for (const d of readdirSync(track)) {
  if (/^[._]/.test(d)) continue;
  const dir = join(track, d);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith("_learn.md")) topics.push({ src: join(dir, f), out: join(dir, f.replace(/\.md$/, ".html")), dir });
  }
}
const extras = [];
if (existsSync(join(track, "roadmap.md"))) extras.push({ src: join(track, "roadmap.md"), out: join(track, "roadmap.html"), dir: track });
const readme = join(track, "README.md");
const index = existsSync(readme) ? { src: readme, out: join(track, "index.html"), dir: track, isIndex: true } : null;

const pages = [...topics, ...extras, ...(index ? [index] : [])];
const byMd = new Map(pages.map(p => [key(p.src), p]));
const byDir = new Map(topics.map(p => [key(p.dir), p]));

// Порядок тем — як у таблиці README; решта — за абеткою в кінці
const readmeText = index ? readFileSync(readme, "utf8") : "";
const order = [];
for (const m of readmeText.matchAll(/\]\(([^)#\s]+_learn\.md)\)/g)) {
  const p = byMd.get(key(join(track, m[1])));
  if (p && !order.includes(p)) order.push(p);
}
const unlisted = topics.filter(p => !order.includes(p)).sort((a, b) => a.dir.localeCompare(b.dir));
const sequence = [...order, ...unlisted];

// Заголовок сторінки — перший "# " поза блоками коду
const titleOf = src => {
  const tokens = new Marked().lexer(readFileSync(src, "utf8"));
  const h = tokens.find(t => t.type === "heading" && t.depth === 1);
  return h ? h.text.replace(/`/g, "") : basename(src, ".md");
};
for (const p of pages) p.title = titleOf(p.src);
// Назва треку для хлібних крихт — перша частина заголовка README до " — "
const trackName = index ? stripTags(index.title).split(" — ")[0] : basename(track);

// ---------------------------------------------------------------- Рендер однієї сторінки
function render(page) {
  const md = readFileSync(page.src, "utf8");
  const outDir = dirname(page.out);
  const toc = [], used = new Map();
  let mermaidCount = 0, linksRewritten = 0;

  const slug = text => {
    const base = text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "s";
    const n = used.get(base) || 0; used.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };

  // Посилання на .md чи теку, для яких є вітрина, ведуть на .html; решта лишається як є
  const mapHref = href => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return href;
    const [path] = href.split("#");
    let target;
    try { target = resolve(dirname(page.src), decodeURI(path)); } catch { return href; }
    const hit = byMd.get(key(target)) || byDir.get(key(target.replace(/[\\/]+$/, "")));
    if (!hit) return href;
    linksRewritten++;
    return rel(outDir, hit.out);
  };

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      code({ text, lang }) {
        const l = (lang || "").trim();
        if (l === "mermaid") { mermaidCount++; return `<figure class="diagram"><pre class="mermaid">${esc(text)}</pre></figure>\n`; }
        return `<div class="code"><span class="lang">${esc(l || "text")}</span><pre><code>${esc(text)}</code></pre></div>\n`;
      },
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        const id = slug(text);
        // у зміст ідуть частини й розділи, а також підрозділи, дописані при аудиті (2026)
        if (depth <= 2 || (depth === 3 && /\(2026\)/.test(text))) toc.push({ depth, id, html: inner });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
      codespan({ text }) {
        // [Співбесіда], [Базовий] … — мітки рівня, показуємо як бейджі
        const m = /^\[(.+)\]$/.exec(text);
        if (m) return `<span class="badge${/Співбесіда/.test(m[1]) ? " hot" : ""}">${m[1]}</span>`;
        return `<code>${text}</code>`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const to = mapHref(href);
        const ext = /^https?:/.test(to) ? ' target="_blank" rel="noopener"' : "";
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ""}${ext}>${inner}</a>`;
      },
    },
  });

  let body = marked.parse(md).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

  if (page.isIndex && unlisted.length) {
    const id = slug("Теми поза таблицею навігації");
    toc.push({ depth: 2, id, html: "Теми поза таблицею навігації" });
    body += `<h2 id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>Теми поза таблицею навігації</h2>
<p>Ці теки є в треку, але таблиця навігації в <code>README.md</code> їх ще не згадує. Порядок — за абеткою. Блок додає генератор; щоб тема стала в потрібне місце, допиши її в README.</p>
<ul>${unlisted.map(p => `<li><a href="${esc(rel(outDir, p.out))}">${esc(p.title)}</a> — <code>${esc(rel(track, p.src))}</code></li>`).join("")}</ul>\n`;
  }

  // Навігація по треку: хлібні крихти зверху, попередня/наступна тема знизу
  let crumbs = "", pager = "";
  if (!page.isIndex && index) {
    crumbs = `<nav class="crumbs" aria-label="Навігація треку"><a href="${esc(rel(outDir, index.out))}">${esc(trackName)} — усі теми</a></nav>`;
    const i = sequence.indexOf(page);
    if (i !== -1) {
      const prev = sequence[i - 1], next = sequence[i + 1];
      pager = `<nav class="pager" aria-label="Попередня й наступна тема">${
        prev ? `<a class="prev" href="${esc(rel(outDir, prev.out))}"><span>← Попередня</span>${esc(prev.title)}</a>` : "<span></span>"}${
        next ? `<a class="next" href="${esc(rel(outDir, next.out))}"><span>Наступна →</span>${esc(next.title)}</a>` : ""}</nav>`;
    }
  }

  let tocHtml = "", open = false;
  for (const t of toc) {
    if (t.depth === 1) {
      if (open) tocHtml += "</ul></li>";
      tocHtml += `<li><a href="#${t.id}">${t.html}</a><ul>`; open = true;
    } else {
      tocHtml += `<li${t.depth === 3 ? ' class="sub"' : ""}><a href="#${t.id}">${t.html}</a></li>`;
    }
  }
  if (open) tocHtml += "</ul></li>";
  tocHtml = tocHtml.replace(/<ul><\/ul>/g, "");

  const mermaidTag = mermaidCount ? `<script src="${esc(rel(outDir, join(assets, "mermaid.min.js")))}"></script>\n` : "";
  const html = TEMPLATE({
    title: stripTags(page.title).split(" — ")[0],
    tocHtml, body, crumbs, pager, mermaidTag,
    source: rel(outDir, page.src),
  });
  writeFileSync(page.out, html);
  return { page: rel(track, page.out), kb: Math.round(Buffer.byteLength(html) / 1024), mermaid: mermaidCount, toc: toc.length, links: linksRewritten };
}

const TEMPLATE = ({ title, tocHtml, body, crumbs, pager, mermaidTag, source }) => `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  /* Стиль узгоджено з code-visual-guide: системний шрифт, нейтральна палітра. */
  :root {
    --ink: #1a1a1a; --muted: #5b6470; --line: #d7dce3; --bg: #ffffff; --bg-soft: #f4f6f9;
    --accent: #1D4ED8; --hot: #DC2626; --quote: #10B981;
  }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --ink: #e6e9ee; --muted: #9aa3ae; --line: #2f3742; --bg: #14181d; --bg-soft: #1c222a;
      --accent: #7aa2ff; --hot: #f87171; --quote: #34d399; }
  }
  * { box-sizing: border-box; }
  html { scroll-padding-top: 16px; }
  body { margin: 0; font-family: "Segoe UI", Arial, system-ui, sans-serif; color: var(--ink); background: var(--bg);
    font-size: 16px; line-height: 1.6; }
  .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); max-width: 1320px; margin: 0 auto; }
  nav.toc { position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid var(--line);
    padding: 20px 16px; font-size: 13.5px; background: var(--bg-soft); }
  nav.toc .head { font-weight: 700; margin-bottom: 8px; }
  nav.toc ul { list-style: none; margin: 0; padding: 0; }
  nav.toc > ul > li { margin-top: 10px; }
  nav.toc > ul > li > a { font-weight: 600; }
  nav.toc ul ul { padding-left: 10px; border-left: 2px solid var(--line); margin-top: 4px; }
  nav.toc ul ul li { margin: 2px 0; }
  nav.toc li.sub { padding-left: 12px; font-size: 12.5px; }
  nav.toc a { color: var(--ink); text-decoration: none; display: block; padding: 1px 4px; border-radius: 4px; }
  nav.toc a:hover, nav.toc a.active { background: var(--line); }
  nav.toc .badge { display: none; }
  #filter { width: 100%; padding: 6px 8px; margin-bottom: 8px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--bg); color: var(--ink); font: inherit; }
  main { padding: 24px 40px 80px; min-width: 0; }
  article { max-width: 860px; }
  .crumbs { font-size: 14px; margin-bottom: 16px; }
  .crumbs a { text-decoration: none; }
  .crumbs a::before { content: "← "; }
  .pager { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 860px; margin-top: 40px; }
  .pager a { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px;
    text-decoration: none; color: var(--ink); font-weight: 600; font-size: 14px; }
  .pager a:hover { border-color: var(--accent); }
  .pager a span { font-weight: 400; font-size: 12px; color: var(--muted); }
  .pager .next { text-align: right; grid-column: 2; }
  h1, h2, h3, h4 { line-height: 1.25; position: relative; }
  h1 { font-size: 1.7rem; margin: 56px 0 12px; padding-top: 20px; border-top: 3px solid var(--ink); }
  article > h1:first-child { margin-top: 0; border-top: 0; padding-top: 0; font-size: 2rem; }
  h2 { font-size: 1.3rem; margin: 36px 0 10px; padding-bottom: 4px; border-bottom: 2px solid var(--line); }
  h3 { font-size: 1.1rem; margin: 26px 0 8px; }
  .anchor { position: absolute; left: -1.1em; color: var(--muted); text-decoration: none; opacity: 0; }
  h1:hover .anchor, h2:hover .anchor, h3:hover .anchor { opacity: 1; }
  p, li { max-width: 75ch; }
  a { color: var(--accent); }
  code { font-family: Consolas, "Courier New", monospace; font-size: .88em; background: var(--bg-soft);
    border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  .code { position: relative; margin: 14px 0; }
  .code .lang { position: absolute; top: 0; right: 0; font: 11px Consolas, monospace; color: var(--muted);
    padding: 2px 8px; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0 6px 0 6px; }
  .code pre { margin: 0; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px;
    overflow-x: auto; font-size: 13.5px; line-height: 1.5; }
  .code pre code { background: none; border: 0; padding: 0; }
  blockquote { margin: 16px 0; padding: 10px 16px; border-left: 4px solid var(--quote); background: var(--bg-soft); border-radius: 0 6px 6px 0; }
  blockquote p { margin: 6px 0; }
  .table-wrap { overflow-x: auto; margin: 14px 0; }
  table { border-collapse: collapse; font-size: .92em; min-width: 100%; }
  th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: var(--bg-soft); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
  .badge { display: inline-block; font-size: .72em; font-weight: 600; padding: 1px 8px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--muted); vertical-align: middle; margin-left: 4px; }
  h1 .badge, h2 .badge, h3 .badge { font-size: 12px; }
  .badge.hot { border-color: var(--hot); color: var(--hot); }
  figure.diagram { margin: 18px 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; background: var(--bg); }
  pre.mermaid { margin: 0; background: transparent; text-align: center; font-size: 13px; }
  pre.mermaid:not([data-processed]) { text-align: left; color: var(--muted); white-space: pre-wrap; }
  footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: .9em; }
  .menu-btn { display: none; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    nav.toc { position: fixed; inset: 0 25% 0 0; z-index: 10; transform: translateX(-105%); transition: transform .2s; height: 100%; }
    nav.toc.open { transform: none; box-shadow: 0 0 0 100vmax rgba(0,0,0,.35); }
    .menu-btn { display: block; position: fixed; right: 16px; bottom: 16px; z-index: 11; border: 0; border-radius: 999px;
      padding: 10px 16px; font: 600 14px "Segoe UI", sans-serif; background: var(--ink); color: var(--bg); }
    main { padding: 16px 16px 80px; }
    .anchor { display: none; }
    .pager { grid-template-columns: 1fr; }
    .pager .next { grid-column: 1; }
  }
  @media (prefers-reduced-motion: reduce) { nav.toc { transition: none; } }
</style>
</head>
<body>
<div class="layout">
  <nav class="toc" id="toc" aria-label="Зміст">
    <div class="head">Зміст</div>
    <input id="filter" type="search" placeholder="Фільтр розділів…" aria-label="Фільтр розділів">
    <ul>${tocHtml}</ul>
  </nav>
  <main>
    ${crumbs}
    <article>
${body}
    </article>
    ${pager}
    <footer>Згенеровано з <code>${esc(source)}</code> ${stamp}. Файл .md — джерело; цей HTML — вітрина. Змінився матеріал — перегенеруй генератором <code>teach-concept/references/html_companion</code>, не правь HTML руками.</footer>
  </main>
</div>
<button class="menu-btn" id="menu" type="button" aria-controls="toc" aria-expanded="false">Зміст</button>
${mermaidTag}<script>
(function () {
  if (window.mermaid) {
    var dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    try {
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict",
        flowchart: { htmlLabels: true }, fontFamily: '"Segoe UI", Arial, sans-serif' });
      mermaid.run({ querySelector: "pre.mermaid" }).catch(function (e) { console.error(e); });
    } catch (e) { console.error(e); }
  }

  var toc = document.getElementById("toc"), menu = document.getElementById("menu");
  menu.addEventListener("click", function () { var o = toc.classList.toggle("open"); menu.setAttribute("aria-expanded", o); });
  toc.addEventListener("click", function (e) { if (e.target.closest("a")) { toc.classList.remove("open"); menu.setAttribute("aria-expanded", false); } });

  document.getElementById("filter").addEventListener("input", function () {
    var q = this.value.trim().toLowerCase();
    toc.querySelectorAll("li").forEach(function (li) {
      li.hidden = q && li.textContent.toLowerCase().indexOf(q) === -1;
    });
  });

  var links = {}; toc.querySelectorAll("a[href^='#']").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
  var current;
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && links[en.target.id]) {
          if (current) current.classList.remove("active");
          current = links[en.target.id]; current.classList.add("active");
          // Прокручуємо лише сам зміст: scrollIntoView зсуває і сторінку, а на мобільному — вбік до схованого меню
          var r = current.getBoundingClientRect(), tr = toc.getBoundingClientRect();
          if (r.top < tr.top || r.bottom > tr.bottom) toc.scrollTop += r.top - tr.top - tr.height / 2;
        }
      });
    }, { rootMargin: "0px 0px -70% 0px" });
    document.querySelectorAll("article h1[id], article h2[id], article h3[id]").forEach(function (h) { io.observe(h); });
  }
})();
</script>
</body>
</html>
`;

const mermaidFile = join(assets, "mermaid.min.js");
if (!existsSync(mermaidFile)) {
  try {
    const res = await fetch(MERMAID_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(assets, { recursive: true });
    writeFileSync(mermaidFile, Buffer.from(await res.arrayBuffer()));
    console.log(`Завантажено mermaid ${MERMAID_VERSION} → ${rel(track, mermaidFile)}`);
  } catch (e) {
    console.warn(`УВАГА: не вдалося завантажити ${MERMAID_URL} (${e.message}) — діаграми покажуться як текст`);
  }
}
const report = pages.map(render);
console.table(report);
if (unlisted.length) console.log("Поза таблицею README:", unlisted.map(p => rel(track, p.dir)).join(", "));
