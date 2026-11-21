// ═══════════════════════════════════════════════════════════════════════════
//  FABRICATION DE CitizenPad-Bridge.exe — sous Windows uniquement
// ═══════════════════════════════════════════════════════════════════════════
//  Lancé par GitHub Actions (voir .github/workflows/construire.yml), ou à la
//  main sur un PC Windows avec Node 22 :   npm ci  puis  npm run fabriquer
//
//  1. esbuild rassemble bridge.mjs et ses dépendances en UN fichier.
//  2. Node le transforme en « blob » d'application autonome (SEA).
//  3. On copie node.exe, on lui donne l'icône, le nom et la version. Depuis
//     la 1.5.2 : SANS droits administrateur (asInvoker). Microsoft a refusé
//     allowElevation au Store (16 nov. 2026), et la fenêtre UAC jaune faisait
//     fuir les nouveaux venus. À valider en jeu : si Star Citizen tourne en
//     élevé, Windows (UIPI) bloque les touches d'un programme ordinaire.
//  4. On injecte le blob dans la copie : c'est le Bridge.
//  5. Inno Setup emballe le tout dans l'installateur (étape suivante du
//     workflow, pas ici).
// ═══════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rcedit } from 'rcedit'

if (process.platform !== 'win32') {
  console.error('À lancer sous Windows : l\'exécutable est fabriqué à partir de node.exe.')
  process.exit(1)
}

const racine = resolve(import.meta.dirname, '..')
const dist = join(racine, 'dist')
const version = JSON.parse(readFileSync(join(racine, 'package.json'), 'utf8')).version

// La version écrite dans bridge.mjs doit être la même : c'est elle que le
// Bridge compare à celle du site.
const source = readFileSync(join(racine, 'bridge.mjs'), 'utf8')
const dansLeCode = source.match(/const VERSION = '([^']+)'/)?.[1]
if (dansLeCode !== version) {
  console.error(`Versions différentes : package.json ${version}, bridge.mjs ${dansLeCode}.`)
  process.exit(1)
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

console.log(`▸ Bridge ${version}`)
console.log('▸ 0/4 L\'aide : fenêtre et clavier (C#, aide.cs)')
{
  // Le compilateur C# livré avec .NET Framework 4 (présent sur tout Windows).
  const csc = ['Framework64', 'Framework']
    .map(d => join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe'))
    .find(p => existsSync(p))
  if (!csc) throw new Error('csc.exe introuvable (.NET Framework 4)')
  // Nom, éditeur et version visibles dans Windows (barre des tâches,
  // Gestionnaire des tâches, propriétés du fichier).
  const infos = join(dist, 'aide-infos.cs')
  writeFileSync(infos, [
    'using System.Reflection;',
    '[assembly: AssemblyTitle("CitizenPad Bridge")]',
    '[assembly: AssemblyProduct("CitizenPad Bridge")]',
    '[assembly: AssemblyCompany("CitizenPad")]',
    `[assembly: AssemblyCopyright("© ${new Date().getFullYear()} CitizenPad")]`,
    `[assembly: AssemblyVersion("${version}.0")]`,
    `[assembly: AssemblyFileVersion("${version}.0")]`,
  ].join('\n'), 'utf8')
  execFileSync(csc, [
    '/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
    `/win32icon:${join(racine, 'build', 'icone.ico')}`,
    `/out:${join(dist, 'CitizenPad-Bridge-Aide.exe')}`,
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    join(racine, 'aide.cs'), infos,
  ], { stdio: 'inherit' })
}
console.log('▸ 0b/4 Les oreilles de NOA (C#, voix.cs) et leurs bibliothèques')
{
  const csc = ['Framework64', 'Framework']
    .map(d => join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe'))
    .find(p => existsSync(p))
  // Programme sans fenêtre (winexe) : il ne parle qu'au Bridge, par son entrée
  // et sa sortie. x64 : libvosk.dll est une bibliothèque 64 bits.
  execFileSync(csc, [
    '/nologo', '/target:winexe', '/optimize+', '/codepage:65001', '/platform:x64',
    `/win32icon:${join(racine, 'build', 'icone.ico')}`,
    `/out:${join(dist, 'CitizenPad-Bridge-Voix.exe')}`,
    join(racine, 'voix.cs'), join(dist, 'aide-infos.cs'),
  ], { stdio: 'inherit' })
  // libvosk.dll (+ ses dépendances), préparés par GitHub Actions dans vendor/
  // (voir construire.yml). Copiés à côté du Bridge. (Whisper retiré en 1.6.7.)
  for (const d of ['vendor']) {
    const dossier = join(racine, d)
    if (!existsSync(dossier)) { console.log(`  (${d}/ absent : NOA sur le PC ne marchera pas avec cette fabrication)`); continue }
    for (const f of readdirSync(dossier)) { copyFileSync(join(dossier, f), join(dist, f)); console.log(`  + ${f}`) }
  }
}
console.log('▸ 1/4 Assemblage (esbuild)')
await build({
  entryPoints: [join(racine, 'bridge.mjs')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  // `ws` ne sert qu'aux vieux Node : l'exécutable embarque Node 22, qui a sa
  // propre WebSocket.
  external: ['ws'],
  outfile: join(dist, 'bridge.cjs'),
  legalComments: 'none',
})

console.log('▸ 2/4 Blob autonome (Node SEA)')
writeFileSync(join(dist, 'sea-config.json'), JSON.stringify({
  main: join(dist, 'bridge.cjs'),
  output: join(dist, 'sea.blob'),
  disableExperimentalSEAWarning: true,
}))
execFileSync(process.execPath, ['--experimental-sea-config', join(dist, 'sea-config.json')], { stdio: 'inherit' })

console.log('▸ 3/4 Exécutable : icône, nom, version, sans droits administrateur')
const exe = join(dist, 'CitizenPad-Bridge.exe')
copyFileSync(process.execPath, exe)

// node.exe est signé par la fondation OpenJS. Une fois modifié, cette
// signature devient invalide : on la retire proprement plutôt que de livrer
// un fichier à la signature cassée (plus suspect qu'une absence de signature).
const signtool = trouverSigntool()
if (signtool) execFileSync(signtool, ['remove', '/s', exe], { stdio: 'inherit' })
else console.log('  (signtool introuvable : signature d\'origine laissée en place)')

await rcedit(exe, {
  icon: join(racine, 'build', 'icone.ico'),
  'file-version': `${version}.0`,
  'product-version': `${version}.0`,
  'requested-execution-level': 'asInvoker',
  'version-string': {
    CompanyName: 'CitizenPad',
    FileDescription: 'CitizenPad Bridge',
    ProductName: 'CitizenPad Bridge',
    InternalFilename: 'CitizenPad-Bridge',
    OriginalFilename: 'CitizenPad-Bridge.exe',
    LegalCopyright: `© ${new Date().getFullYear()} CitizenPad`,
  },
})

console.log('▸ 4/4 Injection du Bridge dans l\'exécutable')
execFileSync(process.execPath, [
  join(racine, 'node_modules', 'postject', 'dist', 'cli.js'),
  exe, 'NODE_SEA_BLOB', join(dist, 'sea.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
], { stdio: 'inherit' })

// ── Pas de console ─────────────────────────────────────────────────────────
// Un exécutable « console » ouvre une fenêtre noire à chaque lancement. On le
// marque « application Windows » (sous-système GUI) : plus de fenêtre noire,
// seule la fenêtre du Bridge apparaît. Node le gère : sans console, ses
// sorties partent simplement dans le vide (le journal, lui, est écrit).
// Le champ Subsystem est à l'octet 68 de l'en-tête optionnel PE.
{
  const octets = readFileSync(exe)
  const pe = octets.readUInt32LE(0x3c)
  if (octets.readUInt32LE(pe) !== 0x00004550) throw new Error('En-tête PE introuvable')
  const champ = pe + 4 + 20 + 68
  const avant = octets.readUInt16LE(champ)
  if (avant !== 3 && avant !== 2) throw new Error(`Sous-système inattendu : ${avant}`)
  octets.writeUInt16LE(2, champ)   // 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI
  writeFileSync(exe, octets)
  console.log(`  sous-système : ${avant} → 2 (application Windows, sans console)`)
}

// Le logo affiché en haut de la fenêtre, à côté de l'exécutable.
copyFileSync(join(racine, 'build', 'logo.png'), join(dist, 'logo.png'))

writeFileSync(join(dist, 'version.txt'), version)
console.log(`✓ ${exe}`)

function trouverSigntool() {
  const base = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  if (!existsSync(base)) return null
  const versions = readdirSync(base).filter(d => /^10\./.test(d)).sort().reverse()
  for (const v of versions) {
    const p = join(base, v, 'x64', 'signtool.exe')
    if (existsSync(p)) return p
  }
  return null
}
