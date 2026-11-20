// Essai de CitizenPad-Bridge-Voix.exe sur la machine de GitHub : le programme
// démarre, charge libvosk.dll, lit le modèle français (téléchargé comme le
// ferait le Bridge), accepte une liste de phrases et du son, et répond.
// whisper-server démarre aussi (aide en ligne seulement : pas de modèle ici).
import { Noa } from '../noa.mjs'
import { spawn, execFileSync } from 'node:child_process'
import readline from 'node:readline'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const dist = resolve(import.meta.dirname, '..', 'dist')
const SITE = 'https://dev-citizenpad.contact-citizenpad.workers.dev'
const noa = new Noa({ diffuser() {}, autorise: () => true, noter: l => console.log('  ', l), site: () => SITE, dossierProgramme: dist })
const modele = await noa.modeleVosk()
console.log('Modèle :', modele)

const p = spawn(join(dist, 'CitizenPad-Bridge-Voix.exe'), [], { cwd: dist, stdio: ['pipe', 'pipe', 'inherit'] })
const vus = new Set()
readline.createInterface({ input: p.stdout }).on('line', l => { console.log('  voix >', l.slice(0, 160)); vus.add(l.split('\t')[0]) })
const w = l => p.stdin.write(l + '\n')
const attendre = (quoi, ms) => new Promise((ok, ko) => {
  const t0 = Date.now()
  const i = setInterval(() => { if (vus.has(quoi)) { clearInterval(i); ok() } else if (Date.now() - t0 > ms) { clearInterval(i); ko(new Error(`pas de ${quoi}`)) } }, 50)
})
await attendre('PRET', 10000)
w(`MODELE\t${modele}`); await attendre('MODELE_OK', 30000)
w('GRAMMAIRE\t["noa noise", "noa decoy", "[unk]"]\t0'); await attendre('GRAMMAIRE_OK', 10000)
w('INFOS'); await attendre('INFOS', 10000)
w('MICROS'); await attendre('MICROS', 10000)
w('SOURCE\texterne')
// Une seconde de bruit léger : le programme doit l'accepter sans planter.
const son = Buffer.alloc(32000); for (let i = 0; i < son.length; i += 2) son.writeInt16LE(Math.round((Math.random() - 0.5) * 200), i)
for (let i = 0; i < son.length; i += 1280) w(`PCM\t${son.subarray(i, i + 1280).toString('base64')}`)
await attendre('NIVEAU', 5000)
// Le son de NOA sur le PC : la machine de GitHub n'a pas de carte son, le programme doit
// le dire sans s'arrêter.
vus.delete('INFOS')
w('SON_DEBUT\t24000'); w(`SON\t${Buffer.alloc(4800).toString('base64')}`); w('SON_STOP')
w('INFOS'); await attendre('INFOS', 10000)
w('QUITTER')
await new Promise(r => p.on('exit', r))

for (const f of ['whisper-server.exe', 'whisper-server-vulkan.exe']) {
  const exe = join(dist, f)
  if (!existsSync(exe)) throw new Error(`${f} absent`)
  try { execFileSync(exe, ['--help'], { stdio: 'pipe', timeout: 20000 }) ; console.log(`✓ ${f} démarre`) }
  catch (e) {
    // Sans pilote Vulkan sur la machine de GitHub, la version carte graphique ne peut pas démarrer : normal.
    if (f.includes('vulkan')) console.log(`  (${f} : ${String(e.message).slice(0, 120)} — attendu sans carte graphique)`)
    else throw e
  }
}
console.log('✓ Les oreilles de NOA fonctionnent.')
