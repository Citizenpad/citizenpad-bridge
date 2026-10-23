#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  CITIZENPAD BRIDGE — application PC
// ═══════════════════════════════════════════════════════════════════════════
//  Reçoit les commandes de la button box et les transforme en vraies frappes
//  clavier / souris sur cet ordinateur.
//
//  ── COMMENT ÇA MARCHE ────────────────────────────────────────────────────
//  Deux processus qui se parlent :
//
//    Node        gère la connexion au salon Realtime et la logique
//    PowerShell  reste ouvert en permanence et injecte les entrées via
//                l'API Windows SendInput
//
//  Pourquoi PowerShell plutôt qu'un module natif : les bibliothèques Node qui
//  simulent le clavier (robotjs, nut-js) demandent une compilation native, un
//  compilateur C++ installé, et cassent à chaque nouvelle version de Node.
//  Ici, zéro dépendance native — le seul paquet nécessaire est le client
//  Supabase. Et un PowerShell maintenu OUVERT coûte 1 à 3 ms par commande,
//  là où le relancer à chaque touche en coûterait 200.
//
//  ── SÉCURITÉ ─────────────────────────────────────────────────────────────
//  La liste blanche plus bas est la vraie barrière. L'application n'appuie
//  QUE sur des touches qu'elle connaît. Même si quelqu'un devinait
//  l'identifiant du salon, il ne pourrait pas faire taper une commande
//  arbitraire, ouvrir un terminal ni saisir du texte.
//
//  Toute touche inconnue est refusée et signalée à l'écran.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, statSync, renameSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import readline from 'node:readline'
import { createServer } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { connect as connexionLocale } from 'node:net'
import { scriptFenetre, ascii } from './fenetre.mjs'

/**
 * Version de CE Bridge.
 *
 * À incrémenter à chaque correction envoyée aux joueurs (ici ET dans
 * package.json) : c'est l'écart avec /api/version qui annonce la mise à jour.
 */
const VERSION = '1.4.0'

// ── Où tourne ce Bridge ? ────────────────────────────────────────────────────
// Deux façons de l'utiliser :
//   - CitizenPad-Bridge.exe, posé par l'installateur (le cas normal) ;
//   - `node bridge.mjs`, pour le développement.
// Seule la version .exe sait s'installer une mise à jour : l'autre se contente
// de l'annoncer.
const EXE = /citizenpad-bridge\.exe$/i.test(process.execPath)

// ── Le site auquel il parle ──────────────────────────────────────────────────
// citizenpad.com par défaut. La version de test du site donne des codes
// d'appairage commençant par « T- » : le Bridge retient alors le site de test
// dans sa configuration, et toutes ses demandes partent là-bas.
const SITE_PROD = 'https://citizenpad.com'
const SITE_TEST = 'https://dev-citizenpad.contact-citizenpad.workers.dev'
let SITE = (process.env.CITIZENPAD_URL || SITE_PROD).replace(/\/+$/, '')

// ── D'où viennent les mises à jour ───────────────────────────────────────────
// Adresse FIXE, écrite ici et nulle part ailleurs : le Bridge ne télécharge
// jamais un fichier dont l'adresse lui serait dictée par le réseau. Seul le
// numéro de version vient du site, et il doit ressembler à « 1.4.2 ».
const DEPOT = 'https://github.com/Citizenpad/citizenpad-bridge/releases/download'
const NOM_INSTALLEUR = 'CitizenPad-Bridge-Setup.exe'

const CONFIG = join(homedir(), '.citizenpad', 'bridge.json')
const JOURNAL = join(homedir(), '.citizenpad', 'journal.txt')

// Français si Windows est en français, anglais sinon.
const FR = (() => { try { return /^fr/i.test(Intl.DateTimeFormat().resolvedOptions().locale) } catch { return true } })()
const t = (fr, en) => FR ? fr : en

// ═══════════════════════════════════════════════════════════════════════════
//  LA FENÊTRE (voir fenetre.mjs)
// ═══════════════════════════════════════════════════════════════════════════
//  Ouverte par défaut dans la version .exe. `--console` garde l'ancienne
//  console (dépannage) ; CP_FENETRE=1 l'ouvre aussi en développement.
class Fenetre {
  constructor() {
    this.ps = null
    this.ok = false
    this.fermeture = false
    this.attenteCode = null
    this.actions = {}       // MAJ, CHANGER, JOURNAL, QUITTER, FERMEE
  }

  /** true si la fenêtre s'est ouverte ; false (sans rien casser) sinon. */
  ouvrir() {
    return new Promise((resolve) => {
      let fini = false
      const finir = (v) => { if (!fini) { fini = true; resolve(v) } }
      try {
        this.ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (e) { noter(`FENÊTRE  lancement impossible : ${e.message}`); return finir(false) }
      this.ps.on('error', (e) => { noter(`FENÊTRE  ${e.message}`); finir(false) })
      this.ps.stderr.setEncoding('utf8')
      this.ps.stderr.on('data', d => noter(`FENÊTRE  ${String(d).trim().slice(0, 600)}`))
      readline.createInterface({ input: this.ps.stdout }).on('line', (l) => {
        const [quoi, ...reste] = l.split('\t')
        if (quoi === 'PRET') { this.ok = true; return finir(true) }
        if (quoi === 'ERREUR') { noter(`FENÊTRE  erreur : ${reste.join(' ').slice(0, 1500)}`); return }
        if (quoi === 'CODE') { const r = this.attenteCode; this.attenteCode = null; r?.(reste.join('')); return }
        this.actions[quoi]?.()
      })
      this.ps.on('exit', (code) => {
        const etaitOk = this.ok
        this.ok = false
        finir(false)
        if (etaitOk && !this.fermeture) { noter(`FENÊTRE  fermée de façon inattendue (code ${code})`); this.actions.FERMEE?.() }
      })
      this.ps.stdin.on('error', () => {})
      this.ps.stdin.write(scriptFenetre({
        exe: process.execPath, version: VERSION,
        // L'exécutable n'a plus de console à cacher (voir build/fabriquer.mjs).
        cacherConsole: false, langue: FR ? 'fr' : 'en',
      }))
      // Compilation + ouverture : une à trois secondes d'habitude.
      setTimeout(() => { if (!this.ok) { noter('FENÊTRE  pas de réponse, retour à la console'); try { this.ps.kill() } catch {} finir(false) } }, 30_000)
    })
  }

  envoyer(...champs) {
    if (!this.ok || !this.ps?.stdin.writable) return
    const ligne = champs.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')
    this.ps.stdin.write(ascii(ligne) + '\n')
  }
  etat(code, detail = '') { this.envoyer('ETAT', code, detail) }
  afficher() { this.envoyer('AFFICHER') }
  /** Attend que le joueur appuie sur Valider. `afficher` : montre d'abord le
   *  champ (la première fois seulement : le refaire effacerait le message
   *  d'erreur d'un code refusé). */
  demanderCode(afficher) { if (afficher) this.envoyer('CODE', 'demande'); return new Promise(r => { this.attenteCode = r }) }
  fermer() { this.fermeture = true; this.envoyer('FIN') }
}

/** La fenêtre, quand elle est ouverte. null en mode console. */
let fen = null
/** État affiché (fenêtre ouverte), ou rien. */
// ⚠ Pas « etat » : ce nom est déjà pris par le paramètre de canal.subscribe.
const montrerEtat = (code, detail) => fen?.etat(code, detail)

// ═══════════════════════════════════════════════════════════════════════════
//  MISES À JOUR — proposées, jamais imposées
// ═══════════════════════════════════════════════════════════════════════════
//  Un Bridge qui se coupe en plein combat pour se mettre à jour, c'est un
//  vaisseau sans commandes au pire moment. Règle absolue : RIEN ne s'installe
//  sans que le joueur l'ait demandé.
//
//  Le joueur a trois occasions de dire oui :
//    - au lancement du Bridge (il n'est pas encore en vol) ;
//    - la touche U dans cette fenêtre, quand il veut ;
//    - le bouton « Installer » qui apparaît sur sa tablette.
//
//  ⚠ LA VÉRIFICATION NE DOIT JAMAIS BLOQUER. Site injoignable, réponse
//  illisible, coupure réseau : on continue en silence.
// ═══════════════════════════════════════════════════════════════════════════
const VERSION_VALIDE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/

/** « 1.10.0 » est plus récent que « 1.9.0 » : on compare des nombres. */
function plusRecente(v, ref) {
  const a = v.split('.').map(x => parseInt(x) || 0)
  const b = ref.split('.').map(x => parseInt(x) || 0)
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return false
}

/** La mise à jour connue, ou null. Renseignée par chercherMaj(). */
let maj = null   // { version, note }

async function chercherMaj() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch(`${SITE}/api/version`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!r.ok) return maj
    const j = await r.json()
    const derniere = String(j?.bridge || '')
    if (VERSION_VALIDE.test(derniere) && plusRecente(derniere, VERSION)) {
      const nouvelle = !maj || maj.version !== derniere
      maj = { version: derniere, note: String(j?.note || '').slice(0, 300) }
      if (nouvelle) noter(`Mise à jour disponible : ${derniere}`)
    } else {
      maj = null
    }
  } catch { /* le silence est volontaire */ }
  return maj
}

function afficherMaj() {
  fen?.envoyer('MAJ', maj?.version || '', maj?.note || '', EXE ? 'auto' : 'manuel')
  if (!maj) return
  console.log('')
  console.log('  ┌────────────────────────────────────────────────┐')
  console.log(`  │  Mise à jour disponible : ${maj.version.padEnd(21)}│`)
  console.log(`  │  Tu utilises la ${VERSION.padEnd(31)}│`)
  console.log('  └────────────────────────────────────────────────┘')
  if (maj.note) console.log(`  ${maj.note}`)
  if (EXE) console.log('  Appuie sur U dans cette fenêtre pour l\'installer maintenant, ou sur')
  if (EXE) console.log('  « Installer » sur ta tablette. Rien ne s\'installe sans toi.')
  else console.log(`  Télécharge l'installateur sur ${SITE_PROD} (Réglages → Bridge).`)
  console.log('')
}

/**
 * Télécharge l'installateur officiel, vérifie son empreinte, le lance et
 * ferme ce Bridge. L'installateur relance le nouveau Bridge tout seul.
 * Renvoie false (sans rien casser) si quoi que ce soit échoue.
 */
async function installerMaj(avantDeQuitter) {
  if (!EXE || !maj || !VERSION_VALIDE.test(maj.version)) return false
  const v = maj.version
  const url = `${DEPOT}/v${v}/${NOM_INSTALLEUR}`
  const cible = join(tmpdir(), `CitizenPad-Bridge-Setup-${v}.exe`)
  const annoncer = (texte, echec) => { fen?.envoyer('MAJPROG', texte, echec ? 'echec' : '') }
  try {
    console.log(`\n  Téléchargement de la version ${v}…`)
    annoncer(t(`Téléchargement de la version ${v}…`, `Downloading version ${v}…`))
    noter(`MAJ  téléchargement ${url}`)

    // L'empreinte publiée à côté de l'installateur : un fichier tronqué ou
    // altéré en route ne sera jamais lancé.
    const rs = await fetch(`${url}.sha256`)
    if (!rs.ok) throw new Error(`empreinte introuvable (${rs.status})`)
    const attendue = (await rs.text()).trim().split(/\s+/)[0].toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(attendue)) throw new Error('empreinte illisible')

    const r = await fetch(url)
    if (!r.ok || !r.body) throw new Error(`téléchargement refusé (${r.status})`)
    const total = Number(r.headers.get('content-length')) || 0
    const morceaux = []
    let recu = 0, dernierPct = -1
    for await (const m of r.body) {
      morceaux.push(m); recu += m.length
      const pct = total ? Math.floor(recu * 100 / total) : -1
      if (pct !== dernierPct && pct % 5 === 0) { dernierPct = pct; process.stdout.write(`\r  ${pct} %   `); annoncer(t(`Téléchargement… ${pct} %`, `Downloading… ${pct}%`)) }
    }
    const donnees = Buffer.concat(morceaux)
    const empreinte = createHash('sha256').update(donnees).digest('hex')
    if (empreinte !== attendue) throw new Error('empreinte différente : fichier refusé')
    if (donnees[0] !== 0x4d || donnees[1] !== 0x5a) throw new Error('ce n\'est pas un programme Windows')
    writeFileSync(cible, donnees)
    console.log('\r  ✓ Téléchargé et vérifié.          ')

    await avantDeQuitter?.()
    console.log('  Installation… le Bridge va se relancer tout seul.\n')
    annoncer(t('Installation… le Bridge revient tout seul dans quelques secondes.', 'Installing… the Bridge will be back in a few seconds.'))
    noter(`MAJ  lancement de l'installateur ${v}`)
    // /SILENT : aucune question, juste une barre de progression.
    await new Promise((ok, ko) => {
      const p = spawn(cible, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/MAJ'], { detached: true, stdio: 'ignore' })
      p.once('error', ko)
      p.once('spawn', () => { p.unref(); ok() })
    }).catch(async (e) => {
      console.log(`  ✗ L'installateur n'a pas pu démarrer (${e.message}).`)
      console.log(`    Lance-le toi-même : ${cible}\n`)
      noter(`MAJ  lancement impossible : ${e.message}`)
      await quitter(1)
    })
    fen?.fermer()
    setTimeout(() => process.exit(0), 400)
    return true
  } catch (e) {
    console.log(`\n  ✗ Mise à jour impossible : ${e.message}`)
    annoncer(t(`Mise à jour impossible (${e.message}). Ton Bridge continue de fonctionner.`, `Update failed (${e.message}). Your Bridge keeps working.`), true)
    console.log(`    Ton Bridge continue de fonctionner. Tu peux aussi la télécharger sur ${SITE_PROD}.\n`)
    noter(`MAJ  échec : ${e.message}`)
    try { if (existsSync(cible)) unlinkSync(cible) } catch {}
    return false
  }
}

/** Ferme le programme. En .exe, la fenêtre disparaîtrait avant qu'on ait pu
 *  lire le message : on attend Entrée. */
async function quitter(code, message) {
  // Fenêtre ouverte : le problème s'y affiche, et on attend que le joueur
  // la ferme (Quitter) pour qu'il ait le temps de le lire.
  if (fen?.ok && message) {
    montrerEtat('erreur', message)
    fen.afficher()
    await new Promise(r => { fen.actions.QUITTER = r; fen.actions.FERMEE = r })
    fen.fermer()
    await new Promise(r => setTimeout(r, 200))
    process.exit(code)
  }
  if (EXE && process.stdin.isTTY) await demander('  Appuie sur Entrée pour fermer. ')
  process.exit(code)
}

// ── Journal ──────────────────────────────────────────────────────────────────
// Écrit ce que le Bridge REÇOIT et ce qu'il ENVOIE réellement au clavier, ligne
// par ligne, horodaté à la milliseconde.
//
// C'est le seul moyen de trancher entre « la boîte a envoyé autre chose que
// prévu » et « le jeu a réagi autrement que prévu ». Sans ça, on en est réduit
// à des hypothèses — et on en a déjà perdu deux.
let journalActif = true
function noter(ligne) {
  if (!journalActif) return
  try {
    // Le dossier n'existe pas encore au tout premier lancement.
    if (!noter.pret) { mkdirSync(dirname(JOURNAL), { recursive: true }); noter.pret = true }
    const h = new Date().toISOString().replace('T', ' ').slice(0, 23)
    appendFileSync(JOURNAL, `${h}  ${ligne}\n`)
  } catch { journalActif = false }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LISTE BLANCHE
// ═══════════════════════════════════════════════════════════════════════════
//  Codes virtuels Windows. Rien d'autre ne sera jamais pressé.
//  Volontairement limitée aux touches dont Star Citizen a besoin : pas de
//  touche Windows, pas d'Entrée, pas de lettres isolées hors jeu.
// ═══════════════════════════════════════════════════════════════════════════
//  LISTE BLANCHE — positions physiques QWERTY
// ═══════════════════════════════════════════════════════════════════════════
//  Ces nombres sont des SCAN CODES : des positions physiques sur le clavier,
//  pas des lettres.
//
//  Pourquoi c'est écrit en dur plutôt que calculé :
//
//  La version précédente demandait à Windows de convertir « la lettre Q » en
//  position, via MapVirtualKey. Windows répondait selon la disposition ACTIVE.
//  Sur un clavier français, la lettre Q se trouve là où un clavier américain
//  a le A — Windows renvoyait donc la position du A américain.
//
//  Or Star Citizen nomme ses raccourcis par la position QWERTY. Le jeu
//  recevait la position du A et cherchait le raccourci « a », alors que la
//  boîte croyait envoyer « q ». Les touches identiques sur les deux
//  dispositions (C, D, I, O, P, U, F1-F12) fonctionnaient ; les cinq qui
//  bougent — A Q Z W M — échouaient silencieusement.
//
//  En inscrivant la table QWERTY en dur, la conversion ne dépend plus du
//  clavier de l'utilisateur. Un joueur AZERTY, QWERTZ ou QWERTY enverra
//  exactement la même chose, et le jeu comprendra la même chose.
//
//  Rien en dehors de cette table ne sera jamais pressé.
const SC = {
  // Lettres — positions QWERTY
  A:0x1E, B:0x30, C:0x2E, D:0x20, E:0x12, F:0x21, G:0x22, H:0x23, I:0x17,
  J:0x24, K:0x25, L:0x26, M:0x32, N:0x31, O:0x18, P:0x19, Q:0x10, R:0x13,
  S:0x1F, T:0x14, U:0x16, V:0x2F, W:0x11, X:0x2D, Y:0x15, Z:0x2C,
  // Chiffres de la rangée du haut
  '1':0x02,'2':0x03,'3':0x04,'4':0x05,'6':0x07,'5':0x06,
  '7':0x08,'8':0x09,'9':0x0A,'0':0x0B,
  // Fonctions
  F1:0x3B, F2:0x3C, F3:0x3D, F4:0x3E, F5:0x3F, F6:0x40,
  F7:0x41, F8:0x42, F9:0x43, F10:0x44, F11:0x57, F12:0x58,
  // Ponctuation, nommée comme dans Star Citizen
  SEMICOLON:0x27, APOSTROPHE:0x28, COMMA:0x33, PERIOD:0x34, SLASH:0x35,
  LBRACKET:0x1A, RBRACKET:0x1B, BACKSLASH:0x2B, MINUS:0x0C, EQUALS:0x0D,
  GRAVE:0x29,
  // Divers utiles en vol
  TAB:0x0F, SPACE:0x39, BACKSPACE:0x0E, ESCAPE:0x01,
  // Modificateurs. Le drapeau « étendu » distingue la version droite de la
  // gauche : sans lui, RCtrl et RAlt seraient confondus avec leurs jumelles.
  LSHIFT:0x2A, RSHIFT:0x36, LCTRL:0x1D, RCTRL:0x1D, LALT:0x38, RALT:0x38,
}

// Touches nécessitant le drapeau « étendu »
const ETENDUES = new Set(['RCTRL', 'RALT'])

const MODIFS = { LALT:'LALT', RALT:'RALT', LSHIFT:'LSHIFT', RSHIFT:'RSHIFT', LCTRL:'LCTRL', RCTRL:'RCTRL', ALT:'LALT', SHIFT:'LSHIFT', CTRL:'LCTRL' }
const SOURIS = { MOUSE1:'M1', MOUSE2:'M2', MOUSE3:'M3', MWUP:'WU', MWDN:'WD' }

/** "LAlt+LShift+P" → { modifs:['LALT','LSHIFT'], base:'P' }. null si inconnue. */
function analyser(combinaison) {
  const morceaux = String(combinaison).split('+').map(m => m.trim().toUpperCase()).filter(Boolean)
  if (!morceaux.length) return null
  const base = morceaux.pop()
  const modifs = []
  for (const m of morceaux) {
    if (!MODIFS[m]) return null
    modifs.push(MODIFS[m])
  }
  if (SOURIS[base]) return { modifs, base, souris: SOURIS[base] }
  if (SC[base] === undefined) return null
  return { modifs, base }
}

// ═══════════════════════════════════════════════════════════════════════════
//  INJECTION — PowerShell maintenu ouvert
// ═══════════════════════════════════════════════════════════════════════════
const SCRIPT_PS = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CP {
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public UNION u; }

  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] p, int cb);

  const uint KEYBOARD = 1, MOUSE = 0;
  const uint KEYUP = 0x0002, SCANCODE = 0x0008, EXTENDED = 0x0001;

  // Le scan code arrive déjà calculé côté Node, depuis une table QWERTY figée.
  // Aucune dépendance à la disposition clavier de l'utilisateur.
  public static void Key(ushort sc, bool up, bool ext) {
    uint f = SCANCODE;
    if (up) f |= KEYUP;
    if (ext) f |= EXTENDED;
    INPUT[] i = new INPUT[1];
    i[0].type = KEYBOARD;
    i[0].u.ki.wVk = 0;
    i[0].u.ki.wScan = sc;
    i[0].u.ki.dwFlags = f;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Mouse(uint flags, uint data) {
    INPUT[] i = new INPUT[1];
    i[0].type = MOUSE;
    i[0].u.mi.dwFlags = flags;
    i[0].u.mi.mouseData = data;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
Write-Output "READY"
while ($true) {
  $ligne = [Console]::In.ReadLine()
  if ($null -eq $ligne) { break }
  $p = $ligne.Split(' ')
  try {
    switch ($p[0]) {
      'KD' { [CP]::Key([uint16]$p[1], $false, ($p[2] -eq '1')) }
      'KU' { [CP]::Key([uint16]$p[1], $true,  ($p[2] -eq '1')) }
      'M1D'{ [CP]::Mouse(0x0002,0) } 'M1U'{ [CP]::Mouse(0x0004,0) }
      'M2D'{ [CP]::Mouse(0x0008,0) } 'M2U'{ [CP]::Mouse(0x0010,0) }
      'M3D'{ [CP]::Mouse(0x0020,0) } 'M3U'{ [CP]::Mouse(0x0040,0) }
      'WU' { [CP]::Mouse(0x0800,120) }
      'WD' { [CP]::Mouse(0x0800,4294967176) }
    }
  } catch { }
}
`

class Injecteur {
  constructor() {
    this.ps = null
    this.pret = false
    this.enfoncees = new Set()   // pour tout relâcher proprement à la sortie
    this.file = []               // commandes en attente
    this.enCours = false
    this.tenus = new Set()       // boutons « maintenir » réellement en cours
    this.sourisEnfoncee = new Set()
  }

  demarrer() {
    return new Promise((resolve, reject) => {
      this.ps = spawn('powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      this.ps.stdin.on('error', (e) => noter(`⚠ Entrée PowerShell : ${e.message}`))

      const lecteur = readline.createInterface({ input: this.ps.stdout })
      lecteur.on('line', l => {
        if (l.trim() === 'READY') { this.pret = true; resolve() }
      })
      this.ps.on('error', reject)
      // ⚠ POWERSHELL QUI S'ARRÊTE = TOUCHES COLLÉES.
      //
      // Si PowerShell s'arrête au milieu d'une séquence, les KEYDOWN déjà
      // envoyés n'auront jamais leur KEYUP : la touche reste enfoncée dans
      // Windows (Shift collé, majuscules partout, commandes jamais demandées
      // dans le jeu).
      //
      // On NE vide PAS la liste des touches enfoncées : on relance PowerShell,
      // puis on relâche tout ce qui était tenu. C'est le seul moyen de
      // réellement décoller les touches côté Windows.
      this.ps.on('exit', () => {
        this.pret = false
        if (this.arret) return
        noter('⚠ PowerShell s\'est arrêté : relance et relâchement des touches')
        this.#relancer()
      })
      this.ps.stdin.write(SCRIPT_PS + '\n')
      setTimeout(() => { if (!this.pret) reject(new Error('PowerShell ne répond pas.')) }, 12000)
    })
  }

  async #relancer() {
    this.relances = (this.relances || 0) + 1
    if (this.relances > 5) {
      console.log('\n  ⚠ PowerShell s\'arrête en boucle. Relance le Bridge.\n')
      noter('⚠ Trop de relances PowerShell, abandon')
      return
    }
    try {
      await new Promise(r => setTimeout(r, 300))
      await this.demarrer()
      this.toutRelacher()
      noter('PowerShell relancé, touches relâchées')
      // Une relance réussie remet le compteur à zéro au bout d'une minute.
      setTimeout(() => { this.relances = 0 }, 60_000)
    } catch (e) {
      noter(`⚠ Relance PowerShell impossible : ${e.message}`)
    }
  }

  brut(cmd) {
    noter(`      → ${cmd}`)
    if (this.pret && this.ps?.stdin.writable) {
      this.ps.stdin.write(cmd + '\n')
      return true
    }
    // Une commande perdue en silence est le pire cas : si c'est un KEYUP, la
    // touche reste enfoncée. On le signale au journal pour que ça se voie.
    noter(`      ⚠ PERDUE (canal indisponible) : ${cmd}`)
    return false
  }

  // `nom` sert à retrouver le drapeau étendu ; la valeur envoyée est le scan
  // code QWERTY, jamais une lettre.
  #ligne(prefixe, nom) {
    const ext = ETENDUES.has(nom) ? 1 : 0
    return `${prefixe} ${SC[nom]} ${ext}`
  }

  /** Appelé par un bouton à maintenir : la touche reste enfoncée jusqu'au
   *  retrait du doigt, la purge doit donc l'épargner. */
  enfoncerTenu(a) {
    this.tenus.add(a.base)
    this.enfoncer(a)
  }

  relacherTenu(a) {
    this.tenus.delete(a.base)
    this.relacher(a)
    if (!this.tenus.size) this.purgerModificateurs()
  }

  enfoncer(a) {
    // ══════════════════════════════════════════════════════════════════
    //  LA MOLETTE GARDE SON MODIFICATEUR ENFONCÉ
    // ══════════════════════════════════════════════════════════════════
    //  Une vraie molette de souris, on la tourne en MAINTENANT la touche :
    //  RAlt reste enfoncé, et la roue envoie cran après cran.
    //
    //  Le Bridge faisait « RAlt bas, un cran, RAlt haut » à chaque
    //  impulsion. Le jeu voyait des gestes isolés au lieu d'un mouvement
    //  continu, et le limiteur ne suivait pas.
    //
    //  Pendant une rafale, les modificateurs restent donc enfoncés, et ne
    //  sont relâchés qu'après une pause. C'est exactement ce que fait une
    //  main sur une souris.
    const rafale = a.souris === 'WU' || a.souris === 'WD'
    if (rafale) {
      clearTimeout(this.finRafale)
      const voulus = a.modifs.join('+')
      if (this.modifsRafale !== voulus) {
        // Changement de combinaison : on relâche l'ancienne avant la neuve,
        // sinon les deux s'empileraient.
        this.#relacherRafale()
        for (const m of a.modifs) { this.brut(this.#ligne('KD', m)); this.enfoncees.add(m) }
        this.modifsRafale = voulus
        this.modifsRafaleListe = [...a.modifs]
      }
      this.brut(a.souris)
      // 260 ms sans impulsion : le geste est fini, on relâche. Assez long
      // pour couvrir l'intervalle entre deux crans, assez court pour ne pas
      // laisser une touche enfoncée quand le doigt se retire.
      this.finRafale = setTimeout(() => this.#relacherRafale(), 260)
      return
    }

    for (const m of a.modifs) { this.brut(this.#ligne('KD', m)); this.enfoncees.add(m) }
    if (a.souris) {
      if (a.souris === 'WU' || a.souris === 'WD') this.brut(a.souris)
      else { this.brut(a.souris + 'D'); this.sourisEnfoncee.add(a.souris) }
    } else {
      this.brut(this.#ligne('KD', a.base)); this.enfoncees.add(a.base)
    }
  }

  /** Relâche les modificateurs tenus pour une rafale de molette. */
  #relacherRafale() {
    clearTimeout(this.finRafale)
    for (const m of [...(this.modifsRafaleListe || [])].reverse()) {
      this.brut(this.#ligne('KU', m))
      this.enfoncees.delete(m)
    }
    this.modifsRafale = null
    this.modifsRafaleListe = []
  }

  relacher(a) {
    // La rafale gère elle-même son relâchement, après sa pause.
    if (a.souris === 'WU' || a.souris === 'WD') return
    // Le relâchement doit être INTÉGRAL, même si une commande échoue en
    // chemin. Sans ce filet, un seul échec laissait un modificateur enfoncé
    // pour toujours.
    try {
      this.#relacherVraiment(a)
    } finally {
      if (!this.tenus.size) {
        const rafale = new Set(this.modifsRafaleListe || [])
        for (const nom of [...this.enfoncees]) {
          if (rafale.has(nom)) continue   // la molette les relâche elle-même
          this.brut(`KU ${SC[nom]} ${ETENDUES.has(nom) ? 1 : 0}`)
          this.enfoncees.delete(nom)
        }
      }
    }
  }

  #relacherVraiment(a) {
    if (a.souris) {
      if (a.souris !== 'WU' && a.souris !== 'WD') {
        this.brut(a.souris + 'U'); this.sourisEnfoncee.delete(a.souris)
      }
    } else {
      this.brut(this.#ligne('KU', a.base)); this.enfoncees.delete(a.base)
    }
    for (const m of [...a.modifs].reverse()) { this.brut(this.#ligne('KU', m)); this.enfoncees.delete(m) }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FILE D'ATTENTE — une commande à la fois, jamais deux en vol
  // ══════════════════════════════════════════════════════════════════════
  //  Sans cette file, deux frappes rapprochées se marchaient dessus sur les
  //  modificateurs. Exemple concret :
  //
  //    t=0    RShift+G  →  KD RShift, KD G
  //    t=20   RShift+E  →  KD RShift (déjà enfoncé), KD E
  //    t=60   fin de la première  →  KU G, KU RShift   ← RShift relâché
  //    t=80   fin de la seconde   →  KU E, KU RShift
  //
  //  Entre t=60 et t=80, le jeu voyait « E seul », sans RShift. Et pendant un
  //  instant il avait vu « RShift + G + E » tenus ensemble. D'où des commandes
  //  que personne n'a demandées et des systèmes qui basculent sans raison.
  //
  //  Chaque frappe est désormais complète — appui, maintien, relâche — avant
  //  que la suivante ne commence. Un intervalle de 25 ms sépare deux frappes
  //  pour que le jeu les distingue nettement.
  frapper(a) {
    this.file.push(a)
    if (!this.enCours) this.#deviderFile()
  }

  async #deviderFile() {
    this.enCours = true
    const pause = ms => new Promise(r => setTimeout(r, ms))
    while (this.file.length) {
      const a = this.file.shift()
      this.enfoncer(a)
      await pause(60)          // CryEngine lit le clavier une fois par image
      this.relacher(a)
      await pause(25)          // séparation nette entre deux frappes
    }
    // Ceinture et bretelles : la file vidée, plus AUCUN modificateur ne doit
    // rester enfoncé. Voir purgerModificateurs() pour ce que ça évite.
    this.purgerModificateurs()
    this.enCours = false
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PURGE DES MODIFICATEURS — le garde-fou le plus important du programme
  // ══════════════════════════════════════════════════════════════════════
  //  Un modificateur resté enfoncé est le pire défaut possible, parce qu'il
  //  déborde du jeu : Windows croit la touche tenue, et TOUT le clavier
  //  physique devient inutilisable — chaque frappe part en majuscule ou
  //  déclenche un raccourci. Dans le jeu, la moindre touche devient une
  //  combinaison et fait basculer des systèmes au hasard.
  //
  //  Pire encore, le symptôme ne ressemble pas à sa cause : on croit à un
  //  bouton défectueux alors que c'est un `keyup` perdu trois minutes plus tôt.
  //
  //  On relâche donc les six modificateurs sans condition, même ceux qu'on ne
  //  pense pas avoir enfoncés. Envoyer un relâchement pour une touche déjà
  //  relâchée ne coûte rien et n'a aucun effet de bord.
  purgerModificateurs() {
    if (this.tenus.size) return   // un bouton « maintenir » est en cours
    // ⚠ On ne relâche QUE ce qu'on a soi-même enfoncé.
    //
    // La version précédente envoyait un relâchement sur les six modificateurs
    // sans condition. Conséquence : quand le joueur tenait physiquement Shift
    // pour courir, on relâchait SA touche. Il la tenait toujours, Windows la
    // ré-enregistrait, et le cycle recommençait, marche, course, marche,
    // course, plusieurs fois par seconde.
    //
    // Le Bridge ne doit jamais toucher à une touche qu'il n'a pas pressée.
    // Le suivi dans `enfoncees` suffit à rattraper un relâchement perdu, qui
    // était le seul problème à résoudre.
    //
    // Exception : les modificateurs d'une rafale de molette en cours. Les
    // relâcher ici ferait tourner la molette sans RAlt au cran suivant ;
    // la rafale les relâche elle-même après sa pause.
    const rafale = new Set(this.modifsRafaleListe || [])
    for (const nom of [...this.enfoncees]) {
      if (rafale.has(nom)) continue
      this.brut(`KU ${SC[nom]} ${ETENDUES.has(nom) ? 1 : 0}`)
      this.enfoncees.delete(nom)
    }
  }

  /** Filet de sécurité. Une touche restée enfoncée après une coupure, c'est
      un vaisseau qui part en vrille tout seul. */
  toutRelacher() {
    this.#relacherRafale()
    this.file.length = 0
    this.tenus.clear()
    for (const nom of this.enfoncees) {
      this.brut(`KU ${SC[nom]} ${ETENDUES.has(nom) ? 1 : 0}`)
    }
    this.enfoncees.clear()
    // Pareil pour la souris : on ne relâche que les boutons qu'on a enfoncés,
    // sinon on interromprait un tir en cours déclenché à la main.
    for (const b of [...this.sourisEnfoncee]) this.brut(b + 'U')
    this.sourisEnfoncee.clear()
  }

  arreter() {
    this.arret = true   // pas de relance automatique quand on quitte exprès
    this.toutRelacher()
    setTimeout(() => { try { this.ps?.kill() } catch {} }, 120)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
function lireConfig() {
  try { return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : null }
  catch { return null }
}
function ecrireConfig(c) {
  mkdirSync(dirname(CONFIG), { recursive: true })
  writeFileSync(CONFIG, JSON.stringify(c, null, 2))
}

// ═══════════════════════════════════════════════════════════════════════════
//  UN SEUL BRIDGE PAR PC
// ═══════════════════════════════════════════════════════════════════════════
//  Le Bridge occupe un port local réservé. Un second Bridge lancé sur le même
//  PC (double clic de trop, ou un autre compte) ne peut pas l'obtenir et
//  s'arrête en le disant. Deux Bridges qui pressent les mêmes touches en même
//  temps, c'est des commandes en double dans le jeu.
//
//  Le port ne sert qu'à ce verrou : il n'écoute que l'ordinateur lui-même
//  (127.0.0.1) et refuse toute connexion.
const PORT_VERROU = 47809

function essayerVerrou() {
  return new Promise((resolve) => {
    // Un second lancement (double clic sur le raccourci) se connecte ici
    // pour dire « montre-toi », puis s'arrête : on voit la fenêtre existante
    // au lieu d'un message d'erreur.
    const serveur = createServer(sock => {
      sock.setTimeout(2000, () => sock.destroy())
      // Réponse « OK » : ce Bridge-ci fonctionne et vient de se montrer. Le
      // nouveau venu peut s'effacer tranquillement.
      sock.on('data', d => { if (String(d).includes('AFFICHER')) { fen?.afficher(); sock.end('OK\n') } else sock.destroy() })
      sock.on('error', () => {})
    })
    serveur.once('error', () => resolve(false))
    serveur.listen(PORT_VERROU, '127.0.0.1', () => resolve(true))
  })
}

/** Quelques essais : juste après une mise à jour, l'ancien Bridge peut mettre
 *  une seconde à libérer la place. */
async function verrouUnique() {
  for (let i = 0; i < 6; i++) {
    if (await essayerVerrou()) return true
    await new Promise(r => setTimeout(r, 700))
  }
  return false
}

/** Demande au Bridge déjà ouvert de se montrer.
 *  'ok' : il a répondu et s'affiche.  'muet' : quelque chose tient la place
 *  sans répondre (ancienne version, ou Bridge bloqué). */
function montrerAutreBridge() {
  return new Promise(resolve => {
    let fini = false
    const finir = (v) => { if (!fini) { fini = true; try { s.destroy() } catch {} resolve(v) } }
    const s = connexionLocale(PORT_VERROU, '127.0.0.1', () => s.write('AFFICHER\n'))
    s.setEncoding('utf8')
    s.on('data', d => finir(String(d).includes('OK') ? 'ok' : 'muet'))
    s.on('error', () => finir('muet'))
    s.on('close', () => finir('muet'))
    s.setTimeout(2500, () => finir('muet'))
  })
}

/** Arrête les autres CitizenPad-Bridge.exe de ce PC (jamais celui-ci). Sert
 *  quand un Bridge bloqué ou une ancienne version tient la place sans
 *  répondre : sans ça, le joueur ne pourrait plus rien lancer. */
function arreterAutresBridges() {
  return new Promise(resolve => {
    try {
      const p = spawn('taskkill.exe', ['/F', '/IM', 'CitizenPad-Bridge.exe', '/FI', `PID ne ${process.pid}`],
        { stdio: 'ignore', windowsHide: true })
      p.on('exit', () => setTimeout(resolve, 800))
      p.on('error', () => resolve())
    } catch { resolve() }
  })
}

/** Identifiant de CE Bridge, tiré au hasard une fois et gardé dans la config. */
function idBridge(conf) {
  if (conf.bridge_id && /^[A-Za-z0-9_-]{8,64}$/.test(conf.bridge_id)) return conf.bridge_id
  conf.bridge_id = randomBytes(16).toString('hex')
  ecrireConfig(conf)
  return conf.bridge_id
}

// ═══════════════════════════════════════════════════════════════════════════
//  APPAREILS AUTORISÉS
// ═══════════════════════════════════════════════════════════════════════════
//  Le serveur sait quels écrans ont le droit de piloter ce compte : 1 en
//  gratuit, 4 en Citizen Max. Le Bridge lui demande la liste toutes les 20 s
//  et ignore les commandes des autres.
//
//  Si le site est injoignable, on garde la dernière liste connue (et si on
//  n'en a jamais eu, on laisse passer) : une panne de citizenpad.com ne doit
//  pas couper une session en cours.
class Autorisations {
  constructor(conf) {
    this.conf = conf
    this.bridgeId = idBridge(conf)
    this.ecrans = null          // null : jamais reçu
    this.refuse = null          // { occupes } quand un autre PC a la place
    this.dernier = 0
    this.enCours = null
  }

  async rafraichir() {
    if (this.enCours) return this.enCours
    this.enCours = (async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 6000)
        const r = await fetch(`${SITE}/api/bridge/autorises`, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canal: this.conf.canal, bridge_id: this.bridgeId,
            appareil: process.env.COMPUTERNAME || 'PC', version: VERSION,
          }),
        })
        clearTimeout(t)
        const j = await r.json().catch(() => ({}))
        this.dernier = Date.now()
        if (r.status === 409) {
          if (!this.refuse) {
            console.log(`\n  ⚠ Ce compte est déjà utilisé par le Bridge d'un autre PC (${(j.occupes || []).join(', ') || 'PC'}).`)
            console.log('    Ferme-le, ou passe à Citizen Max pour utiliser deux PC.\n')
            noter(`REFUS  autre PC actif : ${(j.occupes || []).join(', ')}`)
          }
          this.refuse = { occupes: j.occupes || [] }
          montrerEtat('refuse', t(`Ton compte est utilisé par le Bridge d'un autre PC (${(j.occupes || []).join(', ') || 'PC'}). Ferme-le, ou passe à Citizen Max pour utiliser deux PC.`,
            `Your account is used by the Bridge of another PC (${(j.occupes || []).join(', ') || 'PC'}). Close it, or get Citizen Max to use two PCs.`))
          this.surRefus?.()
          return
        }
        if (r.status === 404) {
          console.log('\n  ⚠ Ce PC n\'est plus reconnu. Supprime le fichier de configuration et relance :')
          console.log(`    ${CONFIG}\n`)
          this.refuse = { occupes: [] }
          montrerEtat('erreur', t('Ce PC n\'est plus reconnu. Clique sur « Changer de compte » pour le relier à nouveau.',
            'This PC is no longer recognized. Click "Switch account" to link it again.'))
          return
        }
        if (r.ok && Array.isArray(j.ecrans)) {
          if (this.refuse) { console.log('\n  ✓ Ce PC a de nouveau la main.\n'); montrerEtat('pret', t('Ce PC a de nouveau la main.', 'This PC is back in control.')) }
          this.refuse = null
          this.ecrans = new Set(j.ecrans)
        }
      } catch { /* site injoignable : on garde la dernière liste */ }
      finally { this.enCours = null }
    })()
    return this.enCours
  }

  /** Cette commande vient-elle d'un écran autorisé ? */
  autorise(appareil) {
    if (this.refuse) return false
    if (this.ecrans === null) return true
    return !!appareil && this.ecrans.has(appareil)
  }

  /** Un appareil inconnu se manifeste : liste peut-être périmée, on la relit. */
  signaler(appareil) {
    if (appareil && this.ecrans && !this.ecrans.has(appareil) && Date.now() - this.dernier > 1500) {
      this.rafraichir()
    }
  }
}
function demander(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(r => rl.question(question, rep => { rl.close(); r(rep.trim()) }))
}

async function appairer(ancienne) {
  if (fen?.ok) return appairerFenetre(ancienne)
  console.log('\n  Ouvre la Button Box sur ta tablette, appuie sur APPAIRER,')
  console.log('  puis recopie le code affiché.\n')
  for (let essai = 0; essai < 5; essai++) {
    let code = (await demander('  Code (ex. 4K7-Q2) : ')).toUpperCase().replace(/\s+/g, '')
    if (!code) continue
    // « T-… » : code donné par la version de test du site.
    let site = process.env.CITIZENPAD_URL ? SITE : SITE_PROD
    if (/^T-/.test(code)) { site = SITE_TEST; code = code.slice(2) }
    try {
      const r = await fetch(`${site}/api/bridge/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, appareil: process.env.COMPUTERNAME || 'PC' }),
      })
      const j = await r.json()
      if (!r.ok) { console.log(`  ✗ ${j?.error || 'Refusé.'}\n`); continue }
      // L'identifiant du PC survit à un nouvel appairage.
      const conf = { canal: j.canal, url: j.supabase_url, anon: j.supabase_anon, site, bridge_id: ancienne?.bridge_id }
      if (!conf.bridge_id) delete conf.bridge_id
      ecrireConfig(conf)
      SITE = site
      console.log(`\n  ✓ Appairé${site === SITE_TEST ? ' à la VERSION DE TEST' : ''}. Ce PC est reconnu définitivement.\n`)
      return conf
    } catch (e) {
      console.log(`  ✗ Connexion impossible : ${e.message}\n`)
    }
  }
  console.log('  Trop de tentatives. Relance le programme.\n')
  return quitter(1)
}

/** Même chose, dans la fenêtre : un champ, un bouton Valider, et des
 *  essais illimités (un code mal tapé n'oblige pas à tout relancer). */
async function appairerFenetre(ancienne) {
  montrerEtat('appairage', t('Le code apparaît sur ta tablette quand tu appuies sur APPAIRER.', 'The code appears on your tablet when you tap PAIR.'))
  for (let premier = true; ; premier = false) {
    let code = String(await fen.demanderCode(premier)).toUpperCase().replace(/\s+/g, '')
    let site = process.env.CITIZENPAD_URL ? SITE : SITE_PROD
    if (/^T-/.test(code)) { site = SITE_TEST; code = code.slice(2) }
    try {
      const r = await fetch(`${site}/api/bridge/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, appareil: process.env.COMPUTERNAME || 'PC' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        fen.envoyer('CODE', 'erreur', j?.error || t('Code refusé. Vérifie-le sur ta tablette, ou appuie à nouveau sur APPAIRER pour en avoir un neuf.', 'Code refused. Check it on your tablet, or tap PAIR again for a new one.'))
        continue
      }
      const conf = { canal: j.canal, url: j.supabase_url, anon: j.supabase_anon, site, bridge_id: ancienne?.bridge_id }
      if (!conf.bridge_id) delete conf.bridge_id
      ecrireConfig(conf)
      SITE = site
      if (site === SITE_TEST) fen.envoyer('TEST')
      fen.envoyer('CODE', 'ok')
      noter(`Appairé (${site})`)
      return conf
    } catch (e) {
      fen.envoyer('CODE', 'erreur', t(`Connexion impossible (${e.message}). Vérifie ta connexion Internet et réessaie.`, `Cannot connect (${e.message}). Check your Internet connection and try again.`))
    }
  }
}

/** Le site retenu dans la configuration, s'il fait partie des deux connus. */
function appliquerSite(conf) {
  if (process.env.CITIZENPAD_URL) return
  if (conf?.site === SITE_TEST || conf?.site === SITE_PROD) SITE = conf.site
}

/** Relance un Bridge neuf dans sa propre fenêtre, puis ferme celui-ci. */
//  `start` plutôt qu'un lancement direct : c'est lui qui donne au nouveau
//  Bridge une vraie fenêtre où l'on peut taper (le code d'appairage).
async function relancer(avant) {
  await avant?.()
  const cible = [process.execPath, ...(EXE ? [] : process.argv.slice(1, 2))].map(a => `"${a}"`).join(' ')
  setTimeout(() => {
    spawn('cmd.exe', ['/d', '/c', `start "CitizenPad Bridge" ${cible}`], {
      detached: true, stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true,
    }).unref()
    setTimeout(() => process.exit(0), 200)
  }, 300)
}

// ═══════════════════════════════════════════════════════════════════════════
//  BOUCLE PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  // Utilisé par la fabrication pour vérifier que l'exécutable démarre.
  if (process.argv.includes('--version')) { console.log(VERSION); process.exit(0) }
  try { process.title = 'CitizenPad Bridge' } catch {}
  console.log('')
  console.log('  ╔══════════════════════════════════════════════╗')
  console.log('  ║          CITIZENPAD  ·  BRIDGE               ║')
  console.log('  ╚══════════════════════════════════════════════╝')
  console.log(`  version ${VERSION}`)
  console.log('')

  if (process.platform !== 'win32') {
    console.log('  Cette version ne fonctionne que sous Windows.\n')
    return quitter(1)
  }
  // Le journal note chaque touche : au-delà de 2 Mo, on repart d'un fichier
  // neuf (l'ancien est gardé à côté, une génération).
  try { if (existsSync(JOURNAL) && statSync(JOURNAL).size > 2_000_000) renameSync(JOURNAL, JOURNAL.replace(/\.txt$/, '-ancien.txt')) } catch {}
  noter(`──────── Lancement ${VERSION}${EXE ? ' (.exe)' : ''} ${process.argv.slice(2).join(' ')}`)

  // Node n'expose une WebSocket native qu'à partir de la version 22 (la
  // version .exe l'embarque). En dessous, on charge le paquet `ws`.
  let transportWS
  if (typeof globalThis.WebSocket === 'undefined') {
    try { transportWS = (await import('ws')).default }
    catch {
      console.log('\n  Composant manquant. Ouvre une invite de commandes dans ce dossier et lance :')
      console.log('      npm install\n')
      return quitter(1)
    }
  }

  if (!(await verrouUnique())) {
    // Déjà ouvert et en forme : on montre sa fenêtre et on s'efface.
    const reponse = await montrerAutreBridge()
    noter(`Un autre Bridge occupe la place : ${reponse}`)
    if (reponse === 'ok') process.exit(0)
    // Il ne répond pas : on le remplace, plutôt que de laisser le joueur
    // devant un Bridge qui « s'éteint » à chaque lancement.
    let libre = false
    if (EXE) { await arreterAutresBridges(); libre = await verrouUnique() }
    if (!libre) {
      console.log('  ⚠ CitizenPad Bridge est déjà ouvert sur ce PC.')
      console.log('    Un seul Bridge à la fois : utilise la fenêtre déjà ouverte.\n')
      return quitter(0)
    }
    noter('Ancien Bridge arrêté, on prend la place')
  }

  // La fenêtre, sauf demande contraire. Si elle ne s'ouvre pas, la console
  // reste : le Bridge fonctionne quand même.
  if ((EXE || process.env.CP_FENETRE === '1') && !process.argv.includes('--console')) {
    console.log('  Ouverture de la fenêtre…')
    const f = new Fenetre()
    if (await f.ouvrir()) {
      fen = f
      // Avant que la session existe, ces actions ont un comportement simple ;
      // elles sont remplacées plus bas une fois connectés.
      fen.actions.QUITTER = () => { fen.fermer(); setTimeout(() => process.exit(0), 200) }
      fen.actions.FERMEE = () => process.exit(0)
      fen.actions.JOURNAL = ouvrirJournal
      fen.actions.CHANGER = () => changerDeCompte()
      fen.actions.MAJ = async () => { if (enMaj) return; enMaj = true; if (!(await installerMaj())) enMaj = false }
      noter('FENÊTRE  ouverte')
    } else if (EXE) {
      // L'exécutable n'a pas de console (c'est voulu : plus de fenêtre
      // noire). Sans fenêtre, le joueur ne verrait rien : on le prévient
      // avec une simple boîte de message, et on s'arrête.
      noter('FENÊTRE  impossible à ouvrir : arrêt')
      await boiteMessage(t(
        'La fenêtre de CitizenPad Bridge n\'a pas pu s\'ouvrir.\n\nRelance le Bridge. Si ça recommence, écris-nous à contact@citizenpad.com en joignant le fichier :\n' + JOURNAL,
        'The CitizenPad Bridge window could not open.\n\nRestart the Bridge. If it happens again, write to contact@citizenpad.com and attach this file:\n' + JOURNAL))
      process.exit(1)
    } else {
      console.log('  (fenêtre indisponible : on reste dans cette console)\n')
    }
  }

  let conf = lireConfig()
  appliquerSite(conf)
  if (SITE !== SITE_PROD) { console.log(`  ⚠ VERSION DE TEST : ${SITE}\n`); fen?.envoyer('TEST') }

  // On annonce la mise à jour dès le lancement, mais on NE fait PAS attendre
  // la connexion : le Bridge a peut-être été relancé en pleine partie. Le
  // joueur appuie sur U quand il veut, ou sur « Installer » sur sa tablette.
  await chercherMaj()
  afficherMaj()

  if (!conf?.canal) conf = await appairer(conf)

  const autorisations = new Autorisations(conf)
  await autorisations.rafraichir()
  // `injecteur` est créé juste après : le rappel ne s'exécute qu'en cours de
  // session, une fois qu'il existe.
  autorisations.surRefus = () => { try { injecteur.toutRelacher() } catch {} }
  setInterval(() => autorisations.rafraichir(), 20_000)

  noter('──────── Démarrage du Bridge ────────')
  const injecteur = new Injecteur()
  process.stdout.write('  Préparation du clavier… ')
  try { await injecteur.demarrer(); console.log('OK') }
  catch (e) {
    console.log(`ÉCHEC\n  ${e.message}\n`)
    return quitter(1, t(`Le clavier n'a pas pu être préparé (${e.message}). Relance le Bridge ; si ça recommence, écris-nous avec le journal.`,
      `The keyboard could not be prepared (${e.message}). Restart the Bridge; if it happens again, write to us with the log.`))
  }

  const db = createClient(conf.url, conf.anon, {
    auth: { persistSession: false },
    realtime: {
      params: { eventsPerSecond: 40 },
      // `transport` n'est renseigné que sur les Node antérieurs à la 22.
      ...(transportWS ? { transport: transportWS } : {}),
    },
  })

  // ═════════════════════════════════════════════════════════════════════════
  //  CONNEXION AVEC RECONNEXION AUTOMATIQUE
  // ═════════════════════════════════════════════════════════════════════════
  //  Une coupure Internet de trois secondes ne doit pas obliger à tout
  //  relancer au milieu d'une session. Le Bridge retente donc indéfiniment,
  //  avec un délai qui s'allonge (2, 4, 8… jusqu'à 30 s) pour ne pas marteler
  //  le serveur quand la connexion est vraiment coupée.
  //
  //  ⚠ POINT CRITIQUE : à chaque perte de connexion, on RELÂCHE TOUT.
  //  Si la coupure survient pendant qu'un bouton à maintenir est enfoncé —
  //  extraire au laser, scanner, quitter le siège — le `keyup` n'arriverait
  //  jamais. La touche resterait enfoncée indéfiniment et le vaisseau partirait
  //  en vrille sans que le joueur comprenne pourquoi. C'est le pire scénario
  //  possible, et le seul dont on ne puisse pas se remettre en jeu.
  let canal = null
  let compteur = 0
  let abonne = false
  let tentative = 0
  let minuteurPong = null
  let minuteurRetry = null

  const nomPC = process.env.COMPUTERNAME || 'PC'
  let derniereTouche = ''
  let minuteurCompteur = null

  // N'émettre QUE si le canal est réellement abonné : sinon la librairie
  // bascule silencieusement sur des appels HTTP, ce qui remplit la console
  // d'avertissements sans rien transmettre.
  const pong = () => {
    if (!abonne || !canal) return
    // `maj` : la tablette affiche « Mise à jour disponible » et un bouton
    // Installer, seulement si ce Bridge sait l'installer lui-même.
    canal.send({ type: 'broadcast', event: 'pong', payload: {
      appareil: nomPC, version: VERSION, maj: maj?.version || null, auto: EXE,
    } })
  }

  const perdu = (raison) => {
    if (!abonne && tentative > 0) return   // déjà en cours de reconnexion
    abonne = false
    clearInterval(minuteurPong)
    injecteur.toutRelacher()               // ← le filet de sécurité
    console.log(`\n  ✗ Liaison perdue (${raison}). Toutes les touches ont été relâchées.`)
    planifierReconnexion()
  }

  const planifierReconnexion = () => {
    clearTimeout(minuteurRetry)
    tentative++
    const delai = Math.min(30000, 2000 * Math.pow(2, Math.min(tentative - 1, 4)))
    console.log(`  ↻ Nouvelle tentative dans ${Math.round(delai / 1000)} s…`)
    montrerEtat('perdu', t(`Toutes les touches ont été relâchées. Nouvelle tentative dans ${Math.round(delai / 1000)} s…`,
      `All keys were released. Retrying in ${Math.round(delai / 1000)} s…`))
    minuteurRetry = setTimeout(connecter, delai)
  }

  function connecter() {
    if (canal) { try { db.removeChannel(canal) } catch {} canal = null }
    if (!abonne) montrerEtat('connexion', t('Connexion à ton compte CitizenPad…', 'Connecting to your CitizenPad account…'))

    canal = db.channel(`bridge:${conf.canal}`, {
      config: { broadcast: { ack: false, self: false } },
    })

    canal.on('broadcast', { event: 'ping' }, ({ payload }) => {
      autorisations.signaler(String(payload?.appareil || ''))
      if (!autorisations.refuse) montrerEtat('tablette', t('Clique dans la fenêtre de Star Citizen, puis appuie sur tes boutons.', 'Click into the Star Citizen window, then press your buttons.'))
      pong()
    })

    // Le joueur a appuyé sur « Installer » sur sa tablette. Même contrôle que
    // pour une touche : seul un écran autorisé peut le demander. Et même s'il
    // le pouvait, un intrus ne ferait qu'installer NOTRE mise à jour, depuis
    // l'adresse écrite en dur plus haut, après vérification de l'empreinte.
    canal.on('broadcast', { event: 'maj' }, async ({ payload }) => {
      const origine = String(payload?.appareil || '')
      if (!autorisations.autorise(origine)) { noter(`IGNORÉ  maj (appareil non autorisé : ${origine || 'inconnu'})`); return }
      if (enMaj) return
      await chercherMaj()
      if (!maj || !EXE) return
      enMaj = true
      console.log(`\n\n  Mise à jour demandée depuis la tablette.`)
      if (!(await installerMaj(arreterProprement))) enMaj = false
    })

    canal.on('broadcast', { event: 'cmd' }, ({ payload }) => {
      const action = String(payload?.action || '')
      const touche = String(payload?.key || '')
      const origine = String(payload?.appareil || '')

      // Seuls les écrans autorisés par le serveur pilotent ce PC.
      // Exception : un RELÂCHEMENT passe toujours. Si un appareil perd son
      // autorisation pendant qu'il maintient une touche, refuser son keyup
      // laisserait la touche collée, le pire défaut possible.
      if (action !== 'keyup' && !autorisations.autorise(origine)) {
        autorisations.signaler(origine)
        noter(`IGNORÉ  ${action} ${touche} (appareil non autorisé : ${origine || 'inconnu'})`)
        return
      }

      const a = analyser(touche)

      if (!a) {
        noter(`REFUSÉ  ${touche}`)
        console.log(`\n  ⚠ Touche refusée (hors liste blanche) : ${touche}`)
        return
      }

      noter(`REÇU  ${action.padEnd(8)} ${touche}`)

      if (action === 'keydown')      injecteur.enfoncerTenu(a)
      else if (action === 'keyup')   injecteur.relacherTenu(a)
      else if (action === 'key')     injecteur.frapper(a)
      else return

      compteur++
      process.stdout.write(`\r  Commandes transmises : ${compteur}   (dernière : ${touche})        `)
      // Au plus quatre mises à jour par seconde de la fenêtre.
      derniereTouche = touche
      if (!minuteurCompteur) minuteurCompteur = setTimeout(() => { minuteurCompteur = null; fen?.envoyer('COMPTEUR', compteur, derniereTouche) }, 250)
    })

    canal.subscribe(etat => {
      if (etat === 'SUBSCRIBED') {
        abonne = true
        const reprise = tentative > 0
        tentative = 0
        console.log(reprise ? '\n  ✓ Liaison rétablie.\n' : '  Connecté au salon.\n')
        if (!autorisations.refuse) montrerEtat('pret', t('Ouvre la Button Box sur ta tablette, puis clique dans la fenêtre de Star Citizen.', 'Open the Button Box on your tablet, then click into the Star Citizen window.'))
        if (!reprise) {
          console.log('  ▸ Laisse cette fenêtre ouverte et lance Star Citizen.')
          console.log('  ▸ Clique DANS la fenêtre du jeu avant d\'appuyer.')
          console.log('  ▸ Ctrl+C pour arrêter proprement.\n')
          console.log(`  Journal : ${JOURNAL}\n`)
        }
        pong()
        clearInterval(minuteurPong)
        minuteurPong = setInterval(pong, 8000)
      } else if (etat === 'CHANNEL_ERROR') {
        perdu('erreur de canal')
      } else if (etat === 'TIMED_OUT') {
        perdu('délai dépassé')
      } else if (etat === 'CLOSED' && abonne) {
        perdu('canal fermé')
      }
    })
  }

  connecter()

  // Dernier filet : si un `keyup` s'est perdu — coupure réseau, onglet fermé,
  // doigt qui glisse hors du bouton — plus rien ne viendrait relâcher la
  // touche. Toutes les trois secondes, en l'absence de maintien en cours et
  // de commande en vol, on purge. Invisible quand tout va bien, salvateur
  // sinon.
  setInterval(() => {
    if (!injecteur.tenus.size && !injecteur.enCours) injecteur.purgerModificateurs()
  }, 3000)

  // ── Mises à jour en cours de session ─────────────────────────────────────
  // On regarde toutes les deux heures, SANS rien installer : la tablette et
  // cette fenêtre l'annoncent, le joueur choisit son moment.
  setInterval(async () => {
    const avant = maj?.version
    await chercherMaj()
    if (maj && maj.version !== avant) {
      console.log(`\n\n  ★ Mise à jour ${maj.version} disponible. Touche U pour l'installer quand tu veux (ou depuis ta tablette).\n`)
      afficherMaj()
      pong()
    }
  }, 2 * 3600_000)

  /** Avant une mise à jour ou un nouvel appairage : tout relâcher, se
   *  déconnecter, libérer la place. */
  const arreterProprement = async () => {
    clearInterval(minuteurPong)
    clearTimeout(minuteurRetry)
    abonne = false
    try { if (canal) await db.removeChannel(canal) } catch {}
    injecteur.arreter()
    await new Promise(r => setTimeout(r, 250))
  }

  const sortir = () => {
    console.log('\n\n  Relâchement de toutes les touches…')
    clearInterval(minuteurPong)
    clearTimeout(minuteurRetry)
    injecteur.arreter()
    fen?.fermer()
    setTimeout(() => process.exit(0), 300)
  }
  if (fen) {
    fen.actions.QUITTER = sortir
    fen.actions.FERMEE = sortir          // fenêtre tuée : on ne tourne pas en aveugle
    fen.actions.CHANGER = () => changerDeCompte(arreterProprement)
    fen.actions.MAJ = async () => {
      if (enMaj) return
      enMaj = true
      if (!(await installerMaj(arreterProprement))) enMaj = false
    }
  }
  process.on('SIGINT', sortir)
  process.on('SIGTERM', sortir)
  // Fenêtre fermée avec la croix : Windows laisse quelques secondes, assez
  // pour relâcher toutes les touches.
  process.on('SIGHUP', sortir)

  // ── Touches de cette fenêtre ─────────────────────────────────────────────
  //  U  installer la mise à jour     A  appairer un autre compte
  //  Q  quitter (comme Ctrl+C)
  if (process.stdin.isTTY) {
    console.log(`  Touches de cette fenêtre :  U  mise à jour   ·   A  changer de compte   ·   Q  quitter\n`)
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.resume()   // readline l'avait mis en pause après la dernière question
    let occupe = false
    process.stdin.on('keypress', async (_, k) => {
      if (!k || occupe) return
      if (k.ctrl && k.name === 'c') return sortir()
      const t = (k.name || '').toLowerCase()
      if (t === 'q') return sortir()
      if (t === 'u') {
        occupe = true
        await chercherMaj()
        if (!maj) console.log(`\n\n  ✓ Tu as déjà la dernière version (${VERSION}).\n`)
        else if (!EXE) afficherMaj()
        else { enMaj = true; if (!(await installerMaj(arreterProprement))) enMaj = false }
        occupe = false
      }
      if (t === 'a') {
        occupe = true
        process.stdin.setRawMode(false)
        const rep = await demander('\n\n  Appairer ce PC à un autre compte ? Le compte actuel sera oublié. (O/N) : ')
        if (/^[oy]/i.test(rep)) return changerDeCompte(arreterProprement)
        process.stdin.setRawMode(true)
        process.stdin.resume()
        occupe = false
      }
    })
  }
}

let enMaj = false

/** Boîte de message Windows, pour les cas où la fenêtre du Bridge n'existe pas. */
function boiteMessage(texte) {
  return new Promise(resolve => {
    try {
      const echappe = String(texte).replace(/'/g, "''")
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('${echappe}', 'CitizenPad Bridge')`],
        { stdio: 'ignore', windowsHide: true })
      p.on('exit', resolve); p.on('error', resolve)
    } catch { resolve() }
  })
}

// Rien ne doit disparaître sans laisser de trace dans le journal.
process.on('uncaughtException', (e) => {
  noter(`ERREUR non rattrapée : ${e?.stack || e}`)
  console.error(e)
  quitter(1, t(`Erreur inattendue : ${e?.message || e}. Relance le Bridge ; si ça recommence, écris-nous avec le journal.`,
    `Unexpected error: ${e?.message || e}. Restart the Bridge; if it happens again, write to us with the log.`))
})
for (const sig of ['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => noter(`Signal ${sig}`))
process.on('exit', (code) => noter(`Arrêt du Bridge (code ${code})`))

/** Oublie le compte (garde l'identifiant du PC) et relance un Bridge neuf,
 *  qui demandera un code. */
function changerDeCompte(avant) {
  const c = lireConfig() || {}
  ecrireConfig({ bridge_id: c.bridge_id })
  noter('Changement de compte demandé')
  console.log('  Un nouveau Bridge s\'ouvre et te demandera le code.\n')
  return relancer(async () => { await avant?.(); fen?.fermer() })
}

function ouvrirJournal() {
  try {
    if (!existsSync(JOURNAL)) { mkdirSync(dirname(JOURNAL), { recursive: true }); writeFileSync(JOURNAL, '') }
    spawn('notepad.exe', [JOURNAL], { detached: true, stdio: 'ignore' }).unref()
  } catch {}
}

main().catch(e => {
  console.error('\n  Erreur :', e.message, '\n')
  noter(`ERREUR  ${e.stack || e.message}`)
  quitter(1, t(`Erreur inattendue : ${e.message}. Relance le Bridge ; si ça recommence, écris-nous avec le journal.`,
    `Unexpected error: ${e.message}. Restart the Bridge; if it happens again, write to us with the log.`))
})
