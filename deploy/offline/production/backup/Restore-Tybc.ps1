[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDir,

    [string]$ComposeFile =
        ".\deploy\offline\production\compose.yaml",

    [string]$EnvFile =
        "D:\TomYumBangC\config\phase3-rehearsal.env",

    [string]$ProjectName =
        "tybc-restore-test",

    [string]$RestoreVolume =
        "tybc_phase3_restore_test_db_data",

    [string]$Database =
        "postgres"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-NativeSuccess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

function Wait-Healthy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerId,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [int]$TimeoutSeconds = 120
    )

    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        $status = & docker inspect `
            --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" `
            $ContainerId `
            2>$null

        if ($LASTEXITCODE -eq 0) {
            $status = ($status | Out-String).Trim()

            if ($status -eq "healthy") {
                Write-Host "PASS: $Name healthy."
                return
            }

            if (
                $status -eq "unhealthy" -or
                $status -eq "exited" -or
                $status -eq "dead"
            ) {
                throw "$Name entered state: $status"
            }
        }

        Start-Sleep -Seconds 1
    }

    throw "$Name did not become healthy within timeout."
}

if (-not (Test-Path $BackupDir)) {
    throw "Backup directory not found: $BackupDir"
}

if (-not (Test-Path $ComposeFile)) {
    throw "Compose file not found: $ComposeFile"
}

if (-not (Test-Path $EnvFile)) {
    throw "Environment file not found: $EnvFile"
}

$ComposeFile = (Resolve-Path $ComposeFile).Path
$EnvFile = (Resolve-Path $EnvFile).Path
$BackupDir = (Resolve-Path $BackupDir).Path

if (
    $RestoreVolume -eq "tybc_phase3_rehearsal_db_data" -or
    $RestoreVolume -eq "tybc_db_data"
) {
    throw "REFUSED: protected production/rehearsal volume."
}

if (
    $ProjectName -eq "tybc-phase3-rehearsal"
) {
    throw "REFUSED: protected rehearsal project."
}

$manifestPath = Join-Path `
    $BackupDir `
    "manifest.json"

if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found."
}

$manifest = Get-Content `
    $manifestPath `
    -Raw |
ConvertFrom-Json

if ($manifest.formatVersion -ne 1) {
    throw "Unsupported backup manifest format."
}

$archivePath = Join-Path `
    $BackupDir `
    $manifest.archive.file

if (-not (Test-Path $archivePath)) {
    throw "Backup archive not found."
}

Write-Host "`n=== D5 RESTORE PREFLIGHT ==="

$actualHash = (
    Get-FileHash `
        -Path $archivePath `
        -Algorithm SHA256
).Hash

if (
    $actualHash -ne
    $manifest.archive.sha256
) {
    throw "Backup SHA256 mismatch."
}

Write-Host "PASS: backup checksum verified."

$volumeNames = & docker volume ls `
    --format "{{.Name}}"

Assert-NativeSuccess `
    "Unable to enumerate Docker volumes."

if ($volumeNames -contains $RestoreVolume) {
    throw @"
STOP: restore target volume already exists:
$RestoreVolume

Restore is create-only.
Do not overwrite an existing volume.
"@
}

$existingProject = & docker ps `
    -a `
    --filter "label=com.docker.compose.project=$ProjectName" `
    -q

if (
    -not [string]::IsNullOrWhiteSpace(
        ($existingProject -join "")
    )
) {
    throw "Restore project already exists: $ProjectName"
}

Write-Host "PASS: restore target isolated."

& docker volume create `
    $RestoreVolume |
Out-Null

Assert-NativeSuccess `
    "Unable to create restore volume."

Write-Host "PASS: created volume $RestoreVolume"

$oldVolume = $env:TYBC_DB_VOLUME
$dbId = $null
$authId = $null
$containerArchive = "/tmp/tybc-restore.dump"

try {
    $env:TYBC_DB_VOLUME = $RestoreVolume

    Write-Host "`n=== START FRESH DB + AUTH ==="

    & docker compose `
        -p $ProjectName `
        --env-file $EnvFile `
        -f $ComposeFile `
        up -d db auth

    Assert-NativeSuccess `
        "Unable to start DB/Auth."

    $dbId = (
        & docker compose `
            -p $ProjectName `
            --env-file $EnvFile `
            -f $ComposeFile `
            ps -q db
    ) | Out-String

    $dbId = $dbId.Trim()

    $authId = (
        & docker compose `
            -p $ProjectName `
            --env-file $EnvFile `
            -f $ComposeFile `
            ps -q auth
    ) | Out-String

    $authId = $authId.Trim()

    if (
        [string]::IsNullOrWhiteSpace($dbId) -or
        [string]::IsNullOrWhiteSpace($authId)
    ) {
        throw "Unable to resolve DB/Auth container IDs."
    }

    Wait-Healthy `
        -ContainerId $dbId `
        -Name "restore DB"

    Wait-Healthy `
        -ContainerId $authId `
        -Name "restore Auth"

    Write-Host "`n=== APPLY APP MIGRATIONS ==="

    & docker compose `
        -p $ProjectName `
        --env-file $EnvFile `
        -f $ComposeFile `
        run `
        --rm `
        --no-deps `
        migrate

    Assert-NativeSuccess `
        "Application migrations failed."

    Write-Host "PASS: migrations applied."

    Write-Host "`n=== STOP AUTH BEFORE RESTORE ==="

    & docker compose `
        -p $ProjectName `
        --env-file $EnvFile `
        -f $ComposeFile `
        stop auth

    Assert-NativeSuccess `
        "Unable to stop Auth."

    Write-Host "`n=== COPY + VALIDATE BACKUP ==="

    & docker cp `
        $archivePath `
        "${dbId}:${containerArchive}"

    Assert-NativeSuccess `
        "Unable to copy backup archive."

    & docker exec `
        $dbId `
        pg_restore `
        --list `
        $containerArchive `
        *> $null

    Assert-NativeSuccess `
        "Backup archive is unreadable."

    Write-Host "PASS: archive readable."

    Write-Host "`n=== CLEAR FRESH SEEDED DATA ==="

    $resetSql = @(
        'DO $$'
        'DECLARE'
        '    truncate_sql text;'
        'BEGIN'
        '    SELECT'
        "        'TRUNCATE TABLE ' ||"
        '        string_agg('
        "            format('%I.%I', schemaname, tablename),"
        "            ', '"
        '        ) ||'
        "        ' RESTART IDENTITY CASCADE'"
        '    INTO truncate_sql'
        '    FROM pg_tables'
        "    WHERE schemaname = 'public';"
        ''
        '    IF truncate_sql IS NOT NULL THEN'
        '        EXECUTE truncate_sql;'
        '    END IF;'
        'END'
        '$$;'
        ''
        'TRUNCATE TABLE auth.users CASCADE;'
    ) -join [Environment]::NewLine

    $resetSql |
        & docker exec `
            -i `
            $dbId `
            psql `
            -U postgres `
            -d $Database `
            -v ON_ERROR_STOP=1

    Assert-NativeSuccess `
        "Unable to clear fresh seeded data."

    Write-Host "PASS: target data cleared."

    Write-Host "`n=== RESTORE DATA ==="

    # auth tables are owned by supabase_auth_admin while public tables
    # are owned by postgres. supabase_admin is the local superuser
    # required to disable/enable triggers safely across both schemas.
    & docker exec `
        $dbId `
        pg_restore `
        -U supabase_admin `
        -d $Database `
        --data-only `
        --disable-triggers `
        --no-owner `
        --no-privileges `
        --exit-on-error `
        --single-transaction `
        $containerArchive

    Assert-NativeSuccess `
        "Data restore failed."

    Write-Host "PASS: data restored."

    Write-Host "`n=== VERIFY MANIFEST COUNTS ==="

    foreach (
        $property in
        $manifest.rowCounts.PSObject.Properties
    ) {
        $qualifiedName = $property.Name
        $expected = [int64]$property.Value

        $parts = $qualifiedName.Split(".")

        if ($parts.Count -ne 2) {
            throw "Invalid manifest table name: $qualifiedName"
        }

        $schema = $parts[0]
        $table = $parts[1]

        if (
            $schema -notmatch '^[a-z_]+$' -or
            $table -notmatch '^[a-z0-9_]+$'
        ) {
            throw "Unsafe manifest table identifier."
        }

        $sql = `
            "select count(*) from `"$schema`".`"$table`";"

        $actual = (
            & docker exec `
                $dbId `
                psql `
                -U postgres `
                -d $Database `
                -Atc $sql
        ) | Out-String

        Assert-NativeSuccess `
            "Unable to verify $qualifiedName"

        $actual = $actual.Trim()

        if ([int64]$actual -ne $expected) {
            throw @"
Row-count mismatch:
$qualifiedName
Expected: $expected
Actual:   $actual
"@
        }

        Write-Host `
            "PASS: $qualifiedName=$actual"
    }

    Write-Host "`n=== RESTART AUTH ==="

    & docker compose `
        -p $ProjectName `
        --env-file $EnvFile `
        -f $ComposeFile `
        start auth

    Assert-NativeSuccess `
        "Unable to restart Auth."

    $authId = (
        & docker compose `
            -p $ProjectName `
            --env-file $EnvFile `
            -f $ComposeFile `
            ps -q auth
    ) | Out-String

    $authId = $authId.Trim()

    Wait-Healthy `
        -ContainerId $authId `
        -Name "restored Auth"

    & docker exec `
        $dbId `
        rm -f $containerArchive `
        2>$null |
    Out-Null

    Write-Host ""
    Write-Host "PASS: TYBC restore completed."
    Write-Host "Project: $ProjectName"
    Write-Host "Volume:  $RestoreVolume"
    Write-Host "Protected rehearsal volume unchanged."
}
finally {
    if ($null -eq $oldVolume) {
        Remove-Item `
            Env:TYBC_DB_VOLUME `
            -ErrorAction SilentlyContinue
    }
    else {
        $env:TYBC_DB_VOLUME = $oldVolume
    }
}
