<#
.SYNOPSIS
  CLIENT MACHINE (no Internet needed): verify and load the image archives from the
  offline handover package, then prove each loaded image matches images.lock.json.

.DESCRIPTION
  Steps: SHA-256 of every archive must match the lock -> 'docker load' -> the image ID
  for repository:tag must equal the lock's imageId. Any mismatch stops the import.
  Never pulls from a registry; never changes Docker settings.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$LockFile
)
$ErrorActionPreference = 'Stop'
if (-not $LockFile) { $LockFile = Join-Path $PackageDir 'images.lock.json' }
$lock = Get-Content -LiteralPath $LockFile -Raw | ConvertFrom-Json
& docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker engine not reachable. Start Docker Desktop first.' }
$rows = @()
foreach ($img in $lock.images) {
  $tar = Join-Path $PackageDir ($img.archive -replace '/', '\')
  if (-not (Test-Path -LiteralPath $tar)) { throw "Missing archive $tar" }
  $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $tar).Hash.ToLowerInvariant()
  if ($h -ne $img.archiveSha256) { throw "Checksum mismatch for $($img.archive)" }
  & docker load -i $tar | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "docker load failed for $($img.archive)" }
  $id = (& docker image inspect --format '{{.Id}}' "$($img.repository):$($img.tag)").Trim()
  $ok = $id -eq $img.imageId
  $rows += [pscustomobject]@{ image = "$($img.repository):$($img.tag)"; sha256 = 'ok'; imageId = $(if ($ok) { 'match' } else { "MISMATCH $id" }) }
  if (-not $ok) { $rows | Format-Table -AutoSize; throw "Loaded image ID differs from the lock for $($img.repository):$($img.tag)" }
}
$rows | Format-Table -AutoSize
Write-Host 'All images verified and loaded. Compose files use pull_policy: never.'
