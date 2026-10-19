$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$AppUrl    = "http://127.0.0.1:3000"
$OllamaUrl = "http://127.0.0.1:11434"
$Model     = "qwen3.5:4b"

$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile    = Join-Path $RuntimeDir "restaurant-stock.pid"
$OutLog     = Join-Path $RuntimeDir "server.out.log"
$ErrLog     = Join-Path $RuntimeDir "server.err.log"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Fail([string]$Text) {
    Write-Host ""
    Write-Host "ERROR: $Text" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Get-OllamaCommand {
    $cmd = Get-Command ollama.exe -ErrorAction SilentlyContinue

    if ($cmd) {
        return $cmd.Source
    }

    $fallback = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"

    if (Test-Path $fallback) {
        return $fallback
    }

    return $null
}

function Test-Ollama {
    try {
        Invoke-RestMethod `
            -Uri "$OllamaUrl/api/tags" `
            -Method Get `
            -TimeoutSec 3 |
        Out-Null

        return $true
    }
    catch {
        return $false
    }
}

function Test-App {
    try {
        $response = Invoke-WebRequest `
            -Uri "$AppUrl/login" `
            -UseBasicParsing `
            -TimeoutSec 3

        return (
            $response.StatusCode -ge 200 -and
            $response.StatusCode -lt 500
        )
    }
    catch {
        return $false
    }
}

Set-Location $ProjectRoot

New-Item `
    -ItemType Directory `
    -Force `
    -Path $RuntimeDir |
Out-Null

Write-Host ""
Write-Host "TOM YUM BANG C" -ForegroundColor DarkYellow
Write-Host "Restaurant Stock + Local AI"
Write-Host "----------------------------------------"

# ------------------------------------------------------------
# Required application files
# ------------------------------------------------------------

Write-Step "ตรวจสอบระบบ"

if (-not (Test-Path ".env.local")) {
    Fail "ไม่พบ .env.local กรุณารัน Setup-TomYum-Stock-AI.cmd ก่อน"
}

if (-not (Test-Path ".next\BUILD_ID")) {
    Fail "ไม่พบ Production Build กรุณารัน Setup-TomYum-Stock-AI.cmd ก่อน"
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Fail "ไม่พบ Node.js"
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Fail "ไม่พบ npm"
}

# ------------------------------------------------------------
# Ollama
# ------------------------------------------------------------

Write-Step "ตรวจสอบ Ollama"

$OllamaCommand = Get-OllamaCommand

if (-not $OllamaCommand) {
    Fail "ไม่พบ Ollama กรุณารัน Setup-TomYum-Stock-AI.cmd"
}

if (-not (Test-Ollama)) {

    Write-Host "กำลังเปิด Ollama..."

    Start-Process `
        -FilePath $OllamaCommand `
        -ArgumentList "serve" `
        -WindowStyle Hidden

    $ready = $false

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1

        if (Test-Ollama) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        Fail "Ollama ไม่ตอบสนองที่ 127.0.0.1:11434"
    }
}

Write-Host "Ollama: พร้อม" -ForegroundColor Green

# ------------------------------------------------------------
# Model
# ------------------------------------------------------------

Write-Step "ตรวจสอบ Local AI Model"

try {
    $tags = Invoke-RestMethod `
        -Uri "$OllamaUrl/api/tags" `
        -Method Get `
        -TimeoutSec 5
}
catch {
    Fail "ไม่สามารถอ่าน Model จาก Ollama"
}

$modelFound = $false

foreach ($item in $tags.models) {

    if (
        $item.name -eq $Model -or
        $item.model -eq $Model
    ) {
        $modelFound = $true
        break
    }
}

if (-not $modelFound) {
    Fail "ไม่พบ $Model กรุณารัน Setup-TomYum-Stock-AI.cmd"
}

Write-Host "$Model : พร้อม" -ForegroundColor Green

# ------------------------------------------------------------
# Existing managed server
# ------------------------------------------------------------

Write-Step "ตรวจสอบ Restaurant Stock"

if (Test-Path $PidFile) {

    $savedPidText = (Get-Content $PidFile -ErrorAction SilentlyContinue).Trim()

    $savedPid = 0

    if ([int]::TryParse($savedPidText, [ref]$savedPid)) {

        $listener = Get-NetTCPConnection `
            -LocalPort 3000 `
            -State Listen `
            -ErrorAction SilentlyContinue |
        Where-Object {
            $_.OwningProcess -eq $savedPid
        } |
        Select-Object -First 1

        if ($listener -and (Test-App)) {

            Write-Host "Restaurant Stock เปิดอยู่แล้ว" -ForegroundColor Green

            Start-Process "$AppUrl/reports"
            exit 0
        }
    }

    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------
# Protect port 3000
# ------------------------------------------------------------

$existingListener = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue |
Select-Object -First 1

if ($existingListener) {

    Fail (
        "Port 3000 ถูกใช้งานโดย Process PID " +
        $existingListener.OwningProcess +
        " และไม่ได้ถูกเปิดโดย TOM YUM BANG C Launcher"
    )
}

# ------------------------------------------------------------
# Local AI runtime
# ------------------------------------------------------------

$env:AI_LOCAL_ENABLED = "true"
$env:OLLAMA_BASE_URL   = $OllamaUrl
$env:OLLAMA_MODEL      = $Model
$env:OLLAMA_TIMEOUT_MS = "120000"
$env:OLLAMA_KEEP_ALIVE = "10m"

# ------------------------------------------------------------
# Start Next.js production
# ------------------------------------------------------------

Write-Step "กำลังเปิด Restaurant Stock + Local AI"

Remove-Item $OutLog, $ErrLog -Force -ErrorAction SilentlyContinue

$npmProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @(
        "start",
        "--",
        "-H",
        "127.0.0.1",
        "-p",
        "3000"
    ) `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden `
    -PassThru

# ------------------------------------------------------------
# Wait for application
# ------------------------------------------------------------

$appReady = $false

for ($i = 0; $i -lt 60; $i++) {

    Start-Sleep -Seconds 1

    if (Test-App) {
        $appReady = $true
        break
    }

    if ($npmProcess.HasExited) {
        break
    }
}

if (-not $appReady) {

    if (-not $npmProcess.HasExited) {
        taskkill /PID $npmProcess.Id /T /F | Out-Null
    }

    Write-Host ""
    Write-Host "Server log:" -ForegroundColor Yellow
    Write-Host $ErrLog

    Fail "Restaurant Stock ไม่สามารถเริ่มทำงานภายใน 60 วินาที"
}

# ------------------------------------------------------------
# Save actual Next.js listener PID
# ------------------------------------------------------------

$listener = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue |
Select-Object -First 1

if (-not $listener) {

    Fail "ระบบเปิดแล้วแต่ไม่พบ Process ที่ฟัง Port 3000"
}

[System.IO.File]::WriteAllText(
    $PidFile,
    [string]$listener.OwningProcess,
    [System.Text.Encoding]::ASCII
)

Write-Host ""
Write-Host "พร้อมใช้งาน" -ForegroundColor Green
Write-Host "Local AI : $Model"
Write-Host "Address  : $AppUrl"
Write-Host "PID      : $($listener.OwningProcess)"

Start-Process "$AppUrl/reports"