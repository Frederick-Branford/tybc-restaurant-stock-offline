[CmdletBinding()]
param(
    [string]$DbContainer = "tybc-phase3-rehearsal-db-1",
    [string]$BackupRoot = "D:\TomYumBangC\backups",
    [string]$Database = "postgres",
    [string]$Label = "manual"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & docker @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')"
    }
}

$running = & docker inspect `
    --format "{{.State.Running}}" `
    $DbContainer 2>$null

if ($LASTEXITCODE -ne 0 -or $running.Trim() -ne "true") {
    throw "Database container is not running: $DbContainer"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$day = Get-Date -Format "yyyy-MM-dd"

$backupDir = Join-Path `
    (Join-Path $BackupRoot "daily\$day") `
    "tybc-$timestamp-$Label"

New-Item `
    -ItemType Directory `
    -Path $backupDir `
    -Force | Out-Null

$currentUser = `
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

try {
    & icacls $backupDir `
        /inheritance:r | Out-Null

    & icacls $backupDir `
        /grant:r `
        "${currentUser}:(OI)(CI)F" `
        "SYSTEM:(OI)(CI)F" | Out-Null
}
catch {
    Write-Warning `
        "Could not tighten backup directory ACL automatically."
}

$archiveName = "tybc-data.dump"
$archivePath = Join-Path $backupDir $archiveName
$manifestPath = Join-Path $backupDir "manifest.json"

$containerArchive = "/tmp/tybc-$timestamp.dump"

try {
    Write-Host "`n=== TYBC BACKUP ==="
    Write-Host "Target: $backupDir"

    Write-Host "`n[1/5] Creating data-only archive..."

    Invoke-Docker @(
        "exec",
        $DbContainer,
        "pg_dump",
        "-U", "postgres",
        "-d", $Database,
        "--format=custom",
        "--compress=6",
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--table=public.*",
        "--table=auth.users",
        "--table=auth.identities",
        "--file=$containerArchive"
    )

    Write-Host "[2/5] Validating archive structure..."

    Invoke-Docker @(
        "exec",
        $DbContainer,
        "pg_restore",
        "--list",
        $containerArchive
    ) | Out-Null

    Write-Host "[3/5] Copying archive to backup storage..."

    Invoke-Docker @(
        "cp",
        "${DbContainer}:${containerArchive}",
        $archivePath
    )

    if (-not (Test-Path $archivePath)) {
        throw "Backup archive was not copied to host."
    }

    $archiveInfo = Get-Item $archivePath
    $hash = (
        Get-FileHash `
            -Path $archivePath `
            -Algorithm SHA256
    ).Hash

    Write-Host "[4/5] Capturing row-count manifest..."

    $publicTables = & docker exec `
        $DbContainer `
        psql `
        -U postgres `
        -d $Database `
        -Atc "
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;
"

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to enumerate public tables."
    }

    $rowCounts = [ordered]@{}

    foreach ($table in @(
        $publicTables |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }
    )) {
        $count = & docker exec `
            $DbContainer `
            psql `
            -U postgres `
            -d $Database `
            -Atc "
select count(*)
from public.""$table"";
"

        if ($LASTEXITCODE -ne 0) {
            throw "Unable to count public.$table"
        }

        $rowCounts["public.$table"] = `
            [int64]$count.Trim()
    }

    foreach ($authTable in @(
        "users",
        "identities"
    )) {
        $count = & docker exec `
            $DbContainer `
            psql `
            -U postgres `
            -d $Database `
            -Atc "
select count(*)
from auth.$authTable;
"

        if ($LASTEXITCODE -ne 0) {
            throw "Unable to count auth.$authTable"
        }

        $rowCounts["auth.$authTable"] = `
            [int64]$count.Trim()
    }

    $pgVersion = & docker exec `
        $DbContainer `
        pg_dump --version

    $gitCommit = $null

    try {
        $gitCommit = (
            git rev-parse HEAD
        ).Trim()
    }
    catch {
        $gitCommit = $null
    }

    $manifest = [ordered]@{
        formatVersion = 1
        createdAt = (
            Get-Date
        ).ToString("o")

        label = $Label
        database = $Database
        sourceContainer = $DbContainer

        archive = [ordered]@{
            file = $archiveName
            bytes = $archiveInfo.Length
            sha256 = $hash
            format = "postgres-custom-data-only"
        }

        scope = @(
            "public.*",
            "auth.users",
            "auth.identities"
        )

        excludedAuthRuntimeState = @(
            "auth.sessions",
            "auth.refresh_tokens",
            "auth.audit_log_entries",
            "auth.schema_migrations",
            "auth.mfa_*",
            "auth.one_time_tokens"
        )

        pgDumpVersion = $pgVersion.Trim()
        gitCommit = $gitCommit
        rowCounts = $rowCounts
    }

    $manifest |
        ConvertTo-Json -Depth 8 |
        Set-Content `
            -Path $manifestPath `
            -Encoding utf8

    Write-Host "[5/5] Verifying host checksum..."

    $verifyHash = (
        Get-FileHash `
            -Path $archivePath `
            -Algorithm SHA256
    ).Hash

    if ($verifyHash -ne $hash) {
        throw "Backup checksum verification failed."
    }

    Write-Host ""
    Write-Host "PASS: TYBC backup created."
    Write-Host "Folder: $backupDir"
    Write-Host "Archive bytes: $($archiveInfo.Length)"
    Write-Host "SHA256: $hash"
}
finally {
    & docker exec `
        $DbContainer `
        rm -f $containerArchive `
        2>$null | Out-Null
}
