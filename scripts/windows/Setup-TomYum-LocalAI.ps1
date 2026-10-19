$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$Model     = "qwen3.5:4b"
$OllamaUrl = "http://127.0.0.1:11434"

function Write-Step([string]$Text) {

    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Fail([string]$Text) {

    Write-Host ""
    Write-Host "ERROR: $Text" -ForegroundColor Red
    Write-Host ""
    Read-Host "กด Enter เพื่อปิด"

    exit 1
}

function Refresh-Path {

    $machine = [Environment]::GetEnvironmentVariable(
        "Path",
        "Machine"
    )

    $user = [Environment]::GetEnvironmentVariable(
        "Path",
        "User"
    )

    $env:Path = "$machine;$user"
}

function Get-OllamaCommand {

    $cmd = Get-Command ollama.exe -ErrorAction SilentlyContinue

    if ($cmd) {
        return $cmd.Source
    }

    $fallback = Join-Path `
        $env:LOCALAPPDATA `
        "Programs\Ollama\ollama.exe"

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

function Get-DotEnvValue(
    [string]$Path,
    [string]$Name
) {

    if (-not (Test-Path $Path)) {
        return $null
    }

    $escaped = [regex]::Escape($Name)

    $line = Get-Content `
        -LiteralPath $Path `
        -ErrorAction SilentlyContinue |
    Where-Object {
        $_ -match "^\s*$escaped\s*="
    } |
    Select-Object -Last 1

    if (-not $line) {
        return $null
    }

    $value = ($line -split "=", 2)[1].Trim()

    if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    return $value
}

Set-Location $ProjectRoot

Write-Host ""
Write-Host "TOM YUM BANG C" -ForegroundColor DarkYellow
Write-Host "Restaurant Stock + Local AI Setup"
Write-Host "========================================"
Write-Host ""
Write-Host "Setup นี้ใช้สำหรับการติดตั้งครั้งแรกเท่านั้น"
Write-Host ""

# ------------------------------------------------------------
# Project validation
# ------------------------------------------------------------

if (-not (Test-Path "package.json")) {
    Fail "ไม่พบ package.json"
}

if (-not (Test-Path "package-lock.json")) {
    Fail "ไม่พบ package-lock.json"
}

# ------------------------------------------------------------
# Node.js
# ------------------------------------------------------------

Write-Step "ตรวจสอบ Node.js"

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {

    Write-Host "ไม่พบ Node.js"

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue

    if (-not $winget) {

        Write-Host ""
        Write-Host "กรุณาติดตั้ง Node.js LTS จากเว็บไซต์ทางการ"
        Start-Process "https://nodejs.org/"

        Fail "ติดตั้ง Node.js แล้วให้รัน Setup อีกครั้ง"
    }

    Write-Host "กำลังติดตั้ง Node.js LTS ผ่าน Windows Package Manager..."

    & winget install `
        --id OpenJS.NodeJS.LTS `
        -e `
        --accept-source-agreements `
        --accept-package-agreements

    if ($LASTEXITCODE -ne 0) {

        Start-Process "https://nodejs.org/"

        Fail "ติดตั้ง Node.js อัตโนมัติไม่สำเร็จ"
    }

    Refresh-Path
}

try {

    $nodeVersion = (& node -p "process.versions.node").Trim()

    $nodeMajor = [int](($nodeVersion -split "\.")[0])
}
catch {

    Fail "ไม่สามารถอ่าน Node.js version"
}

if ($nodeMajor -lt 20) {

    Fail (
        "Node.js ปัจจุบันคือ v" +
        $nodeVersion +
        " ต้องใช้ Node.js 20 ขึ้นไป"
    )
}

Write-Host "Node.js v$nodeVersion : พร้อม" -ForegroundColor Green

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Fail "ไม่พบ npm"
}

# ------------------------------------------------------------
# Ollama
# ------------------------------------------------------------

Write-Step "ตรวจสอบ Ollama"

$OllamaCommand = Get-OllamaCommand

if (-not $OllamaCommand) {

    Write-Host "ไม่พบ Ollama"

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue

    if (-not $winget) {

        Start-Process "https://ollama.com/download/windows"

        Fail "ติดตั้ง Ollama แล้วให้รัน Setup อีกครั้ง"
    }

    Write-Host "กำลังติดตั้ง Ollama ผ่าน Windows Package Manager..."

    & winget install `
        --id Ollama.Ollama `
        -e `
        --accept-source-agreements `
        --accept-package-agreements

    if ($LASTEXITCODE -ne 0) {

        Start-Process "https://ollama.com/download/windows"

        Fail "ติดตั้ง Ollama อัตโนมัติไม่สำเร็จ"
    }

    Refresh-Path

    Start-Sleep -Seconds 2

    $OllamaCommand = Get-OllamaCommand
}

if (-not $OllamaCommand) {

    Fail "ยังไม่พบ Ollama หลังการติดตั้ง"
}

Write-Host "Ollama : พร้อม" -ForegroundColor Green

# ------------------------------------------------------------
# Start Ollama if required
# ------------------------------------------------------------

if (-not (Test-Ollama)) {

    Write-Host "กำลังเปิด Ollama..."

    Start-Process `
        -FilePath $OllamaCommand `
        -ArgumentList "serve" `
        -WindowStyle Hidden

    $ollamaReady = $false

    for ($i = 0; $i -lt 30; $i++) {

        Start-Sleep -Seconds 1

        if (Test-Ollama) {

            $ollamaReady = $true
            break
        }
    }

    if (-not $ollamaReady) {

        Fail "Ollama ไม่ตอบสนอง"
    }
}

# ------------------------------------------------------------
# Model
# ------------------------------------------------------------

Write-Step "ตรวจสอบ $Model"

$tags = Invoke-RestMethod `
    -Uri "$OllamaUrl/api/tags" `
    -Method Get `
    -TimeoutSec 5

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

    Write-Host ""
    Write-Host "$Model ยังไม่ได้ติดตั้ง"
    Write-Host "กำลัง Download Local AI Model..."
    Write-Host ""
    Write-Host "ไฟล์ Model มีขนาดหลาย GB และอาจใช้เวลาสักครู่"
    Write-Host ""

    & $OllamaCommand pull $Model

    if ($LASTEXITCODE -ne 0) {

        Fail "Download $Model ไม่สำเร็จ"
    }
}

Write-Host "$Model : พร้อม" -ForegroundColor Green

# ------------------------------------------------------------
# Environment
# ------------------------------------------------------------

Write-Step "ตรวจสอบ Environment Configuration"

$envFile = Join-Path $ProjectRoot ".env.local"

if (-not (Test-Path $envFile)) {

    $exampleFile = Join-Path $ProjectRoot ".env.example"

    if (-not (Test-Path $exampleFile)) {

        Fail "ไม่พบ .env.example"
    }

    Copy-Item `
        $exampleFile `
        $envFile `
        -Force

    Write-Host ""
    Write-Host ".env.local ถูกสร้างจาก .env.example" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "กรุณาใส่ Production Supabase configuration"
    Write-Host "จากเจ้าของระบบก่อนดำเนินการต่อ"
    Write-Host ""
    Write-Host "ห้ามส่ง Production Secret ผ่านช่องทางสาธารณะ"
    Write-Host ""

    Start-Process notepad.exe $envFile

    Read-Host "แก้ .env.local และ Save แล้วกด Enter"
}

$required = @(
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY"
)

foreach ($key in $required) {

    $value = Get-DotEnvValue $envFile $key

    if ([string]::IsNullOrWhiteSpace($value)) {

        Fail "$key ยังไม่ได้ตั้งค่าใน .env.local"
    }
}

Write-Host "Environment : พร้อม" -ForegroundColor Green

# ------------------------------------------------------------
# Install dependencies
# ------------------------------------------------------------

Write-Step "ติดตั้ง Application Dependencies"

& npm.cmd ci

if ($LASTEXITCODE -ne 0) {

    Fail "npm ci ไม่สำเร็จ"
}

# ------------------------------------------------------------
# Production build
# ------------------------------------------------------------

Write-Step "สร้าง Production Build"

& npm.cmd run build

if ($LASTEXITCODE -ne 0) {

    Fail "Production Build ไม่ผ่าน"
}

# ------------------------------------------------------------
# Runtime directory
# ------------------------------------------------------------

New-Item `
    -ItemType Directory `
    -Force `
    -Path (Join-Path $ProjectRoot ".runtime") |
Out-Null

# ------------------------------------------------------------
# Desktop shortcut
# ------------------------------------------------------------

Write-Step "สร้าง Desktop Shortcut"

$desktop = [Environment]::GetFolderPath("Desktop")

$shortcutPath = Join-Path `
    $desktop `
    "TOM YUM BANG C Stock AI.lnk"

$launcher = Join-Path `
    $ProjectRoot `
    "Start-TomYum-Stock-AI.cmd"

if (-not (Test-Path $launcher)) {

    Fail "ไม่พบ Start-TomYum-Stock-AI.cmd"
}

$wshell = New-Object -ComObject WScript.Shell

$shortcut = $wshell.CreateShortcut($shortcutPath)

$shortcut.TargetPath       = $launcher
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description      = "TOM YUM BANG C Restaurant Stock + Local AI"

$shortcut.Save()

Write-Host "Desktop Shortcut : พร้อม" -ForegroundColor Green

# ------------------------------------------------------------
# Health check
# ------------------------------------------------------------

Write-Step "ตรวจสอบระบบหลังติดตั้ง"

$checkScript = Join-Path `
    $PSScriptRoot `
    "Check-TomYum-System.ps1"

& powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $checkScript

if ($LASTEXITCODE -ne 0) {

    Write-Host ""
    Write-Host "Setup เสร็จ แต่ Health Check พบสิ่งที่ต้องตรวจสอบ" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "กด Enter เพื่อปิด"

    exit 1
}

# ------------------------------------------------------------
# Complete
# ------------------------------------------------------------

Write-Host ""
Write-Host "========================================"
Write-Host "SETUP COMPLETE" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "TOM YUM BANG C Restaurant Stock"
Write-Host "Local AI : $Model"
Write-Host ""
Write-Host "Desktop Shortcut:"
Write-Host "TOM YUM BANG C Stock AI"
Write-Host ""

$answer = Read-Host "เปิดระบบตอนนี้หรือไม่? (Y/N)"

if ($answer -match "^[Yy]") {

    Start-Process $launcher
}