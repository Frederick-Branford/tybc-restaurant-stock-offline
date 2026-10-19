<#
  Self-test for Test-TomYum-OfflinePrerequisites.ps1 (no Pester needed; runs on Windows
  PowerShell 5.1 or PowerShell 7, including pwsh on Linux). Every system read is
  replaced by a fake, so it proves the PASS/WARN/FAIL logic and exit codes without
  touching the machine. Usage: pwsh -File scripts/windows/tests/Test-TomYum-OfflinePrerequisites.SelfTest.ps1
#>
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot '..\Test-TomYum-OfflinePrerequisites.ps1'
$failures = 0
function Assert-Status([string]$Scenario, [string]$Id, [string]$Expected) {
  $r = @($script:Results | Where-Object id -eq $Id)
  $got = if ($r.Count) { $r[0].status } else { '<none>' }
  if ($got -ne $Expected) { $script:failures++; Write-Output "FAIL  [$Scenario] $Id expected $Expected got $got :: $($r[0].detail)" }
  else { Write-Output "ok    [$Scenario] $Id = $Expected" }
}

function New-Fakes([hashtable]$o) {
  $script:F = $o
  function Get-TybcCim { param([string]$Class, [string]$Filter)
    switch ($Class) {
      'Win32_OperatingSystem' { [pscustomobject]@{ Caption = 'Microsoft Windows 11 Pro'; Version = '10.0.26100'; BuildNumber = $script:F.build; OSArchitecture = '64-bit'; FreePhysicalMemory = 6GB / 1KB } }
      'Win32_Processor' { [pscustomobject]@{ Name = 'AMD Ryzen 7 6800H'; Architecture = $script:F.arch; VirtualizationFirmwareEnabled = $script:F.fw; SecondLevelAddressTranslationExtensions = $true } }
      'Win32_ComputerSystem' { [pscustomobject]@{ TotalPhysicalMemory = $script:F.ramGB * 1GB; HypervisorPresent = $script:F.hv } }
      'Win32_LogicalDisk' { [pscustomobject]@{ FreeSpace = $script:F.diskGB * 1GB; Size = 512GB } }
      'Win32_OptionalFeature' { [pscustomobject]@{ InstallState = $script:F.feature } }
    } }
  function Invoke-TybcNative { param([string]$Exe, [string[]]$Arguments)
    $a = $Arguments -join ' '
    switch -Regex ("$Exe $a") {
      '^wsl\.exe --version' { if ($script:F.wsl) { return [pscustomobject]@{ found = $true; code = 0; out = "WSL version: 2.6.1.0`nKernel version: 6.6.87.2-1" } } else { return [pscustomobject]@{ found = $false; code = $null; out = '' } } }
      '^wsl\.exe --status' { return [pscustomobject]@{ found = $true; code = 0; out = 'Default Version: 2' } }
      '^wsl\.exe --list' { return [pscustomobject]@{ found = $true; code = 0; out = "  NAME STATE VERSION`n* docker-desktop Running 2" } }
      '^docker version' { if (-not $script:F.dockerCli) { return [pscustomobject]@{ found = $false; code = $null; out = '' } }
                          if ($script:F.engine) { return [pscustomobject]@{ found = $true; code = 0; out = '{"Client":{"Version":"29.8.2"},"Server":{"Version":"29.8.2","Os":"linux","Arch":"amd64"}}' } }
                          return [pscustomobject]@{ found = $true; code = 1; out = '{"Client":{"Version":"29.8.2"},"Server":null}' } }
      '^docker info' { $t = (Get-TybcUtcNow).AddSeconds($script:F.driftSec).ToString('yyyy-MM-ddTHH:mm:ss.fffffff') + '12Z'; return [pscustomobject]@{ found = $true; code = 0; out = (@{ MemTotal = [long]($script:F.vmGB * 1GB); NCPU = 8; OperatingSystem = 'Docker Desktop'; SystemTime = $t } | ConvertTo-Json) } }
      '^docker compose' { return [pscustomobject]@{ found = $script:F.dockerCli; code = 0; out = '5.5.1' } }
      '^ollama --version' { return [pscustomobject]@{ found = $script:F.ollamaExe; code = 0; out = 'ollama version is 0.12.3' } }
      '^w32tm' { return [pscustomobject]@{ found = $true; code = 0; out = 'Last Successful Sync Time: 19/10/2026 09:00:00' } }
      '^powercfg' { return [pscustomobject]@{ found = $true; code = 0; out = ('Current AC Power Setting Index: 0x{0:x8}' -f $script:F.sleepSec) } }
      '^git .*rev-parse HEAD$' { return [pscustomobject]@{ found = $true; code = 0; out = '53ed3f75790f9f68712c362a2f00d772b38edd63' } }
      '^git .*--abbrev-ref' { return [pscustomobject]@{ found = $true; code = 0; out = 'feat/offline-docker-v1' } }
      '^git .*\^\{commit\}' { return [pscustomobject]@{ found = $true; code = 0; out = $script:F.tagCommit } }
      '^git .*merge-base' { return [pscustomobject]@{ found = $true; code = 0; out = '' } }
      '^git .*status' { return [pscustomobject]@{ found = $true; code = 0; out = '' } }
      default { return [pscustomobject]@{ found = $false; code = $null; out = '' } }
    } }
  function Invoke-TybcHttp { param([string]$Url)
    if (-not $script:F.ollamaUp) { return [pscustomobject]@{ ok = $false; status = $null; body = 'refused' } }
    if ($Url -like '*/api/version') { return [pscustomobject]@{ ok = $true; status = 200; body = '{"version":"0.12.3"}' } }
    $models = @($script:F.models | ForEach-Object { @{ name = $_ } })
    return [pscustomobject]@{ ok = $true; status = 200; body = (@{ models = $models } | ConvertTo-Json -Depth 4) } }
  function Get-TybcListeners { param([int[]]$Ports)
    if ($script:F.noListenerApi) { return $null }
    return ,@($script:F.listeners | Where-Object { $Ports -contains $_.port }) }
  function Get-TybcEnvAllScopes { param([string]$Name) [ordered]@{ process = $script:F.ollamaHost; user = $null; machine = $null } }
  function Get-TybcRegistryValue { param([string]$Path, [string]$Name) if ($script:F.desktop) { '4.48.0' } else { $null } }
}

$base = @{
  build = 26100; arch = 9; fw = $true; hv = $true; ramGB = 15.3; diskGB = 120; feature = 1; wsl = $true
  dockerCli = $true; engine = $true; vmGB = 4; driftSec = 1; desktop = $true; ollamaExe = $true; ollamaUp = $true
  models = @('qwen3.5:4b'); ollamaHost = $null; sleepSec = 0; tagCommit = '53ed3f75790f9f68712c362a2f00d772b38edd63'
  listeners = @([pscustomobject]@{ port = 11434; address = '127.0.0.1'; process = 'ollama' })
}

function Invoke-Scenario([string]$Name, [hashtable]$Override) {
  $o = $base.Clone(); foreach ($k in $Override.Keys) { $o[$k] = $Override[$k] }
  . $target -NoRun -RepoPath $PSScriptRoot
  . New-Fakes $o
  function Test-Repository { }   # repository path differs in the sandbox; covered by its own scenario below
  function Test-LicenceRecord { Add-Result P20 'Docker Desktop licence' PASS 'fake' }
  function Get-TimeZone { [pscustomobject]@{ Id = 'SE Asia Standard Time' } }
  Invoke-AllChecks
  return (Get-ExitCode)
}

$code = Invoke-Scenario 'healthy notebook' @{}
foreach ($id in 'P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12','P13','P14','P15','P16','P17','P18') { Assert-Status 'healthy' $id 'PASS' }
if ($code -ne 0) { $failures++; Write-Output "FAIL  [healthy] exit code $code (expected 0)" } else { Write-Output 'ok    [healthy] exit code 0' }

$code = Invoke-Scenario 'ollama on 0.0.0.0' @{ listeners = @([pscustomobject]@{ port = 11434; address = '0.0.0.0'; process = 'ollama' }); ollamaHost = '0.0.0.0' }
Assert-Status 'ollama exposed' 'P16' 'FAIL'
if ($code -ne 2) { $failures++; Write-Output "FAIL  [ollama exposed] exit $code" } else { Write-Output 'ok    [ollama exposed] exit code 2' }

Invoke-Scenario 'bios off' @{ fw = $false; hv = $false } | Out-Null;           Assert-Status 'bios off' 'P05' 'FAIL'
Invoke-Scenario 'features off' @{ feature = 2 } | Out-Null;                    Assert-Status 'features off' 'P07' 'FAIL'
Invoke-Scenario 'no docker' @{ desktop = $false; dockerCli = $false } | Out-Null
Assert-Status 'no docker' 'P08' 'FAIL'; Assert-Status 'no docker' 'P09' 'FAIL'; Assert-Status 'no docker' 'P10' 'FAIL'; Assert-Status 'no docker' 'P11' 'NOT CHECKED'
Invoke-Scenario 'engine stopped' @{ engine = $false } | Out-Null;              Assert-Status 'engine stopped' 'P09' 'WARN'; Assert-Status 'engine stopped' 'P17' 'PASS'
Invoke-Scenario 'model missing' @{ models = @('llama3:8b') } | Out-Null;       Assert-Status 'model missing' 'P15' 'FAIL'
Invoke-Scenario 'ollama stopped' @{ ollamaUp = $false; listeners = @() } | Out-Null
Assert-Status 'ollama stopped' 'P14' 'WARN'; Assert-Status 'ollama stopped' 'P15' 'NOT CHECKED'; Assert-Status 'ollama stopped' 'P16' 'NOT CHECKED'
Invoke-Scenario 'port 3000 taken' @{ listeners = @([pscustomobject]@{ port = 3000; address = '0.0.0.0'; process = 'httpd' }, [pscustomobject]@{ port = 11434; address = '127.0.0.1'; process = 'ollama' }) } | Out-Null
Assert-Status 'port 3000 taken' 'P12' 'FAIL'
Invoke-Scenario 'old launcher on 3000' @{ listeners = @([pscustomobject]@{ port = 3000; address = '127.0.0.1'; process = 'node' }, [pscustomobject]@{ port = 11434; address = '127.0.0.1'; process = 'ollama' }) } | Out-Null
Assert-Status 'old launcher' 'P12' 'WARN'
Invoke-Scenario 'listener API unavailable' @{ noListenerApi = $true } | Out-Null
Assert-Status 'no listener API' 'P16' 'NOT CHECKED'; Assert-Status 'no listener API' 'P12' 'NOT CHECKED'
Invoke-Scenario 'OLLAMA_HOST=0.0.0.0 only' @{ ollamaHost = '0.0.0.0:11434' } | Out-Null; Assert-Status 'env exposed' 'P16' 'FAIL'
Invoke-Scenario 'OLLAMA_HOST loopback' @{ ollamaHost = '127.0.0.1:11434' } | Out-Null; Assert-Status 'env loopback' 'P16' 'PASS'
Invoke-Scenario 'low RAM' @{ ramGB = 7.5 } | Out-Null;                         Assert-Status 'low RAM' 'P03' 'FAIL'
Invoke-Scenario 'small disk' @{ diskGB = 35 } | Out-Null;                      Assert-Status 'small disk' 'P04' 'WARN'
Invoke-Scenario 'ARM64' @{ arch = 12 } | Out-Null;                             Assert-Status 'ARM64' 'P02' 'FAIL'
Invoke-Scenario 'VM clock drift' @{ driftSec = 120 } | Out-Null;               Assert-Status 'drift' 'P17' 'FAIL'
Invoke-Scenario 'uncapped VM' @{ vmGB = 7.6 } | Out-Null;                      Assert-Status 'uncapped' 'P11' 'WARN'
Invoke-Scenario 'sleep 15 min' @{ sleepSec = 900 } | Out-Null;                 Assert-Status 'sleep' 'P18' 'WARN'

# Repository scenario: moved release tag must FAIL.
. $target -NoRun -RepoPath $PSScriptRoot
. New-Fakes ($base.Clone()); $script:F.tagCommit = '0000000000000000000000000000000000000000'
function Test-Path { param([string]$LiteralPath, [string]$Path) $true }
$script:Results.Clear(); $RepoPath = $PSScriptRoot; Test-Repository
Assert-Status 'tag moved' 'P19' 'FAIL'
Remove-Item function:Test-Path

Write-Output ''
if ($failures) { Write-Output "SELF-TEST FAILED: $failures assertion(s)"; exit 1 } else { Write-Output 'SELF-TEST PASSED'; exit 0 }
