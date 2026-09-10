# lang_java — як Java читає код

Java — статично типізована мова, що компілюється в байткод і виконується на JVM. Типи
в сигнатурах (generics, оголошення) — **STRUCTURE**: компілятор перевіряє їх до виконання, на
порядок дій рантайм вони не впливають. Виняток, де тип усе-таки вирішує, яка операція
виконається, — оператор `+` (§2.2). JVM — не мова, а рантайм; правила ініціалізації класів
та об'єктів (§2.1, §2.4) — це мовні правила з JLS, а не деталь конкретної реалізації.

## 1. Маркери

| kind | сигнал у коді | type |
|---|---|---|
| `const` | `static final \w+ \w+` | data |
| `let` | оголошення поля/локальної змінної: `(int|long|double|boolean|String|var|List<.*>|…)\s+\w+\s*=` (включно з `var x = …` — вивід типу, це `let`, не цукор) | data |
| `literal` | число, рядок у лапках, text block `"""…"""`, `true/false/null`, масив-літерал `{...}` | data |
| `function` | static-метод: `static\s+[\w<>\[\]]+\s+\w+\s*\(` | operation |
| `method` | `(public|private|protected)?\s*[\w<>\[\]]+\s+\w+\s*\(`, не всередині оголошення `class`/`new` | operation |
| `operator` | `+ - * / % == != < > && \|\| = instanceof` | operation |
| `return` | `return\b` | operation |
| `if` | `if\s*\(`, `switch`, тернарний `? :`, switch expression `case X -> …` | operation |
| `loop` | `for\b`, `while\b`, `do\b`, enhanced `for (T t : xs)` | operation |
| `decorator` | `^\s*@\w+` перед class/method/field (анотація) | syntax_sugar |
| `lambda` | `->` (лямбда), method reference `::` | syntax_sugar |
| `async` | `CompletableFuture`, `@Async`, `Thread`, `ExecutorService` | syntax_sugar |
| `destructuring` | record pattern: `case Type(f1, f2) ->`, `instanceof Type(f1, f2)` | syntax_sugar |
| `optional_chaining` | `Optional.map(`, `.orElse(`, `.ifPresent(` | syntax_sugar |
| `import` | `^import\b` | structure |
| `class` | `class\s+\w+`, `record\s+\w+`, `enum\s+\w+` | structure |
| `interface` | `interface\s+\w+` | structure |
| `type` | generics `<T>` у сигнатурі методу/класу | structure |
| `export` | `public` перед `class`/`interface`/`record`/`enum` на верхньому рівні файлу | structure |

Примітка: у Java немає окремого `export`-синтаксису — те, що робить клас видимим ззовні пакета,
це модифікатор доступу `public`. У §1 він відображається як `export`, щоб дерево рішень скіла
могло однаково питати «що звідси видно ззовні» для будь-якої мови.

## 2. Пастки читання

### 2.1 Static-блоки і static-поля — до конструктора, в текстовому порядку, один раз

```java
class A {
    static int n = init("static field");
    static { System.out.println("static block"); }
    int m = init("instance field");
    A() { System.out.println("ctor"); }
}
new A(); new A();
```

Порядок: ① `static int n = init(...)` → ② static-блок → (перший `new A()`) f1 `m = init(...)`
→ f2 тіло конструктора; другий `new A()` — тільки f1, f2 (static-крок не повторюється).
Чому: клас ініціалізується один раз, безпосередньо перед першим активним використанням (тут —
перший `new`), і static-члени виконуються в текстовому порядку до появи першого екземпляра.
Instance-члени (поля, instance-блоки, тіло конструктора) виконуються заново при кожному `new`.
reading: «static — один раз для класу, в текстовому порядку, до першого `new`; instance —
при кожному `new`, після static». STRUCTURE-елемент static-блок — єдиний виняток зі спека:
йому теж присвоюється `order` у потоці, бо його місце в текстовому порядку впливає на результат.
Джерело: JLS §12.4 (Initialization of Classes and Interfaces — момент і текстовий порядок
static-ініціалізації), §12.5 (Creation of New Class Instances — крок 4: instance-ініціалізатори
в текстовому порядку).

### 2.2 `+` зі String — обчислення зліва направо, тип змінюється по дорозі

```java
1 + 2 + "3"     // "33"
"1" + 2 + 3     // "123"
```

Порядок: f1 `1 + 2` — обидва операнди `int` → арифметичне додавання → `3` → f2 `3 + "3"` —
правий операнд `String` → конкатенація → `"33"`.
Чому: `+` лівоасоціативний і операнди обчислюються зліва направо; для кожної пари окремо
компілятор вирішує — арифметика це чи конкатенація, залежно від типів саме цієї пари.
reading: «зліва направо; щойно в парі з'являється `String` — ця і всі наступні дії
в ланцюжку стають конкатенацією».
Джерело: JLS §15.18.1 (String Concatenation Operator + — «якщо один з операндів типу String,
виконується конкатенація»; `+` синтаксично лівоасоціативний), §15.7 (Evaluation Order —
операнди обчислюються зліва направо).

### 2.3 Autoboxing і `==` на `Integer`

```java
Integer a = 127, b = 127;   a == b   // true  (кеш)
Integer c = 128, d = 128;   c == d   // false (різні об'єкти)
```

Порядок: f1 `Integer a = 127` — boxing компіл-час константи → f2 `Integer b = 127` — та сама
закешована обгортка → f3 `a == b` порівнює посилання → `true`. f4-f6 те саме для `128` —
поза гарантованим діапазоном кешу → різні об'єкти → `false`.
Чому: JLS гарантує, що boxing constant-виразу `boolean`/`char` (до `\u007f`)/`int`/`short`/`long`
у діапазоні `-128..127` двічі дає той самий об'єкт (кеш обгорток). Поза цим діапазоном
стандарт нічого не гарантує — ідентичність об'єктів там implementation-dependent.
reading для `==` на обгортках: «порівнює посилання, не значення; для значень —
`.equals()`; в діапазоні -128..127 для констант — гарантовано той самий об'єкт, поза ним — ні».
Джерело: JLS §5.1.7 (Boxing Conversion).

### 2.4 Порядок ініціалізації полів: спершу `super()`, потім поля, потім тіло конструктора

```java
class B extends A {
    int x = 5;
    B() { super(); System.out.println(x); }
}
```

Порядок: f1 виклик конструктора суперкласу (`super()`, явний або неявний) завершується
повністю → f2 ініціалізатори полів та instance-блоки в текстовому порядку (`x = 5`) → f3 решта
тіла конструктора.
Чому: JLS фіксує кроки обробки конструктора саме в цьому порядку — суперклас ініціалізується
першим, тоді власні поля, тоді решта коду; до кроку f2 поле має лише дефолтне значення (0/null).
reading: «поле готове лише після `super()` — усередині виклику `super` воно ще не ініціалізоване».
Джерело: JLS §12.5 (Creation of New Class Instances, кроки виконання конструктора).

### 2.5 Streams ліниві до terminal-операції

```java
var s = list.stream().map(x -> { System.out.println(x); return x * 2; });
// нічого не надруковано

s.collect(toList());   // тепер друкує
```

Порядок: f1 `stream()` створює джерело → f2 `map(...)` лише реєструє перетворення й повертає
новий `Stream`, тіло лямбди ще жодного разу не виконане → f3 `collect(toList())` — terminal-
операція — запускає обхід джерела → f4 тіло лямбди з `map` виконується на кожному елементі
під час цього обходу.
Чому: intermediate-операції (`map`, `filter`, …) ліниві — вони будують конвеєр, а не виконують
його; обхід джерела не починається, доки не викликана terminal-операція.
reading для `map`: «відкладено; тіло лямбди виконається лише під час найближчого terminal».
Джерело: java.util.stream, Package Summary («Intermediate operations… are always lazy…
Traversal of the pipeline source does not begin until the terminal operation… is executed»).

### Додатково: анотація — метадані, не виконання

```java
@Override
public String toString() { return "x"; }

@Transactional
public void save(Order o) { repo.save(o); }
```

Порядок: анотація нічого не запускає в потоці виконання — `@Override` перевіряється компілятором
ще на етапі компіляції, `@Transactional` сама по собі під час виклику `save(...)` не виконується;
метод відпрацьовує так, ніби анотації немає.
Чому: анотація — це маркер-метадані, приписані елементу програми; сама вона не має ефекту під
час виконання — ефект (якщо є) дає той, хто цю анотацію читає: компілятор (`@Override`) або
фреймворк через рефлексію під час старту/виклику (`@Transactional`, `@Autowired` — Spring/JPA).
reading: «обробляє Spring/JPA/компілятор, не JVM під час виконання».
kind: `decorator`, `language_specific: true`.
Джерело: JLS §9.7 (Annotations — «An annotation is a marker which associates information with
a program element, but has no effect at run time»).

## 3. Список цукру

`var x = …` у цю таблицю не входить: це вивід типу компілятором (type inference), не
трансформація коду — маркер `let`, kind `data` (див. §1).

| конструкція | kind | equivalent | language_specific |
|---|---|---|---|
| `x -> x + 1` | lambda | анонімний клас, що реалізує єдиний метод функціонального інтерфейсу: `new Function<...>() { public R apply(T x) { return x + 1; } }` | так |
| `String::valueOf` | lambda | `x -> String.valueOf(x)` | так |
| `record P(int x)` | class | клас з полем `x`, конструктором, `equals`/`hashCode`/`toString`, гетером `x()` | так |
| `Optional.ofNullable(a).map(A::b).orElse(null)` | optional_chaining | `a == null ? null : a.b()` | так |
| `for (T t : xs)` (enhanced for) | loop | `Iterator<T> it = xs.iterator(); while (it.hasNext()) { T t = it.next(); … }` | так |
| `try (R r = open()) { … }` | decorator | `R r = open(); try { … } finally { r.close(); }` | так |
| `"""text block"""` | literal | звичайний багаторядковий `String`-літерал | так |
| `case X -> …` (switch expression) | if | класичний `switch(x) { case X: result = …; break; … }` | так |
| `@Override`, `@Transactional`, `@Autowired` | decorator | сама анотація нічого не виконує в рантаймі — «marker… has no effect at run time» (JLS §9.7); поведінку додає той, хто її читає: компілятор для `@Override`, Spring/JPA — рефлексією під час старту | так |
| `@Getter`, `@Data` (Lombok) | decorator | генерує геттери/сеттери/конструктори під час компіляції (annotation processing); у байткоді вже видно як звичайні методи | так |

## 4. Side effects — як розпізнати

- **I/O:** `System.out.*`, `System.err.*`, `Files.*`, `HttpClient` (`.send(`), JDBC
  (`Connection`, `Statement`, `.executeQuery(`), `Logger` (`.info/.warn/.error`).
- **Глобальний стан:** запис у `static`-поле, singleton `getInstance()`, `ThreadLocal`
  (`.set(`).
- **Мутація аргументу:** `list.add/remove/clear`, `map.put`, виклик setter-а на переданому
  об'єкті, `array[i] = …`.

Метод з будь-чим із цього → `side_effect: "<що саме>"`, у гайді ⚠️ і червона рамка.

## 5. Entry point

1. `public static void main(String[] args)` — класичний entry point JVM-застосунку.
2. Клас з анотацією `@SpringBootApplication`.
3. `src/main/java/**/Application.java`, `Main.java`.
4. Для сервлетів — `web.xml` (тег `<servlet-class>`) або клас з `@WebServlet`.

## Джерела

| Джерело | Хто це | Що взято |
|---|---|---|
| [JLS §12.4 — Initialization of Classes and Interfaces](https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html#jls-12.4) | Java Language Specification SE 21, Oracle | §2.1 |
| [JLS §12.5 — Creation of New Class Instances](https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html#jls-12.5) | Java Language Specification SE 21, Oracle | §2.1, §2.4 |
| [JLS §15.18.1 — String Concatenation Operator +](https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.18.1) | Java Language Specification SE 21, Oracle | §2.2 |
| [JLS §5.1.7 — Boxing Conversion](https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html#jls-5.1.7) | Java Language Specification SE 21, Oracle | §2.3 |
| [JLS §15.7 — Evaluation Order](https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.7) | Java Language Specification SE 21, Oracle | §2.2 |
| [java.util.stream — Package Summary](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/package-summary.html) | Java SE 21 API, Oracle | §2.5 |
| [JLS §9.7 — Annotations](https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html#jls-9.7) | Java Language Specification SE 21, Oracle | §3 (анотації) |
