<#
.SYNOPSIS
    One-time setup of a NATIVE LibrePhotos backend dev environment on Windows.

.DESCRIPTION
    Installs the full pinned dependency set from requirements.windows.txt into a
    Python 3.11 venv at apps/backend/.venv-win, installs the two external binaries
    that two packages need (exiftool for PyExifTool, ImageMagick for Wand), and
    writes a small libmagic loader shim into the venv so python-magic imports the
    correct DLL.

    Everything was verified on Windows 11 / CPython 3.11.9 (win_amd64). After this
    finishes, run the suite with: ./scripts/run_tests_windows.ps1

.NOTES
    - Requires Python 3.11 (winget install Python.Python.3.11) and winget.
    - insightface has no prebuilt wheel and is compiled from sdist; that needs the
      MSVC v143 C++ toolchain. If Visual Studio / Build Tools is absent the script
      warns and tells you how to install it. (If you can't install a compiler, use
      the lightweight stub path instead -- see apps/backend/CLAUDE.md.)
#>
[CmdletBinding()]
param(
    [switch]$SkipExternalBinaries
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $BackendDir ".venv-win"
$Reqs = Join-Path $BackendDir "requirements.windows.txt"

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# --- 1. Locate Python 3.11 -----------------------------------------------------
Write-Step "Locating Python 3.11"
$py = $null
try { & py -3.11 --version *> $null; if ($LASTEXITCODE -eq 0) { $py = @("py", "-3.11") } } catch {}
if (-not $py) {
    Write-Error "Python 3.11 not found. Install it with: winget install --id Python.Python.3.11 --scope user"
    exit 1
}
Write-Host ("Using: " + (& $py[0] $py[1] -c "import sys; print(sys.executable)"))

# --- 2. Create venv ------------------------------------------------------------
Write-Step "Creating venv at $VenvDir"
if (-not (Test-Path (Join-Path $VenvDir "Scripts\python.exe"))) {
    & $py[0] $py[1] -m venv $VenvDir
}
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPy -m pip install -U pip wheel | Out-Null

# --- 3. Install the full pinned dependency set ---------------------------------
Write-Step "Installing requirements.windows.txt (this pulls torch, faiss, insightface, ... -- several minutes)"
& $VenvPy -m pip install -r $Reqs
if ($LASTEXITCODE -ne 0) {
    Write-Warning "pip install failed. If the failure was building 'insightface', you are missing the MSVC C++ compiler."
    Write-Warning "Install it with: winget install --id Microsoft.VisualStudio.2022.BuildTools --override `"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet`""
    exit 1
}

# --- 4. libmagic loader shim ---------------------------------------------------
# python-magic on Windows can load Git-for-Windows' MSYS libmagic (msys-magic-1.dll)
# which crashes CPython. Prepend python-magic-bin's bundled DLL dir at startup.
Write-Step "Installing libmagic loader shim into the venv"
$SitePackages = & $VenvPy -c "import sysconfig; print(sysconfig.get_paths()['purelib'])"
$ShimPy = Join-Path $SitePackages "_lp_win_magic_shim.py"
$ShimPth = Join-Path $SitePackages "_lp_win_magic_shim.pth"
@'
"""LibrePhotos Windows dev shim: make python-magic load the RIGHT libmagic.

Git-for-Windows' usr\bin on PATH provides an MSYS/cygwin libmagic that crashes
native CPython when python-magic loads it. Prepend python-magic-bin's bundled
native libmagic.dll directory at interpreter startup so it wins. No-op elsewhere.
Loaded automatically via the companion _lp_win_magic_shim.pth file.
"""
import os
import sys


def _install():
    if sys.platform != "win32":
        return
    try:
        import importlib.util

        spec = importlib.util.find_spec("magic")
        if not spec or not spec.origin:
            return
        libmagic_dir = os.path.join(os.path.dirname(spec.origin), "libmagic")
        if os.path.isdir(libmagic_dir):
            os.environ["PATH"] = libmagic_dir + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass


_install()
'@ | Set-Content -Encoding UTF8 $ShimPy
"import _lp_win_magic_shim`n" | Set-Content -Encoding UTF8 $ShimPth
Write-Host "Wrote $ShimPy"

# --- 5. External binaries ------------------------------------------------------
if (-not $SkipExternalBinaries) {
    Write-Step "Installing external binaries via winget (exiftool, ImageMagick)"
    # exiftool.exe: REQUIRED -- migration 0009 starts an ExifTool process at test-DB setup.
    winget install --id OliverBetz.ExifTool --silent --accept-package-agreements --accept-source-agreements
    # ImageMagick: needed only by Wand (the inno DLL build -- NOT the msix single-exe).
    winget install --id ImageMagick.ImageMagick --silent --accept-package-agreements --accept-source-agreements
    Write-Host "NOTE: open a fresh shell so exiftool.exe / ImageMagick land on PATH."
} else {
    Write-Host "`nSkipped external binaries. exiftool.exe is REQUIRED for the test suite (winget install --id OliverBetz.ExifTool)."
}

# --- 6. MSVC sanity note -------------------------------------------------------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    Write-Warning "No Visual Studio detected. insightface compiles from source and needs the MSVC v143 C++ toolchain if it wasn't already installed above."
}

Write-Step "Done"
Write-Host "Run the test suite with:  ./scripts/run_tests_windows.ps1" -ForegroundColor Green
