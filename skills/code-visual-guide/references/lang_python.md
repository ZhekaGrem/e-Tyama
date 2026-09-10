# lang_python — як Python читає код

Анотації типів (`: int`, `-> str`, `TypedDict`, поля `dataclass`) тут — **STRUCTURE**: у CPython
вони не перевіряються під час виконання (крім рідкісних `assert`/сторонніх бібліотек) і на
порядок виконання не впливають. Гайд описує поведінку офіційної Language Reference
(еталонна реалізація — CPython); специфіка інших реалізацій (PyPy, Jython) не розглядається.

## 1. Маркери

| kind | сигнал у коді | type |
|---|---|---|
| `const` | `^[A-Z_]+\s*=` (домовленість, не мова) | data |
| `let` | `^\s*\w+\s*=` (звичайне присвоєння) | data |
| `literal` | число, рядок у лапках, `True/False/None`, `[...]`, `{...}`, `(...)` як значення | data |
| `function` | `^\s*(async\s+)?def\s+\w+` на рівні модуля | operation |
| `method` | `def` з відступом усередині `class` | operation |
| `operator` | `+ - * / % == != < > and or not in is =` | operation |
| `return` | `return\b`, `yield\b` | operation |
| `if` | `if\b`, `elif\b`, `match\b` (structural pattern matching) | operation |
| `loop` | `for\b`, `while\b` | operation |
| `lambda` | `lambda\b` | syntax_sugar |
| `comprehension` | `\[.*for.*in.*\]`, `{...for...}`, `(...for...)` | syntax_sugar |
| `decorator` | `^\s*@\w+` перед `def`/`class` | syntax_sugar |
| `async` | `async def|await\b` | syntax_sugar |
| `destructuring` | `a, b = ...` (unpacking), `*args`, `**kwargs` | syntax_sugar |
| `import` | `^(import|from)\b` | structure |
| `class` | `^\s*class\s+\w+` | structure |
| `type` | анотації `: int`, `-> str`, `TypedDict`, поля `dataclass` | structure |

## 2. Пастки читання

`f1`, `f2` у прикладах нижче — порядок підвиразів усередині одного виразу чи виклику. У гайді
нумерація за SKILL.md: рівень модуля — ①②③, тіло функції — f1…; підвирази модульного рівня
нумеруються цілими.

### 2.1 LEGB і UnboundLocalError — присвоєння робить ім'я локальним для всієї функції

```python
x = 1
def f():
    print(x)      # UnboundLocalError
    x = 2
```

Порядок: ① компіляція `f` бачить `x = 2` десь у тілі → `x` вважається локальною для **всієї**
функції → f1 `print(x)` намагається прочитати локальну `x`, яка на цей момент ще не
присвоєна → помилка.
Чому: Python вирішує, локальне ім'я чи ні, аналізуючи все тіло функції одразу — за самим фактом
присвоєння десь усередині, незалежно від того, на якому рядку це присвоєння стоїть.
reading для `print(x)` тут: «ім'я `x` локальне через присвоєння нижче, ще не зв'язане».
Джерело: Execution model, Naming and binding.

### 2.2 Mutable default обчислюється один раз — при визначенні функції

```python
def add(item, bucket=[]):
    bucket.append(item)
    return bucket

add(1)   # [1]
add(2)   # [1, 2] — той самий список
```

Порядок: ① `def add` виконується → вираз `[]` обчислюється один раз і стає значенням за
замовчуванням, «прикріпленим» до функції → f1 виклик `add(1)` мутує саме цей список → f2
виклик `add(2)` мутує його ж, без явного `bucket`.
Чому: default-значення параметра обчислюється при виконанні `def`, а не при кожному виклику;
усі виклики без явного аргументу ділять один і той самий об'єкт.
reading для `bucket=[]`: «створено один раз при визначенні функції, спільне для всіх викликів».
Джерело: Compound statements, Function definitions.

### 2.3 Comprehension: for-клаузи зліва направо, вираз — на кожній ітерації

```python
squares = [n * n for n in range(3) if n]
```

Порядок: f1 `range(3)` обчислюється в зовнішній області → f2 `n = 0`, `if n` хибне → пропуск,
без обчислення `n * n` → f3 `n = 1`, `if n` істинне → `n * n` = 1 додано → f4 `n = 2`, `if n`
істинне → `n * n` = 4 додано.
Чому: найлівіший `for` задає джерело ітерації, кожна наступна клауза (`if`, вкладені `for`)
фільтрує чи звужує потік значень, а вихідний вираз обчислюється лише для значень, що пройшли
всі умови.
equivalent: `squares = []` + `for n in range(3):` + `    if n:` + `        squares.append(n * n)`.
Джерело: Expressions, Displays for lists, sets and dictionaries.

### 2.4 Декоратор виконується при визначенні, не при виклику

```python
@app.route("/")
def home(): ...
```

Порядок: ① `app.route("/")` обчислено (виклик із побічним ефектом — реєстрація) → ② тіло `def`
створює функцію-об'єкт `home` (тут же обчислюються default-аргументи) → ③ результат ①
викликано з `home` → ④ ім'я `home` перепризначено на результат.
Чому: вираз декоратора стоїть над `def` і обчислюється першим — ще до того, як побудовано
об'єкт-функцію; лише після цього об'єкт функції створюється (з його default-аргументами) і
передається в уже обчислений виклик декоратора. Саме тому декоратор із побічним ефектом
(наприклад, реєстрація маршруту) спрацьовує ще до того, як функція, яку він реєструє, існує
як об'єкт.
equivalent: `def home(): ...` + `home = app.route("/")(home)`.
order для декоратора в гайді — окремий крок на рівні модуля (виконання при завантаженні),
а не крок усередині майбутнього виклику `home()`.
Джерело: Compound statements, Function definitions.

### 2.5 `is` проти `==` — ідентичність проти значення

```python
a = [1]
b = [1]
a == b   # True  — однакові значення
a is b   # False — різні об'єкти в пам'яті
```

reading для `is`: «той самий об'єкт у пам'яті, не рівність значень»; для `==`: «однакові
значення, об'єкти можуть бути різними».
Джерело: Expressions, Identity comparisons.

### 2.6 Порядок обчислення — зліва направо, права частина присвоєння перед лівою

```python
a, b = 1, 2
a, b = b, a   # спершу будується (b, a) = (2, 1), потім присвоєння
```

Порядок: f1 права частина `b, a` обчислюється повністю й будує кортеж `(2, 1)` → f2 кортеж
розпаковується й присвоюється цілям зліва направо (`a`, потім `b`).
Чому: Python завжди обчислює праву частину присвоєння цілком, перш ніж почати присвоювати
лівим цілям, тому обмін значень без тимчасової змінної працює коректно.
reading: «права частина обчислена повністю (тут — кортеж) до першого присвоєння зліва».
Джерело: Expressions, Evaluation order.

### 2.7 `import` виконує модуль один раз, далі бере з кешу

```python
import config
import config   # другий import нічого не виконує повторно
```

Порядок: f1 перший `import config` → модуль шукається, його код виконується, результат
кладеться в `sys.modules` → f2 другий `import config` (будь-де в програмі) → ім'я вже є в
`sys.modules`, модуль береться звідти без повторного виконання коду.
Чому: повторне виконання модуля при кожному `import` було б і повільним, і небезпечним (side
effects модуля спрацювали б кілька разів); кеш `sys.modules` цьому запобігає.
reading для другого `import config`: «взято з кешу sys.modules, код модуля не виконувався
повторно».
Джерело: Import system, The module cache.

## 3. Список цукру

§3 дає `equivalent`. `type` елемента береться з §1; рядок §3 робить елемент `syntax_sugar`
лише тоді, коли §1 не дав йому іншого типу. Виглядає як цукор, але ним не є — лишається тим,
чим є в §1.

| конструкція | kind | equivalent | language_specific |
|---|---|---|---|
| `[f(x) for x in xs]` | comprehension | `result = []` + `for x in xs: result.append(f(x))` | так |
| `{k: v for k, v in items}` | comprehension | те саме для словника: `result = {}` + `for k, v in items: result[k] = v` | так |
| `lambda x: x + 1` | lambda | `def _(x): return x + 1` | так |
| `a, b = pair` | destructuring | `a = pair[0]; b = pair[1]` | так |
| `f(*args, **kw)` | destructuring | елементи `args` передаються позиційно, пари `kw` — іменованими аргументами | так |
| `with open(p) as f: ...` | decorator | `f = open(p)` + `try: ...` + `finally: f.close()` (кошик decorator — умовний: with не декоратор, а обгортка блоку; окремого kind немає навмисно) | так |
| `async def f(): ...` | async | функція повертає корутину, яку виконує подієвий цикл `asyncio` | так |
| `await x` | async | призупиняє поточну корутину до готовності `x`, керування повертається до подієвого циклу | так |
| `f"{x}"` | operator | `"…" + str(x)` | так |
| `x if c else y` | if | тернарний вираз — те саме `if/else`, записане як operation-вираз | так |
| `@dataclass` над class | decorator | генерує `__init__`, `__eq__` та інше з оголошених полів класу | так |
| `@property` над методом | decorator | метод читається як звичайне поле: `obj.x`, а не `obj.x()` | так |

## 4. Side effects — як розпізнати

- **I/O:** `print`, `open`, `requests.*`, `os.*`, `subprocess.*`, `logging.*`, будь-яке читання
  чи запис у мережу/файлову систему.
- **Глобальний стан:** `global x` / `nonlocal x` у тілі функції, присвоєння атрибутам модуля
  ззовні функції, зміна `sys.path` та подібних глобальних реєстрів.
- **Мутація аргументу:** `.append/.extend/.pop/.sort/.update` на аргументі, `del arg[k]`,
  `arg.attr = ...` де `arg` — параметр функції.

Функція з будь-чим із цього → `side_effect: "<що саме>"`, у гайді ⚠️ і червона рамка.

## 5. Entry point

1. `if __name__ == "__main__":` у файлі, який запускається напряму.
2. Файли за назвою: `main.py`, `app.py`, `manage.py`, `__main__.py`.
3. `pyproject.toml` → секція `[project.scripts]` (консольні entry points пакета).
4. Django: `wsgi.py` / `asgi.py`.
5. FastAPI / Flask: файл, де є `app = FastAPI()` або `app = Flask(__name__)`.
6. Нічого не знайдено → файл із найбільшим числом вихідних імпортів.

## Джерела

| Джерело | Хто це | Що взято |
|---|---|---|
| [Execution model — Naming and binding](https://docs.python.org/3/reference/executionmodel.html#naming-and-binding) | офіційна документація Python 3, Language Reference | §2.1 |
| [Compound statements — Function definitions](https://docs.python.org/3/reference/compound_stmts.html#function-definitions) | офіційна документація Python 3, Language Reference | §2.2, §2.4 |
| [Expressions — Displays for lists, sets and dictionaries](https://docs.python.org/3/reference/expressions.html#displays-for-lists-sets-and-dictionaries) | офіційна документація Python 3, Language Reference | §2.3 |
| [Expressions — Evaluation order](https://docs.python.org/3/reference/expressions.html#evaluation-order) | офіційна документація Python 3, Language Reference | §2.6 |
| [Expressions — Identity comparisons](https://docs.python.org/3/reference/expressions.html#is-not) | офіційна документація Python 3, Language Reference | §2.5 |
| [The import system — The module cache](https://docs.python.org/3/reference/import.html#the-module-cache) | офіційна документація Python 3, Language Reference | §2.7 |
