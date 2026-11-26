#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef DistDir
  #error Pass /DDistDir=<the librephotos folder of the build>
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef OutputName
  #define OutputName "LibrePhotos-Setup-" + AppVersion
#endif
#ifndef Compression
  #define Compression "lzma2/max"
#endif
#define AppId "26C84F48-38D6-462C-8222-E61176B1CF84"
#define AppIdSetup "{{" + AppId + "}"
#define UninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\{" + AppId + "}_is1"
#define ProgramExe "{app}\librephotos\librephotos.exe"

[Setup]
AppId={#AppIdSetup}
AppName=LibrePhotos
AppVersion={#AppVersion}
AppVerName=LibrePhotos {#AppVersion}
AppPublisher=LibrePhotos
AppPublisherURL=https://docs.librephotos.com/
AppSupportURL=https://github.com/LibrePhotos/librephotos/issues
AppUpdatesURL=https://github.com/LibrePhotos/librephotos/releases
AppCopyright=LibrePhotos contributors
VersionInfoVersion={#AppVersion}
VersionInfoProductName=LibrePhotos
VersionInfoDescription=LibrePhotos Setup
PrivilegesRequired=lowest
DefaultDirName={userpf}\LibrePhotos
DisableDirPage=yes
UsePreviousAppDir=yes
DefaultGroupName=LibrePhotos
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupIconFile={#DistDir}\frontend_build\favicon.ico
UninstallDisplayIcon={#ProgramExe}
UninstallDisplayName=LibrePhotos
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
Compression={#Compression}
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4
CloseApplications=no
RestartApplications=no
SetupLogging=yes
#ifdef SignToolName
SignTool={#SignToolName}
SignedUninstaller=yes
#endif

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
en.AutostartTask=Start LibrePhotos when I sign in to Windows
en.StartNow=Start LibrePhotos now
en.Running=LibrePhotos is running. Quit it first: right-click its icon in the notification area (bottom right) and choose Quit LibrePhotos. Then run Setup again.
en.UninstallRunning=LibrePhotos is running. Quit it first: right-click its icon in the notification area (bottom right) and choose Quit LibrePhotos. Then uninstall it again.
en.KeepFailed=Setup could not rename %1 to keep it as the previous release. Close the programs that use files in it and run Setup again.
en.DeleteData=Also delete your LibrePhotos library in %1?%n%nThat is the database (users, albums, people, settings), the thumbnails, the machine learning models and the logs. Your photos in your own folders are not touched.%n%nChoose No to keep it: installing LibrePhotos again picks it up where you left off.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "{cm:AutostartTask}"; Flags: unchecked

[Files]
Source: "{#DistDir}\*"; DestDir: "{app}\librephotos"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\LibrePhotos"; Filename: "{#ProgramExe}"; Parameters: "{code:LaunchParameters}"; WorkingDir: "{app}"; Comment: "Start LibrePhotos"
Name: "{autodesktop}\LibrePhotos"; Filename: "{#ProgramExe}"; Parameters: "{code:LaunchParameters}"; WorkingDir: "{app}"; Comment: "Start LibrePhotos"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LibrePhotos"; ValueData: """{#ProgramExe}"" {code:AutostartParameters}"; Flags: uninsdeletevalue; Tasks: autostart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "LibrePhotos"; Flags: deletevalue; Tasks: not autostart

[Run]
Filename: "{#ProgramExe}"; Parameters: "{code:LaunchParameters}"; WorkingDir: "{app}"; Description: "{cm:StartNow}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\librephotos"
Type: filesandordirs; Name: "{app}\librephotos-*"

[Code]
var
  DataDirValue: String;
  PhotosValue: String;
  WhereRead: Boolean;

function HasSwitch(const Name: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Name) = 0 then
      Result := True;
end;

procedure ReadWhere;
begin
  if WhereRead then
    exit;
  DataDirValue := ExpandConstant('{param:DATADIR}');
  if DataDirValue = '' then
    DataDirValue := GetPreviousData('DataDir', '');
  PhotosValue := ExpandConstant('{param:PHOTOS}');
  if PhotosValue = '' then
    PhotosValue := GetPreviousData('Photos', '');
  WhereRead := True;
end;

function Quoted(const Value: String): String;
var
  Inner: String;
begin
  Inner := Value;
  if (Length(Inner) > 0) and (Inner[Length(Inner)] = '\') then
    Inner := Inner + '\';
  Result := '"' + Inner + '"';
end;

function WhereParameters: String;
begin
  ReadWhere;
  Result := '';
  if DataDirValue <> '' then
    Result := Result + ' --data-dir ' + Quoted(DataDirValue);
  if PhotosValue <> '' then
    Result := Result + ' --photos ' + Quoted(PhotosValue);
  Result := Trim(Result);
end;

function LaunchParameters(Param: String): String;
begin
  Result := WhereParameters;
end;

function AutostartParameters(Param: String): String;
begin
  Result := Trim(WhereParameters + ' run --no-browser');
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  ReadWhere;
  SetPreviousData(PreviousDataKey, 'DataDir', DataDirValue);
  SetPreviousData(PreviousDataKey, 'Photos', PhotosValue);
end;

function LibrePhotosRunningIn(const Folder: String): Boolean;
var
  Locator, Service, Found, Process: Variant;
  I, Pid: Integer;
  Path, Prefix: String;
begin
  Result := False;
  Prefix := Lowercase(AddBackslash(Folder));
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Found := Service.ExecQuery('SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name LIKE ''librephotos%.exe'' AND NOT Name LIKE ''librephotos-setup%''');
    for I := 0 to Found.Count - 1 do
    begin
      Process := Found.ItemIndex(I);
      Path := '';
      if not VarIsNull(Process.ExecutablePath) then
        Path := Process.ExecutablePath;
      Path := Lowercase(Path);
      Pid := Process.ProcessId;
      if (Folder = '') or (Pos(Prefix, Path) = 1) then
      begin
        Log('LibrePhotos runs: process ' + IntToStr(Pid) + ' ' + Path);
        Result := True;
      end;
    end;
  except
    Log('Could not list the running processes: ' + GetExceptionMessage);
    Result := False;
  end;
end;

function LibrePhotosRunning: Boolean;
begin
  Result := LibrePhotosRunningIn('');
end;

function IsRelease(const Folder: String): Boolean;
begin
  Result := FileExists(AddBackslash(Folder) + 'librephotos.exe') and FileExists(AddBackslash(Folder) + 'build_info.json');
end;

function KeepPreviousRelease: String;
var
  ProgramDir, Rollback: String;
begin
  Result := '';
  ProgramDir := ExpandConstant('{app}\librephotos');
  Rollback := ExpandConstant('{app}\librephotos-old');
  if not DirExists(ProgramDir) then
    exit;
  if DirExists(Rollback) then
  begin
    if IsRelease(Rollback) then
      DelTree(Rollback, True, True, True)
    else
      RenameFile(Rollback, Rollback + '.superseded-' + GetDateTimeString('yyyymmddhhnnss', #0, #0));
  end;
  if DirExists(Rollback) or not RenameFile(ProgramDir, Rollback) then
    Result := FmtMessage(CustomMessage('KeepFailed'), [ProgramDir]);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if (not HasSwitch('/SKIPRUNNINGCHECK')) and LibrePhotosRunning then
    Result := CustomMessage('Running')
  else
    Result := KeepPreviousRelease;
end;

var
  CustomDataDir: String;

function InitializeUninstall: Boolean;
begin
  Result := True;
  if not RegQueryStringValue(HKCU, '{#UninstallKey}', 'Inno Setup CodeFile: DataDir', CustomDataDir) then
    CustomDataDir := '';
  if LibrePhotosRunningIn(ExpandConstant('{app}')) then
  begin
    SuppressibleMsgBox(CustomMessage('UninstallRunning'), mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if (CurUninstallStep <> usPostUninstall) or UninstallSilent or (CustomDataDir <> '') then
    exit;
  DataDir := ExpandConstant('{localappdata}\LibrePhotos');
  if not DirExists(DataDir) then
    exit;
  if MsgBox(FmtMessage(CustomMessage('DeleteData'), [DataDir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DelTree(DataDir, True, True, True);
end;
