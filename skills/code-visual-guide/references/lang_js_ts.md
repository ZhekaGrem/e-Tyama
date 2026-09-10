# lang_js_ts — як JavaScript / TypeScript читає код

TypeScript тут = JavaScript + анотації типів. Типи — **STRUCTURE**: після компіляції їх
немає, на порядок виконання вони не впливають. Node.js — не мова, а рантайм; його
особливості — в кінці §2.

## 1. Маркери

| kind | сигнал у коді | type |
|---|---|---|
| `const` | `^\s*(export\s+)?const\s+\w+` | data |
| `let` / `var` | `^\s*(let|var)\s+\w+` | data |
| `literal` | число, рядок у лапках, `true/false/null/undefined`, `[...]`, `{...}` як значення | data |
| `function` | `^\s*(export\s+)?(async\s+)?function\s+\w+` | operation |
| `method` | `\w+\s*\(` всередині `class` або після `.` | operation |
| `method` (`.then(`) | `.then(`, `.catch(`, `.finally(` — виклик методу проміса; callback іде в мікрозадачу після синхронного коду | operation |
| `operator` | `+ - * / % == === != !== < > && || ?? =` | operation |
| `return` | `return\b` | operation |
| `if` | `if\s*\(`, `switch`, тернарний `? :` | operation |
| `loop` | `for\b`, `while\b`, `.map( .filter( .reduce( .forEach(` | operation |
| `async` | `async\b`, `await\b` | syntax_sugar |
| `decorator` | `@\w+` перед class/method (TS) | syntax_sugar |
| `spread` | `\.\.\.\w+` | syntax_sugar |
| `destructuring` | `const {a, b} =`, `const [x] =`, у параметрах | syntax_sugar |
| `lambda` | `=>` | syntax_sugar |
| `optional_chaining` | `?.`, `??`, `!!` | syntax_sugar |
| `import` | `^import\b`, `require(` | structure |
| `export` | `^export\b`, `module.exports` | structure |
| `class` | `^\s*(export\s+)?class\s+\w+` | structure |
| `interface` / `type` | `interface\s+\w+`, `type\s+\w+\s*=`, анотації `: Type` | structure |

## 2. Пастки читання

### 2.1 Hoisting — `var` і `function` існують до свого рядка

```js
console.log(x);        // undefined, не ReferenceError
greet();               // "hi" — працює
var x = 5;
function greet() { console.log("hi"); }
```

Порядок: ① `function greet` створено повністю → ② `var x` оголошено як `undefined` →
③ `console.log(x)` → ④ `greet()` → ⑤ `x = 5`.
Чому: оголошення піднімаються на початок області видимості; присвоєння — ні.
reading для `var x`: «оголошення підняте, значення ще undefined».
Джерело: MDN, Hoisting.

### 2.2 TDZ — `let`/`const` теж підняті, але недоступні

```js
console.log(y);   // ReferenceError: Cannot access 'y' before initialization
let y = 5;
```

Порядок: ① `let y` зарезервовано (TDZ) → ② `console.log(y)` → **помилка**.
Чому: змінна існує в області від початку, але до рядка ініціалізації читати її не можна.
reading: «в TDZ до рядка N».
Джерело: MDN, let — Temporal dead zone.

### 2.3 `+` — додавання чи конкатенація вирішує тип операндів

```js
1 + 2        // 3
1 + "2"      // "12"
1 + 2 + "3"  // "33"  — зліва направо: 3, потім "33"
"1" + 2 + 3  // "123"
```

Порядок: f1 лівий операнд → f2 правий операнд → f3 якщо хоч один string → конкатенація.
Чому: `+` єдиний арифметичний оператор, перевантажений для рядків.
reading для `1 + 2 + "3"`: «(1+2)=3 число; 3+"3" → рядок "33"».
Джерело: MDN, Addition (+).

### 2.4 `==` приводить типи, `===` — ні

```js
0 == ""      // true
0 === ""     // false
null == undefined   // true
```

reading для `==`: «приведення типів перед порівнянням; `===` не приводить».
Джерело: MDN, Equality comparisons and sameness.

### 2.5 Пріоритет і порядок обчислення

```js
const r = 2 + 3 * 4;        // 14: * вище за +
const s = (2 + 3) * 4;      // 20: дужки першими
```

Порядок: f1 `3 * 4` → f2 `2 + 12` → f3 присвоєння.
Чому: пріоритет визначає групування, але **операнди обчислюються зліва направо** — важливо
для викликів з побічними ефектами.
Джерело: MDN, Operator precedence.

### 2.6 Аргументи обчислюються до виклику

```js
items.reduce((sum, i) => sum + i.price, 0);
```

Порядок: f1 стрілка створена → f2 `0` → f3 виклик `reduce` → f4 тіло стрілки на кожній
ітерації.
Чому: усі аргументи готуються, і лише потім виклик. Стрілка — значення, не «виконання».
Джерело: MDN, Operator precedence (розділ про порядок обчислення).

### 2.7 `this` у стрілці — з оточення, не з виклику

```js
const obj = { n: 1, f: () => this, g() { return this.n; } };
obj.f();  // undefined в ESM (у звичайному <script> — window): this взято з місця визначення
obj.g();  // 1 — звичайний метод бере this з виклику obj.g()
```

reading для стрілки-методу: «this береться з місця визначення (модуль), не з obj; у
стрілці-методі this ніколи не буде obj».
Джерело: MDN, Arrow function expressions.

### 2.8 Event loop — синхронне спершу, callback-и потім

```js
setTimeout(() => console.log("A"), 0);
console.log("B");
// B, A
```

Порядок: ① `setTimeout` зареєстрував callback → ② `console.log("B")` → ③ стек порожній →
④ callback `A`.
Чому: `0` — це «не раніше ніж», а не «зараз»; черга обробляється після синхронного коду.
reading: «відкладено в чергу; виконається після поточного стеку».
Джерело: MDN, Event loop; Node.js, Event loop, timers, and nextTick.

### 2.9 Node.js: CommonJS vs ESM

| | CommonJS `require` | ESM `import` |
|---|---|---|
| Коли зв'язується | під час виконання, на рядку `require` | до виконання модуля, статично |
| Кеш | так, другий `require` того ж файлу віддає той самий об'єкт | так, модуль виконується один раз |
| Hoisting | ні, звичайний виклик | так, усі `import` піднято на початок |
| order у гайді | звичайний крок ①… | завжди перед першим виразом модуля |

reading для `import`: «ESM: зв'язується до виконання модуля». Для `require`: «виконується
тут, синхронно; результат кешується».
Джерело: MDN, import (мовне правило: hoisting, static, live bindings); Node.js docs, Modules: CommonJS; Modules: ECMAScript modules (рантайм: require синхронний і кешується, ESM має власний кеш).

## 3. Список цукру

| конструкція | kind | equivalent | language_specific |
|---|---|---|---|
| `async function f() { return 1 }` | async | `function f() { return Promise.resolve(1) }` | так |
| `await p` | async | `p.then(v => …решта функції…)` | так |
| `(a, b) => a + b` | lambda | `function (a, b) { return a + b; }` | так (this інший!) |
| `a?.b` | optional_chaining | `a == null ? undefined : a.b` | так |
| `a ?? b` | optional_chaining | `a !== null && a !== undefined ? a : b` | так |
| `!!x` | optional_chaining | `Boolean(x)` | так |
| `[...arr, x]` | spread | `arr.concat([x])` | так |
| `{...obj, k: v}` | spread | `Object.assign({}, obj, {k: v})` | так |
| `const {a, b} = obj` | destructuring | `const a = obj.a; const b = obj.b;` | так |
| `` `x = ${x}` `` | operator (template) | `"x = " + x` | так |
| `@Component()` над class | decorator | `Component()(MyClass)` — виклик при визначенні | TS |
| `x!` (non-null) | optional_chaining | `x` — лише для компілятора, у рантаймі нічого | TS |

## 4. Side effects — як розпізнати

- **I/O:** `console.*`, `fetch`, `fs.*`, `process.*`, `document.*`, `localStorage`, будь-який
  `await` на мережу/диск.
- **Глобальний стан:** присвоєння змінній, оголошеній поза функцією; `window.x =`,
  `global.x =`, `module.exports.x =` після завантаження.
- **Мутація аргументу:** `arr.push/pop/splice/sort`, `obj.prop = …`, `delete obj.prop`,
  `Object.assign(target, …)` де `target` — параметр.

Функція з будь-чим із цього → `side_effect: "<що саме>"`, у гайді ⚠️ і червона рамка.

## 5. Entry point

1. `package.json` → поле `main`, `module`, `bin` або `scripts.start`.
2. `src/index.ts|js`, `src/main.ts|js`, `index.ts|js` у корені.
3. `src/App.tsx`, `app/layout.tsx`, `pages/_app.tsx` (фронтенд).
4. `server.js`, `app.js` (Express-стиль).
5. Нічого не знайдено → файл із найбільшим числом вихідних імпортів.

## Джерела

| Джерело | Хто це | Що взято |
|---|---|---|
| [MDN — Hoisting](https://developer.mozilla.org/en-US/docs/Glossary/Hoisting) | Mozilla, довідник мови | §2.1 |
| [MDN — let, TDZ](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let#temporal_dead_zone_tdz) | Mozilla | §2.2 |
| [MDN — Addition](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Addition) | Mozilla | §2.3 |
| [MDN — Equality comparisons](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness) | Mozilla | §2.4 |
| [MDN — Operator precedence](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence) | Mozilla | §2.5, §2.6 |
| [MDN — Arrow functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions) | Mozilla | §2.7, §3 |
| [MDN — Optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining) | Mozilla | §3 |
| [MDN — Event loop](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop) | Mozilla | §2.8 |
| [Node.js — Event loop, timers, nextTick](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) | офіційна документація Node.js | §2.8 |
| [MDN — import](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import) | Mozilla | §2.9, §3 |
| [Node.js — Modules: CommonJS](https://nodejs.org/api/modules.html) | офіційна документація Node.js | §2.9 |
| [Node.js — Modules: ECMAScript](https://nodejs.org/api/esm.html) | офіційна документація Node.js | §2.9 |
