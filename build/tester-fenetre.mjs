// ═══════════════════════════════════════════════════════════════════════════
//  VÉRIFIE L'AIDE (fenêtre et clavier) SUR UN VRAI WINDOWS (GitHub Actions)
// ═══════════════════════════════════════════════════════════════════════════
//  Ouvre la fenêtre, lui envoie chaque type de message, la ferme. Démarre le
//  clavier et vérifie qu'il répond READY (sans presser aucune touche).
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { join } from 'node:path'

const aide = join(process.cwd(), 'dist', 'CitizenPad-Bridge-Aide.exe')
const echec = (m, details = '') => {
  console.log(`::error::${m} :: ${String(details).replace(/\s+/g, ' ').slice(0, 1500)}`)
  process.exit(1)
}

function essayer(args, surLigne, delai = 30_000) {
  return new Promise((resolve) => {
    const p = spawn(aide, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let erreurs = ''
    p.stderr.on('data', d => { erreurs += d })
    const m = setTimeout(() => echec(`${args[0]} : pas de réponse`, erreurs), delai)
    readline.createInterface({ input: p.stdout }).on('line', l => { console.log(`  ${args[0]} > ${l}`); surLigne(l, p) })
    p.on('exit', (code) => {
      clearTimeout(m)
      if (erreurs.trim()) echec(`${args[0]} : erreurs (code ${code})`, erreurs)
      resolve(code)
    })
  })
}

await essayer(['fenetre', '0.0.0', 'fr'], (l, p) => {
  if (l.startsWith('ERREUR')) echec('fenêtre', l)
  if (l === 'PRET') {
    for (const m of ['ETAT\tpret\tTest', 'COMPTEUR\t3\tF1', 'MAJ\t9.9.9\tNote \\u00e9\tauto', 'CODE\tdemande', 'CODE\terreur\tRefus\\u00e9', 'MSG\tBonjour', 'TEST'])
      p.stdin.write(m + '\n')
    setTimeout(() => p.stdin.write('FIN\n'), 1500)
  }
})
console.log('✓ La fenêtre répond.')

await essayer(['clavier'], (l, p) => { if (l === 'READY') p.stdin.end() })
console.log('✓ Le clavier répond.')
