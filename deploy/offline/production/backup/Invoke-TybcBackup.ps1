[CmdletBinding()]
param(
    [string]$DbContainer = "tybc-offline-db-1",

    [string]$BackupRoot =
        "D:\TomYumBangC\backups",

    [double]$MaxAgeHours = 24,

    [string]$Label = "scheduled",

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backupTool = Join-Path `
    $PSScriptRoot `
    "Backup-Tybc.ps1"

$verifyTool = Join-Path `
    $PSScriptRoot `
    "Verify-TybcBackup.ps1"

$retentionTool = Join-Path `
    $PSScriptRoot `
    "Invoke-TybcRetention.ps1"

foreach ($tool in @(
    $backupTool,
    $verifyTool,
    $retentionTool
)) {
    if (-not (Test-Path $tool)) {
        throw "Required backup tool missing: $tool"
    }
}

if (-not (Test-Path $BackupRoot)) {
    New-Item `
      -ItemType Directory `
      -Path $BackupRoot `
      -Force |
    Out-Null
}

$BackupRoot = (Resolve-Path $BackupRoot).Path

$repoRoot = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\..\..\..")
)

$logDir = Join-Path `
    $BackupRoot `
    "logs"

New-Item `
  -ItemType Directory `
  -Path $logDir `
  -Force |
Out-Null

$logFile = Join-Path `
    $logDir `
    "backup-operations.log"

function Write-OperationLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $line = "{0} {1}" -f `
        (Get-Date).ToString("o"),
        $Message

    Add-Content `
      -Path $logFile `
      -Value $line `
      -Encoding UTF8

    Write-Host $Message
}

function Set-RestrictedBackupAcl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $currentUser = `
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

    & icacls `
        $Path `
        /inheritance:r `
        *> $null

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to remove ACL inheritance: $Path"
    }

    & icacls `
        $Path `
        /grant:r `
        "${currentUser}:(OI)(CI)F" `
        "SYSTEM:(OI)(CI)F" `
        *> $null

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to secure backup path: $Path"
    }
}

function Get-LatestVerifiedDailyBackup {
    $dailyRoot = Join-Path `
        $BackupRoot `
        "daily"

    if (-not (Test-Path $dailyRoot)) {
        return $null
    }

    $manifests = @(
        Get-ChildItem `
          $dailyRoot `
          -Filter "manifest.json" `
          -File `
          -Recurse `
          -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    )

    foreach ($manifestFile in $manifests) {
        $directory = `
            $manifestFile.Directory.FullName

        try {
            & $verifyTool `
              -BackupDir $directory `
              *> $null

            $manifest = Get-Content `
                $manifestFile.FullName `
                -Raw |
            ConvertFrom-Json

            $createdAt = `
                [DateTimeOffset]::Parse(
                    [string]$manifest.createdAt
                )

            return [pscustomobject]@{
                Directory = $directory
                CreatedAt = $createdAt
                Manifest = $manifest
            }
        }
        catch {
            Write-OperationLog `
              "WARN invalid backup ignored: $directory"
        }
    }

    return $null
}

function Copy-BackupSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$Category,

        [Parameter(Mandatory = $true)]
        [string]$Bucket
    )

    $categoryRoot = Join-Path `
        $BackupRoot `
        $Category

    $bucketPath = Join-Path `
        $categoryRoot `
        $Bucket

    if (Test-Path $bucketPath) {
        $existingManifest = Get-ChildItem `
            $bucketPath `
            -Filter "manifest.json" `
            -File `
            -Recurse `
            -ErrorAction SilentlyContinue |
        Select-Object -First 1

        if ($null -eq $existingManifest) {
            throw @"
Existing $Category bucket is incomplete:
$bucketPath
"@
        }

        & $verifyTool `
          -BackupDir $existingManifest.Directory.FullName `
          *> $null

        Write-OperationLog `
          "PASS $Category snapshot already exists: $Bucket"

        return
    }

    New-Item `
      -ItemType Directory `
      -Path $bucketPath `
      -Force |
    Out-Null

    Set-RestrictedBackupAcl `
      -Path $bucketPath

    Copy-Item `
      -Path $SourceDirectory `
      -Destination $bucketPath `
      -Recurse `
      -Force

    $snapshotPath = Join-Path `
        $bucketPath `
        (Split-Path $SourceDirectory -Leaf)

    if (-not (Test-Path $snapshotPath)) {
        throw "Snapshot copy failed: $snapshotPath"
    }

    Set-RestrictedBackupAcl `
      -Path $snapshotPath

    & $verifyTool `
      -BackupDir $snapshotPath `
      *> $null

    Write-OperationLog `
      "PASS promoted $Category snapshot: $Bucket"
}

Write-OperationLog `
  "START TYBC backup operation."

$latestBefore = `
    Get-LatestVerifiedDailyBackup

$backupRequired = $false
$backupReason = $null

if ($Force) {
    $backupRequired = $true
    $backupReason = "forced"
}
elseif ($null -eq $latestBefore) {
    $backupRequired = $true
    $backupReason = "no-valid-backup"
}
else {
    $age = `
        [DateTimeOffset]::Now -
        $latestBefore.CreatedAt

    Write-OperationLog (
        "Latest verified backup age: {0:N2} hours." -f `
        $age.TotalHours
    )

    if ($age.TotalHours -ge $MaxAgeHours) {
        $backupRequired = $true
        $backupReason = "catch-up"
    }
}

if (-not $backupRequired) {
    Write-OperationLog `
      "SKIP backup: latest verified backup is fresh."

    & $retentionTool `
      -BackupRoot $BackupRoot

    Write-OperationLog `
      "PASS TYBC backup operation completed without new backup."

    return
}

Write-OperationLog `
  "Backup required: $backupReason"

$runningContainers = @(
    & docker ps `
        --filter "status=running" `
        --format "{{.Names}}"
)

if ($LASTEXITCODE -ne 0) {
    throw "Unable to query Docker containers."
}

if ($runningContainers -notcontains $DbContainer) {
    throw "Database container is not running: $DbContainer"
}

$beforePath = $null

if ($null -ne $latestBefore) {
    $beforePath = $latestBefore.Directory
}

Push-Location $repoRoot

try {
    & $backupTool `
      -DbContainer $DbContainer `
      -BackupRoot $BackupRoot `
      -Label $Label
}
finally {
    Pop-Location
}

$latestAfter = `
    Get-LatestVerifiedDailyBackup

if ($null -eq $latestAfter) {
    throw "No verified backup found after backup operation."
}

if (
    $null -ne $beforePath -and
    $latestAfter.Directory -eq $beforePath
) {
    throw "Backup operation did not produce a new verified backup."
}

Write-OperationLog `
  "PASS new daily backup verified."

$today = (Get-Date).Date

$dayOfWeek = [int]$today.DayOfWeek

$mondayOffset = `
    ($dayOfWeek + 6) % 7

$monday = `
    $today.AddDays(-$mondayOffset)

$weeklyBucket = `
    "week-" + $monday.ToString("yyyy-MM-dd")

$monthlyBucket = `
    $today.ToString("yyyy-MM")

Copy-BackupSnapshot `
  -SourceDirectory $latestAfter.Directory `
  -Category "weekly" `
  -Bucket $weeklyBucket

Copy-BackupSnapshot `
  -SourceDirectory $latestAfter.Directory `
  -Category "monthly" `
  -Bucket $monthlyBucket

& $retentionTool `
  -BackupRoot $BackupRoot

Write-OperationLog `
  "PASS retention completed."

Write-OperationLog `
  "PASS TYBC backup operation completed."
