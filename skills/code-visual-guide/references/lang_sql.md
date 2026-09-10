# lang_sql — як SQL читає код

SQL — декларативна мова: рядки коду кажуть *що* отримати, а не *як* і не *в якому порядку*
виконувати. Порядок обчислення визначає СУБД за фіксованими правилами, і цей порядок майже
завжди відрізняється від порядку, в якому написані ключові слова запиту (`SELECT` написано
першим, а виконується майже останнім). Матеріал тут — дiалект-нейтральний; де конкретна СУБД
поводиться по-своєму, позначено «PostgreSQL: …; перевір у своїй СУБД».

## 1. Маркери

| kind | сигнал у коді | type |
|---|---|---|
| `literal` | число, `'рядок'`, `TRUE`/`FALSE`/`NULL`, `DATE '…'` | data |
| `const` | параметр запиту: `:name`, `$1`, `?` (значення підставляється ззовні) | data |
| `query_stage` | `SELECT \| FROM \| JOIN \| WHERE \| GROUP BY \| HAVING \| ORDER BY \| LIMIT \| OFFSET \| UNION \| INSERT \| UPDATE \| DELETE \| RETURNING` | operation |
| `operator` | `= <> < > AND OR NOT IN LIKE BETWEEN IS NULL \|\|` | operation |
| `function` | `COUNT \| SUM \| AVG \| COALESCE`, будь-який виклик `\w+\(` | operation |
| `if` | `CASE WHEN … THEN … END` | operation |
| `cte` | `WITH\s+\w+\s+AS\s*\(` | syntax_sugar |
| `destructuring` | `USING (col)`, `SELECT *` | syntax_sugar |
| `lambda` | віконна функція `… OVER (…)` | syntax_sugar |
| `table` | `CREATE TABLE`, `ALTER TABLE` | structure |
| `index` | `CREATE INDEX` | structure |
| `type` | тип колонки (`INTEGER`, `TEXT`, …), `CONSTRAINT`, `REFERENCES` | structure |
| `import` | `\c db`, `USE db`, `SET search_path` | structure |

## 2. Пастки читання

`f1`, `f2` у прикладах нижче — порядок підвиразів усередині одного виразу чи виклику. У гайді
нумерація за SKILL.md: рівень модуля — ①②③, тіло функції — f1…; підвирази модульного рівня
нумеруються цілими.

### 2.1 Логічний порядок виконання ≠ порядок написання

```sql
SELECT dept, COUNT(*) AS n
FROM emp
JOIN dept ON dept.id = emp.dept_id
WHERE salary > 100
GROUP BY dept
HAVING COUNT(*) > 5
ORDER BY n DESC
LIMIT 10;
```

Порядок: ① `FROM emp` → ② `JOIN dept …` → ③ `WHERE salary > 100` (рядки) → ④ `GROUP BY dept`
→ ⑤ `HAVING COUNT(*) > 5` (групи) → ⑥ `SELECT dept, COUNT(*) AS n` (вирази; аліас `n`
з'являється саме тут) → ⑦ `ORDER BY n DESC` → ⑧ `LIMIT 10`.
Чому: `JOIN` виконується в межах кроку `FROM` — таблиці з'єднуються ДО того, як `WHERE`
відфільтрує рядки; у гайді `FROM` = ①, кожен наступний `JOIN` отримує наступний номер, а
`WHERE` — номер після них. `WHERE` виконується до того, як пораховано агрегати й аліаси зі
`SELECT`, тому не бачить ні `n`, ні `COUNT(*)`; `ORDER BY` виконується після `SELECT` і аліас
уже бачить.
reading для `WHERE`: «до групування; агрегати й аліаси ще недоступні». `order` для стадій —
цілі ①…⑧ за цим логічним порядком, **не за номером рядка** в тексті запиту.
(Повний офіційний ланцюжок довший: `WITH` → `FROM` → `WHERE` → `GROUP BY`/`HAVING` → `SELECT`
→ `DISTINCT` → `UNION`/`INTERSECT`/`EXCEPT` → `ORDER BY` → `LIMIT`/`OFFSET` → `FOR UPDATE`;
у прикладі вище — без `WITH`, `DISTINCT` і `FOR UPDATE`.)
Джерело: PostgreSQL, SELECT — Description.

### 2.2 NULL не дорівнює нічому, навіть NULL

```sql
SELECT * FROM users WHERE deleted_at = NULL;   -- завжди 0 рядків
SELECT * FROM users WHERE deleted_at IS NULL;  -- правильно
```

Чому: `NULL` означає «невідомо». Звичайні оператори порівняння з `NULL` дають `NULL` (не
`true`/`false`), а не `true`/`false` — і такий рядок `WHERE` відкидає.
reading для `deleted_at = NULL`: «результат завжди NULL → рядок відкинуто; для перевірки на
порожнє значення пиши `IS NULL`».
Джерело: PostgreSQL, Comparison Functions and Operators.

### 2.3 CTE обчислюється до основного запиту

```sql
WITH active AS (
  SELECT * FROM users WHERE active
)
SELECT * FROM active JOIN orders USING (user_id);
```

Порядок: ① `active` (CTE) обчислюється як тимчасова таблиця → ② `FROM active JOIN orders …`
виконується над результатом ①.
Чому: `WITH`-запити — це допоміжні оператори, які можна розглядати як тимчасові таблиці для
одного запиту; основний запит звертається до вже готового результату.
equivalent: підзапит у `FROM`: `FROM (SELECT * FROM users WHERE active) AS active JOIN orders
USING (user_id)`.
Джерело: PostgreSQL, WITH Queries (Common Table Expressions).

### 2.4 `JOIN … USING` — цукор над `ON`

```sql
SELECT * FROM active JOIN orders USING (user_id);
-- еквівалент:
SELECT * FROM active JOIN orders ON active.user_id = orders.user_id;
```

Чому: `USING` — скорочення для випадку, коли колонка називається однаково в обох таблицях;
додатково прибирає з виводу дублікат цієї колонки (при `ON` лишаються обидві — `active.user_id`
і `orders.user_id`).
equivalent: `ON active.user_id = orders.user_id`, плюс одна колонка `user_id` у результаті
замість двох.
Джерело: PostgreSQL, Table Expressions — Joined Tables.

## 3. Список цукру

§3 дає `equivalent`. `type` елемента береться з §1; рядок §3 робить елемент `syntax_sugar`
лише тоді, коли §1 не дав йому іншого типу. Виглядає як цукор, але ним не є — лишається тим,
чим є в §1.

| конструкція | kind | equivalent | language_specific |
|---|---|---|---|
| `WITH x AS (…) SELECT …` | cte | підзапит у `FROM (…) AS x` | ні |
| `… JOIN … USING (c)` | destructuring | `… JOIN … ON a.c = b.c` (+ дублікат `c` прибрано з виводу) | ні |
| `SELECT *` | destructuring | явний перелік колонок таблиці (reading: «залежить від порядку колонок у таблиці — ламається при `ALTER TABLE`») | ні |
| `COALESCE(a, b)` | function | `CASE WHEN a IS NOT NULL THEN a ELSE b END` | ні |
| `x BETWEEN 1 AND 5` | operator | `x >= 1 AND x <= 5` | ні |
| `x IN (1, 2)` | operator | `x = 1 OR x = 2` | ні |
| `ROW_NUMBER() OVER (PARTITION BY d ORDER BY s)` | lambda | «номер рядка в межах групи `d`, впорядкованої за `s` — без self-join» | ні |
| `INSERT … ON CONFLICT DO UPDATE` | query_stage | `INSERT`, а якщо конфлікт — окремий `UPDATE` цього рядка | так (PostgreSQL; у MySQL — `ON DUPLICATE KEY UPDATE`) |

## 4. Side effects — як розпізнати

- **I/O (запис даних):** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `COPY` — будь-яка з них
  пише дані на диск.
- **Глобальний стан:** `CREATE`/`ALTER`/`DROP` (таблиця, індекс, вʼю — міняють схему для всіх);
  `nextval()`/`currval()` над `SEQUENCE` — зсуває спільний лічильник; функції, позначені
  `VOLATILE` (PostgreSQL-класифікація: `IMMUTABLE`/`STABLE`/`VOLATILE`; в інших СУБД термін
  інший), а також `NOW()`/`CURRENT_TIMESTAMP`, `random()` — недетерміновані, залежать від часу
  чи сесії, а не лише від аргументів.
- **Блокування (не мутація, але side effect для інших сесій):** `SELECT … FOR UPDATE` /
  `FOR SHARE` — рядки не змінюються, але інші транзакції, що хочуть їх змінити, чекають.

`SELECT` без жодного з переліченого — чисте читання, без side effects.

## 5. Entry point

1. Для міграцій — найстаріший файл у `migrations/` (за номером або датою у назві): це схема
   «з нуля».
2. Для запитів, вбудованих у код, — рядок SQL у файлі entry-мови проєкту (виклик ORM, `.sql`
   файл, який читає код).
3. `schema.sql`, `init.sql` — явний файл ініціалізації схеми, якщо є.
4. `schema.prisma` чи аналогічний ORM-файл схеми — джерело правди для структури, навіть коли
   сам SQL генерується інструментом.
5. Нічого не знайдено → найновіший або найбільший `.sql` файл у репозиторії.

## Джерела

| Джерело | Хто це | Що взято |
|---|---|---|
| [PostgreSQL — SELECT](https://www.postgresql.org/docs/current/sql-select.html) | офіційна документація PostgreSQL | §2.1 |
| [PostgreSQL — Comparison Functions and Operators](https://www.postgresql.org/docs/current/functions-comparison.html) | офіційна документація PostgreSQL | §2.2 |
| [PostgreSQL — WITH Queries](https://www.postgresql.org/docs/current/queries-with.html) | офіційна документація PostgreSQL | §2.3 |
| [PostgreSQL — Table Expressions](https://www.postgresql.org/docs/current/queries-table-expressions.html) | офіційна документація PostgreSQL | §2.4, §3 |
| [PostgreSQL — CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html) | офіційна документація PostgreSQL | §1 (`table`) |
| [PostgreSQL — Indexes Introduction](https://www.postgresql.org/docs/current/indexes-intro.html) | офіційна документація PostgreSQL | §1 (`index`), §4 |
