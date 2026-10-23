; ═══════════════════════════════════════════════════════════════════════════
;  INSTALLATEUR DE CITIZENPAD BRIDGE (Inno Setup 6)
; ═══════════════════════════════════════════════════════════════════════════
;  Compilé par GitHub Actions :  iscc /DVersion=1.4.0 build\installateur.iss
;
;  - Installation dans le dossier de l'utilisateur, SANS droits
;    administrateur : pas de fenêtre UAC pour installer.
;    (Le Bridge, lui, les demandera à chaque lancement : Star Citizen tourne
;    élevé, et Windows refuse qu'un programme ordinaire lui envoie des
;    touches.)
;  - Raccourcis menu Démarrer et Bureau, désinstallation depuis les
;    Paramètres de Windows comme n'importe quelle application.
;  - En mise à jour (/SILENT), il garde les choix d'origine et relance le
;    Bridge tout seul à la fin.
;
;  ⚠ NE JAMAIS CHANGER AppId : c'est lui qui fait reconnaître une mise à jour
;  comme la même application au lieu d'une seconde installation.
; ═══════════════════════════════════════════════════════════════════════════
#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
AppId={{DA1D8263-0A9A-4177-B5DF-842C70988B13}
AppName=CitizenPad Bridge
AppVersion={#Version}
AppVerName=CitizenPad Bridge {#Version}
AppPublisher=CitizenPad
AppPublisherURL=https://citizenpad.com
AppSupportURL=https://citizenpad.com
VersionInfoVersion={#Version}.0
VersionInfoProductName=CitizenPad Bridge
VersionInfoCompany=CitizenPad
VersionInfoDescription=Installation de CitizenPad Bridge
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\CitizenPad Bridge
DisableDirPage=yes
DefaultGroupName=CitizenPad
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=CitizenPad-Bridge-Setup
SetupIconFile=icone.ico
UninstallDisplayIcon={app}\CitizenPad-Bridge.exe
UninstallDisplayName=CitizenPad Bridge
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=auto
; Un Bridge encore ouvert est fermé proprement avant de remplacer le fichier.
CloseApplications=yes
RestartApplications=no
UsePreviousTasks=yes

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
fr.Profil=Profil de touches Star Citizen
en.Profil=Star Citizen key profile
fr.Lisez=Lisez-moi
en.Lisez=Read me

[Tasks]
Name: "bureau"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\CitizenPad-Bridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LISEZ-MOI.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENCE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\profil-touches-citizenpad.xml"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\CitizenPad Bridge"; Filename: "{app}\CitizenPad-Bridge.exe"
Name: "{autoprograms}\CitizenPad\{cm:Lisez}"; Filename: "{app}\LISEZ-MOI.txt"
Name: "{autoprograms}\CitizenPad\{cm:Profil}"; Filename: "{app}"
Name: "{autodesktop}\CitizenPad Bridge"; Filename: "{app}\CitizenPad-Bridge.exe"; Tasks: bureau

[Run]
; shellexec : le Bridge demande les droits administrateur, seul ShellExecute
; sait afficher la demande. Sans « skipifsilent », cette ligne s'exécute
; aussi lors d'une mise à jour silencieuse : le Bridge revient tout seul.
Filename: "{app}\CitizenPad-Bridge.exe"; Description: "{cm:LaunchProgram,CitizenPad Bridge}"; Flags: nowait postinstall shellexec
