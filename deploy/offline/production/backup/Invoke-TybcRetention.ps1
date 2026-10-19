[CmdletBinding()]
param(
    [string]$BackupRoot = "D:\TomYumBangC\backups",
    [int]$KeepDaily = 14,
    [int]$KeepWeekly = 8,
    [int]$KeepMonthly = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupRoot)) {
    throw "Backup root not found: $BackupRoot"
}

$root = (Resolve-Path $BackupRoot).Path.TrimEnd("\")

function Assert-SafePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $resolved = (Resolve-Path $Path).Path

    if (
        -not $resolved.StartsWith(
            $root + "\",
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "REFUSED: path outside backup root: $resolved"
    }

    return $resolved
}

function Remove-OldDirectories {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Category,

        [Parameter(Mandatory = $true)]
        [int]$Keep
    )

    $categoryRoot = Join-Path `
        $root `
        $Category

    if (-not (Test-Path $categoryRoot)) {
        return
    }

    $directories = @(
        Get-ChildItem `
          $categoryRoot `
          -Directory |
        Sort-Object Name -Descending
    )

    if ($directories.Count -le $Keep) {
        Write-Host `
          "PASS: $Category retention requires no deletion."
        return
    }

    $remove = $directories |
      Select-Object -Skip $Keep

    foreach ($directory in $remove) {
        $safePath = Assert-SafePath `
            -Path $directory.FullName

        Write-Host "Removing expired $Category backup:"
        Write-Host $safePath

        Remove-Item `
          $safePath `
          -Recurse `
          -Force
    }
}

Remove-OldDirectories `
  -Category "daily" `
  -Keep $KeepDaily

Remove-OldDirectories `
  -Category "weekly" `
  -Keep $KeepWeekly

Remove-OldDirectories `
  -Category "monthly" `
  -Keep $KeepMonthly

Write-Host "PASS: TYBC backup retention completed."
