// ═══════════════════════════════════════════════════════════════════════════
//  VÉRIFIE LA FENÊTRE SUR UN VRAI WINDOWS (GitHub Actions)
// ═══════════════════════════════════════════════════════════════════════════
//  node build/tester-fenetre.mjs compiler   le C# compile-t-il ?
//  node build/tester-fenetre.mjs ouvrir     la fenêtre s'ouvre-t-elle, et
//                                           répond-elle au protocole ?
//  Même chemin qu'en vrai : le script part sur l'entrée de PowerShell.
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { scriptFenetre } from '../fenetre.mjs'

const mode = process.argv[2] || 'compiler'
let script = scriptFenetre({ exe: process.execPath, version: '0.0.0', cacherConsole: false, langue: 'fr' })
if (mode === 'compiler') script = script.replace(/^\[CPUI\]::Run\(.*$/m, 'Write-Output "COMPILE-OK"')

const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
let erreurs = ''
ps.stderr.on('data', d => { erreurs += d })
const echec = (m) => { console.error(`✗ ${m}\n${erreurs}`); try { ps.kill() } catch {} process.exit(1) }
const minuteur = setTimeout(() => echec('pas de réponse en 90 s'), 90_000)

readline.createInterface({ input: ps.stdout }).on('line', (l) => {
  console.log(`  ${l}`)
  if (l === 'COMPILE-OK') { clearTimeout(minuteur); console.log('✓ La fenêtre compile.'); ps.stdin.end() }
  if (l === 'PRET') {
    for (const m of ['ETAT\tpret\tTest', 'COMPTEUR\t3\tF1', 'MAJ\t9.9.9\tNote \\u00e9\tauto', 'CODE\tdemande', 'CODE\terreur\tRefus\\u00e9', 'MSG\tBonjour'])
      ps.stdin.write(m + '\n')
    setTimeout(() => { ps.stdin.write('FIN\n'); setTimeout(() => ps.stdin.end(), 500) }, 1500)
  }
})
ps.on('exit', (code) => {
  clearTimeout(minuteur)
  if (erreurs.trim()) echec(`PowerShell a signalé des erreurs (code ${code})`)
  console.log(`✓ PowerShell terminé (code ${code}).`)
  process.exit(0)
})
ps.stdin.write(script)
