param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Picture,
  [Parameter(Mandatory = $true)][string]$SecondPicture,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem, System.Drawing, System.Windows.Forms

$Product = 'LibrePhotos Viewer'
$DataName = 'com.librephotos.viewer'
$ExeName = 'librephotos-viewer.exe'
$StartupSeconds = 90
$Package = (Resolve-Path $Package).Path
$Exe = (Resolve-Path $Exe).Path
$Picture = (Resolve-Path $Picture).Path
$SecondPicture = (Resolve-Path $SecondPicture).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$Installer = Join-Path $env:LOCALAPPDATA $DataName
$Classes = 'HKCU:\Software\Classes'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace LpvSmoke {
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, int options, out uint processId);
  }

  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  class ApplicationActivationManager {}

  public static class Activation {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ShellExecuteInfo {
      public int cbSize;
      public uint fMask;
      public IntPtr hwnd;
      public string lpVerb;
      public string lpFile;
      public string lpParameters;
      public string lpDirectory;
      public int nShow;
      public IntPtr hInstApp;
      public IntPtr lpIDList;
      public string lpClass;
      public IntPtr hkeyClass;
      public uint dwHotKey;
      public IntPtr hIcon;
      public IntPtr hProcess;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ShellExecuteExW(ref ShellExecuteInfo info);

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr window);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }

    public static uint Launch(string aumid, string arguments) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint pid;
      Marshal.ThrowExceptionForHR(manager.ActivateApplication(aumid, arguments, 0, out pid));
      return pid;
    }

    public static void OpenWith(string progId, string path) {
      var info = new ShellExecuteInfo();
      info.cbSize = Marshal.SizeOf(typeof(ShellExecuteInfo));
      info.fMask = 0x1 | 0x100 | 0x400;
      info.lpVerb = "open";
      info.lpFile = path;
      info.lpClass = progId;
      info.nShow = 1;
      if (!ShellExecuteExW(ref info)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }

    public static int[] Bounds(IntPtr window) {
      SetForegroundWindow(window);
      Rect r;
      GetWindowRect(window, out r);
      return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }
  }
}
'@

$script:Diagnostics = New-Object System.Collections.Generic.List[scriptblock]

function Step([string]$Message) { Write-Host "- $Message" }

function Fail([string]$Message) {
  Write-Host "::error::msix smoke test failed: $Message"
  foreach ($report in $script:Diagnostics) {
    try { & $report | Out-Host } catch { Write-Host "(diagnostic failed: $_)" }
  }
  exit 1
}

function Wait-For([string]$What, [int]$Seconds, [scriptblock]$Probe) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $value = $null
    try { $value = & $Probe } catch { $value = $null }
    if ($value) { return $value }
    Start-Sleep -Seconds 1
  }
  Fail "timed out waiting for $What"
}

function Find-Sdk([string]$Tool) {
  $bin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $found = Get-ChildItem -Path $bin -Directory -Filter '10.*' |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName "x64\$Tool" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if (-not $found) { Fail "no $Tool in $bin" }
  return $found
}

function Read-PackageManifest([string]$Path) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entry = $zip.GetEntry('AppxManifest.xml')
    $reader = New-Object System.IO.StreamReader $entry.Open()
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $zip.Dispose() }
}

function Get-WindowTitle([int]$ProcessId) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) { return '' }
  return $process.MainWindowTitle
}

function Get-PackagedProcesses([string]$InstallLocation) {
  Get-CimInstance Win32_Process -Filter "Name = '$ExeName'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallLocation, [StringComparison]::OrdinalIgnoreCase) }
}

function Stop-Tree([int]$ProcessId) {
  & taskkill /PID $ProcessId /T /F 2>&1 | Out-Null
  Wait-For "process $ProcessId to exit" 30 { $null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) } | Out-Null
}

function Get-DefaultClass([string]$Extension) {
  $key = Get-Item -LiteralPath "$Classes\$Extension" -ErrorAction SilentlyContinue
  if ($null -eq $key) { return '(none)' }
  $value = $key.GetValue('')
  if ($null -eq $value) { return '(none)' }
  return "=$value"
}

function Get-UserChoice([string]$Extension) {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\UserChoice"
  $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  if ($null -eq $item) { return '(none)' }
  return [string]$item.ProgId
}

function Get-OpenWithProgIds([string]$Extension) {
  $key = Get-Item -LiteralPath "$Classes\$Extension\OpenWithProgids" -ErrorAction SilentlyContinue
  if ($null -eq $key) { return @() }
  return @($key.GetValueNames())
}

function Get-TreeSnapshot([string]$Root) {
  if (-not (Test-Path $Root)) { return @() }
  Get-ChildItem -LiteralPath $Root -Recurse -Force -File |
    Sort-Object FullName |
    ForEach-Object { '{0}|{1}|{2}' -f $_.FullName.Substring($Root.Length), $_.Length, $_.LastWriteTimeUtc.Ticks }
}

function Invoke-Python([string]$Code, [string[]]$Arguments) {
  $output = & python -c $Code @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "python failed: $output" }
  return $output
}

function Save-Screenshot([int]$ProcessId, [string]$Name) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process -or $process.MainWindowHandle -eq [IntPtr]::Zero) { return }
  Start-Sleep -Seconds 4
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $full = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
  $graphics = [System.Drawing.Graphics]::FromImage($full)
  $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
  $graphics.Dispose()
  $full.Save((Join-Path $OutDir "$Name-screen.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $full.Dispose()
  $bounds = [LpvSmoke.Activation]::Bounds($process.MainWindowHandle)
  Start-Sleep -Milliseconds 800
  if ($bounds[2] -gt 0 -and $bounds[3] -gt 0) {
    $window = New-Object System.Drawing.Bitmap $bounds[2], $bounds[3]
    $graphics = [System.Drawing.Graphics]::FromImage($window)
    $graphics.CopyFromScreen($bounds[0], $bounds[1], 0, 0, $window.Size)
    $graphics.Dispose()
    $window.Save((Join-Path $OutDir "$Name-window.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $window.Dispose()
  }
  Step "saved screenshots $Name-screen.png and $Name-window.png"
}

function Save-DefaultAppsPage([string]$Aumid) {
  try {
    Start-Process "ms-settings:defaultapps?registeredAUMID=$([uri]::EscapeDataString($Aumid))"
    Start-Sleep -Seconds 10
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $shot = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    $graphics = [System.Drawing.Graphics]::FromImage($shot)
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $graphics.Dispose()
    $shot.Save((Join-Path $OutDir 'msix-default-apps-screen.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $shot.Dispose()
    Get-Process SystemSettings -ErrorAction SilentlyContinue | Stop-Process -Force
    Step 'saved msix-default-apps-screen.png'
  } catch {
    Write-Host "::warning::no Default apps screenshot: $_"
  }
}

$manifest = Read-PackageManifest $Package
$identityName = $manifest.Package.Identity.Name
$publisher = $manifest.Package.Identity.Publisher
$extensions = @($manifest.GetElementsByTagName('uap:FileType') | ForEach-Object { $_.InnerText.Trim() })
if ($extensions.Count -lt 20) { Fail "the manifest declares only $($extensions.Count) file types" }
Step "package $identityName by $publisher declares $($extensions.Count) file types"

if (Get-AppxPackage -Name $identityName) { Fail "$identityName is installed before the test" }
if (Test-Path $Installer) { Fail "$Installer exists before the test; run this on a clean machine" }

Step 'signing a copy with a throwaway certificate for this run only'
$signDir = Join-Path $OutDir 'test-signed'
New-Item -ItemType Directory -Force -Path $signDir | Out-Null
$signed = Join-Path $signDir (Split-Path $Package -Leaf)
Copy-Item -LiteralPath $Package -Destination $signed -Force
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
  -FriendlyName 'LibrePhotos Viewer MSIX smoke test' -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddDays(2) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path $signDir 'smoke-test.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
& (Find-Sdk 'signtool.exe') sign /fd SHA256 /sha1 $cert.Thumbprint /s My $signed
if ($LASTEXITCODE -ne 0) { Fail "signtool exited with $LASTEXITCODE" }

$jpgClassBefore = Get-DefaultClass '.jpg'
$jpgChoiceBefore = Get-UserChoice '.jpg'
$script:Diagnostics.Add({ Get-AppxPackage -Name $identityName | Format-List Name, PackageFullName, PackageFamilyName, InstallLocation, Status })
$script:Diagnostics.Add({ "processes:"; Get-CimInstance Win32_Process -Filter "Name = '$ExeName' OR Name = 'msedgewebview2.exe'" | Format-Table ProcessId, ParentProcessId, ExecutablePath -AutoSize })
$script:Diagnostics.Add({ "$Classes\.jpg:"; & reg query 'HKCU\Software\Classes\.jpg' /s 2>&1 })
$script:Diagnostics.Add({ "AppX events:"; Get-WinEvent -LogName 'Microsoft-Windows-AppXDeploymentServer/Operational' -MaxEvents 15 -ErrorAction SilentlyContinue | Format-List TimeCreated, Id, Message })

function Install-Package {
  Add-AppxPackage -Path $signed
  $installed = Get-AppxPackage -Name $identityName
  if (-not $installed) { Fail "Get-AppxPackage does not list $identityName after Add-AppxPackage" }
  Step "installed $($installed.PackageFullName) into $($installed.InstallLocation)"
  return [pscustomobject]@{
    PackageFullName   = [string]$installed.PackageFullName
    PackageFamilyName = [string]$installed.PackageFamilyName
    InstallLocation   = [string]$installed.InstallLocation
  }
}

function Assert-Registered($Installed) {
  $repository = "$Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\$($Installed.PackageFullName)\App\Capabilities\FileAssociations"
  $associations = Get-Item -LiteralPath $repository -ErrorAction SilentlyContinue
  if ($null -eq $associations) { Fail "the package registered no file associations at $repository" }
  $progIds = @{}
  foreach ($extension in $extensions) {
    $progId = $associations.GetValue($extension)
    if (-not $progId) { Fail "the package registered no file association for $extension" }
    $progIds[$extension] = $progId
    if ((Get-OpenWithProgIds $extension) -notcontains $progId) {
      Fail "Open with does not offer the package for $extension (no $progId in $extension\OpenWithProgids)"
    }
    $command = Get-Item -LiteralPath "$Classes\$progId\Shell\open" -ErrorAction SilentlyContinue
    if ($null -eq $command) { Fail "$progId has no open verb for $extension" }
    $application = Get-ItemProperty -LiteralPath "$Classes\$progId\Application" -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.AppUserModelID -ne "$($Installed.PackageFamilyName)!App") {
      Fail "$progId does not open $($Installed.PackageFamilyName)!App"
    }
  }
  $registered = Get-Item -LiteralPath 'HKCU:\Software\RegisteredApplications' -ErrorAction SilentlyContinue
  $entry = if ($registered) { $registered.GetValueNames() | Where-Object { [string]$registered.GetValue($_) -like "*$($Installed.PackageFullName)*" } } else { $null }
  Write-Host "  RegisteredApplications entry for Default apps: $(if ($entry) { $entry } else { '(none)' })"
  $after = Get-DefaultClass '.jpg'
  if ($after -ne $jpgClassBefore) { Fail "installing changed the .jpg class from $jpgClassBefore to $after" }
  $choice = Get-UserChoice '.jpg'
  if ($choice -ne $jpgChoiceBefore) { Fail "installing changed the .jpg default app from $jpgChoiceBefore to $choice" }
  Step "Open with offers the package for all $($extensions.Count) types ($(($progIds.Values | Sort-Object -Unique) -join ', ')), defaults unchanged"
  return $progIds
}

function Assert-Removed($Installed, $ProgIds) {
  Remove-AppxPackage -Package $Installed.PackageFullName
  Wait-For 'Get-AppxPackage to forget the package' 60 { -not (Get-AppxPackage -Name $identityName) } | Out-Null
  $packageData = Join-Path $env:LOCALAPPDATA "Packages\$($Installed.PackageFamilyName)"
  Wait-For "the package data at $packageData to be deleted" 60 { -not (Test-Path $packageData) } | Out-Null
  Wait-For "the install folder $($Installed.InstallLocation) to be deleted" 60 { -not (Test-Path $Installed.InstallLocation) } | Out-Null
  foreach ($extension in $ProgIds.Keys) {
    if ((Get-OpenWithProgIds $extension) -contains $ProgIds[$extension]) { Fail "Open with still offers the removed package for $extension" }
  }
  $after = Get-DefaultClass '.jpg'
  if ($after -ne $jpgClassBefore) { Fail "removing left the .jpg class at $after, not $jpgClassBefore" }
  Step 'removed: package, its data, its install folder and its Open with entries are gone'
}

function Wait-Title([int]$ProcessId, [string]$Path) {
  $expected = "$(Split-Path $Path -Leaf) - $Product"
  Wait-For "the window title `"$expected`" (pid $ProcessId)" $StartupSeconds { (Get-WindowTitle $ProcessId) -eq $expected } | Out-Null
  Step "pid $ProcessId shows `"$expected`""
}

Step 'scenario 1: a fresh install keeps its data inside the package'
$installed = Install-Package
$aumid = "$($installed.PackageFamilyName)!App"
$progIds = Assert-Registered $installed
$root = Join-Path $env:LOCALAPPDATA "Packages\$($installed.PackageFamilyName)\LocalCache\Local\$DataName"
$script:Diagnostics.Add({ "package data:"; if (Test-Path (Join-Path $env:LOCALAPPDATA "Packages\$($installed.PackageFamilyName)")) { Get-ChildItem -Recurse -Depth 4 (Join-Path $env:LOCALAPPDATA "Packages\$($installed.PackageFamilyName)") | Select-Object -First 60 FullName } })

$first = [int][LpvSmoke.Activation]::Launch($aumid, "`"$Picture`"")
Step "launched $aumid on $(Split-Path $Picture -Leaf) (pid $first)"
$script:Diagnostics.Add({ "window title of ${first}: $(Get-WindowTitle $first)" })
Wait-Title $first $Picture
$running = @(Get-PackagedProcesses $installed.InstallLocation)
if ($running.Count -ne 1) { Fail "expected one packaged process, found $($running.Count)" }
Save-Screenshot $first 'msix-viewer'

[LpvSmoke.Activation]::OpenWith($progIds['.jpg'], $SecondPicture)
Step "opened $(Split-Path $SecondPicture -Leaf) with the package's .jpg ProgID $($progIds['.jpg']), as Open with does"
Wait-Title $first $SecondPicture
Wait-For 'the second activation to hand over and exit' 30 { @(Get-PackagedProcesses $installed.InstallLocation).Count -eq 1 } | Out-Null
Step 'the running viewer took the file: single instance works packaged'

foreach ($path in @((Join-Path $root 'local.db'), (Join-Path $root 'EBWebView'))) {
  Wait-For "$path to exist" 30 { Test-Path $path } | Out-Null
}
if (Test-Path $Installer) { Fail "the packaged app wrote to $Installer instead of its package folder" }
Step "data written under $root, nothing under $Installer"
Stop-Tree $first
Save-DefaultAppsPage $aumid
Assert-Removed $installed $progIds

Step 'scenario 2: the installer build has data, the first packaged start imports it once'
$plain = Start-Process -FilePath $Exe -ArgumentList "`"$Picture`"" -PassThru
Wait-Title $plain.Id $Picture
Stop-Tree $plain.Id
if (-not (Test-Path (Join-Path $Installer 'local.db'))) { Fail "the installer build wrote no library to $Installer" }
$marker = "carried-over-$([guid]::NewGuid())"
$code = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE IF NOT EXISTS msix_smoke (marker TEXT)'); c.execute('INSERT INTO msix_smoke VALUES (?)', (sys.argv[2],)); c.commit()"
Invoke-Python $code @((Join-Path $Installer 'local.db'), $marker) | Out-Null
$settings = '{"msixSmoke":"' + $marker + '"}'
[System.IO.File]::WriteAllText((Join-Path $Installer 'settings.json'), $settings)
$before = Get-TreeSnapshot $Installer
Step "the installer build's library at $Installer holds $marker ($($before.Count) files)"

$installed = Install-Package
$aumid = "$($installed.PackageFamilyName)!App"
$progIds = Assert-Registered $installed
$root = Join-Path $env:LOCALAPPDATA "Packages\$($installed.PackageFamilyName)\LocalCache\Local\$DataName"
[LpvSmoke.Activation]::OpenWith($progIds['.jpg'], $Picture)
$viewer = Wait-For 'the packaged viewer to start' 60 { Get-PackagedProcesses $installed.InstallLocation | Select-Object -First 1 }
Wait-Title ([int]$viewer.ProcessId) $Picture

$importMarker = Join-Path $root 'imported-from-installer-build.json'
if (-not (Test-Path $importMarker)) { Fail "no import marker at $importMarker" }
Write-Host (Get-Content -Raw $importMarker)
$found = Invoke-Python "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('SELECT marker FROM msix_smoke').fetchone()[0])" @((Join-Path $root 'local.db'))
if ($found -ne $marker) { Fail "the packaged library holds $found, not $marker" }
$copiedSettings = [System.IO.File]::ReadAllText((Join-Path $root 'settings.json'))
if ($copiedSettings -ne $settings) { Fail "settings.json was not carried over: $copiedSettings" }
if (Test-Path "$root.importing") { Fail "the import left $root.importing behind" }
$after = Get-TreeSnapshot $Installer
if (Compare-Object $before $after) {
  Fail "the packaged app changed the installer build's folder:`n$((Compare-Object $before $after | Out-String))"
}
Step "imported: library and settings carried over once, the installer build's folder untouched"

$other = Start-Process -FilePath $Exe -ArgumentList "`"$SecondPicture`"" -PassThru
Wait-Title ([int]$viewer.ProcessId) $SecondPicture
Wait-For 'the installer build to hand the file over and exit' 30 { $other.HasExited } | Out-Null
Step 'the installer build and the package share one running viewer'
Stop-Tree ([int]$viewer.ProcessId)

$second = [int][LpvSmoke.Activation]::Launch($aumid, "`"$SecondPicture`"")
Wait-Title $second $SecondPicture
Stop-Tree $second
$again = Invoke-Python "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('SELECT count(*) FROM msix_smoke').fetchone()[0])" @((Join-Path $root 'local.db'))
if ($again -ne '1') { Fail "a second start imported again ($again rows)" }
Step 'a second start keeps the packaged library as it is'

Assert-Removed $installed $progIds
if (-not (Test-Path (Join-Path $Installer 'local.db'))) { Fail "removing the package deleted the installer build's library" }
Step "the installer build's library survives removing the package"
Remove-Item -Recurse -Force $Installer
Step 'msix smoke test passed'
