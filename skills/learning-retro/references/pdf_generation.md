# Генерація PDF — точні команди (Windows, без інсталяцій)

Підхід: headless Chrome/Edge друкує самодостатній HTML у PDF. Офлайн, детерміновано.

## Крок 1 — знайти браузер

Перевіряй у цьому порядку, бери ПЕРШИЙ що існує (`Test-Path`):

```
C:\Program Files\Google\Chrome\Application\chrome.exe          # Chrome (пріоритет)
C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe   # Edge (fallback)
C:\Program Files\Microsoft\Edge\Application\msedge.exe
```

PowerShell-снайпет для вибору:
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

## Крок 2 — переконатися що папка є

Тека `retro/` — у корені робочої теки учня. Шлях будуємо від поточної теки, не хардкодимо.

```powershell
$dir = Join-Path (Get-Location) "retro"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
```

## Крок 3 — згенерувати PDF

ПЕРЕВІРЕНО на цій машині. `file:///` зі **прямими** слешами. Ключове: `--headless=new` +
власний `--user-data-dir` (без нього Chrome тихо НЕ створює PDF, якщо основний профіль зайнятий
відкритим браузером).

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

Нотатки:
- **`--user-data-dir` обов'язковий** — інакше Chrome падає тихо (exit 0, але файлу немає), якщо
  звичайний Chrome уже відкритий (lock на дефолтний профіль). Це була причина першого фейлу.
- **`--headless=new`** — новий headless; класичний `--headless` без профілю не спрацював.
- `--no-pdf-header-footer` прибирає колонтитули (URL/дата). На дуже старих збірках — `--print-to-pdf-no-header`.
- Chrome пише в **stderr** рядок `NNNNN bytes written to file ...` — це УСПІХ, не помилка.
  PowerShell обгортає stderr як NativeCommandError — ігноруй, орієнтуйся на Test-Path (Крок 4).
- Контент шаблону статичний (CSS-схема, без JS) → `--virtual-time-budget` НЕ потрібен.

## Крок 4 — перевірити результат (Verification)

```powershell
if ((Test-Path $pdf) -and ((Get-Item $pdf).Length -gt 0)) {
  Write-Output "OK $pdf $((Get-Item $pdf).Length) bytes"
} else {
  Write-Output "FAIL"
}
```

PDF має бути > ~10 KB. Якщо 0 байт або файлу немає — генерація провалилась.

## Fallback — браузера немає або PDF не вийшов

1. HTML усе одно збережений у `retro/` — він самодостатній.
2. Повідом учневі чесно: PDF не згенерувався, ось HTML, відкрий його у браузері й
   `Ctrl+P → Зберегти як PDF`.
3. НЕ кажи «готово», якщо PDF не створено (див. Verification у SKILL.md).

## Чому не Mermaid / не pandoc / не puppeteer

- Mermaid рендериться асинхронно → крихкий тайминг у headless + потрібен CDN.
- pandoc/wkhtmltopdf — не встановлені на машині.
- puppeteer/md-to-pdf — качають ~150 MB при першому запуску.
CSS-схема в HTML друкується завжди однаково, без мережі й без інсталяцій.
