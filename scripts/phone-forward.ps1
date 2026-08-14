# Forward the Pixel's http://localhost:5173 to this PC's Vite server.
#   npm run phone         - wait for USB, then connect once
#   npm run phone:watch   - keep re-applying when the cable drops

param(
  [switch]$Watch
)

$ErrorActionPreference = "Stop"
$port = 5173
$adb = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  $fromPath = Get-Command adb -ErrorAction SilentlyContinue
  if ($fromPath) { $adb = $fromPath.Source }
}
if (-not (Test-Path $adb)) {
  Write-Error "adb not found at $env:LOCALAPPDATA\Android\platform-tools\adb.exe"
}

function Connect-Phone {
  Write-Host "Waiting for phone (unlock it and allow USB debugging if asked)..."
  & $adb start-server | Out-Null
  & $adb wait-for-device
  $line = (& $adb devices -l | Select-String "device ").Line
  if (-not $line) {
    throw "Phone is connected but not authorized. Check the Allow USB debugging prompt."
  }
  & $adb reverse "tcp:$port" "tcp:$port" | Out-Null
  $name = if ($line -match "model:(\S+)") { $Matches[1] -replace "_", " " } else { "device" }
  Write-Host "OK - $name -> http://localhost:$port/  (open that URL in Chrome on the phone)"
}

Connect-Phone

if (-not $Watch) { exit 0 }

Write-Host "Watching for disconnects. Ctrl+C to stop."
$wasPresent = $true
while ($true) {
  Start-Sleep -Seconds 2
  $present = [bool](& $adb devices | Select-String "\sdevice(\s|$)")
  if ($present -and -not $wasPresent) {
    Write-Host "Phone back - reconnecting..."
    try { Connect-Phone } catch { Write-Host $_ }
  } elseif (-not $present -and $wasPresent) {
    Write-Host "Phone gone. Plug it back in."
  }
  $wasPresent = $present
}
