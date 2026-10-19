$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile    = Join-Path $RuntimeDir "restaurant-stock.pid"

Write-Host ""
Write-Host "TOM YUM BANG C" -ForegroundColor DarkYellow
Write-Host "Stop Restaurant Stock Local Runtime"
Write-Host "----------------------------------------"
Write-Host ""

if (-not (Test-Path $PidFile)) {

    $listener = Get-NetTCPConnection `
        -LocalPort 3000 `
        -State Listen `
        -ErrorAction SilentlyContinue |
    Select-Object -First 1

    if ($listener) {

        Write-Host "พบ Process บน Port 3000 แต่ไม่ได้ถูกจัดการโดย Launcher" -ForegroundColor Yellow
        Write-Host "PID: $($listener.OwningProcess)"
        Write-Host ""
        Write-Host "ระบบจะไม่ Kill Process นี้เพื่อความปลอดภัย"

        exit 1
    }

    Write-Host "Restaurant Stock Local Runtime ไม่ได้เปิดอยู่" -ForegroundColor Green
    exit 0
}

$pidText = (Get-Content $PidFile -ErrorAction SilentlyContinue).Trim()

$processId = 0

if (-not [int]::TryParse($pidText, [ref]$processId)) {

    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue

    Write-Host "PID file ไม่ถูกต้องและถูกล้างแล้ว" -ForegroundColor Yellow
    exit 1
}

$listener = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue |
Where-Object {
    $_.OwningProcess -eq $processId
} |
Select-Object -First 1

if (-not $listener) {

    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue

    Write-Host "Local Runtime ไม่ได้ทำงานแล้ว" -ForegroundColor Green
    exit 0
}

Write-Host "กำลังปิด Restaurant Stock..."
Write-Host "PID: $processId"

taskkill /PID $processId /T /F | Out-Null

Start-Sleep -Seconds 1

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue

$remaining = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($remaining) {

    Write-Host ""
    Write-Host "WARNING: Port 3000 ยังมี Process อื่นใช้งานอยู่" -ForegroundColor Yellow

    exit 1
}

Write-Host ""
Write-Host "Restaurant Stock Local Runtime ปิดเรียบร้อย" -ForegroundColor Green
Write-Host ""
Write-Host "Ollama จะยังทำงานอยู่ตามปกติ"
Write-Host "Launcher ไม่ปิด Ollama เพื่อไม่กระทบ Application อื่น"