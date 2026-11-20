// ═══════════════════════════════════════════════════════════════════════════
//  NOA SUR LE PC — les oreilles de l'assistant vocal
// ═══════════════════════════════════════════════════════════════════════════
//  Quand la tablette le demande, le Bridge écoute pour NOA :
//
//    - le micro du PC (le casque), ou le micro de la tablette, dont le son
//      arrive en direct par le Wi-Fi (WebRTC : de l'appareil au PC, chiffré,
//      sans serveur au milieu) ;
//    - les COMMANDES sont reconnues par Vosk sur une liste fermée de phrases
//      (CitizenPad-Bridge-Voix.exe) : rapide, sûr, presque rien pour le
//      processeur ;
//    - les MESSAGES dictés sont transcrits par Whisper (whisper.cpp), le
//      meilleur modèle que le PC peut faire tourner. Il ne travaille que
//      pendant la dictée : il ne gêne pas le jeu en combat.
//
//  Seul le TEXTE reconnu repart vers la tablette. Le son n'est jamais écrit
//  sur le disque ni envoyé sur Internet.
//
//  Les modèles se téléchargent une fois, au premier usage, dans
//  %LOCALAPPDATA%\CitizenPad\noa.
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, openSync, writeSync, closeSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, cpus } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { RTCPeerConnection } from 'werift'

const DOSSIER = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'CitizenPad', 'noa')

// Modèles Whisper (whisper.cpp, quantifiés) : du plus fin au plus léger.
// Adresse fixe : le Bridge ne télécharge jamais un fichier dont l'adresse lui
// serait dictée par le réseau.
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
export const MODELES_WHISPER = {
  turbo: { fichier: 'ggml-large-v3-turbo-q5_0.bin', nom: 'Whisper Turbo', mo: 547 },
  small: { fichier: 'ggml-small-q5_1.bin', nom: 'Whisper Small', mo: 181 },
  base: { fichier: 'ggml-base-q5_1.bin', nom: 'Whisper Base', mo: 57 },
}

// Phrases que Whisper « entend » parfois dans le silence ou le bruit (il a
// appris sur des vidéos sous-titrées) : jamais un vrai message.
const HALLUCINATIONS = /sous-titr|amara\.org|merci d'avoir regard|abonnez-vous|thanks for watching|subtitles by|♪|\[musique\]|\[music\]/i

export class Noa {
  /**
   * @param {object} o
   * @param {(event: string, payload: object) => void} o.diffuser  envoi sur le salon de la tablette
   * @param {(appareil: string) => boolean} o.autorise             cet écran a-t-il le droit de piloter ce PC ?
   * @param {(ligne: string) => void} o.noter                       journal
   * @param {() => string} o.site                                   site CitizenPad (modèle Vosk)
   * @param {string} o.dossierProgramme                             où sont Voix.exe, libvosk.dll, whisper-server
   */
  constructor(o) {
    this.o = o
    this.voix = null            // CitizenPad-Bridge-Voix.exe
    this.voixPrete = null       // promesse : programme lancé et modèle chargé
    this.langue = 'fr'
    this.source = 'aucune'      // pc | tablette | aucune
    this.micro = -1
    this.ouvert = false
    this.appareil = ''
    this.whisper = { proc: null, port: 0, cle: '', pret: null, inactif: null }
    this.choixModele = 'auto'
    this.invite = ''            // vocabulaire pour Whisper (pseudos, lieux)
    this.fileDictee = Promise.resolve()
    this.pc = null; this.dc = null
    this.dernierNiveau = 0; this.niveauEnvoye = 0
    this.materiel = null        // { cartes, coeurs, vulkan }
    this.etatCourant = { etat: 'arret' }
  }

  // ── Messages venus de la tablette ─────────────────────────────────────────
  async recevoir(m, parLien = false) {
    if (!m || typeof m !== 'object') return
    // Le micro du PC ne s'ouvre QUE pour un écran autorisé par le serveur. Le
    // lien direct (WebRTC) n'existe qu'avec un écran autorisé : il l'est déjà.
    if (!parLien && m.type !== 'fermer' && !this.o.autorise(String(m.appareil || ''))) { this.o.noter(`NOA  ignoré (${m.type}) : écran non autorisé`); return }
    try {
      switch (m.type) {
        case 'ouvrir': return await this.ouvrir(m)
        case 'grammaire': return this.ecrire('GRAMMAIRE', JSON.stringify(m.grammaire || []), m.rejouer ? '1' : '0')
        case 'sourd': return this.ecrire('SOURD', m.v ? '1' : '0')
        case 'dictee': {
          if (typeof m.invite === 'string') this.invite = m.invite.slice(0, 600)
          this.ecrire('DICTEE', m.v ? '1' : '0'); this.dicteeActive = !!m.v
          if (m.v) this.demarrerWhisper().catch(e => this.etat({ whisper: { etat: 'erreur', detail: e.message } }))
          return
        }
        case 'micros': return this.ecrire('MICROS')
        case 'fermer': return this.fermer()
        case 'rtc': return await this.signal(m)
        // Une touche de la Button Box arrivée par le lien direct : même traitement
        // (et mêmes contrôles) que par le salon.
        case 'cmd': return parLien ? this.o.commande?.(m) : undefined
        case 'son_debut': case 'son_stop': return parLien ? this.son(m) : undefined
      }
    } catch (e) {
      this.o.noter(`NOA  erreur (${m.type}) : ${e.message}`)
      this.etat({ etat: 'erreur', detail: e.message })
    }
  }

  /** Vers la tablette : par le lien direct s'il est ouvert, sinon par le salon. */
  emettre(type, donnees = {}) {
    const m = { type, ...donnees }
    if (this.dc?.readyState === 'open') { try { this.dc.send(JSON.stringify(m)); return } catch {} }
    // Le niveau du micro ne passe que par le lien direct : par le salon, ce
    // serait des milliers de messages par heure pour une simple animation.
    if (type === 'niveau') return
    this.o.diffuser('noa_b', m)
  }

  etat(x) { this.etatCourant = { ...this.etatCourant, ...x }; this.emettre('etat', this.etatCourant) }

  // ── Ouvrir l'écoute ───────────────────────────────────────────────────────
  async ouvrir(m) {
    this.appareil = String(m.appareil || '')
    this.langue = /^[a-z]{2}$/.test(m.langue) ? m.langue : 'fr'
    this.choixModele = ['auto', 'turbo', 'small', 'base', 'aucun'].includes(m.modele) ? m.modele : 'auto'
    const source = m.source === 'tablette' ? 'tablette' : 'pc'
    const micro = Number.isInteger(m.micro) ? m.micro : -1
    this.ouvert = true
    this.etat({ etat: 'prepare', source })
    await this.lancerVoix()
    if (m.grammaire) this.ecrire('GRAMMAIRE', JSON.stringify(m.grammaire), '0')
    this.source = source; this.micro = micro
    this.ecrire('SOURCE', source === 'pc' ? 'pc' : 'externe', String(micro))
    this.ecrire('MICROS')
    const whisper = this.choisirWhisper()
    this.etat({ etat: 'pret', source, whisper: { modele: whisper?.modele || null, gpu: !!whisper?.gpu, etat: this.whisper.proc ? 'pret' : 'repos' } })
    // Whisper chargé dès maintenant (téléchargé la première fois) : prêt avant le premier message.
    if (whisper) this.demarrerWhisper().catch(e => this.etat({ whisper: { modele: whisper.modele, etat: 'erreur', detail: e.message } }))
    this.o.noter(`NOA  écoute ouverte (${source}${source === 'pc' ? `, micro ${micro}` : ''})`)
  }

  fermer() {
    if (!this.ouvert) return
    this.ouvert = false
    this.ecrire('SOURCE', 'aucune')
    this.ecrire('DICTEE', '0')
    this.etat({ etat: 'arret' })
    this.o.noter('NOA  écoute fermée')
    // Whisper rend sa mémoire (vidéo) au jeu trois minutes après la fermeture de NOA.
    clearTimeout(this.whisper.inactif)
    this.whisper.inactif = setTimeout(() => { if (!this.ouvert) this.arreterWhisper() }, 180_000)
    // Le programme reste prêt une minute (réouverture instantanée), puis s'arrête.
    clearTimeout(this.minuteurArret)
    this.minuteurArret = setTimeout(() => this.arreterSiInutile(), 60_000)
  }

  /** Ni écoute, ni son depuis une minute : le programme s'arrête (il redémarre en un instant). */
  arreterSiInutile() {
    if (this.ouvert || Date.now() - (this.dernierSon || 0) < 60_000) { this.minuteurArret = setTimeout(() => this.arreterSiInutile(), 60_000); return }
    // (le lien direct avec la tablette reste ouvert : il ne coûte rien)
    try { this.ecrire('QUITTER') } catch {}
    try { this.voix?.kill() } catch {}
    this.voix = null; this.voixPrete = null
    this.arreterWhisper()
  }

  arreter() {
    try { this.ecrire('QUITTER') } catch {}
    try { this.voix?.kill() } catch {}
    this.voix = null; this.voixPrete = null
    this.arreterWhisper()
    try { this.pc?.close() } catch {}
    this.pc = null; this.dc = null
  }

  ecrire(...champs) {
    if (!this.voix?.stdin.writable) return
    this.voix.stdin.write(champs.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t') + '\n')
  }

  // ── Le programme d'écoute (Vosk) ──────────────────────────────────────────
  /** Le programme d'écoute ET de son (CitizenPad-Bridge-Voix.exe), sans modèle : il sait déjà jouer le son. */
  programme() {
    clearTimeout(this.minuteurArret)
    if (this.voix) return this.voix
    const exe = join(this.o.dossierProgramme, 'CitizenPad-Bridge-Voix.exe')
    if (!existsSync(exe)) throw new Error('CitizenPad-Bridge-Voix.exe introuvable')
    // (Hors Windows, pour les essais : le même programme tourne avec Mono.)
    const p = process.platform === 'win32'
      ? spawn(exe, [], { cwd: this.o.dossierProgramme, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn('mono', [exe], { cwd: this.o.dossierProgramme, stdio: ['pipe', 'pipe', 'pipe'] })
    this.voix = p
    this.modele = null
    p.stdin.on('error', () => {})
    p.stderr.setEncoding('utf8')
    // Vosk signale chaque mot hors de son dictionnaire (pseudos…) : inutile de remplir le journal.
    p.stderr.on('data', d => { const t = String(d).split('\n').filter(l => l.trim() && !/Ignoring word missing/.test(l)).join(' ').trim(); if (t) this.o.noter(`VOIX  ${t.slice(0, 400)}`) })
    readline.createInterface({ input: p.stdout }).on('line', l => this.ligneVoix(l))
    p.on('exit', code => {
      this.o.noter(`VOIX  arrêté (code ${code})`)
      this.modele?.rate(new Error(`le programme d'écoute s'est arrêté (${code})`))
      if (this.voix === p) { this.voix = null; this.voixPrete = null; if (this.ouvert) this.etat({ etat: 'erreur', detail: 'écoute arrêtée' }) }
    })
    this.ecrire('INFOS')
    return p
  }

  lancerVoix() {
    clearTimeout(this.minuteurArret)
    if (this.voixPrete) return this.voixPrete
    this.voixPrete = (async () => {
      const dossierVosk = await this.modeleVosk()
      this.programme()
      const charge = new Promise((pret, rate) => { this.modele = { pret, rate } })
      this.ecrire('MODELE', dossierVosk)
      await charge
    })()
    this.voixPrete.catch(() => { this.voixPrete = null })
    return this.voixPrete
  }

  // ── Le son de NOA sur le PC ───────────────────────────────────────────────
  //  La tablette prépare le son (voix + effets, déjà au bon volume) et l'envoie par le lien
  //  direct ; le PC le joue sur sa sortie par défaut (casque ou enceintes).
  son(m, octets) {
    this.dernierSon = Date.now()
    try { this.programme() } catch (e) { this.o.noter(`SON  ${e.message}`); return }
    if (!this.ouvert) { clearTimeout(this.minuteurArret); this.minuteurArret = setTimeout(() => this.arreterSiInutile(), 60_000) }
    if (m?.type === 'son_debut') this.ecrire('SON_DEBUT', String(Number(m.f) || 24000))
    else if (m?.type === 'son_stop') this.ecrire('SON_STOP')
    else if (octets) this.ecrire('SON', octets.toString('base64'))
  }

  ligneVoix(l) {
    const pret = () => this.modele?.pret(), rate = e => this.modele?.rate(e)
    const i = l.indexOf('\t')
    const quoi = i < 0 ? l : l.slice(0, i), reste = i < 0 ? '' : l.slice(i + 1)
    switch (quoi) {
      case 'MODELE_OK': return pret()
      case 'ERREUR': this.o.noter(`VOIX  erreur : ${reste}`); if (/modèle|libvosk/.test(reste)) rate(new Error(reste)); return
      case 'PARTIEL': {
        const t = lireJson(reste)?.partial?.trim()
        if (t) this.emettre('partiel', { t })
        return
      }
      case 'RESULTAT': {
        // numéro de la phrase, lecture avec la certitude de chaque mot, 6 lectures possibles
        const [n, jr, ja] = reste.split('\t')
        const j = lireJson(jr), a = lireJson(ja)
        const t = String(j?.text || '').trim()
        const mots = (j?.result || []).filter(w => w.word !== '[unk]')
        const c = mots.length ? mots.reduce((x, w) => x + (w.conf ?? 1), 0) / mots.length : 1
        const alts = (a?.alternatives || []).filter(x => x.text).map(x => ({ t: x.text, s: Math.round(x.confidence * 10) / 10 }))
        // Une phrase sans aucun mot du vocabulaire compte aussi pendant une dictée : Whisper va l'écrire.
        if (!t && !this.dicteeActive) return
        this.emettre('resultat', { t, c: Math.round(c * 100) / 100, seq: Number(n) || 0, alts })
        return
      }
      case 'NIVEAU': {
        const n = Number(reste) || 0
        // Au plus 5 fois par seconde, et seulement si ça bouge.
        const maintenant = Date.now()
        if (maintenant - this.dernierNiveau < 200 && Math.abs(n - this.niveauEnvoye) < 0.15) return
        this.dernierNiveau = maintenant; this.niveauEnvoye = n
        this.emettre('niveau', { n })
        return
      }
      case 'SEGMENT': { const [n, b] = reste.split('\t'); return this.dicter(Buffer.from(b || '', 'base64'), Number(n) || 0) }
      case 'MICROS': return this.emettre('micros', { liste: lireJson(reste) || [] })
      case 'INFOS': this.materiel = { cartes: lireJson(reste) || [], coeurs: cpus().length, vulkan: vulkanPresent() }; this.o.noter(`NOA  matériel : ${JSON.stringify(this.materiel)}`); return
      case 'MICRO_OK': this.o.noter(`VOIX  micro ouvert (${reste})`); return
      case 'ERREUR_MICRO': this.o.noter(`VOIX  micro : ${reste}`); this.etat({ etat: 'erreur', detail: 'micro' }); return
    }
  }

  /** Le modèle Vosk de la langue, téléchargé depuis le site la première fois. */
  async modeleVosk() {
    const dossier = join(DOSSIER, `vosk-${this.langue}`)
    if (existsSync(join(dossier, '.complet'))) return dossier
    const site = this.o.site()
    const r = await fetch(`${site}/noa/modele/manifeste.json`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`modèle introuvable (${r.status})`)
    const man = (await r.json())?.[this.langue]
    if (!man?.morceaux) throw new Error(`pas de modèle pour la langue ${this.langue}`)
    const morceaux = []
    let recu = 0, dernier = -1
    for (let k = 0; k < man.morceaux; k++) {
      const rm = await fetch(`${site}/noa/modele/vosk-${this.langue}.part${k}.bin`)
      if (!rm.ok || !rm.body) throw new Error(`téléchargement refusé (${rm.status})`)
      for await (const b of rm.body) {
        morceaux.push(b); recu += b.length
        const pct = Math.min(99, Math.floor(recu * 100 / man.taille))
        if (pct !== dernier) { dernier = pct; this.etat({ etat: 'telecharge', quoi: 'commandes', pct }) }
      }
    }
    const archive = Buffer.concat(morceaux)
    if (man.sha256 && createHash('sha256').update(archive).digest('hex') !== man.sha256) throw new Error('modèle abîmé (empreinte différente)')
    rmSync(dossier, { recursive: true, force: true })
    extraireTar(gunzipSync(archive), dossier)
    writeFileSync(join(dossier, '.complet'), new Date().toISOString())
    this.o.noter(`NOA  modèle Vosk ${this.langue} installé`)
    return dossier
  }

  // ── Whisper ───────────────────────────────────────────────────────────────
  /** Le meilleur modèle que ce PC peut faire tourner sans gêner le jeu. */
  choisirWhisper() {
    if (this.choixModele === 'aucun') return null
    const m = this.materiel || { cartes: [], coeurs: cpus().length, vulkan: vulkanPresent() }
    // Carte dédiée : NVIDIA, AMD Radeon, Intel Arc. Les puces intégrées
    // partagent la mémoire du PC : on reste sur le processeur.
    const dediees = m.cartes.filter(c => /nvidia|geforce|rtx|radeon|rx\s?\d|arc/i.test(c.nom) && !/basic|virtual|parsec|meta/i.test(c.nom))
    const vram = Math.max(0, ...dediees.map(c => c.vram || 0)) / 2 ** 30
    const gpu = m.vulkan && vram >= 3.5
    let modele
    if (this.choixModele !== 'auto') modele = this.choixModele
    // Star Citizen prend beaucoup de mémoire vidéo : le grand modèle seulement
    // sur une carte qui en a de la marge.
    else if (gpu && vram >= 6) modele = 'turbo'
    else if (gpu) modele = 'small'
    else modele = m.coeurs >= 8 ? 'small' : 'base'
    return { modele, gpu, vram: Math.round(vram * 10) / 10 }
  }

  async demarrerWhisper() {
    const choix = this.choisirWhisper()
    if (!choix) return
    clearTimeout(this.whisper.inactif)
    const cle = `${choix.modele}|${choix.gpu}|${this.langue}`
    if (this.whisper.pret && this.whisper.cle === cle) return this.whisper.pret
    this.arreterWhisper()
    this.whisper.cle = cle
    this.whisper.pret = (async () => {
      const fichier = await this.modeleWhisper(choix.modele)
      const exe = join(this.o.dossierProgramme, choix.gpu ? 'whisper-server-vulkan.exe' : 'whisper-server.exe')
      if (!existsSync(exe)) throw new Error(`${exe} introuvable`)
      const port = await portLibre()
      // Le processeur reste au jeu : au plus 4 fils, et jamais tous les cœurs.
      const fils = Math.max(2, Math.min(4, cpus().length - 2))
      const args = ['-m', fichier, '-l', this.langue, '--host', '127.0.0.1', '--port', String(port), '-t', String(fils), '-nt']
      if (!choix.gpu) args.push('-ng')
      this.etat({ whisper: { modele: choix.modele, gpu: choix.gpu, etat: 'demarre' } })
      const p = spawn(exe, args, { cwd: this.o.dossierProgramme, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      this.whisper.proc = p; this.whisper.port = port
      let journal = ''
      const garder = d => { journal = (journal + d).slice(-3000) }
      p.stdout.on('data', garder); p.stderr.on('data', garder)
      p.on('exit', code => {
        this.o.noter(`WHISPER  arrêté (code ${code}) ${code ? journal.slice(-600).replace(/\s+/g, ' ') : ''}`)
        if (this.whisper.proc === p) { this.whisper.proc = null; this.whisper.pret = null; this.whisper.cle = '' }
      })
      // Prêt quand /health répond (le modèle est chargé).
      const debut = Date.now()
      for (;;) {
        if (!this.whisper.proc) throw new Error('Whisper n\'a pas démarré')
        try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break } catch {}
        if (Date.now() - debut > 60_000) throw new Error('Whisper ne répond pas')
        await attendre(250)
      }
      const gpuVu = /vulkan.*found [1-9]|ggml_vulkan: \d+ =/i.test(journal)
      this.o.noter(`WHISPER  prêt : ${choix.modele}, ${choix.gpu ? (gpuVu ? 'carte graphique' : 'carte graphique demandée, non vue') : 'processeur'}, ${Date.now() - debut} ms`)
      this.etat({ whisper: { modele: choix.modele, gpu: choix.gpu, etat: 'pret' } })
    })()
    this.whisper.pret.catch(e => { this.o.noter(`WHISPER  ${e.message}`); this.whisper.pret = null; this.whisper.cle = '' })
    return this.whisper.pret
  }

  arreterWhisper() {
    clearTimeout(this.whisper.inactif)
    try { this.whisper.proc?.kill() } catch {}
    this.whisper = { proc: null, port: 0, cle: '', pret: null, inactif: null }
  }

  async modeleWhisper(nom) {
    const m = MODELES_WHISPER[nom]
    const chemin = join(DOSSIER, 'whisper', m.fichier)
    if (existsSync(chemin) && existsSync(chemin + '.complet')) return chemin
    mkdirSync(dirname(chemin), { recursive: true })
    const r = await fetch(`${HF}/${m.fichier}`)
    if (!r.ok || !r.body) throw new Error(`téléchargement du modèle refusé (${r.status})`)
    // Hugging Face donne l'empreinte SHA-256 du fichier : un fichier tronqué
    // ou altéré en route n'est jamais utilisé.
    const attendue = String(r.headers.get('x-linked-etag') || r.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '').toLowerCase()
    const total = Number(r.headers.get('content-length')) || m.mo * 2 ** 20
    const tmp = chemin + '.partiel'
    const fd = openSync(tmp, 'w')
    const h = createHash('sha256')
    let recu = 0, dernier = -1
    try {
      for await (const b of r.body) {
        writeSync(fd, b); h.update(b); recu += b.length
        const pct = Math.floor(recu * 100 / total)
        if (pct !== dernier) { dernier = pct; this.etat({ whisper: { modele: nom, etat: 'telecharge', pct } }) }
      }
    } finally { closeSync(fd) }
    if (/^[0-9a-f]{64}$/.test(attendue) && h.digest('hex') !== attendue) { rmSync(tmp, { force: true }); throw new Error('modèle abîmé (empreinte différente)') }
    renameSync(tmp, chemin)
    writeFileSync(chemin + '.complet', '')
    this.o.noter(`NOA  modèle ${m.fichier} installé (${Math.round(recu / 2 ** 20)} Mo)`)
    return chemin
  }

  /** Une phrase dictée → Whisper → texte, dans l'ordre où elles ont été dites. */
  dicter(pcm, seq = 0) {
    this.fileDictee = this.fileDictee.then(async () => {
      try {
        await this.demarrerWhisper()
        if (!this.whisper.port) return
        const fd = new FormData()
        fd.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'phrase.wav')
        fd.append('language', this.langue)
        fd.append('response_format', 'json')
        fd.append('temperature', '0.0')
        fd.append('no_timestamps', 'true')
        fd.append('suppress_non_speech', 'true')
        if (this.invite) fd.append('prompt', this.invite)
        const t0 = Date.now()
        const r = await fetch(`http://127.0.0.1:${this.whisper.port}/inference`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        const texte = String(j?.text || '').replace(/\s+/g, ' ').trim()
        this.o.noter(`WHISPER  ${(pcm.length / 32000).toFixed(1)} s de voix → ${Date.now() - t0} ms`)
        // Toujours répondre (même vide) : la tablette attend ce numéro pour décider.
        this.emettre('dictee', { t: !texte || HALLUCINATIONS.test(texte) ? '' : texte, seq })
      } catch (e) {
        this.o.noter(`WHISPER  échec : ${e.message}`)
        this.emettre('dictee', { t: '', seq, erreur: e.message })
      }
    })
  }

  // ── Lien direct avec la tablette (WebRTC) ─────────────────────────────────
  //  La tablette propose, le Bridge répond ; les deux s'échangent leurs
  //  adresses par le salon, puis se parlent en direct sur le réseau local.
  async signal(m) {
    if (m.offre) {
      try { this.pc?.close() } catch {}
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      this.pc = pc; this.dc = null
      pc.onIceCandidate.subscribe(c => { if (c && this.pc === pc) this.o.diffuser('noa_b', { type: 'rtc', candidat: c.toJSON() }) })
      pc.connectionStateChange.subscribe(s => {
        this.o.noter(`LIEN  ${s}`)
        if (this.pc !== pc) return
        if (s === 'failed' || s === 'closed' || s === 'disconnected') { if (this.dc) this.o.coupure?.(); this.dc = null; this.etat({ lien: 'echec' }) }
      })
      pc.onDataChannel.subscribe(dc => {
        dc.stateChanged?.subscribe?.(s => {
          if (s !== 'closed' || this.dc !== dc) return
          this.dc = null
          // Une touche maintenue par ce lien ne recevrait jamais son relâchement.
          this.o.coupure?.()
          this.etat({ lien: 'coupe' })
        })
        dc.onMessage.subscribe(d => {
          if (typeof d === 'string') { try { this.recevoir(JSON.parse(d), true) } catch {} return }
          // Premier octet : 1 = son du micro de la tablette (16 kHz, 16 bits, mono) ; 2 = son de NOA à jouer sur le PC.
          const b = Buffer.from(d)
          if (b[0] === 2) return this.son(null, b.subarray(1))
          if (b[0] === 1 && this.source === 'tablette' && this.ouvert) this.ecrire('PCM', b.subarray(1).toString('base64'))
        })
        this.dc = dc
        this.o.noter('LIEN  ouvert avec la tablette')
        this.etat({ lien: 'ok' })
      })
      await pc.setRemoteDescription(m.offre)
      const rep = await pc.createAnswer()
      await pc.setLocalDescription(rep)
      this.o.diffuser('noa_b', { type: 'rtc', reponse: { type: 'answer', sdp: pc.localDescription.sdp } })
    } else if (m.candidat && this.pc) {
      try { await this.pc.addIceCandidate(m.candidat) } catch {}
    }
  }
}

// ── Outils ──────────────────────────────────────────────────────────────────
const attendre = ms => new Promise(r => setTimeout(r, ms))
function lireJson(s) { try { return JSON.parse(s) } catch { return null } }

/** vulkan-1.dll vient avec les pilotes de la carte graphique. */
function vulkanPresent() {
  const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll')
  try { return statSync(sys).isFile() } catch { return false }
}

function portLibre() {
  return new Promise((ok, ko) => {
    const s = createServer()
    s.once('error', ko)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
  })
}

/** Un fichier WAV (16 kHz, 16 bits, mono) autour du son brut. */
export function wav(pcm) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** Extrait une archive tar (déjà décompressée) : seulement des fichiers et
 *  dossiers ordinaires, jamais en dehors du dossier cible. Le premier niveau
 *  (vosk-model-small-fr-0.22/) est retiré. */
export function extraireTar(tar, cible) {
  mkdirSync(cible, { recursive: true })
  let o = 0, longNom = null
  while (o + 512 <= tar.length) {
    const entete = tar.subarray(o, o + 512)
    if (entete.every(b => b === 0)) break
    const texte = (a, b) => entete.subarray(a, b).toString('utf8').replace(/\0.*$/s, '')
    let nom = longNom || (texte(345, 500) ? texte(345, 500) + '/' + texte(0, 100) : texte(0, 100))
    longNom = null
    const taille = parseInt(texte(124, 136).trim() || '0', 8)
    const type = String.fromCharCode(entete[156] || 48)
    const donnees = tar.subarray(o + 512, o + 512 + taille)
    o += 512 + Math.ceil(taille / 512) * 512
    if (type === 'L') { longNom = donnees.toString('utf8').replace(/\0.*$/s, ''); continue }
    const morceaux = nom.split('/').filter(Boolean).slice(1)
    if (!morceaux.length || morceaux.some(m => m === '..' || m.includes(':') || m.includes('\\'))) continue
    const chemin = join(cible, ...morceaux)
    if (type === '5') mkdirSync(chemin, { recursive: true })
    else if (type === '0' || type === '\0' || type === '7') { mkdirSync(dirname(chemin), { recursive: true }); writeFileSync(chemin, donnees) }
  }
}
