$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$OllamaUrl = "http://127.0.0.1:11434"
$Model     = "qwen3.5:4b"

$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile    = Join-Path $RuntimeDir "restaurant-stock.pid"

$script:Failures = 0

function Pass([string]$Name, [string]$Detail = "") {

    Write-Host ("[PASS] " + $Name) -ForegroundColor Green

    if ($Detail) {
        Write-Host ("       " + $Detail) -ForegroundColor DarkGray
    }
}

function Warn([string]$Name, [string]$Detail = "") {

    Write-Host ("[WARN] " + $Name) -ForegroundColor Yellow

    if ($Detail) {
        Write-Host ("       " + $Detail) -ForegroundColor DarkGray
    }
}

function Fail([string]$Name, [string]$Detail = "") {

    $script:Failures++

    Write-Host ("[FAIL] " + $Name) -ForegroundColor Red

    if ($Detail) {
        Write-Host ("       " + $Detail) -ForegroundColor DarkGray
    }
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
Write-Host "System Health Check"
Write-Host "========================================"

# ------------------------------------------------------------
# Windows
# ------------------------------------------------------------

Write-Host ""
Write-Host "Environment" -ForegroundColor Cyan

Pass "Windows" ([Environment]::OSVersion.VersionString)

# ------------------------------------------------------------
# Node
# ------------------------------------------------------------

$node = Get-Command node.exe -ErrorAction SilentlyContinue

if ($node) {

    try {

        $nodeVersion = (& node -p "process.versions.node").Trim()

        $major = [int](($nodeVersion -split "\.")[0])

        if ($major -ge 20) {
            Pass "Node.js" ("v" + $nodeVersion)
        }
        else {
            Fail "Node.js" "ต้องการ Node.js 20 ขึ้นไป"
        }
    }
    catch {
        Fail "Node.js" "ไม่สามารถอ่าน Version"
    }
}
else {

    Fail "Node.js" "ไม่พบ Node.js"
}

# ------------------------------------------------------------
# npm
# ------------------------------------------------------------

if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {

    try {
        $npmVersion = (& npm.cmd --version).Trim()
        Pass "npm" $npmVersion
    }
    catch {
        Fail "npm"
    }
}
else {

    Fail "npm" "ไม่พบ npm"
}

# ------------------------------------------------------------
# Environment
# ------------------------------------------------------------

Write-Host ""
Write-Host "Application" -ForegroundColor Cyan

$envFile = Join-Path $ProjectRoot ".env.local"

if (Test-Path $envFile) {

    Pass ".env.local"

    $required = @(
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY"
    )

    foreach ($key in $required) {

        $value = Get-DotEnvValue $envFile $key

        if ([string]::IsNullOrWhiteSpace($value)) {
            Fail $key "ไม่มีค่าใน .env.local"
        }
        else {
            Pass $key "configured"
        }
    }
}
else {

    Fail ".env.local" "ไม่พบไฟล์"
}

# ------------------------------------------------------------
# Git secret protection
# ------------------------------------------------------------

if (Get-Command git.exe -ErrorAction SilentlyContinue) {

    & git check-ignore -q .env.local

    if ($LASTEXITCODE -eq 0) {
        Pass "Git secret protection" ".env.local is ignored"
    }
    else {
        Fail "Git secret protection" ".env.local ไม่ถูก ignore"
    }
}
else {

    Warn "Git" "ไม่ได้ติดตั้ง — ไม่จำเป็นสำหรับการใช้งานประจำวัน"
}

# ------------------------------------------------------------
# Production build
# ------------------------------------------------------------

if (Test-Path ".next\BUILD_ID") {
    Pass "Production Build"
}
else {
    Fail "Production Build" "กรุณารัน Setup ใหม่"
}

# ------------------------------------------------------------
# Ollama
# ------------------------------------------------------------

Write-Host ""
Write-Host "Local AI" -ForegroundColor Cyan

$ollamaCommand = Get-OllamaCommand

if ($ollamaCommand) {

    Pass "Ollama executable" $ollamaCommand

    try {

        $tags = Invoke-RestMethod `
            -Uri "$OllamaUrl/api/tags" `
            -Method Get `
            -TimeoutSec 4

        Pass "Ollama API" "127.0.0.1:11434"

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

        if ($modelFound) {
            Pass "Local AI Model" $Model
        }
        else {
            Fail "Local AI Model" "$Model ยังไม่ได้ติดตั้ง"
        }
    }
    catch {

        Fail "Ollama API" "Ollama ยังไม่ทำงาน"
    }
}
else {

    Fail "Ollama" "ไม่พบ Ollama"
}

# ------------------------------------------------------------
# Supabase connectivity
# ------------------------------------------------------------

$supabaseUrl = Get-DotEnvValue `
    $envFile `
    "NEXT_PUBLIC_SUPABASE_URL"

$publishableKey = Get-DotEnvValue `
    $envFile `
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"

if (
    -not [string]::IsNullOrWhiteSpace($supabaseUrl) -and
    -not [string]::IsNullOrWhiteSpace($publishableKey)
) {

    try {

        $healthUrl = $supabaseUrl.TrimEnd("/") + "/auth/v1/health"

        $headers = @{
            apikey = $publishableKey
        }

        $response = Invoke-WebRequest `
            -Uri $healthUrl `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 8 `
            -ErrorAction Stop

        if (
            $response.StatusCode -ge 200 -and
            $response.StatusCode -lt 300
        ) {
            Pass "Supabase Cloud" $supabaseUrl
        }
        else {
            Fail "Supabase Cloud" "HTTP $($response.StatusCode)"
        }
    }
    catch {

        $statusCode = $null

        try {
            $statusCode = [int]$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$OllamaUrl = "http://127.0.0.1:11434"
$Model     = "qwen3.5:4b"

$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile    = Join-Path $RuntimeDir "restaurant-stock.pid"

$script:Failures = 0

function Pass([string]$Name, [string]$Detail = "") {

    Write-Host ("[PASS] " + $Name) -ForegroundColor Green

    if ($Detail) {
        Write-Host ("       " + $Detail) -ForegroundColor DarkGray
    }
}

function Warn([string]$Name, [string]$Detail = "") {

    Write-Host ("[WARN] " + $Name) -ForegroundColor Yellow

    if ($Detail) {
        Write-Host ("       " + $Detail) -ForegroundColor DarkGray
    }
}

function Fail([string]$Name, [string]$Detail = "") {

    $script:Failures++

    Write-Host ("[FAIL] " + $Name) -ForegroundColor Red

    if ($Detail) {
        Write-Host ("       " + $Detail) -ForegroundColor DarkGray
    }
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
Write-Host "System Health Check"
Write-Host "========================================"

# ------------------------------------------------------------
# Windows
# ------------------------------------------------------------

Write-Host ""
Write-Host "Environment" -ForegroundColor Cyan

Pass "Windows" ([Environment]::OSVersion.VersionString)

# ------------------------------------------------------------
# Node
# ------------------------------------------------------------

$node = Get-Command node.exe -ErrorAction SilentlyContinue

if ($node) {

    try {

        $nodeVersion = (& node -p "process.versions.node").Trim()

        $major = [int](($nodeVersion -split "\.")[0])

        if ($major -ge 20) {
            Pass "Node.js" ("v" + $nodeVersion)
        }
        else {
            Fail "Node.js" "ต้องการ Node.js 20 ขึ้นไป"
        }
    }
    catch {
        Fail "Node.js" "ไม่สามารถอ่าน Version"
    }
}
else {

    Fail "Node.js" "ไม่พบ Node.js"
}

# ------------------------------------------------------------
# npm
# ------------------------------------------------------------

if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {

    try {
        $npmVersion = (& npm.cmd --version).Trim()
        Pass "npm" $npmVersion
    }
    catch {
        Fail "npm"
    }
}
else {

    Fail "npm" "ไม่พบ npm"
}

# ------------------------------------------------------------
# Environment
# ------------------------------------------------------------

Write-Host ""
Write-Host "Application" -ForegroundColor Cyan

$envFile = Join-Path $ProjectRoot ".env.local"

if (Test-Path $envFile) {

    Pass ".env.local"

    $required = @(
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY"
    )

    foreach ($key in $required) {

        $value = Get-DotEnvValue $envFile $key

        if ([string]::IsNullOrWhiteSpace($value)) {
            Fail $key "ไม่มีค่าใน .env.local"
        }
        else {
            Pass $key "configured"
        }
    }
}
else {

    Fail ".env.local" "ไม่พบไฟล์"
}

# ------------------------------------------------------------
# Git secret protection
# ------------------------------------------------------------

if (Get-Command git.exe -ErrorAction SilentlyContinue) {

    & git check-ignore -q .env.local

    if ($LASTEXITCODE -eq 0) {
        Pass "Git secret protection" ".env.local is ignored"
    }
    else {
        Fail "Git secret protection" ".env.local ไม่ถูก ignore"
    }
}
else {

    Warn "Git" "ไม่ได้ติดตั้ง — ไม่จำเป็นสำหรับการใช้งานประจำวัน"
}

# ------------------------------------------------------------
# Production build
# ------------------------------------------------------------

if (Test-Path ".next\BUILD_ID") {
    Pass "Production Build"
}
else {
    Fail "Production Build" "กรุณารัน Setup ใหม่"
}

# ------------------------------------------------------------
# Ollama
# ------------------------------------------------------------

Write-Host ""
Write-Host "Local AI" -ForegroundColor Cyan

$ollamaCommand = Get-OllamaCommand

if ($ollamaCommand) {

    Pass "Ollama executable" $ollamaCommand

    try {

        $tags = Invoke-RestMethod `
            -Uri "$OllamaUrl/api/tags" `
            -Method Get `
            -TimeoutSec 4

        Pass "Ollama API" "127.0.0.1:11434"

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

        if ($modelFound) {
            Pass "Local AI Model" $Model
        }
        else {
            Fail "Local AI Model" "$Model ยังไม่ได้ติดตั้ง"
        }
    }
    catch {

        Fail "Ollama API" "Ollama ยังไม่ทำงาน"
    }
}
else {

    Fail "Ollama" "ไม่พบ Ollama"
}

# ------------------------------------------------------------
# Supabase connectivity
# ------------------------------------------------------------

$supabaseUrl = Get-DotEnvValue `
    $envFile `
    "NEXT_PUBLIC_SUPABASE_URL"

if (-not [string]::IsNullOrWhiteSpace($supabaseUrl)) {

    try {

        $healthUrl = $supabaseUrl.TrimEnd("/") + "/auth/v1/health"

        $response = Invoke-WebRequest `
            -Uri $healthUrl `
            -UseBasicParsing `
            -TimeoutSec 8

        if (
            $response.StatusCode -ge 200 -and
            $response.StatusCode -lt 500
        ) {
            Pass "Supabase Cloud" $supabaseUrl
        }
        else {
            Fail "Supabase Cloud" "HTTP $($response.StatusCode)"
        }
    }
    catch {

        Fail "Supabase Cloud" "เชื่อมต่อไม่ได้"
    }
}

# ------------------------------------------------------------
# Vercel Production
# ------------------------------------------------------------

try {

    $response = Invoke-WebRequest `
        -Uri "https://restaurant-stock-rho.vercel.app/login" `
        -UseBasicParsing `
        -TimeoutSec 8

    if (
        $response.StatusCode -ge 200 -and
        $response.StatusCode -lt 500
    ) {
        Pass "Vercel Production" "restaurant-stock-rho.vercel.app"
    }
    else {
        Warn "Vercel Production" "HTTP $($response.StatusCode)"
    }
}
catch {

    Warn "Vercel Production" "เชื่อมต่อไม่ได้ในขณะนี้"
}

# ------------------------------------------------------------
# Local port
# ------------------------------------------------------------

Write-Host ""
Write-Host "Local Runtime" -ForegroundColor Cyan

$listener = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue |
Select-Object -First 1

if (-not $listener) {

    Pass "Port 3000" "available"
}
else {

    $managed = $false

    if (Test-Path $PidFile) {

        $pidText = (Get-Content $PidFile -ErrorAction SilentlyContinue).Trim()

        $savedPid = 0

        if ([int]::TryParse($pidText, [ref]$savedPid)) {

            if ($savedPid -eq $listener.OwningProcess) {
                $managed = $true
            }
        }
    }

    if ($managed) {

        Pass "Restaurant Stock Local Runtime" `
            ("running PID " + $listener.OwningProcess)
    }
    else {

        Fail "Port 3000" `
            ("ถูกใช้โดย PID " + $listener.OwningProcess)
    }
}

# ------------------------------------------------------------
# Final summary
# ------------------------------------------------------------

Write-Host ""
Write-Host "========================================"

if ($script:Failures -eq 0) {

    Write-Host "SYSTEM STATUS: READY" -ForegroundColor Green
    Write-Host "Local AI พร้อมสำหรับ TOM YUM BANG C"

    exit 0
}

Write-Host (
    "SYSTEM STATUS: ATTENTION REQUIRED (" +
    $script:Failures +
    " issue(s))"
) -ForegroundColor Red

exit 1.Exception.Response.StatusCode
        }
        catch {}

        if ($statusCode) {
            Fail "Supabase Cloud" "HTTP $statusCode"
        }
        else {
            Fail "Supabase Cloud" "เชื่อมต่อไม่ได้"
        }
    }
}
else {

    Fail "Supabase Cloud" "Supabase URL หรือ Publishable Key ไม่พร้อม"
}
# ------------------------------------------------------------
# Vercel Production
# ------------------------------------------------------------

try {

    $response = Invoke-WebRequest `
        -Uri "https://restaurant-stock-rho.vercel.app/login" `
        -UseBasicParsing `
        -TimeoutSec 8

    if (
        $response.StatusCode -ge 200 -and
        $response.StatusCode -lt 500
    ) {
        Pass "Vercel Production" "restaurant-stock-rho.vercel.app"
    }
    else {
        Warn "Vercel Production" "HTTP $($response.StatusCode)"
    }
}
catch {

    Warn "Vercel Production" "เชื่อมต่อไม่ได้ในขณะนี้"
}

# ------------------------------------------------------------
# Local port
# ------------------------------------------------------------

Write-Host ""
Write-Host "Local Runtime" -ForegroundColor Cyan

$listener = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue |
Select-Object -First 1

if (-not $listener) {

    Pass "Port 3000" "available"
}
else {

    $managed = $false

    if (Test-Path $PidFile) {

        $pidText = (Get-Content $PidFile -ErrorAction SilentlyContinue).Trim()

        $savedPid = 0

        if ([int]::TryParse($pidText, [ref]$savedPid)) {

            if ($savedPid -eq $listener.OwningProcess) {
                $managed = $true
            }
        }
    }

    if ($managed) {

        Pass "Restaurant Stock Local Runtime" `
            ("running PID " + $listener.OwningProcess)
    }
    else {

        Fail "Port 3000" `
            ("ถูกใช้โดย PID " + $listener.OwningProcess)
    }
}

# ------------------------------------------------------------
# Final summary
# ------------------------------------------------------------

Write-Host ""
Write-Host "========================================"

if ($script:Failures -eq 0) {

    Write-Host "SYSTEM STATUS: READY" -ForegroundColor Green
    Write-Host "Local AI พร้อมสำหรับ TOM YUM BANG C"

    exit 0
}

Write-Host (
    "SYSTEM STATUS: ATTENTION REQUIRED (" +
    $script:Failures +
    " issue(s))"
) -ForegroundColor Red

exit 1