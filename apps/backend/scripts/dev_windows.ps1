<#
.SYNOPSIS
    Run the native Windows dev stack: exif sidecar (:8010) + qcluster + uvicorn (:8000).
    Needs a venv from requirements.txt (.venv or .venv-win); see
    CLAUDE.md. Frontend: VITE_BACKEND_URL in apps/frontend/.env.development, `yarn start`.
.EXAMPLE
    ./scripts/dev_windows.ps1 -DataDir C:\librephotos-devdata
    ./scripts/dev_windows.ps1 -Only workers
#>
[CmdletBinding()]
param(
    [string]$DataDir = (Join-Path $HOME "librephotos-devdata"),
    [string]$LogsDir,
    [string]$BindAddress = "0.0.0.0",
    [int]$Port = 8000,
    [string]$Python,
    [ValidateSet("all", "server", "workers", "exif")]
    [string]$Only = "all",
    [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $PSScriptRoot
if (-not $LogsDir) { $LogsDir = Join-Path $DataDir "logs" }
New-Item -ItemType Directory -Force -Path $DataDir, $LogsDir | Out-Null

if (-not $Python) {
    $Python = "python"
    foreach ($venv in @(".venv", ".venv-win")) {
        $candidate = Join-Path $BackendDir "$venv\Scripts\python.exe"
        if (Test-Path $candidate) { $Python = $candidate; break }
    }
}

$env:DJANGO_SETTINGS_MODULE = "librephotos.settings.dev_windows"
$env:BASE_DATA = $DataDir
$env:BASE_LOGS = $LogsDir
if (-not $env:SECRET_KEY) { $env:SECRET_KEY = "dev-secret-key" }


Push-Location $BackendDir
$children = @()
try {
    if (-not $SkipMigrate -and $Only -in @("all", "server")) {
        & $Python manage.py migrate
        if ($LASTEXITCODE -ne 0) { throw "migrate failed" }
    }
    if ($Only -in @("all", "exif")) {
        $children += Start-Process -FilePath $Python -ArgumentList "service/exif/main.py" -NoNewWindow -PassThru `
            -RedirectStandardOutput (Join-Path $LogsDir "dev-exif.log") `
            -RedirectStandardError (Join-Path $LogsDir "dev-exif.err.log")
    }
    if ($Only -in @("all", "workers")) {
        $children += Start-Process -FilePath $Python -ArgumentList "manage.py", "qcluster" -NoNewWindow -PassThru `
            -RedirectStandardOutput (Join-Path $LogsDir "dev-qcluster.log") `
            -RedirectStandardError (Join-Path $LogsDir "dev-qcluster.err.log")
    }
    if ($Only -in @("all", "server")) {
        Write-Host "API http://${BindAddress}:$Port  (logs: $LogsDir)" -ForegroundColor Green
        & $Python -m uvicorn librephotos.asgi:application --host $BindAddress --port $Port --reload
    }
    elseif ($children) {
        Write-Host "Running. Ctrl-C to stop." -ForegroundColor Green
        $children | Wait-Process
    }
}
finally {
    Pop-Location
    foreach ($child in $children) {
        if ($child -and -not $child.HasExited) {
            try { Stop-Process -Id $child.Id -Force -ErrorAction Stop } catch {}
        }
    }
}
