<#
.SYNOPSIS
  TOM YUM BANG C - Offline Edition prerequisite check (READ-ONLY).

.DESCRIPTION
  Reports whether this Windows machine can host the Offline Docker Edition.
  It only READS system state. It never installs, enables, starts, stops or
  configures anything: no BIOS, WSL, Docker, Windows features, services,
  firewall, hosts file, networking, Ollama or Git changes. It does not start
  Docker Desktop, WSL distributions or Ollama, and it never reads .env files.

  Results: PASS / WARN / FAIL / NOT CHECKED.
  Exit code: 0 = all PASS, 1 = any WARN or NOT CHECKED, 2 = any FAIL.

.PARAMETER OutFile
  Optional path for a JSON report. Nothing is written unless this is given.

.PARAMETER Json
  Print the JSON report to stdout instead of the table.

.PARAMETER RepoPath
  Repository to inspect (default: two folders above this script).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\Test-TomYum-OfflinePrerequisites.ps1
#>
[CmdletBinding()]
param(
  [string]$OutFile,
  [switch]$Json,
  [string]$RepoPath,
  [switch]$NoRun  # tests only: load functions without running the checks
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

$script:Expected = [ordered]@{
  Win11MinBuild      = 22631          # Windows 11 23H2; confirm against Docker's current published minimum
  MinRamGB           = 15             # 16 GB machines report ~15.x GB usable
  WarnRamGB          = 8
  MinFreeDiskGB      = 30
  GoodFreeDiskGB     = 50
  DockerVmMinGB      = 3
  DockerVmMaxGB      = 6
  OllamaUrl          = 'http://127.0.0.1:11434'
  OllamaModel        = 'qwen3.5:4b'
  TimeZoneId         = 'SE Asia Standard Time'
  ReleaseTag         = 'v1.2.1'
  ReleaseCommit      = '53ed3f75790f9f68712c362a2f00d772b38edd63'
  PublishedPorts     = @(3000, 3100)
  InternalPorts      = @(5432, 8000, 9999, 54321, 54322, 54323, 54324)
  OllamaPort         = 11434
}

$script:Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param([string]$Id, [string]$Area, [ValidateSet('PASS','WARN','FAIL','NOT CHECKED')][string]$Status,
        [string]$Detail, [string]$Hint = '')
  $script:Results.Add([pscustomobject][ordered]@{ id = $Id; area = $Area; status = $Status; detail = $Detail; hint = $Hint })
}

# ---------------------------------------------------------------------------
# Read-only wrappers (tests replace these with fakes).
# ---------------------------------------------------------------------------
function Get-TybcCim { param([string]$Class, [string]$Filter)
  if ($Filter) { Get-CimInstance -ClassName $Class -Filter $Filter -ErrorAction Stop } else { Get-CimInstance -ClassName $Class -ErrorAction Stop } }

function Invoke-TybcNative { param([string]$Exe, [string[]]$Arguments)
  $cmd = Get-Command $Exe -ErrorAction SilentlyContinue
  if (-not $cmd) { return [pscustomobject]@{ found = $false; code = $null; out = '' } }
  $old = $env:WSL_UTF8; $env:WSL_UTF8 = '1'   # wsl.exe prints UTF-16 otherwise
  try {
    $out = & $cmd.Source @Arguments 2>&1 | Out-String
    return [pscustomobject]@{ found = $true; code = $LASTEXITCODE; out = $out.Trim() }
  } catch {
    return [pscustomobject]@{ found = $true; code = -1; out = $_.Exception.Message }
  } finally { $env:WSL_UTF8 = $old }
}

function Invoke-TybcHttp { param([string]$Url, [int]$TimeoutSec = 3)
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
    return [pscustomobject]@{ ok = $true; status = [int]$r.StatusCode; body = [string]$r.Content }
  } catch { return [pscustomobject]@{ ok = $false; status = $null; body = $_.Exception.Message } }
}

function Get-TybcListeners { param([int[]]$Ports)
  $rows = @()
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return $null }
  foreach ($c in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $Ports -contains $_.LocalPort })) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    $rows += [pscustomobject]@{ port = [int]$c.LocalPort; address = [string]$c.LocalAddress; process = $(if ($p) { $p.ProcessName } else { "pid $($c.OwningProcess)" }) }
  }
  return ,$rows
}

function Get-TybcEnvAllScopes { param([string]$Name)
  [ordered]@{
    process = [Environment]::GetEnvironmentVariable($Name, 'Process')
    user    = [Environment]::GetEnvironmentVariable($Name, 'User')
    machine = [Environment]::GetEnvironmentVariable($Name, 'Machine')
  }
}

function Get-TybcRegistryValue { param([string]$Path, [string]$Name)
  try { (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name } catch { $null } }

function Test-TybcElevated {
  try { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { $false } }

function Get-TybcUtcNow { [DateTime]::UtcNow }

function Test-TybcLoopback { param([string]$Address)
  return @('127.0.0.1', '::1') -contains $Address }

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
function Test-WindowsVersion {
  try {
    $os = Get-TybcCim -Class Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    $d = "$($os.Caption) version $($os.Version) build $build, $($os.OSArchitecture)"
    if ($build -ge $script:Expected.Win11MinBuild) { Add-Result P01 'Windows' PASS $d }
    elseif ($build -ge 22000) { Add-Result P01 'Windows' WARN $d 'Windows 11 below 23H2: confirm Docker Desktop''s current minimum; update Windows manually if needed.' }
    else { Add-Result P01 'Windows' WARN $d 'Target is Windows 11; Windows 10 support depends on Docker''s current requirements.' }
  } catch { Add-Result P01 'Windows' 'NOT CHECKED' $_.Exception.Message }
}

function Test-Architecture {
  try {
    $cpu = @(Get-TybcCim -Class Win32_Processor)[0]
    $arch = @{ 0 = 'x86'; 5 = 'ARM'; 9 = 'x64'; 12 = 'ARM64' }[[int]$cpu.Architecture]
    $d = "$($cpu.Name.Trim()); architecture $arch; PROCESSOR_ARCHITECTURE=$($env:PROCESSOR_ARCHITECTURE)"
    if ($arch -eq 'x64') { Add-Result P02 'CPU architecture' PASS $d } else { Add-Result P02 'CPU architecture' FAIL $d 'The offline images are linux/amd64; an x64 machine is required.' }
  } catch { Add-Result P02 'CPU architecture' 'NOT CHECKED' $_.Exception.Message }
}

function Test-Memory {
  try {
    $cs = Get-TybcCim -Class Win32_ComputerSystem
    $os = Get-TybcCim -Class Win32_OperatingSystem
    $gb = [math]::Round([double]$cs.TotalPhysicalMemory / 1GB, 1)
    $free = [math]::Round([double]$os.FreePhysicalMemory * 1KB / 1GB, 1)
    $d = "total $gb GB, currently free $free GB"
    if ($gb -ge $script:Expected.MinRamGB) { Add-Result P03 'RAM' PASS $d }
    elseif ($gb -ge $script:Expected.WarnRamGB) { Add-Result P03 'RAM' WARN $d 'Below the 16 GB target: Local AI and the stack may compete for memory.' }
    else { Add-Result P03 'RAM' FAIL $d 'Less than 8 GB.' }
  } catch { Add-Result P03 'RAM' 'NOT CHECKED' $_.Exception.Message }
}

function Test-Disk {
  try {
    $systemDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }

    $dockerVhdCandidates = @()

    if ($env:LOCALAPPDATA) {
      $dockerVhdCandidates += Join-Path `
        $env:LOCALAPPDATA `
        'Docker\wsl\disk\docker_data.vhdx'
    }

    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
      ForEach-Object {
        $dockerVhdCandidates += Join-Path `
          $_.Root `
          'DockerData\DockerDesktopWSL\disk\docker_data.vhdx'
      }

    $dockerVhd = $dockerVhdCandidates |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1

    $dockerDrive = $systemDrive

    if ($dockerVhd) {
      $dockerDrive = (
        [System.IO.Path]::GetPathRoot($dockerVhd)
      ).TrimEnd('\')
    }

    $dockerDisk = Get-TybcCim `
      -Class Win32_LogicalDisk `
      -Filter "DeviceID='$dockerDrive'"

    $systemDisk = Get-TybcCim `
      -Class Win32_LogicalDisk `
      -Filter "DeviceID='$systemDrive'"

    $dockerFreeGB = [math]::Round(
      [double]$dockerDisk.FreeSpace / 1GB,
      1
    )

    $dockerSizeGB = [math]::Round(
      [double]$dockerDisk.Size / 1GB,
      1
    )

    $systemFreeGB = [math]::Round(
      [double]$systemDisk.FreeSpace / 1GB,
      1
    )

    $detail = "Docker storage $dockerDrive free $dockerFreeGB GB of $dockerSizeGB GB"

    if ($dockerVhd) {
      $detail += "; VHDX=$dockerVhd"
    }

    if ($dockerDrive -ne $systemDrive) {
      $detail += "; system $systemDrive free $systemFreeGB GB"
    }

    if ($dockerFreeGB -lt $script:Expected.MinFreeDiskGB) {
      Add-Result `
        P04 `
        'Free disk' `
        FAIL `
        $detail `
        'Docker storage has less than 30 GB free.'

      return
    }

    if ($systemFreeGB -lt 10) {
      Add-Result `
        P04 `
        'Free disk' `
        FAIL `
        $detail `
        'System drive has less than 10 GB free.'

      return
    }

    if (
      $dockerFreeGB -lt $script:Expected.GoodFreeDiskGB -or
      $systemFreeGB -lt 15
    ) {
      Add-Result `
        P04 `
        'Free disk' `
        WARN `
        $detail `
        'Storage is usable, but additional free space is recommended.'

      return
    }

    Add-Result P04 'Free disk' PASS $detail

  } catch {
    Add-Result `
      P04 `
      'Free disk' `
      'NOT CHECKED' `
      $_.Exception.Message
  }
}

function Test-Virtualization {
  try {
    $cpu = @(Get-TybcCim -Class Win32_Processor)[0]
    $cs = Get-TybcCim -Class Win32_ComputerSystem
    $fw = $cpu.VirtualizationFirmwareEnabled; $hv = $cs.HypervisorPresent; $slat = $cpu.SecondLevelAddressTranslationExtensions
    $d = "HypervisorPresent=$hv; VirtualizationFirmwareEnabled=$fw; SLAT=$slat"
    if ($hv -eq $true) { Add-Result P05 'BIOS virtualization' PASS "$d (a hypervisor is running, so firmware virtualization is on)" }
    elseif ($fw -eq $true) { Add-Result P05 'BIOS virtualization' PASS $d }
    elseif ($fw -eq $false) { Add-Result P05 'BIOS virtualization' FAIL $d 'Enable AMD-V/SVM (or Intel VT-x) in the BIOS/UEFI setup manually. This tool never changes BIOS settings.' }
    else { Add-Result P05 'BIOS virtualization' 'NOT CHECKED' $d 'Windows did not report the firmware flag.' }
  } catch { Add-Result P05 'BIOS virtualization' 'NOT CHECKED' $_.Exception.Message }
}

function Test-WindowsFeatures {
  $names = @('VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux')
  $parts = @(); $bad = @()
  foreach ($n in $names) {
    try {
      $f = Get-TybcCim -Class Win32_OptionalFeature -Filter "Name='$n'"
      $state = @{ 1 = 'Enabled'; 2 = 'Disabled'; 3 = 'Absent'; 4 = 'Unknown' }[[int]$f.InstallState]
      if (-not $f) { $state = 'Not found' }
      $parts += "$n=$state"; if ($state -ne 'Enabled') { $bad += $n }
    } catch { $parts += "$n=unreadable" ; $bad += $n }
  }
  $d = $parts -join '; '
  if ($bad.Count -eq 0) { Add-Result P07 'Windows features' PASS $d }
  elseif ($parts -match 'unreadable') { Add-Result P07 'Windows features' 'NOT CHECKED' $d 'Could not read optional features.' }
  else { Add-Result P07 'Windows features' FAIL $d "Missing: $($bad -join ', '). Enabling them is an administrative step done separately after approval (A-2)." }
}

function Test-Wsl {
  $v = Invoke-TybcNative -Exe 'wsl.exe' -Arguments @('--version')
  if (-not $v.found) { Add-Result P06 'WSL' FAIL 'wsl.exe not found' 'Install WSL (administrative step after approval).'; return }
  $s = Invoke-TybcNative -Exe 'wsl.exe' -Arguments @('--status')
  $l = Invoke-TybcNative -Exe 'wsl.exe' -Arguments @('--list', '--verbose')
  $wslVer = if ($v.out -match 'WSL[^:\r\n]*:\s*([0-9][0-9.]+)') { $Matches[1] } else { $null }
  $kernel = if ($v.out -match 'Kernel[^:\r\n]*:\s*([0-9][^\s]+)') { $Matches[1] } else { $null }
  $default2 = ($s.out -match 'Default Version:\s*2') -or ($s.out -notmatch 'Default Version')
  $distros = ($l.out -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Skip 1 | ForEach-Object { ($_ -replace '^\*?\s*', '') -replace '\s{2,}', ' ' }) -join ', '
  $d = "WSL=$wslVer kernel=$kernel; distros: $(if ($distros) { $distros } else { 'none' })"
  if ($v.code -ne 0 -or -not $wslVer) { Add-Result P06 'WSL' WARN "$d; 'wsl --version' unsupported (inbox WSL)" 'Store WSL is recommended for Docker Desktop (installed separately after approval).' }
  elseif (-not $default2) { Add-Result P06 'WSL' WARN "$d; default version is not 2" 'Docker Desktop uses its own WSL 2 distribution; the default can stay as is.' }
  else { Add-Result P06 'WSL' PASS $d }
}

function Test-DockerDesktopInstalled {
  $ver = Get-TybcRegistryValue `
    -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Docker Desktop' `
    -Name 'DisplayVersion'

  if (-not $ver) {
    $ver = Get-TybcRegistryValue `
      -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Docker Desktop' `
      -Name 'DisplayVersion'
  }

  $candidates = @()

  if ($env:ProgramFiles) {
    $candidates += Join-Path `
      $env:ProgramFiles `
      'Docker\Docker\Docker Desktop.exe'
  }

  if ($env:LOCALAPPDATA) {
    $candidates += Join-Path `
      $env:LOCALAPPDATA `
      'Programs\DockerDesktop\Docker Desktop.exe'
  }

  $exe = $candidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

  if ($exe) {
    if (-not $ver) {
      try {
        $ver = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
      } catch {
        $ver = 'unknown'
      }
    }

    Add-Result `
      P08 `
      'Docker Desktop' `
      PASS `
      "installed (version $ver; path=$exe)"

    return
  }

  Add-Result `
    P08 `
    'Docker Desktop' `
    FAIL `
    'not installed' `
    'Install Docker Desktop only after confirming it is actually absent.'
}

function Test-DockerEngine {
  $v = Invoke-TybcNative -Exe 'docker' -Arguments @('version', '--format', '{{json .}}')
  if (-not $v.found) { Add-Result P09 'Docker Engine' FAIL 'docker CLI not found' 'Comes with Docker Desktop.'; return $null }
  $j = $null; try { $j = $v.out | ConvertFrom-Json } catch { }
  if ($j -and $j.Server) {
    Add-Result P09 'Docker Engine' PASS "client $($j.Client.Version), server $($j.Server.Version) ($($j.Server.Os)/$($j.Server.Arch))"
    $i = Invoke-TybcNative -Exe 'docker' -Arguments @('info', '--format', '{{json .}}')
    try { return ($i.out | ConvertFrom-Json) } catch { return $null }
  }
  $cv = if ($j -and $j.Client) { $j.Client.Version } else { '?' }
  Add-Result P09 'Docker Engine' WARN "client $cv; engine not reachable (Docker Desktop not running?)" 'Start Docker Desktop and re-run; this tool does not start it.'
  return $null
}

function Test-Compose {
  $c = Invoke-TybcNative -Exe 'docker' -Arguments @('compose', 'version', '--short')
  if (-not $c.found) { Add-Result P10 'Docker Compose' FAIL 'docker CLI not found'; return }
  if ($c.code -eq 0 -and $c.out -match '^v?([2-9]|\d{2,})\.') { Add-Result P10 'Docker Compose' PASS "compose $($c.out)" }
  else { Add-Result P10 'Docker Compose' FAIL "compose not available: $($c.out)" 'Compose v2 ships with Docker Desktop.' }
}

function Test-DockerResources { param($Info)
  $cap = $null
  $wslcfg = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.wslconfig' } else { $null }
  if ($wslcfg -and (Test-Path -LiteralPath $wslcfg)) {
    $m = Select-String -LiteralPath $wslcfg -Pattern '^\s*memory\s*=\s*(\S+)' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $cap = $m.Matches[0].Groups[1].Value }
  }
  if (-not $Info) { Add-Result P11 'Docker VM resources' 'NOT CHECKED' ".wslconfig memory=$cap" 'Engine not running.'; return }
  $gb = [math]::Round([double]$Info.MemTotal / 1GB, 1)
  $d = "VM memory $gb GB, CPUs $($Info.NCPU), OS '$($Info.OperatingSystem)', .wslconfig memory=$(if ($cap) { $cap } else { 'not set' })"
  if ($gb -lt $script:Expected.DockerVmMinGB) { Add-Result P11 'Docker VM resources' FAIL $d 'Less than 3 GB for the Docker VM.' }
  elseif ($gb -gt $script:Expected.DockerVmMaxGB) { Add-Result P11 'Docker VM resources' WARN $d 'No effective cap: recommended .wslconfig memory=4GB (operator applies it manually; never automatic).' }
  else { Add-Result P11 'Docker VM resources' PASS $d }
}

function Test-Ports {
  $all = @($script:Expected.PublishedPorts) + @($script:Expected.InternalPorts)
  $rows = Get-TybcListeners -Ports $all
  if ($null -eq $rows) { Add-Result P12 'Ports' 'NOT CHECKED' 'Get-NetTCPConnection unavailable'; return }
  $fail = @(); $warn = @(); $seen = @()
  foreach ($r in $rows) {
    $seen += "$($r.port)@$($r.address)=$($r.process)"
    if ($script:Expected.PublishedPorts -contains $r.port) {
      if ($r.process -match '^(com\.docker\.backend|wslrelay|vpnkit|node)$') { $warn += $r.port } else { $fail += $r.port }
    } else { $warn += $r.port }
  }
  $d = if ($seen.Count) { "listening: $($seen -join ', ')" } else { "ports $($all -join ',') free" }
  if ($fail.Count) { Add-Result P12 'Ports' FAIL $d "Port(s) $($fail -join ',') are used by an unknown process; the app publishes 127.0.0.1:3000 (3100 for rehearsals)." }
  elseif ($warn.Count) { Add-Result P12 'Ports' WARN $d 'Known TYBC/Docker/Node process, or an internal-only port (not published by the stack).' }
  else { Add-Result P12 'Ports' PASS $d }
}

function Test-Ollama {
  $o = Invoke-TybcNative -Exe 'ollama' -Arguments @('--version')
  if (-not $o.found) { Add-Result P13 'Ollama executable' FAIL 'ollama not found on PATH' 'Install Ollama (administrative step after approval).' }
  else { $ver = if ($o.out -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { $o.out }; Add-Result P13 'Ollama executable' PASS "version $ver" }

  $v = Invoke-TybcHttp -Url "$($script:Expected.OllamaUrl)/api/version"
  if ($v.ok) { Add-Result P14 'Ollama API' PASS "GET /api/version -> $($v.status) $($v.body)" }
  else { Add-Result P14 'Ollama API' WARN 'not reachable on 127.0.0.1:11434 (not running?)' 'Start Ollama and re-run; this tool does not start it.' }

  if (-not $v.ok) { Add-Result P15 'AI model' 'NOT CHECKED' "API not reachable; cannot list models" ; }
  else {
    $t = Invoke-TybcHttp -Url "$($script:Expected.OllamaUrl)/api/tags"
    $names = @(); try { $names = @(($t.body | ConvertFrom-Json).models | ForEach-Object { $_.name }) } catch { }
    if ($names -contains $script:Expected.OllamaModel) { Add-Result P15 'AI model' PASS "$($script:Expected.OllamaModel) present" }
    else { Add-Result P15 'AI model' FAIL "$($script:Expected.OllamaModel) missing (found: $($names -join ', '))" 'Load the model from the offline package or pull it on the preparation machine.' }
  }

  $envs = Get-TybcEnvAllScopes -Name 'OLLAMA_HOST'
  $envTxt = ($envs.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '; '
  $raw = Get-TybcListeners -Ports @($script:Expected.OllamaPort)
  $listenerApi = $null -ne $raw
  $rows = @($raw | Where-Object { $_ })          # never let $null become a fake listener
  $listen = if (-not $listenerApi) { 'not readable' } elseif ($rows.Count) { ($rows | ForEach-Object { "$($_.address)=$($_.process)" }) -join ', ' } else { 'none' }
  $exposedListener = @($rows | Where-Object { -not (Test-TybcLoopback $_.address) }).Count -gt 0
  $exposedEnv = @($envs.Values | Where-Object { $_ -and ($_ -notmatch '^(https?://)?(127\.0\.0\.1|\[?::1\]?|localhost)(:\d+)?/?$') }).Count -gt 0
  $fwTxt = 'not checked'; $fwAllow = $false
  if (Get-Command Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue) {
    try {
      $rules = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match 'ollama' } | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' })
      $fwAllow = $rules.Count -gt 0; $fwTxt = "$($rules.Count) enabled inbound allow rule(s) for ollama.exe"
    } catch { $fwTxt = 'unreadable' }
  }
  $d = "listener: $listen; OLLAMA_HOST: $(if ($envTxt) { $envTxt } else { 'unset' }); firewall: $fwTxt"
  if ($exposedListener -or $exposedEnv) { Add-Result P16 'Ollama exposure' FAIL $d 'Ollama must stay on 127.0.0.1:11434 (never 0.0.0.0 or a LAN address). Fix manually after approval.' }
  elseif ($fwAllow) { Add-Result P16 'Ollama exposure' WARN $d 'Loopback-only today, but an inbound allow rule exists; review it manually.' }
  elseif (-not $listenerApi) { Add-Result P16 'Ollama exposure' 'NOT CHECKED' $d 'Listening sockets could not be read.' }
  elseif ($rows.Count -eq 0) { Add-Result P16 'Ollama exposure' 'NOT CHECKED' $d 'Ollama is not listening; re-run while it is running.' }
  else { Add-Result P16 'Ollama exposure' PASS $d }
}

function Test-Clock {
  param($Info)

  try {
    $status = 'PASS'
    $hints = @()
    $parts = @()

    $tz = Get-TimeZone -ErrorAction Stop
    $parts += "time zone: $($tz.Id)"

    $hostUtc = [DateTimeOffset]::UtcNow

    $wslClock = Invoke-TybcNative `
      -Exe 'wsl' `
      -Arguments @(
        '-d',
        'docker-desktop',
        '--',
        'date',
        '-u',
        '+%Y-%m-%dT%H:%M:%SZ'
      )

    if (
      $wslClock.found -and
      $wslClock.code -eq 0 -and
      $wslClock.out
    ) {
      $vm = [DateTimeOffset]::ParseExact(
        $wslClock.out.Trim(),
        'yyyy-MM-ddTHH:mm:ssZ',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal
      )

      $drift = [math]::Round(
        [math]::Abs(
          ($vm.UtcDateTime - $hostUtc.UtcDateTime).TotalSeconds
        ),
        1
      )

      $parts += "Docker WSL drift: $drift s"

      if ($drift -gt 60) {
        $status = 'FAIL'
        $hints += 'Docker Desktop WSL clock differs by more than 60 seconds.'
      }
      elseif ($drift -gt 5) {
        $status = 'WARN'
        $hints += 'Docker Desktop WSL clock differs by more than 5 seconds.'
      }
    }
    else {
      $status = 'WARN'
      $parts += 'Docker WSL clock: not checked'
      $hints += 'Could not read live time from docker-desktop WSL.'
    }

    Add-Result `
      P17 `
      'Clock' `
      $status `
      ($parts -join '; ') `
      ($hints -join ' ')

  } catch {
    Add-Result `
      P17 `
      'Clock' `
      'NOT CHECKED' `
      $_.Exception.Message
  }
}

function Test-Power {
  $q = Invoke-TybcNative -Exe 'powercfg' -Arguments @('/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE')
  if (-not $q.found -or $q.code -ne 0 -or $q.out -notmatch 'Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)') { Add-Result P18 'Power (sleep on AC)' 'NOT CHECKED' 'powercfg not readable'; return }
  $sec = [Convert]::ToInt32($Matches[1], 16)
  $d = if ($sec -eq 0) { 'sleep on AC: never' } else { "sleep on AC after $([math]::Round($sec/60)) min" }
  if ($sec -eq 0 -or $sec -ge 3600) { Add-Result P18 'Power (sleep on AC)' PASS $d }
  else { Add-Result P18 'Power (sleep on AC)' WARN $d 'Sleep pauses the stack and skips backups until catch-up; consider a longer timeout (operator decision).' }
}

function Test-Repository {
  $repo = $RepoPath
  if (-not $repo) { $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..') -ErrorAction SilentlyContinue).Path }
  if (-not $repo -or -not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { Add-Result P19 'Repository' 'NOT CHECKED' "no git repository at '$repo'"; return }
  $env:GIT_OPTIONAL_LOCKS = '0'
  $g = { param([string[]]$a) Invoke-TybcNative -Exe 'git' -Arguments (@('-C', $repo, '--no-optional-locks') + $a) }
  $head = (& $g @('rev-parse', 'HEAD')).out
  $branch = (& $g @('rev-parse', '--abbrev-ref', 'HEAD')).out
  $tag = (& $g @('rev-parse', "$($script:Expected.ReleaseTag)^{commit}")).out
  $anc = (& $g @('merge-base', '--is-ancestor', $script:Expected.ReleaseCommit, 'HEAD')).code
  $dirty = (& $g @('status', '--porcelain', '--untracked-files=no')).out
  $envLocal = Test-Path -LiteralPath (Join-Path $repo '.env.local')   # existence only; never read
  $d = "branch $branch @ $($head.Substring(0, [math]::Min(12, $head.Length))); $($script:Expected.ReleaseTag) -> $($tag.Substring(0, [math]::Min(12, $tag.Length))); descends from release: $($anc -eq 0); tracked changes: $(if ($dirty) { 'yes' } else { 'none' }); .env.local present: $envLocal"
  if ($tag -ne $script:Expected.ReleaseCommit) { Add-Result P19 'Repository' FAIL $d "$($script:Expected.ReleaseTag) no longer points at $($script:Expected.ReleaseCommit)." }
  elseif ($anc -ne 0) { Add-Result P19 'Repository' FAIL $d 'Checked-out commit does not descend from the release.' }
  elseif ($dirty) { Add-Result P19 'Repository' WARN $d 'Uncommitted tracked changes.' }
  else { Add-Result P19 'Repository' PASS $d }
}

function Test-LicenceRecord {
  $repo = $RepoPath
  if (-not $repo) { $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..') -ErrorAction SilentlyContinue).Path }
  $f = if ($repo) { Join-Path $repo 'deploy\offline\decisions.env' } else { $null }
  if (-not $f -or -not (Test-Path -LiteralPath $f)) { Add-Result P20 'Docker Desktop licence' 'NOT CHECKED' 'deploy/offline/decisions.env not found'; return }
  $line = Select-String -LiteralPath $f -Pattern '^DOCKER_DESKTOP_LICENSE_ELIGIBILITY=(\S+)' | Select-Object -First 1
  $val = if ($line) { $line.Matches[0].Groups[1].Value } else { 'missing' }
  if ($val -eq 'CONFIRMED') { Add-Result P20 'Docker Desktop licence' PASS 'DOCKER_DESKTOP_LICENSE_ELIGIBILITY=CONFIRMED' }
  else { Add-Result P20 'Docker Desktop licence' FAIL "DOCKER_DESKTOP_LICENSE_ELIGIBILITY=$val" 'Do not rely on Docker Desktop for production until confirmed.' }
}

function Invoke-Safely { param([string]$Id, [string]$Area, [scriptblock]$Block)
  try { & $Block } catch { Add-Result $Id $Area 'NOT CHECKED' ("check error: " + $_.Exception.Message) }
}

function Invoke-AllChecks {
  Invoke-Safely P01 'Windows' { Test-WindowsVersion }
  Invoke-Safely P02 'CPU architecture' { Test-Architecture }
  Invoke-Safely P03 'RAM' { Test-Memory }
  Invoke-Safely P04 'Free disk' { Test-Disk }
  Invoke-Safely P05 'BIOS virtualization' { Test-Virtualization }
  Invoke-Safely P06 'WSL' { Test-Wsl }
  Invoke-Safely P07 'Windows features' { Test-WindowsFeatures }
  Invoke-Safely P08 'Docker Desktop' { Test-DockerDesktopInstalled }
  $script:DockerInfo = $null
  Invoke-Safely P09 'Docker Engine' { $script:DockerInfo = Test-DockerEngine }
  Invoke-Safely P10 'Docker Compose' { Test-Compose }
  Invoke-Safely P11 'Docker VM resources' { Test-DockerResources -Info $script:DockerInfo }
  Invoke-Safely P12 'Ports' { Test-Ports }
  Invoke-Safely P13 'Ollama' { Test-Ollama }
  Invoke-Safely P17 'Clock' { Test-Clock -Info $script:DockerInfo }
  Invoke-Safely P18 'Power (sleep on AC)' { Test-Power }
  Invoke-Safely P19 'Repository' { Test-Repository }
  Invoke-Safely P20 'Docker Desktop licence' { Test-LicenceRecord }
}

function Get-ExitCode {
  if (@($script:Results | Where-Object { $_.status -eq 'FAIL' }).Count) { return 2 }
  if (@($script:Results | Where-Object { $_.status -ne 'PASS' }).Count) { return 1 }
  return 0
}

if ($NoRun) { return }

Invoke-AllChecks
$sorted = @($script:Results | Sort-Object id)
$report = [ordered]@{
  tool = 'Test-TomYum-OfflinePrerequisites'; version = '2.0-phase2'; readOnly = $true
  computer = $env:COMPUTERNAME; elevated = (Test-TybcElevated); generatedUtc = (Get-TybcUtcNow).ToString('o')
  summary = [ordered]@{
    PASS = @($sorted | Where-Object status -eq 'PASS').Count; WARN = @($sorted | Where-Object status -eq 'WARN').Count
    FAIL = @($sorted | Where-Object status -eq 'FAIL').Count; 'NOT CHECKED' = @($sorted | Where-Object status -eq 'NOT CHECKED').Count
  }
  results = $sorted
}
if ($OutFile) {
  $dir = Split-Path -Parent $OutFile
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutFile -Encoding UTF8
}
if ($Json) { $report | ConvertTo-Json -Depth 6 }
else {
  $sorted | Format-Table -AutoSize -Wrap id, area, status, detail | Out-String -Width 220 | Write-Output
  $sorted | Where-Object { $_.status -ne 'PASS' -and $_.hint } | ForEach-Object { Write-Output ("[{0}] {1}: {2}" -f $_.status, $_.id, $_.hint) }
  Write-Output ("Summary: PASS {0}  WARN {1}  FAIL {2}  NOT CHECKED {3}" -f $report.summary.PASS, $report.summary.WARN, $report.summary.FAIL, $report.summary.'NOT CHECKED')
}
exit (Get-ExitCode)
