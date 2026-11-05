#ifndef PackageDir
  #error PackageDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif

[Setup]
AppId=Contentrium.RiumDownload
AppName=Rium Download
AppVersion={#AppVersion}
AppPublisher=Contentrium
AppPublisherURL=https://contentrium.com/
DefaultDirName={localappdata}\Rium Download
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Rium-Download-Setup-Windows-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UninstallDisplayName=Rium Download
UninstallDisplayIcon={app}\extension\icon128.png
SetupLogging=yes
InfoBeforeFile=windows-notice.txt

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#PackageDir}\native\*"; DestDir: "{app}\native"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PackageDir}\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PackageDir}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PackageDir}\LICENSE"; DestDir: "{app}"
Source: "{#PackageDir}\THIRD-PARTY.md"; DestDir: "{app}"

[Run]
Filename: "{app}\설치 안내.html"; Description: "브라우저 확장 추가 안내 열기 / Open browser setup guide"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
Filename: "{app}\native\rium-download-host.exe"; Parameters: "--unregister-installed --no-guide"; Flags: runhidden waituntilterminated; RunOnceId: "UnregisterNativeHost"

[UninstallDelete]
Type: files; Name: "{app}\설치 안내.html"
Type: files; Name: "{app}\native\com.contentrium.rium_download.json"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    if not Exec(ExpandConstant('{app}\native\rium-download-host.exe'),
      '--register-installed --no-guide', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      RaiseException('Browser helper registration could not start. Run setup again.');
    if ResultCode <> 0 then
      RaiseException('Browser helper registration failed. Run setup again.');
  end;
end;
