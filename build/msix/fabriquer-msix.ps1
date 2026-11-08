# ═══════════════════════════════════════════════════════════════════════════
#  PAQUET MICROSOFT STORE (MSIX), à partir de ce que `npm run fabriquer` a mis
#  dans dist\. Résultat : dist\CitizenPad-Bridge-<version>.msix, NON signé
#  (c'est Microsoft qui le signe quand il est publié sur le Store). À déposer
#  dans Partner Center > CitizenPad Bridge > Packages.
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
$racine = Resolve-Path "$PSScriptRoot\..\.."
$dist = Join-Path $racine 'dist'
$v = (Get-Content (Join-Path $dist 'version.txt')).Trim()
$stage = Join-Path $dist 'msix'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item (Join-Path $dist 'CitizenPad-Bridge.exe') $stage
Copy-Item (Join-Path $dist 'CitizenPad-Bridge-Aide.exe') $stage
Copy-Item (Join-Path $dist 'logo.png') $stage
foreach ($f in 'LISEZ-MOI.txt', 'LICENCE.txt', 'profil-touches-citizenpad.xml') { Copy-Item (Join-Path $racine $f) $stage }
Copy-Item (Join-Path $PSScriptRoot 'Assets') (Join-Path $stage 'Assets') -Recurse
(Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw).Replace('__VERSION__', "$v.0") |
  Set-Content (Join-Path $stage 'AppxManifest.xml') -Encoding utf8

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter makeappx.exe |
  Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe introuvable (Windows SDK)' }
$sortie = Join-Path $dist "CitizenPad-Bridge-$v.msix"
& $makeappx.FullName pack /d $stage /p $sortie /o
if ($LASTEXITCODE -ne 0) { throw "makeappx a échoué ($LASTEXITCODE)" }
Get-Item $sortie | Select-Object Name, Length
