[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BackupDir = (Resolve-Path $BackupDir).Path

$manifestPath = Join-Path `
    $BackupDir `
    "manifest.json"

if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found: $BackupDir"
}

$manifest = Get-Content `
    $manifestPath `
    -Raw |
ConvertFrom-Json

if ($manifest.formatVersion -ne 1) {
    throw "Unsupported manifest format."
}

if ([string]::IsNullOrWhiteSpace($manifest.archive.file)) {
    throw "Archive filename missing from manifest."
}

if ([string]::IsNullOrWhiteSpace($manifest.archive.sha256)) {
    throw "Archive SHA256 missing from manifest."
}

$archivePath = Join-Path `
    $BackupDir `
    $manifest.archive.file

if (-not (Test-Path $archivePath)) {
    throw "Backup archive missing."
}

$fileInfo = Get-Item $archivePath

if ($fileInfo.Length -le 0) {
    throw "Backup archive is empty."
}

if (
    [int64]$manifest.archive.bytes -ne
    $fileInfo.Length
) {
    throw @"
Backup size mismatch.
Manifest: $($manifest.archive.bytes)
Actual:   $($fileInfo.Length)
"@
}

$actualHash = (
    Get-FileHash `
        -Path $archivePath `
        -Algorithm SHA256
).Hash

if (
    $actualHash -ne
    $manifest.archive.sha256
) {
    throw "Backup SHA256 verification failed."
}

$requiredCounts = @(
    "auth.users",
    "auth.identities",
    "public.items",
    "public.stock_movements"
)

foreach ($name in $requiredCounts) {
    $property = `
        $manifest.rowCounts.PSObject.Properties[$name]

    if ($null -eq $property) {
        throw "Required row-count missing: $name"
    }

    if ([int64]$property.Value -lt 0) {
        throw "Invalid row-count: $name"
    }
}

Write-Host "PASS: TYBC backup verified."
Write-Host "Folder=$BackupDir"
Write-Host "Bytes=$($fileInfo.Length)"
Write-Host "SHA256=$actualHash"
