# ═══════════════════════════════════════════════════════════════════════════
#  ESSAI RÉEL SUR LA MACHINE WINDOWS DE GITHUB
# ═══════════════════════════════════════════════════════════════════════════
#  Lance le vrai CitizenPad-Bridge.exe (dossier utilisateur temporaire, donc
#  jamais appairé : il doit afficher sa fenêtre et attendre un code), vérifie
#  qu'il tourne toujours au bout de 15 s, photographie l'écran, puis l'arrête.
#  Le journal du Bridge est recopié dans le résumé de l'exécution.
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Continue'
$profil = Join-Path $env:RUNNER_TEMP 'profil-essai'
New-Item -ItemType Directory -Force -Path $profil | Out-Null
$env:USERPROFILE = $profil
$env:HOME = $profil
$p = Start-Process -FilePath (Resolve-Path 'dist\CitizenPad-Bridge.exe') -PassThru
Start-Sleep -Seconds 15
$vivant = -not $p.HasExited
New-Item -ItemType Directory -Force -Path 'captures' | Out-Null
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $ecran = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $img = New-Object System.Drawing.Bitmap $ecran.Width, $ecran.Height
  $g = [System.Drawing.Graphics]::FromImage($img)
  $g.CopyFromScreen($ecran.Location, [System.Drawing.Point]::Empty, $ecran.Size)
  $img.Save((Join-Path (Get-Location) 'captures\fenetre.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} catch { Write-Host "Capture impossible : $_" }
$journal = Join-Path $profil '.citizenpad\journal.txt'
$texte = if (Test-Path $journal) { (Get-Content $journal -Raw) } else { '(pas de journal)' }
Write-Host $texte
$resume = ($texte -replace '\r?\n', ' | ')
if ($resume.Length -gt 1500) { $resume = $resume.Substring($resume.Length - 1500) }
if ($vivant) {
  Write-Host "::notice::Bridge toujours en marche après 15 s. Journal : $resume"
  Stop-Process -Id $p.Id -Force
  Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | Stop-Process -Force -ErrorAction SilentlyContinue
  exit 0
} else {
  Write-Host "::error::Le Bridge s'est arrêté tout seul (code $($p.ExitCode)). Journal : $resume"
  exit 1
}
