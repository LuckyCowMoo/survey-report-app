# Encodes public/tutorial/_walk_frames into walk.mp4 after the Blender job exits.
param(
  [int]$BlenderPid,
  [string]$Repo = "C:\Users\lukea\Projects\survey-report-app"
)

$frames = Join-Path $Repo "public\tutorial\_walk_frames"
$mp4 = Join-Path $Repo "public\tutorial\walk.mp4"
$done = Join-Path $Repo "public\tutorial\RENDER_DONE.txt"
$log = Join-Path $Repo "public\tutorial\encode.log"

function Write-Log($m) {
  $line = "$(Get-Date -Format o) $m"
  Add-Content -Path $log -Value $line
}

if ($BlenderPid -gt 0) {
  Write-Log "Waiting for Blender PID $BlenderPid"
  try { Wait-Process -Id $BlenderPid -ErrorAction Stop } catch {}
}

$ffmpeg = $null
$candidates = @(
  (Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe",
  "$env:ProgramFiles\ffmpeg\bin\ffmpeg.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if ($candidates) { $ffmpeg = $candidates[0] }
if (-not $ffmpeg) {
  Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 | ForEach-Object { $ffmpeg = $_.FullName }
}

if (-not $ffmpeg) {
  Write-Log "ffmpeg not found; PNG frames are in $frames"
  exit 1
}

if (-not (Test-Path (Join-Path $frames "walk_0001.png"))) {
  Write-Log "No walk frames found"
  exit 1
}

Write-Log "Encoding with $ffmpeg"
& $ffmpeg -y -framerate 24 -i (Join-Path $frames "walk_%04d.png") -c:v libx264 -pix_fmt yuv420p $mp4
if ($LASTEXITCODE -eq 0 -and (Test-Path $mp4)) {
  Write-Log "Wrote $mp4"
  Add-Content -Path $done -Value "walk.mp4 encoded"
  exit 0
}
Write-Log "ffmpeg failed with $LASTEXITCODE"
exit 1
