<#
  Removes the Justakartik Browser Presence companion, its native-host registration and the unpacked extension.

    irm https://raw.githubusercontent.com/justakartik/discord-browser-presence/main/uninstall.ps1 | iex

  Afterwards, remove the extension itself in chrome://extensions.
#>
$ErrorActionPreference = "SilentlyContinue"
$HostName = "com.justakartik.youtube_discord_presence"
Get-Process jpresence-host | Stop-Process -Force
Start-Sleep -Milliseconds 500
foreach ($root in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts", "HKCU:\Software\Chromium\NativeMessagingHosts")) {
  Remove-Item -Path (Join-Path $root $HostName) -Recurse -Force
}
Remove-Item -Path (Join-Path $env:LOCALAPPDATA "Justakartik\Presence") -Recurse -Force
Remove-Item -Path (Join-Path $env:APPDATA "Justakartik\Presence") -Recurse -Force
Write-Host "Justakartik Browser Presence removed. Now remove the extension in chrome://extensions." -ForegroundColor Green
