<#
  Justakartik Browser Presence - one-line installer (Windows, per-user, no admin).

    irm https://raw.githubusercontent.com/justakartik/discord-browser-presence/main/install.ps1 | iex

  Downloads the latest GitHub release, verifies SHA-256, installs the companion (Discord application IDs are
  built in) and unpacks the browser extension. Re-run it any time to update.
#>
param(
  [string]$Version = "latest",
  [string]$Repo = "justakartik/discord-browser-presence"
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"   # much faster Invoke-WebRequest on Windows PowerShell 5.1

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

Step "Finding release ($Version)"
$api = if ($Version -eq "latest") { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/$Version" }
$rel = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "justakartik-presence-installer" }
function Asset($name) {
  $a = $rel.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $a) { throw "Release $($rel.tag_name) has no asset named '$name'." }
  return $a.browser_download_url
}

# A stalled transfer must not hang forever: each attempt gets a deadline, then it is retried.
function Get-Download($url, $dest) {
  for ($try = 1; $try -le 3; $try++) {
    $job = Start-Job -ScriptBlock { param($u, $o) $ProgressPreference = "SilentlyContinue"; Invoke-WebRequest -Uri $u -OutFile $o -UseBasicParsing } -ArgumentList $url, $dest
    $done = Wait-Job $job -Timeout 300
    $ok = $done -and $job.State -eq "Completed"
    Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($ok -and (Test-Path $dest)) { return }
    Remove-Item $dest -Force -ErrorAction SilentlyContinue
    Write-Host "    download attempt $try failed or timed out; retrying..." -ForegroundColor Yellow
  }
  throw "Could not download $url. Check your connection and run the installer again."
}

$tmp = Join-Path $env:TEMP ("jpresence-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  $files = @("JustakartikPresence.exe", "justakartik-presence-extension.zip", "SHA256SUMS.txt")
  foreach ($f in $files) {
    Step "Downloading $f"
    Get-Download (Asset $f) (Join-Path $tmp $f)
  }

  Step "Verifying checksums"
  $sums = @{}
  Get-Content (Join-Path $tmp "SHA256SUMS.txt") | ForEach-Object {
    if ($_ -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') { $sums[$Matches[2].Trim()] = $Matches[1].ToLower() }
  }
  foreach ($f in $files | Where-Object { $_ -ne "SHA256SUMS.txt" }) {
    $actual = (Get-FileHash (Join-Path $tmp $f) -Algorithm SHA256).Hash.ToLower()
    if (-not $sums.ContainsKey($f) -or $sums[$f] -ne $actual) { throw "Checksum mismatch for $f. Aborting; nothing was installed." }
  }

  Step "Installing companion"
  $installed = Join-Path $env:LOCALAPPDATA "Justakartik\Presence\jpresence-host.exe"
  $want = $sums["JustakartikPresence.exe"]
  $ok = $false
  # The browser relaunches the companion as soon as it is stopped, which can lock the file mid-copy,
  # so retry until the installed exe really matches the verified download.
  for ($i = 1; $i -le 20 -and -not $ok; $i++) {
    Get-Process jpresence-host -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 400
    # Piping the output keeps the exe from waiting for a key press.
    & (Join-Path $tmp "JustakartikPresence.exe") --install | Out-Null
    if (Test-Path $installed) { $ok = ((Get-FileHash $installed -Algorithm SHA256).Hash.ToLower() -eq $want) }
  }
  if (-not $ok) { throw "Could not replace the running companion. Close Chrome/Edge and run the installer again." }
  Write-Host "    companion installed and verified"

  Step "Unpacking extension"
  $extDir = Join-Path $env:LOCALAPPDATA "Justakartik\Presence\extension"
  if (Test-Path $extDir) { Get-ChildItem $extDir -Force | Remove-Item -Recurse -Force }
  New-Item -ItemType Directory -Force $extDir | Out-Null
  Expand-Archive -Path (Join-Path $tmp "justakartik-presence-extension.zip") -DestinationPath $extDir -Force
  if (-not (Test-Path (Join-Path $extDir "manifest.json"))) { throw "Extension unpack failed (manifest.json missing)." }
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

try { Set-Clipboard -Value $extDir } catch { }
Write-Host ""
Write-Host "Companion installed ($($rel.tag_name))." -ForegroundColor Green
Write-Host "Last step (Chrome does not allow scripts to add extensions):" -ForegroundColor Yellow
Write-Host "  1. Open chrome://extensions and turn on 'Developer mode'"
Write-Host "  2. Click 'Load unpacked' and choose:  $extDir   (path copied to your clipboard)"
Write-Host "  3. Discord: User Settings -> Activity Privacy -> 'Share your detected activities'"
Write-Host "Updating later? Just run this installer again, then click reload on the extension."
try { Start-Process "chrome.exe" "chrome://extensions" } catch { try { Start-Process "msedge.exe" "edge://extensions" } catch { } }
try { Start-Process explorer.exe $extDir } catch { }
