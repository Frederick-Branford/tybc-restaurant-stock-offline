<#
.SYNOPSIS
  TOM YUM BANG C - Offline Edition Phase 2 spike runner (DISPOSABLE, SYNTHETIC DATA).

.DESCRIPTION
  Runs the Phase 2 infrastructure spike on a Windows machine with Docker Desktop:
    1. starts the minimal stack (db -> auth -> migrate -> rest -> gateway) from compose.spike.yaml
    2. API compatibility probe (tests/compat.mjs, same supabase-js as the app) + spike S1
       (container -> http://host.docker.internal:11434, version, tags, small qwen3.5:4b inference)
    3. database-level checks (tests/db-checks.sql)
    4. LAN-exposure probe for Ollama (host LAN IPs, from the host and from a container)
    5. resource sampling (containers, Ollama idle and during inference, Windows memory)
    6. persistence test (stop/start, down/up, down -v/up keep the EXTERNAL volume)
  Evidence is written to %LOCALAPPDATA%\TomYumBangC\spike\evidence-<timestamp>\ (outside the repo).

  Safety: synthetic secrets are generated into %LOCALAPPDATA% (never the repo) and never
  printed. Nothing touches Production. The script never changes Ollama's binding, the
  firewall, WSL, Docker Desktop settings or Windows networking, and never runs
  'docker compose down -v' against anything but the disposable spike project.

.PARAMETER ImagesEnv
  Env file with TYBC_IMG_DB / _AUTH / _REST / _GATEWAY / _NODE (repo:tag@sha256:...).
  Default: generated from deploy/offline/images.lock.json.

.PARAMETER SkipPersistence / SkipResources / SkipS1
  Skip individual parts (reported as NOT TESTED).

.PARAMETER Cleanup
  Remove the spike containers, the spike volume and the synthetic secrets, then exit.
#>
[CmdletBinding()]
param(
  [string]$ImagesEnv,
  [switch]$SkipPersistence,
  [switch]$SkipResources,
  [switch]$SkipS1,
  [switch]$Cleanup
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 1.0

$SpikeDir   = Split-Path -Parent $PSScriptRoot
$RepoRoot   = (Resolve-Path (Join-Path $SpikeDir '..\..\..')).Path
$Compose    = Join-Path $SpikeDir 'compose.spike.yaml'
$Project    = 'tybc-spike'
$Volume     = 'tybc_spike_db_data'
$StateRoot  = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'TomYumBangC\spike' } else { Join-Path $HOME '.tybc-spike' }
$SecretsEnv = Join-Path $StateRoot 'spike-secrets.env'
$Stamp      = (Get-Date).ToString('yyyyMMdd-HHmmss')
$Evidence   = Join-Path $StateRoot "evidence-$Stamp"
$Results    = New-Object System.Collections.Generic.List[object]
$IsWin      = [Environment]::OSVersion.Platform -eq 'Win32NT'

function Add-R([string]$Id, [string]$Title, [string]$Status, [string]$Detail) {
  $Results.Add([pscustomobject][ordered]@{ id = $Id; title = $Title; status = $Status; detail = $Detail })
  Write-Host ("{0,-11} {1,-6} {2}" -f $Status, $Id, $Title)
}
function Save-Evidence([string]$Name, $Object) {
  $p = Join-Path $Evidence $Name
  if ($Object -is [string]) { Set-Content -LiteralPath $p -Value $Object -Encoding UTF8 } else { $Object | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $p -Encoding UTF8 }
}
function Invoke-Docker([string[]]$Arguments, [switch]$AllowFail, [switch]$Quiet) {
  $previousEap = $ErrorActionPreference

  try {
    # Windows PowerShell 5.1 turns native stderr into ErrorRecord objects.
    # Docker Compose writes normal progress to stderr, so do not let EAP=Stop
    # terminate before we can inspect the real process exit code.
    $ErrorActionPreference = 'Continue'

    $out = & docker @Arguments 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousEap
  }

  $text = ($out | ForEach-Object { "$_" }) -join "`n"

  if ($code -ne 0 -and -not $AllowFail) {
    throw "docker $($Arguments -join ' ') failed ($code): $text"
  }

  return [pscustomobject]@{
    code = $code
    text = $text
  }
}
function Get-DockerStdout([string[]]$Arguments) {
  $previousEap = $ErrorActionPreference

  try {
    $ErrorActionPreference = 'Continue'

    $out = & docker @Arguments 2>$null
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousEap
  }

  return [pscustomobject]@{
    code = $code
    text = (($out | ForEach-Object { "$_" }) -join "`n")
  }
}
function Compose([string[]]$More) { return @('compose', '-p', $Project, '--env-file', $SecretsEnv, '--env-file', $ImagesEnv, '-f', $Compose) + $More }

function ConvertTo-B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function New-RandomSecret([int]$Bytes = 32) { $b = New-Object byte[] $Bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ConvertTo-B64Url $b }
function New-Hs256Jwt([hashtable]$Payload, [string]$Secret) {
  $enc = [Text.Encoding]::UTF8
  $h = ConvertTo-B64Url ($enc.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $p = ConvertTo-B64Url ($enc.GetBytes(($Payload | ConvertTo-Json -Compress)))
  $hmac = New-Object Security.Cryptography.HMACSHA256 (,$enc.GetBytes($Secret))
  return "$h.$p." + (ConvertTo-B64Url ($hmac.ComputeHash($enc.GetBytes("$h.$p"))))
}

# ----------------------------------------------------------------------------- cleanup
if ($Cleanup) {
  $answer = Read-Host "Remove spike project '$Project', volume '$Volume' and synthetic secrets? Type YES"
  if ($answer -ne 'YES') { Write-Host 'Cancelled.'; exit 1 }
  if (Test-Path -LiteralPath $SecretsEnv) {
    if (-not $ImagesEnv) { $ImagesEnv = Join-Path $StateRoot 'images.env' }
    Invoke-Docker (Compose @('--profile', 'probe', '--profile', 'app', 'down')) -AllowFail | Out-Null
  }
  Invoke-Docker @('volume', 'rm', $Volume) -AllowFail | Out-Null
  Remove-Item -LiteralPath $SecretsEnv -ErrorAction SilentlyContinue
  Write-Host 'Spike removed. Evidence folders were kept.'; exit 0
}

New-Item -ItemType Directory -Force -Path $Evidence | Out-Null

# ----------------------------------------------------------------------------- preconditions
$ver = Get-DockerStdout @('version', '--format', '{{json .}}')
if ($ver.code -ne 0) { throw 'Docker engine not reachable. Start Docker Desktop first (this script does not start it).' }
$info = (Get-DockerStdout @('info', '--format', '{{json .}}')).text | ConvertFrom-Json
Save-Evidence 'docker-info.json' ([ordered]@{ ServerVersion = $info.ServerVersion; OperatingSystem = $info.OperatingSystem; KernelVersion = $info.KernelVersion; MemTotal = $info.MemTotal; NCPU = $info.NCPU; Driver = $info.Driver; SystemTime = "$($info.SystemTime)" })

if (-not $ImagesEnv) {
  $lock = Join-Path $RepoRoot 'deploy\offline\images.lock.json'
  if (-not (Test-Path -LiteralPath $lock)) { throw "No -ImagesEnv given and $lock not found. Run scripts\windows\offline-prep\Export-TomYum-OfflineImages.ps1 first." }
  $l = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
  $map = @{ db = 'TYBC_IMG_DB'; auth = 'TYBC_IMG_AUTH'; rest = 'TYBC_IMG_REST'; gateway = 'TYBC_IMG_GATEWAY'; node = 'TYBC_IMG_NODE' }
  # Tags + image-ID verification (not repo@digest): after 'docker load' on an offline
  # machine the registry digest may not be recorded locally, so a digest reference could
  # trigger a pull. pull_policy: never + ID check gives the same immutability offline.
  $lines = foreach ($img in $l.images) { if ($map.ContainsKey($img.role)) { "$($map[$img.role])=$($img.repository):$($img.tag)" } }
  $idFail = @()
  foreach ($img in $l.images) {
    $id = (Get-DockerStdout @('image', 'inspect', '--format', '{{.Id}}', "$($img.repository):$($img.tag)")).text.Trim()
    if ($id -ne $img.imageId) { $idFail += "$($img.repository):$($img.tag) local=$id lock=$($img.imageId)" }
  }
  if ($idFail.Count) { Add-R 'IMAGES' 'local images match images.lock.json' 'FAIL' ($idFail -join '; '); throw 'Image IDs do not match the lock file; refusing to run.' }
  Add-R 'IMAGES' 'local images match images.lock.json' 'PASS' (($l.images | ForEach-Object { "$($_.repository):$($_.tag)" }) -join ', ')
  New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
  $ImagesEnv = Join-Path $StateRoot 'images.env'
  Set-Content -LiteralPath $ImagesEnv -Value ($lines + "TYBC_MIGRATIONS_DIR=$((Join-Path $RepoRoot 'supabase\migrations'))") -Encoding ASCII
}

if (-not (Test-Path -LiteralPath $SecretsEnv)) {
  New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
  $jwt = New-RandomSecret 48; $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $exp = $now + 315360000
  $vals = [ordered]@{
    POSTGRES_PASSWORD = (New-RandomSecret); AUTHENTICATOR_PASSWORD = (New-RandomSecret); SUPABASE_AUTH_ADMIN_PASSWORD = (New-RandomSecret)
    TYBC_BACKUP_PASSWORD = (New-RandomSecret); JWT_SECRET = $jwt
    ANON_KEY = (New-Hs256Jwt @{ iss = 'supabase'; role = 'anon'; iat = $now; exp = $exp } $jwt)
    SERVICE_ROLE_KEY = (New-Hs256Jwt @{ iss = 'supabase'; role = 'service_role'; iat = $now; exp = $exp } $jwt)
  }
  Set-Content -LiteralPath $SecretsEnv -Value ($vals.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -Encoding ASCII
  if ($IsWin) { & icacls $SecretsEnv /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null }
  Write-Host "Synthetic spike secrets written to $SecretsEnv (values not shown)."
}

$tests = Join-Path $SpikeDir 'tests'
if (-not (Test-Path -LiteralPath (Join-Path $tests 'node_modules\@supabase\supabase-js'))) {
  if (Get-Command npm -ErrorAction SilentlyContinue) { Push-Location $tests; try { & npm ci --no-audit --no-fund | Out-Null } finally { Pop-Location } }
  if (-not (Test-Path -LiteralPath (Join-Path $tests 'node_modules\@supabase\supabase-js'))) { throw 'tests\node_modules missing: run "npm ci" in deploy\offline\spike\tests on the preparation machine.' }
}

# ----------------------------------------------------------------------------- 1. start stack
if ((Get-DockerStdout @('volume', 'inspect', $Volume)).code -ne 0) { Invoke-Docker @('volume', 'create', $Volume) | Out-Null }
$sw = [Diagnostics.Stopwatch]::StartNew()
$up = Invoke-Docker (Compose @('up', '-d', '--wait', '--wait-timeout', '300')) -AllowFail
$sw.Stop()
$ps = Get-DockerStdout (Compose @('ps', '-a', '--format', '{{.Service}} {{.State}} {{.Status}}'))
Save-Evidence 'compose-up.txt' ("exit $($up.code) in $([int]$sw.Elapsed.TotalSeconds)s`n$($up.text)`n---`n$($ps.text)")
$migr = Get-DockerStdout @('logs', "$Project-migrate-1")
Save-Evidence 'migrate.log' $migr.text
if ($up.code -eq 0) { Add-R 'STACK' 'db -> auth -> migrate -> rest -> gateway healthy' 'PASS' "$([int]$sw.Elapsed.TotalSeconds)s; $(($migr.text -split "`n" | Select-String 'migrations applied').Line)" }
else { Add-R 'STACK' 'db -> auth -> migrate -> rest -> gateway healthy' 'FAIL' "compose up exit $($up.code); see compose-up.txt"; Save-Evidence 'results.json' $Results; exit 2 }

# ----------------------------------------------------------------------------- 2. compat + S1
$runArgs = @('--profile', 'probe', 'run', '--rm', '-T')
if (-not $SkipS1) { $runArgs += @('-e', 'RUN_S1=1') }
$probe = Get-DockerStdout (Compose ($runArgs + @('probe')))
Save-Evidence 'compat.json' $probe.text
try { $cj = $probe.text | ConvertFrom-Json; foreach ($r in $cj.results) { Add-R $r.id $r.title $r.status $r.detail } }
catch { Add-R 'COMPAT' 'compatibility probe' 'FAIL' "probe output not JSON (exit $($probe.code))" }

# ----------------------------------------------------------------------------- 3. db checks (after the probe, so the ledger has synthetic rows for D11)
$sql = Get-Content -LiteralPath (Join-Path $tests 'db-checks.sql') -Raw
$previousEap = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $dbc = $sql | & docker @(Compose @('exec', '-T', 'db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-f', '-')) 2>&1 | ForEach-Object { "$_" }
  $dbcExitCode = $LASTEXITCODE
}
finally {
  $ErrorActionPreference = $previousEap
}

if ($dbcExitCode -ne 0) {
  throw "database check docker command failed ($dbcExitCode): $($dbc -join "`n")"
}
Save-Evidence 'db-checks.txt' ($dbc -join "`n")
foreach ($line in $dbc) { if ($line -match '(D\d\d)\|(PASS|FAIL|WARN)\|(.*)$') { Add-R $Matches[1] 'database check' $Matches[2] $Matches[3] } }

# ----------------------------------------------------------------------------- 4. S1 context + LAN exposure
if ($SkipS1) { Add-R 'S1-CTX' 'Ollama binding / exposure evidence' 'NOT TESTED' 'skipped' }
else {
  $ctx = [ordered]@{ ollamaListeners = @(); ollamaHost = $null; hostDockerInternalInContainer = $null; lanProbes = @() }
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $ctx.ollamaListeners = @(Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid $($_.OwningProcess)" })
  }
  $ctx.ollamaHost = [ordered]@{ process = $env:OLLAMA_HOST; user = [Environment]::GetEnvironmentVariable('OLLAMA_HOST', 'User'); machine = [Environment]::GetEnvironmentVariable('OLLAMA_HOST', 'Machine') }
  $dns = Get-DockerStdout (Compose @('--profile', 'probe', 'run', '--rm', '-T', 'probe', 'node', '-e', "require('dns').lookup('host.docker.internal',(e,a)=>console.log(e?('ERR '+e.code):a))"))
  $ctx.hostDockerInternalInContainer = $dns.text.Trim()
  $edge = Get-DockerStdout @('network', 'inspect', "$($Project)_tybc_edge", '--format', '{{json .IPAM.Config}}')
  $ctx.edgeNetwork = $edge.text.Trim()
  $lanIps = @()
  if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
    $lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress })
  }
  $exposed = $false
  foreach ($ip in $lanIps) {
    $fromHost = $false
    try { $c = New-Object Net.Sockets.TcpClient; $iar = $c.BeginConnect($ip, 11434, $null, $null); $fromHost = $iar.AsyncWaitHandle.WaitOne(1500) -and $c.Connected; $c.Close() } catch { $fromHost = $false }
    $fc = Get-DockerStdout (Compose @('--profile', 'probe', 'run', '--rm', '-T', 'probe', 'node', '-e', "fetch('http://$($ip):11434/api/version',{signal:AbortSignal.timeout(2000)}).then(r=>console.log('OPEN '+r.status),e=>console.log('CLOSED'))"))
    $fromCt = $fc.text.Trim() -match 'OPEN'
    if ($fromHost -or $fromCt) { $exposed = $true }
    $ctx.lanProbes += [ordered]@{ ip = $ip; reachableFromHost = $fromHost; reachableFromContainer = $fromCt }
  }
  Save-Evidence 's1-context.json' $ctx
  $loop = @($ctx.ollamaListeners | Where-Object { $_ -notmatch '^(127\.0\.0\.1|::1):' }).Count -eq 0
  $status = if ($exposed -or -not $loop) { 'FAIL' } elseif ($lanIps.Count -eq 0) { 'NOT TESTED' } else { 'PASS' }
  Add-R 'S1-EXPOSURE' 'Ollama stays loopback-only; not reachable on any LAN IP' $status ("listeners: $($ctx.ollamaListeners -join ', '); LAN IPs tested: $($lanIps -join ', '); exposed: $exposed")
}

# ----------------------------------------------------------------------------- 5. resources
if ($SkipResources) { Add-R 'RES' 'resource sampling' 'NOT TESTED' 'skipped' }
else {
  function Get-StackMem {
    $s = Get-DockerStdout @('stats', '--no-stream', '--format', '{{.Name}}|{{.MemUsage}}')
    $o = [ordered]@{}
    foreach ($l in ($s.text -split "`n")) { if ($l -match '^(tybc-spike-[^|]+)\|\s*([\d.]+)\s*([KMG]i?B)') { $o[$Matches[1]] = [math]::Round([double]$Matches[2] * @{ 'KiB' = 1/1024; 'MiB' = 1; 'GiB' = 1024; 'kB' = 1/1000; 'MB' = 1; 'GB' = 1000 }[$Matches[3]], 1) } }
    return $o
  }
  function Get-OllamaMB { $p = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^ollama' }); [math]::Round((($p | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 0) }
  function Get-WinUsedMB { try { $os = Get-CimInstance Win32_OperatingSystem; [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1KB, 0) } catch { $null } }
  function Get-VmmemMB { try { $p = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -match '^vmmem' }); [math]::Round((($p | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 0) } catch { $null } }
  Start-Sleep -Seconds 20
  $res = [ordered]@{ idleContainersMiB = (Get-StackMem); ollamaIdleMB = (Get-OllamaMB); windowsUsedIdleMB = (Get-WinUsedMB); dockerVmIdleMB = (Get-VmmemMB); totalRamMB = $null; inference = $null }
  try { $res.totalRamMB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB, 0) } catch { }
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient; $client.Timeout = [TimeSpan]::FromSeconds(300)
  $body = '{"model":"qwen3.5:4b","prompt":"Summarise in five short Thai bullet points why a restaurant should count stock daily.","stream":false,"think":false,"options":{"num_predict":200}}'
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $task = $client.PostAsync('http://127.0.0.1:11434/api/generate', (New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/json')))
  $peakO = 0; $peakW = 0; $peakV = 0
  while (-not $task.IsCompleted) {
    $o = Get-OllamaMB; $w = Get-WinUsedMB; $v = Get-VmmemMB
    if ($o -gt $peakO) { $peakO = $o }; if ($w -gt $peakW) { $peakW = $w }; if ($v -gt $peakV) { $peakV = $v }
    Start-Sleep -Milliseconds 500
  }
  $sw.Stop()
  $ok = $false; try { $ok = $task.Result.IsSuccessStatusCode } catch { }
  $res.inference = [ordered]@{ ok = $ok; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); ollamaPeakMB = $peakO; windowsUsedPeakMB = $peakW; dockerVmPeakMB = $peakV }
  $res.loadedContainersMiB = Get-StackMem
  Save-Evidence 'resources.json' $res
  $stackIdle = [math]::Round((($res.idleContainersMiB.Values | Measure-Object -Sum).Sum), 0)
  $head = if ($res.totalRamMB -and $peakW) { $res.totalRamMB - $peakW } else { $null }
  $st = if (-not $ok) { 'WARN' } elseif ($head -ne $null -and $head -lt 1024) { 'FAIL' } elseif ($head -ne $null -and $head -lt 2048) { 'WARN' } else { 'PASS' }
  Add-R 'RES' 'RAM: stack idle, Ollama idle/peak, Windows headroom during inference' $st "stack idle ${stackIdle} MiB; Ollama idle $($res.ollamaIdleMB) MB, peak $peakO MB; Windows used peak $peakW of $($res.totalRamMB) MB (headroom $head MB); inference $($res.inference.seconds)s ok=$ok"
}

# ----------------------------------------------------------------------------- 6. persistence
if ($SkipPersistence) { Add-R 'PERSIST' 'external volume survives stop / down / down -v' 'NOT TESTED' 'skipped' }
else {
  $digestSql = "select (select count(*) from auth.users)||'/'||(select count(*) from public.stock_movements)||'/'||md5(coalesce(string_agg(t::text,'|' order by t.id),'')) from public.stock_movements t"
  function Get-Digest { (Get-DockerStdout (Compose @('exec', '-T', 'db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-c', $digestSql))).text.Trim() }
  $p = [ordered]@{ baseline = (Get-Digest) }
  Invoke-Docker (Compose @('stop')) | Out-Null; Invoke-Docker (Compose @('up', '-d', '--wait')) | Out-Null; $p.afterStopStart = Get-Digest
  Invoke-Docker (Compose @('down')) | Out-Null; $p.volumeAfterDown = ((Get-DockerStdout @('volume', 'inspect', $Volume)).code -eq 0)
  Invoke-Docker (Compose @('up', '-d', '--wait')) | Out-Null; $p.afterDownUp = Get-Digest
  Invoke-Docker (Compose @('down', '-v')) | Out-Null; $p.volumeAfterDownV = ((Get-DockerStdout @('volume', 'inspect', $Volume)).code -eq 0)
  Invoke-Docker (Compose @('up', '-d', '--wait')) | Out-Null; $p.afterDownVUp = Get-Digest
  Save-Evidence 'persistence.json' $p
  $same = ($p.baseline -and $p.afterStopStart -eq $p.baseline -and $p.afterDownUp -eq $p.baseline -and $p.afterDownVUp -eq $p.baseline -and $p.volumeAfterDown -and $p.volumeAfterDownV)
  Add-R 'PERSIST' 'external volume survives stop / down / down -v (Docker Desktop)' $(if ($same) { 'PASS' } else { 'FAIL' }) ($p | ConvertTo-Json -Compress)
}

$summary = [ordered]@{ ranAt = (Get-Date).ToString('o'); machine = $env:COMPUTERNAME; evidence = $Evidence; counts = [ordered]@{}; results = $Results }
foreach ($s in 'PASS', 'WARN', 'FAIL', 'NOT TESTED') { $summary.counts[$s] = @($Results | Where-Object status -eq $s).Count }
Save-Evidence 'results.json' $summary
Write-Host ''
Write-Host ("PASS {0}  WARN {1}  FAIL {2}  NOT TESTED {3}   evidence: {4}" -f $summary.counts.PASS, $summary.counts.WARN, $summary.counts.FAIL, $summary.counts.'NOT TESTED', $Evidence)
Write-Host 'Leave the stack running for inspection, or remove it with -Cleanup.'
exit $(if ($summary.counts.FAIL) { 2 } elseif ($summary.counts.WARN -or $summary.counts.'NOT TESTED') { 1 } else { 0 })
