# Worked example — `checkout.ts`

Повний прохід скіла на одному файлі. Це **фікстура**: `test_render_guide.mjs` читає JSON
звідси, тому блок нижче має лишатись валідним за схемою з `SKILL.md`.

## Вхід

```ts
import { Item } from "./types";
export const TAX_RATE = 0.2;
export async function calculateTotal(items: Item[]) {
  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  return subtotal * (1 + TAX_RATE);
}
```

## Дані гайда (те, що пише скіл у `code_guide_<sha8>.md`)

```json
{
  "project": "shop",
  "generated": "2026-09-10",
  "git_commit": "a1b2c3d",
  "root_path": "/work/shop",
  "languages": ["js_ts"],
  "depth": 2,
  "l1": {
    "nodes": [
      {"id": "src/checkout.ts", "kind": "file", "summary": "Рахує суму замовлення з податком."},
      {"id": "src/types.ts", "kind": "file", "summary": "Типи доменних сутностей."}
    ],
    "edges": [{"from": "src/checkout.ts", "to": "src/types.ts"}],
    "callouts": []
  },
  "files": [
    {
      "path": "src/checkout.ts",
      "language": "js_ts",
      "elements": [
        {"type": "structure", "kind": "import", "name": "Item", "line": 1,
         "explanation": "Тип із сусіднього файлу; зникає після компіляції.",
         "language_specific": true, "order": 1, "equivalent": null, "reading": "ESM: зв'язується до виконання модуля", "side_effect": null},
        {"type": "operation", "kind": "function", "name": "calculateTotal", "line": 3,
         "explanation": "Вхід Item[], вихід Promise<number>. Без побічних ефектів.",
         "language_specific": false, "order": 2, "equivalent": null, "reading": "оголошення функції піднято: існує до рядка 2", "side_effect": null,
         "calls": ["reduce"]},
        {"type": "data", "kind": "const", "name": "TAX_RATE", "line": 2,
         "explanation": "Константа 0.2, число; читається всередині функції.",
         "language_specific": false, "order": 3, "equivalent": null, "reading": null, "side_effect": null},
        {"type": "structure", "kind": "type", "name": "items: Item[]", "line": 3,
         "explanation": "Анотація параметра; на виконання не впливає.",
         "language_specific": true, "order": null, "equivalent": null, "reading": null, "side_effect": null},
        {"type": "syntax_sugar", "kind": "async", "name": "async", "line": 3,
         "explanation": "Загортає повернене число в Promise — останній крок виклику.",
         "language_specific": true, "order": "f8", "equivalent": "function calculateTotal(items) { return Promise.resolve(...) }", "reading": null, "side_effect": null},
        {"type": "syntax_sugar", "kind": "lambda", "name": "(sum, i) => sum + i.price", "line": 4,
         "explanation": "Стрілка без власного this; створюється до виклику reduce.",
         "language_specific": true, "order": "f1", "equivalent": "function (sum, i) { return sum + i.price; }", "reading": null, "side_effect": null},
        {"type": "data", "kind": "literal", "name": "0", "line": 4,
         "explanation": "Початкове значення reduce; без нього тип результату інший.",
         "language_specific": false, "order": "f2", "equivalent": null, "reading": null, "side_effect": null},
        {"type": "operation", "kind": "method", "name": "reduce", "line": 4,
         "explanation": "Проходить масив, накопичує суму.",
         "language_specific": false, "order": "f3", "equivalent": null, "reading": "аргументи обчислені ДО виклику: f1, f2, потім f3", "side_effect": null},
        {"type": "operation", "kind": "operator", "name": "sum + i.price", "line": 4,
         "explanation": "Число + число = додавання, не конкатенація.",
         "language_specific": false, "order": "f4", "equivalent": null, "reading": "обидва операнди number → арифметика", "side_effect": null},
        {"type": "data", "kind": "const", "name": "subtotal", "line": 4,
         "explanation": "Результат reduce; незмінна в межах виклику.",
         "language_specific": false, "order": "f5", "equivalent": null, "reading": null, "side_effect": null},
        {"type": "operation", "kind": "operator", "name": "1 + TAX_RATE", "line": 5,
         "explanation": "Дужки першими; TAX_RATE береться з модуля.",
         "language_specific": false, "order": "f6", "equivalent": null, "reading": "1.2 — число; далі множення", "side_effect": null},
        {"type": "operation", "kind": "return", "name": "return", "line": 5,
         "explanation": "Віддає число; далі async робить із нього Promise.",
         "language_specific": false, "order": "f7", "equivalent": null, "reading": null, "side_effect": null}
      ],
      "l3_fragment": {
        "lines": "1-6",
        "why_chosen": "trap",
        "full_code": "import { Item } from \"./types\";\nexport const TAX_RATE = 0.2;\nexport async function calculateTotal(items: Item[]) {\n  const subtotal = items.reduce((sum, i) => sum + i.price, 0);\n  return subtotal * (1 + TAX_RATE);\n}",
        "order_explanation": "Модуль: ① import зв'язується, ② оголошення calculateTotal піднято (hoisting), ③ TAX_RATE = 0.2. Тіло при виклику: аргументи reduce (f1 стрілка, f2 seed 0) обчислюються до самого виклику f3. Див. lang_js_ts.md §2 — hoisting, порядок обчислення аргументів."
      }
    }
  ]
}
```

## Що з цього бачить учень

HTML будує рендерер із JSON вище: L1 — граф `checkout.ts → types.ts`; L2 — таблиця 12
елементів і Mermaid із стрілкою `calculateTotal → reduce`; L3 — код зліва, стрічка справа.
Два простори нумерації: ①②③ — модуль при завантаженні; f1…f8 — тіло при виклику
`calculateTotal()`. Головна пастка: функція існує **до** константи, а аргументи `reduce`
обчислюються **до** самого виклику. Mermaid у `.md` не пишеться — форми знає лише рендерер.
