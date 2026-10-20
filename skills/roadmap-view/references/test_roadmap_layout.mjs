// Tests for the pure layout script inside roadmap_template.html.
// Run: node --test skills/roadmap-view/references/test_roadmap_layout.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, here), 'utf8');
const fixture = (name) => JSON.parse(read(`fixtures/${name}.json`));

const template = read('roadmap_template.html');

function scriptById(id) {
  const re = new RegExp(`<script[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</script>`);
  const m = template.match(re);
  assert.ok(m, `no <script id="${id}"> in the template`);
  return m[1];
}

const ctx = vm.createContext({});
vm.runInContext(scriptById('roadmap-layout'), ctx);
const { deriveStates, layoutRoadmap, countMandatory, dueText, repeatHasExample } = ctx;

const linear5 = fixture('linear5');
const branching12 = fixture('branching12');
const big30 = fixture('big30');
const hostile = fixture('hostile');
const empty = fixture('empty');

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
const byId = (L, id) => {
  const n = L.nodes.find((x) => x.id === id);
  assert.ok(n, `node ${id} missing from the layout`);
  return n;
};
const edge = (L, from, to) => {
  const e = L.edges.find((x) => x.from === from && x.to === to);
  assert.ok(e, `edge ${from} -> ${to} missing from the layout`);
  return e;
};
const ys = (L) => L.nodes.map((n) => n.y);

test('derives states from statuses and deps', () => {
  // present=пройдено, past=в процесі, cond depends past (не почато), vocab depends present (не почато)
  const nodes = [
    { id: 'present', title: 'Present Simple', status: 'пройдено', mandatory: true, depends: [] },
    { id: 'past', title: 'Past Simple', status: 'в процесі', mandatory: true, depends: ['present'] },
    { id: 'cond', title: 'Conditionals', status: 'не почато', mandatory: true, depends: ['past'] },
    { id: 'vocab', title: 'Словник IT', status: 'не почато', mandatory: true, depends: ['present'] },
  ];
  assert.deepEqual(pick(deriveStates(nodes), ['present', 'past', 'cond', 'vocab']),
    { present: 'done', past: 'now', cond: 'locked', vocab: 'available' });
});

test('linear chain stays on the trunk, top to bottom', () => {
  const L = layoutRoadmap(linear5);
  assert.equal(new Set(L.nodes.filter((n) => !n.isGoal).map((n) => n.x)).size, 1);
  ys(L).forEach((y, i, a) => i && assert.ok(y > a[i - 1]));
});

test('siblings split left and right and merge below', () => {
  const L = layoutRoadmap(branching12);
  const past = byId(L, 'past'), vocab = byId(L, 'vocab'), cond = byId(L, 'cond'), trunk = byId(L, 'present').x;
  assert.equal(past.y, vocab.y);
  assert.ok(Math.min(past.x, vocab.x) < trunk && Math.max(past.x, vocab.x) > trunk);
  assert.equal(cond.x, trunk); assert.ok(cond.y > past.y);
});

test('optional nodes sit outside and use optional edges', () => {
  const L = layoutRoadmap(branching12);
  assert.match(byId(L, 'words1000').side, /^opt-/);
  assert.equal(edge(L, 'present', 'words1000').kind, 'optional');
});

test('goal node joins every mandatory sink', () => {
  const L = layoutRoadmap(branching12);
  const goal = L.nodes.find((n) => n.isGoal);
  assert.deepEqual(L.edges.filter((e) => e.to === goal.id).map((e) => e.from).sort(), ['review', 'standup']);
});

test('30 nodes keep min spacing', () => {
  for (const opts of [undefined, { labelWidth: 100 }]) {
    const L = layoutRoadmap(big30, opts);
    assert.equal(L.nodes.filter((n) => !n.isGoal).length, 30);
    for (let i = 0; i < L.nodes.length; i++) {
      for (let j = i + 1; j < L.nodes.length; j++) {
        const a = L.nodes[i], b = L.nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(d >= 56, `${a.id} and ${b.id} are ${d.toFixed(1)} apart`);
      }
    }
  }
});

test('30 nodes: label boxes do not overlap each other or other nodes', () => {
  for (const opts of [undefined, { labelWidth: 100 }]) {
    const L = layoutRoadmap(big30, opts);
    const hit = (p, q) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
    for (const a of L.nodes) {
      for (const b of L.nodes) {
        if (a === b) continue;
        assert.ok(!hit(a.labelBox, b.labelBox), `labels of ${a.id} and ${b.id} overlap`);
        assert.ok(!hit(a.labelBox, b.nodeBox), `label of ${a.id} covers node ${b.id}`);
      }
    }
    for (const n of L.nodes) {
      assert.ok(n.labelBox.x0 >= 0 && n.labelBox.x1 <= L.width, `label of ${n.id} leaves the canvas`);
    }
  }
});

test('survives cycles and dangling deps', () => {
  const L = layoutRoadmap(hostile);           // має завершитись
  assert.match(byId(L, 'b').meta, /залежність/);  // цикл або ghost позначено в meta
});

test('empty roadmap renders empty state', () => {
  assert.deepEqual(layoutRoadmap(empty).nodes, []);
});

test('escapes markup in titles', () => {
  // The render code must build nodes with createElement(NS) + textContent only.
  const scripts = [...template.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/application\/json/.test(m[1]))
    .map((m) => m[2]).join('\n');
  assert.ok(/textContent/.test(scripts), 'render code should use textContent');
  assert.doesNotMatch(scripts, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  // Titles reach the layout untouched: escaping is the DOM's job, not string surgery.
  assert.equal(byId(layoutRoadmap(hostile), 'x1').title, '</script><img src=x onerror=alert(1)>');
});

test('template has exactly one data placeholder and never writes storage', () => {
  assert.equal(template.split('__ROADMAP_DATA__').length - 1, 1);
  assert.match(template, /<script type="application\/json" id="roadmap-data">__ROADMAP_DATA__<\/script>/);
  assert.doesNotMatch(template, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test('counter counts mandatory steps only, the goal excluded', () => {
  assert.deepEqual(pick(countMandatory(branching12), ['total', 'done']), { total: 7, done: 3 });
  assert.deepEqual(pick(countMandatory(empty), ['total', 'done']), { total: 0, done: 0 });
});

test('light --ink-3 keeps 4.5:1 contrast on every light surface', () => {
  const root = template.match(/:root\{([\s\S]*?)\}/)[1];
  const tok = (name) => root.match(new RegExp(`--${name}:([^;]+);`))[1].trim();
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b, a] = tok('ink-3').match(/rgba\(([^)]+)\)/)[1].split(',').map(Number);
  const lum = (c) => {
    const [R, G, B] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  };
  for (const surface of ['bg', 'surface', 'raised']) {
    const base = hex(tok(surface));
    const mixed = [r, g, b].map((v, i) => v * a + base[i] * (1 - a));
    const [hi, lo] = [lum(base), lum(mixed)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    assert.ok(ratio >= 4.5, `--ink-3 on --${surface} is ${ratio.toFixed(2)}:1`);
  }
});

test('rails into the goal turn accent only when the goal itself is reached', () => {
  const node = (id, status, depends = []) => ({ id, title: id, status, mandatory: true, depends, meta: '', weak_count: 0 });
  const half = layoutRoadmap({ goal_title: 'Ціль', nodes: [node('a', 'пройдено'), node('b', 'не почато')] });
  const halfGoal = half.nodes.find((n) => n.isGoal);
  assert.equal(edge(half, 'a', halfGoal.id).done, false);
  const full = layoutRoadmap({ goal_title: 'Ціль', nodes: [node('a', 'пройдено'), node('b', 'пройдено')] });
  const fullGoal = full.nodes.find((n) => n.isGoal);
  assert.equal(fullGoal.state, 'done');
  assert.equal(edge(full, 'a', fullGoal.id).done, true);
  assert.equal(edge(full, 'b', fullGoal.id).done, true);
});

test('repeat dates read relative to the update day', () => {
  assert.equal(dueText('2026-10-20', '2026-10-20'), 'повтор сьогодні');
  assert.equal(dueText('2026-10-21', '2026-10-20'), 'повтор завтра, 21 жовтня');
  assert.equal(dueText('2026-11-02', '2026-10-20'), 'повтор 2 листопада');
  assert.equal(dueText('2026-10-19', '2026-10-20'), 'повтор уже настав, 19 жовтня');
  assert.equal(dueText('2027-01-05', '2026-10-20'), 'повтор 5 січня 2027');
});

test('a repeat entry without wrong and right shows only the concept', () => {
  assert.equal(repeatHasExample({ concept: 'c', wrong: '', right: '' }), false);
  assert.equal(repeatHasExample({ concept: 'c' }), false);
  assert.equal(repeatHasExample({ concept: 'c', wrong: '  ', right: null }), false);
  assert.equal(repeatHasExample({ concept: 'c', wrong: 'did + went', right: 'did + go' }), true);
  assert.equal(repeatHasExample({ concept: 'c', wrong: '', right: 'did + go' }), true);
});
