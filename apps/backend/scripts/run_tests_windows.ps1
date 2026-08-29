<#
.SYNOPSIS
    Run the LibrePhotos backend test suite on a Windows dev box (in-memory SQLite).

.DESCRIPTION
    Uses the NATIVE Windows dev venv at apps/backend/.venv-win -- the full pinned
    dependency set installed from requirements.windows.txt (real pyvips, libmagic,
    torch, insightface, exiftool, ...). Run scripts/setup_windows.ps1 once first.

    The test DB is in-memory SQLite (librephotos.settings.test_sqlite); no Postgres
    needed. The libmagic loader shim is applied automatically by the venv (see
    setup_windows.ps1); this script additionally puts exiftool.exe on PATH, which
    migration 0009 needs at test-DB setup.

    Lightweight alternative (no native deps / no C++ compiler): install
    requirements.windows-test.txt and set DJANGO_SETTINGS_MODULE to
    librephotos.settings.test_windows (stubs the native modules). See CLAUDE.md.

.PARAMETER TestArgs
    Arguments passed straight to `manage.py test`, e.g. a dotted test path like
    api.tests.test_photo_lifecycle, optionally with flags such as `-v 2`.
    Defaults to the whole suite (api.tests).

.EXAMPLE
    ./scripts/run_tests_windows.ps1
    ./scripts/run_tests_windows.ps1 api.tests.test_multi_user_isolation
    ./scripts/run_tests_windows.ps1 api.tests.test_stats_accuracy -v 2
#>
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TestArgs = @("api.tests")
)

if (-not $TestArgs -or $TestArgs.Count -eq 0) { $TestArgs = @("api.tests") }

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $BackendDir ".venv-win\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Error "venv not found at $Python. Run ./scripts/setup_windows.ps1 first."
    exit 1
}

$TmpRoot = Join-Path $BackendDir ".testtmp"
foreach ($sub in @("logs", "data", "protected_media")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $TmpRoot $sub) | Out-Null
}

# Ensure exiftool.exe is reachable (winget installs it here for the current user).
$ExifDir = Join-Path $env:LOCALAPPDATA "Programs\ExifTool"
if ((Test-Path $ExifDir) -and ($env:PATH -notlike "*$ExifDir*")) {
    $env:PATH = "$ExifDir;$env:PATH"
}
if (-not (Get-Command exiftool -ErrorAction SilentlyContinue)) {
    Write-Warning "exiftool.exe not found on PATH -- migration 0009 will fail. Install: winget install --id OliverBetz.ExifTool"
}

$env:DJANGO_SETTINGS_MODULE = "librephotos.settings.test_sqlite"
$env:SECRET_KEY = "test-secret-key"
$env:BASE_DATA = $TmpRoot
$env:BASE_LOGS = Join-Path $TmpRoot "logs"
$env:NO_COVERAGE = "1"

Push-Location $BackendDir
try {
    & $Python manage.py test @TestArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
