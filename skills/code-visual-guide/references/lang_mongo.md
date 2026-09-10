# lang_mongo — як MongoDB / Mongoose читає код

MongoDB тут — не мова загального призначення, а дві мови запитів усередині JS/TS-хосту:
**aggregation pipeline** (масив стадій `$match`, `$group`, …) і **CRUD-методи** (`find`,
`updateOne`, …). Обидві виконуються не так, як звичайний JS: масив стадій — це не список
незалежних операцій, а конвеєр, де кожна стадія бачить тільки те, що віддала попередня.
Mongoose — ODM поверх драйвера: додає схеми, моделі й хелпери (`.lean()`, `.populate()`),
які самі по собі непрозорі для читання коду. Синтаксис навколо запитів (`const`, `=>`,
`await`) читається за правилами `lang_js_ts.md`; тут — лише те, що специфічне для Mongo.

## 1. Маркери

| kind | сигнал у коді | type |
|---|---|---|
| `literal` | значення у фільтрах і update: `{ age: 5 }`, `"str"`, `ObjectId(...)`, числа/рядки/булі як значення поля | data |
| `const` | змінна, підставлена у фільтр або update: `const filter = { age }` | data |
| `query_stage` | стадії пайплайну `$match $group $project $sort $limit $skip $lookup $unwind $addFields $count` і методи `find/findOne/insertOne/updateOne/deleteMany/aggregate` | operation |
| `operator` | оператори виразів і update: `$eq $gt $in $and $or $regex $set $inc $push` | operation |
| `if` | `$cond`, `$switch` | operation |
| `loop` | `$map`, `$reduce`, `.forEach()` на курсорі | operation |
| `destructuring` | `$unwind: "$items"`, projection `{ name: 1 }` | syntax_sugar |
| `lambda` | `$expr`, `$function` | syntax_sugar |
| `optional_chaining` | `$ifNull`, `.lean()`, `.exec()`, `.populate()` (Mongoose-хелпери) | syntax_sugar |
| `cte` | `$facet` (кілька пайплайнів в одному) | syntax_sugar |
| `collection` | `mongoose.model(...)`, `db.collection(...)` | structure |
| `class` | `new Schema({...})` | structure |
| `index` | `schema.index(...)`, `createIndex(...)` | structure |
| `type` | типи полів у Schema: `{ name: String }`, `type: Number` | structure |

## 2. Пастки читання

### 2.1 Пайплайн виконується зверху вниз; `$match` рано — менше даних далі

```js
db.orders.aggregate([
  { $lookup: { from: "users", localField: "uid", foreignField: "_id", as: "u" } },
  { $match: { status: "paid" } }
])
```

Порядок: ① `$lookup` виконується на **всіх** замовленнях (join з `users` для кожного
документа) → ② `$match` відкидає більшість результатів, коли join уже зроблено.
Чому: стадії виконуються послідовно зверху вниз, кожна отримує на вхід те, що вивела
попередня; `$match` не «спливає» сам угору — дорога стадія перед ним уже відпрацювала на
всьому обсязі.
reading для `$match` після `$lookup`: «фільтр після join — join зроблено даремно на всіх
документах; переставити $match вище».
Джерело: MongoDB Manual, Aggregation Pipeline; $match.

### 2.2 `$project` ховає поля для наступних стадій

```js
db.orders.aggregate([
  { $project: { name: 1 } },
  { $sort: { age: -1 } }
])
```

Порядок: ① після `$project` лишається лише `name` (і `_id` за замовчуванням) → ② `$sort`
намагається впорядкувати за `age`, якого в документах уже немає → результат — порядок,
який не залежить від `age`.
Чому: `$project` передає далі документи лише з переліченими полями; наступна стадія не
бачить нічого, що не пройшло через цей фільтр полів.
reading: «поле відкинуте стадією `$project` вище; тут його вже нема».
Джерело: MongoDB Manual, $project.

### 2.3 `$group` скидає документ до `_id` + акумуляторів

```js
db.employees.aggregate([
  { $group: { _id: "$dept", n: { $sum: 1 } } }
])
```

Порядок: ① вхідні документи розподіляються по групах за ключем `_id: "$dept"` → ② для
кожної групи `n` рахується акумулятором `$sum: 1` → ③ на виході — документи лише з
`_id` і `n`; будь-яке інше поле джерела (`name`, `salary`, …) у результат не потрапляє,
якщо не задане через акумулятор.
Чому: у специфікації `$group` кожне поле, крім `_id`, мусить бути акумулятор-виразом;
довільне поле «просто скопіювати» не існує.
reading: «після $group лишається лише _id і поля-акумулятори; решта зникла».
Джерело: MongoDB Manual, $group.

### 2.4 `$lookup` додає масив, а не об'єкт

```js
db.orders.aggregate([
  { $lookup: { from: "users", localField: "uid", foreignField: "_id", as: "u" } }
])
// order.u === [ { ... } ]  — масив, навіть якщо збіг лише один
```

equivalent: left outer join до колекції `users`; `u` — масив збігів (0, 1 або більше
документів), не одиничний об'єкт.
reading: «`u` — масив; для одного елемента далі потрібен `$unwind`».
Джерело: MongoDB Manual, $lookup.

### 2.5 `.lean()` змінює тип результату

```js
const u = await User.findOne({ _id: id }).lean();
u.save();   // TypeError: u.save is not a function
```

Порядок: ① `.lean()` додано до запиту → ② Mongoose пропускає гідратацію результату в
Document → ③ `u` — простий об'єкт (POJO): без `save()`, без getters/setters/virtuals,
без відстеження змін.
Чому: `.lean()` навмисно економить на кроці «обгорнути сирий BSON у Mongoose Document».
reading: «простий об'єкт; методів документа немає; швидше, але без гідратації».
Джерело: Mongoose docs, lean.

### 2.6 `find()` повертає курсор; Mongoose-запит без `await`/`.exec()` не виконується

```js
const cursor = db.collection("orders").find({ status: "paid" });
// cursor — ще нічого не запитано у базі
const docs = await cursor.toArray();   // тепер запит матеріалізується

const q = User.find({ age: { $gt: 18 } });
// q — Query, теж ще не виконаний
const users = await q;                 // або: await q.exec()
```

Порядок: ① `find()` будує курсор/Query, у мережу нічого не йде → ② `.toArray()` /
`await` / `.exec()` матеріалізує запит.
Чому: `db.collection.find()` за визначенням повертає курсор, а не масив. У Mongoose
`Query` — не проміс, а «thenable»: має `.then()`, тому працює з `await`, але сам запит
у базу відправляється лише в момент виклику `.then()`/`.exec()`, і повторний виклик
`.then()` на вже виконаному запиті кидає помилку.
reading: «ледачий, поки не await/.exec()/.toArray()».
Джерело: MongoDB Manual, db.collection.find; Mongoose docs, Queries.

## 3. Список цукру

| конструкція | kind | equivalent | language_specific |
|---|---|---|---|
| `$unwind: "$items"` | destructuring | один документ на кожен елемент масиву `items` (SQL: `CROSS JOIN UNNEST`) | так |
| `{ name: 1 }` (projection) | destructuring | `const { name } = doc` — лишити тільки перелічені поля | так |
| `$ifNull: [a, b]` | optional_chaining | `a ?? b` | так |
| `$facet` | cte | кілька незалежних пайплайнів паралельно на одному вході; кожен пише свій ключ у результат | так |
| `.populate("user")` | optional_chaining | `$lookup` + `$unwind`, зроблені драйвером окремим запитом, не однією агрегацією | Mongoose |
| `.lean()` | optional_chaining | результат запиту віддається як POJO одразу з драйвера; Mongoose пропускає крок гідратації, Document не створюється (це НЕ `toObject()` після гідратації) | Mongoose |
| `$expr` | lambda | вираз агрегації всередині `find` (динамічна умова замість статичного фільтра) | так |
| `updateOne(filter, { $set: {...} })` | query_stage | `UPDATE ... SET ...` | так |
| `upsert: true` | operator | вставити документ, якщо `filter` нічого не знайшов | так |

## 4. Side effects — як розпізнати

- **I/O (запис у базу):** `insertOne/insertMany`, `updateOne/updateMany`, `deleteOne/
  deleteMany`, `replaceOne`, `findOneAndUpdate`, `save()`, і стадії агрегації `$out` та
  `$merge` — вони виглядають як звичайні стадії пайплайну, але **пишуть** у колекцію,
  на відміну від решти стадій, які лише перетворюють потік документів.
- **Глобальний стан (структура/схема бази):** `createIndex`, `schema.index(...)`,
  `drop()` — змінюють колекцію для всіх, хто до неї звертається, не лише для поточного
  запиту.
- **Мутація аргументу (прихований side effect):** Mongoose middleware `pre('save')` /
  `pre('validate')` виконується неявно перед записом і може змінити документ, який
  викликач вважає вже готовим до збереження — у reading позначати окремо, бо в місці
  виклику `save()` цього коду не видно.

Читання без запису (`find`, `aggregate` без `$out`/`$merge` у стадіях) — без side effects.

## 5. Entry point

1. Файл, де встановлюється з'єднання: `mongoose.connect(...)` або `new MongoClient(...)`
   — звідси починається залежність коду від бази.
2. `models/` (або де оголошені `Schema`/`mongoose.model(...)`) — це STRUCTURE-вузли рівня
   L1 (форма даних), не точка виконання: самі по собі вони нічого не запускають.
3. Самі запити (`.aggregate([`, `.find(`, `.updateOne(`) шукати у файлах entry-мови
   (JS/TS) — контролерах, роутах, сервісах — за правилами §5 `lang_js_ts.md`.

## Джерела

| Джерело | Хто це | Що взято |
|---|---|---|
| [MongoDB Manual — Aggregation Pipeline](https://www.mongodb.com/docs/manual/core/aggregation-pipeline/) | MongoDB Manual, офіційна документація | §2.1 |
| [MongoDB Manual — $match](https://www.mongodb.com/docs/manual/reference/operator/aggregation/match/) | MongoDB Manual, офіційна документація | §2.1 |
| [MongoDB Manual — $project](https://www.mongodb.com/docs/manual/reference/operator/aggregation/project/) | MongoDB Manual, офіційна документація | §2.2 |
| [MongoDB Manual — $group](https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/) | MongoDB Manual, офіційна документація | §2.3 |
| [MongoDB Manual — $lookup](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/) | MongoDB Manual, офіційна документація | §2.4 |
| [MongoDB Manual — db.collection.find()](https://www.mongodb.com/docs/manual/reference/method/db.collection.find/) | MongoDB Manual, офіційна документація | §2.6 |
| [Mongoose docs — lean()](https://mongoosejs.com/docs/tutorials/lean.html) | Mongoose docs, офіційна документація ODM | §2.5, §3 |
| [Mongoose docs — Schemas guide](https://mongoosejs.com/docs/guide.html) | Mongoose docs, офіційна документація ODM | §1 (Schema/Model) |
| [Mongoose docs — Queries](https://mongoosejs.com/docs/queries.html) | Mongoose docs, офіційна документація ODM | §2.6 |
