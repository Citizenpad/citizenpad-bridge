// ═══════════════════════════════════════════════════════════════════════════
//  FABRICATION DE CitizenPad-Bridge.exe — sous Windows uniquement
// ═══════════════════════════════════════════════════════════════════════════
//  Lancé par GitHub Actions (voir .github/workflows/construire.yml), ou à la
//  main sur un PC Windows avec Node 22 :   npm ci  puis  npm run fabriquer
//
//  1. esbuild rassemble bridge.mjs et ses dépendances en UN fichier.
//  2. Node le transforme en « blob » d'application autonome (SEA).
//  3. On copie node.exe, on lui donne l'icône, le nom, la version, et la
//     demande de droits administrateur (indispensable : Star Citizen tourne
//     élevé, et Windows refuse qu'un programme ordinaire lui envoie des
//     touches).
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

console.log('▸ 3/4 Exécutable : icône, nom, version, droits administrateur')
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
  'requested-execution-level': 'requireAdministrator',
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
