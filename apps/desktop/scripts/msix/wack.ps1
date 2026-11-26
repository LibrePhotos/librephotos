param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Report
)

$ErrorActionPreference = 'Stop'
$summary = $env:GITHUB_STEP_SUMMARY

function Write-Summary([string]$Text) {
  Write-Host $Text
  if ($summary) { Add-Content -Path $summary -Value $Text -Encoding utf8 }
}

$kit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\App Certification Kit\appcert.exe'
if (-not (Test-Path $kit)) {
  Write-Summary "### Windows App Certification Kit`n`nNot run: $kit is not on this runner."
  exit 0
}

New-Item -ItemType Directory -Force -Path (Split-Path $Report) | Out-Null
$Report = Join-Path (Resolve-Path (Split-Path $Report)).Path (Split-Path $Report -Leaf)
& $kit reset | Out-Host
$started = Get-Date
& $kit test -appxpackagepath (Resolve-Path $Package).Path -reportoutputpath $Report | Out-Host
$exit = $LASTEXITCODE
if (-not (Test-Path $Report)) {
  Write-Summary "### Windows App Certification Kit`n`nappcert.exe exited with $exit and wrote no report."
  exit 1
}

[xml]$xml = Get-Content -Raw $Report
$overall = $xml.REPORT.OVERALL_RESULT
$lines = @(
  '### Windows App Certification Kit',
  '',
  "Overall: **$overall** (appcert.exe $((Get-Item $kit).VersionInfo.FileVersion), $([int]((Get-Date) - $started).TotalMinutes) min)",
  '',
  '| Test | Result |',
  '| --- | --- |'
)
foreach ($test in $xml.SelectNodes('//TEST')) {
  $result = $test.RESULT.'#cdata-section'
  if (-not $result) { $result = $test.RESULT.InnerText }
  $kind = if ($test.OPTIONAL -eq 'TRUE') { ' (optional)' } else { '' }
  $lines += "| $($test.NAME)$kind | $($result.Trim()) |"
}
Write-Summary ($lines -join "`n")
foreach ($test in $xml.SelectNodes('//TEST')) {
  $result = $test.RESULT.InnerText.Trim()
  if ($result -ne 'PASS') {
    $kind = if ($test.OPTIONAL -eq 'TRUE') { 'optional test' } else { 'required test' }
    Write-Host "::warning::WACK $kind $($test.NAME): $result"
    foreach ($message in $test.SelectNodes('.//MESSAGE')) { Write-Host "  $($message.TEXT)" }
  }
}
