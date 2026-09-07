# Генерація PDF — крос-платформно, без інсталяцій

Підхід: headless Chrome/Edge/Chromium друкує самодостатній HTML у PDF. Офлайн, детерміновано,
нічого не качає.

| Платформа | Стан |
|---|---|
| Windows | перевірено на реальній машині |
| macOS | ті самі прапорці, інші шляхи |
| Linux | ті самі прапорці, браузер шукається через `command -v` |
| Телефон | **напряму неможливо** — див. розділ у кінці |

---

## Крок 0 — визнач платформу

```bash
case "$(uname -s)" in
  Darwin)                 OS=macos   ;;
  Linux)                  OS=linux   ;;
  MINGW*|MSYS*|CYGWIN*)   OS=windows ;;   # Git Bash — краще піти в PowerShell
  *)                      echo "Unsupported: $(uname -s)"; exit 1 ;;
esac
```

На Windows виконуй PowerShell-версію нижче, не bash: шляхи з пробілами й `Program Files`
у Git Bash поводяться непередбачувано.

---

## Windows (PowerShell)

### Крок 1 — знайти браузер

Бери ПЕРШИЙ що існує:

```powershell
$cands = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$browser = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Write-Output "NO_BROWSER" }
```

### Крок 2 — тека

Тека `retro/` — у корені робочої теки учня. Шлях від поточної теки, не хардкод.

```powershell
$dir = Join-Path (Get-Location) "retro"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
```

### Крок 3 — згенерувати

```powershell
$base = "2026-06-23-<kebab-тема>"   # без розширення
$dir  = Join-Path (Get-Location) "retro"
$html = Join-Path $dir "$base.html"
$pdf  = Join-Path $dir "$base.pdf"
$url  = "file:///" + ($html -replace '\\','/')   # file:/// вимагає АБСОЛЮТНОГО шляху
$tmp  = "$env:TEMP\chrome-retro-profile"

& $browser --headless=new --disable-gpu --no-first-run --no-pdf-header-footer `
  --user-data-dir="$tmp" --print-to-pdf="$pdf" "$url" 2>&1 | Out-Null
Start-Sleep -Milliseconds 1200
```

### Крок 4 — перевірити

```powershell
if ((Test-Path $pdf) -and ((Get-Item $pdf).Length -gt 0)) {
  Write-Output "OK $pdf $((Get-Item $pdf).Length) bytes"
} else {
  Write-Output "FAIL"
}
```

---

## macOS (bash)

```bash
# Крок 1 — браузер
if   [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
  BROWSER="/Applications/Chromium.app/Contents/MacOS/Chromium"
elif [ -x "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
  BROWSER="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
elif [ -x "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  BROWSER="$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  echo "NO_BROWSER"; exit 1
fi

# Крок 2 — тека
DIR="$(pwd)/retro"
mkdir -p "$DIR"

# Крок 3 — генерація
BASE="2026-06-23-<kebab-тема>"
HTML="$DIR/$BASE.html"
PDF="$DIR/$BASE.pdf"
URL="file://$HTML"                      # шлях уже починається з "/", разом = file:///
TMP="${TMPDIR:-/tmp}/chrome-retro-profile"

"$BROWSER" --headless=new --disable-gpu --no-first-run --no-pdf-header-footer \
  --user-data-dir="$TMP" --print-to-pdf="$PDF" "$URL" 2>/dev/null
sleep 1.2

# Крок 4 — перевірка
if [ -s "$PDF" ]; then
  echo "OK $PDF $(stat -f%z "$PDF") bytes"     # BSD stat
else
  echo "FAIL"
fi
```

---

## Linux (bash)

Відрізняється від macOS **двома** місцями: пошук браузера і синтаксис `stat`.
Скопіювати macOS-версію цілком не можна.

```bash
# Крок 1 — браузер
for c in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if command -v "$c" >/dev/null 2>&1; then BROWSER="$c"; break; fi
done
# snap-інсталяції часто не в PATH під sudo
[ -z "$BROWSER" ] && [ -x /snap/bin/chromium ] && BROWSER=/snap/bin/chromium
[ -z "$BROWSER" ] && { echo "NO_BROWSER"; exit 1; }

# Крок 2 — тека
DIR="$(pwd)/retro"
mkdir -p "$DIR"

# Крок 3 — генерація
BASE="2026-06-23-<kebab-тема>"
HTML="$DIR/$BASE.html"
PDF="$DIR/$BASE.pdf"
URL="file://$HTML"
TMP="${TMPDIR:-/tmp}/chrome-retro-profile"

SANDBOX=""
[ "$(id -u)" = "0" ] && SANDBOX="--no-sandbox"    # під root Chrome інакше не стартує

"$BROWSER" --headless=new --disable-gpu --no-first-run --no-pdf-header-footer \
  $SANDBOX --user-data-dir="$TMP" --print-to-pdf="$PDF" "$URL" 2>/dev/null
sleep 1.2

# Крок 4 — перевірка
if [ -s "$PDF" ]; then
  echo "OK $PDF $(stat -c%s "$PDF") bytes"      # GNU stat, НЕ -f%z
else
  echo "FAIL"
fi
```

---

## Нотатки, які коштували часу

- **`--user-data-dir` обов'язковий на всіх ОС.** Без нього Chrome падає тихо (exit 0, файлу
  немає), якщо звичайний Chrome уже відкритий — lock на дефолтний профіль.
- **`--headless=new`** — новий headless. Класичний `--headless` без профілю не спрацював.
  На дуже старих збірках Chromium (< 109) `=new` не підтримується — тоді просто `--headless`.
- **`--no-pdf-header-footer`** прибирає колонтитули. На старих збірках — `--print-to-pdf-no-header`.
- **`stat`:** macOS `-f%z`, Linux `-c%s`. Переплутаєш — перевірка завжди каже FAIL,
  хоча PDF створився.
- **`$TMPDIR`:** на macOS заданий, на більшості Linux — ні. Без `${TMPDIR:-/tmp}` шлях
  стане `/chrome-retro-profile` і запис провалиться.
- **`file://`:** абсолютний шлях уже починається з `/`, тому `file://` + `/Users/...` дає
  правильні три слеші. На Windows шлях починається з літери диска, тому там треба `file:///`
  явно. **Пробіли в шляху** ламають URL — або уникай їх, або кодуй як `%20`.
- **Chrome пише в stderr** рядок `NNNNN bytes written to file ...` — це УСПІХ, не помилка.
  PowerShell обгортає stderr як NativeCommandError. Орієнтуйся на існування файлу, не на код виходу.
- Шаблон статичний (CSS, без JS) → `--virtual-time-budget` не потрібен.

PDF має бути > ~10 KB. Нуль байтів або немає файлу — генерація провалилась.

---

## Fallback — браузера немає або PDF не вийшов

1. HTML усе одно збережений — він самодостатній.
2. Скажи учневі чесно: PDF не згенерувався, ось HTML, відкрий у браузері й
   `Ctrl+P` / `Cmd+P` → «Зберегти як PDF».
3. **НЕ кажи «готово»**, якщо PDF не створено.

---

## Телефон — прямої генерації немає

Скажи це прямо, не обіцяй те, чого не буде.

На iOS та Android **немає CLI-браузера**: ані `chrome.exe`, ані `google-chrome`, ані
headless-режиму. Немає й доступу до файлової системи, як на десктопі. Тому крок 3 не
виконується взагалі.

**Що працює насправді — і цього достатньо:**

Віддай учневі HTML і скажи: відкрити у браузері телефона → **Поділитися → Друк → Зберегти
як PDF**. Це вбудовано і в iOS, і в Android, дає той самий рушій друку і ту саму якість.
Один зайвий тап замість інфраструктури.

**Чого тут свідомо НЕ робимо:**

| Варіант | Чому ні |
|---|---|
| Свій бекенд із Playwright | Tyama — набір скілів, не сервіс. Сервер треба хостити, оновлювати й платити за нього |
| Хмарні PDF API (Browserless, PDF4.dev) | зовнішня залежність, ключі, ліміти, і твої логи їдуть на чужий сервер |
| `jsPDF` / `html2pdf.js` у браузері | гірша якість друку, обмежена підтримка CSS, великі файли падають |

Це не «колись зробимо». Для навчального плагіна вбудований друк телефона — правильна
відповідь, а не компроміс.

---

## Чому не Mermaid / не pandoc / не puppeteer

- **Mermaid** рендериться асинхронно → крихкий тайминг у headless + потрібен CDN.
- **pandoc / wkhtmltopdf** — окрема інсталяція, якої в учня може не бути.
- **puppeteer / md-to-pdf** — качають ~150 MB при першому запуску.

CSS-схема в HTML друкується однаково скрізь, без мережі й без інсталяцій.
