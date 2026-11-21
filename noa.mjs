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
//    - les MESSAGES aussi : chaque écran du message n'attend que ses numéros
//      (annuaire, catégorie, phrase). Whisper a été retiré en 1.6.7 : plus
//      besoin de lui, et le jeu garde sa carte graphique.
//
//  Seul le TEXTE reconnu repart vers la tablette. Le son n'est jamais écrit
//  sur le disque ni envoyé sur Internet.
//
//  Les modèles se téléchargent une fois, au premier usage, dans
//  %LOCALAPPDATA%\CitizenPad\noa.
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, cpus } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { RTCPeerConnection } from 'werift'

const DOSSIER = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'CitizenPad', 'noa')

// Whisper (1.6.0 à 1.6.6) : ses modèles téléchargés sont effacés au démarrage (jusqu'à 547 Mo).
const DOSSIER_WHISPER = join(DOSSIER, 'whisper')

/** Efface les modèles Whisper laissés par les versions 1.6.0 à 1.6.6. */
export function effacerWhisper(noter) {
  try { if (existsSync(DOSSIER_WHISPER)) { rmSync(DOSSIER_WHISPER, { recursive: true, force: true }); noter('NOA  anciens modèles Whisper effacés') } } catch (e) { noter(`NOA  Whisper non effacé : ${e.message}`) }
}

export class Noa {
  /**
   * @param {object} o
   * @param {(event: string, payload: object) => void} o.diffuser  envoi sur le salon de la tablette
   * @param {(appareil: string) => boolean} o.autorise             cet écran a-t-il le droit de piloter ce PC ?
   * @param {(ligne: string) => void} o.noter                       journal
   * @param {() => string} o.site                                   site CitizenPad (modèle Vosk)
   * @param {string} o.dossierProgramme                             où sont Voix.exe et libvosk.dll
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
    this.choixModele = 'auto'
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
        case 'dictee': return            // plus de dictée libre (Whisper retiré en 1.6.7)
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
    const source = m.source === 'tablette' ? 'tablette' : 'pc'
    const micro = Number.isInteger(m.micro) ? m.micro : -1
    this.ouvert = true
    this.etat({ etat: 'prepare', source })
    await this.lancerVoix()
    if (m.grammaire) this.ecrire('GRAMMAIRE', JSON.stringify(m.grammaire), '0')
    // Réactivité choisie sur la tablette : silence (ms) qui termine une phrase. 300 = réglage d'origine.
    const calme = Number.isInteger(m.calme) ? Math.min(800, Math.max(150, m.calme)) : 300
    this.ecrire('CALME', String(calme))
    this.source = source; this.micro = micro
    this.ecrire('SOURCE', source === 'pc' ? 'pc' : 'externe', String(micro))
    this.ecrire('MICROS')
    this.etat({ etat: 'pret', source, whisper: { modele: null, etat: 'repos' } })
    this.o.noter(`NOA  écoute ouverte (${source}${source === 'pc' ? `, micro ${micro}` : ''})`)
  }

  fermer() {
    if (!this.ouvert) return
    this.ouvert = false
    this.ecrire('SOURCE', 'aucune')
    this.ecrire('DICTEE', '0')
    this.etat({ etat: 'arret' })
    this.o.noter('NOA  écoute fermée')
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
  }

  arreter() {
    try { this.ecrire('QUITTER') } catch {}
    try { this.voix?.kill() } catch {}
    this.voix = null; this.voixPrete = null
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
    // Un son annonce sa taille (tablette du 20 nov. 2026+) : on le garde jusqu'à l'avoir
    // ENTIER avant de le jouer. Sinon un retard du Wi-Fi au milieu (renvoi de paquets)
    // coupait NOA en pleine phrase, puis il reprenait plus tard (présentation, 20 nov. 2026).
    // Filet : au bout de 4 s, on joue ce qui est arrivé et la suite au fil de l'eau.
    if (m?.type === 'son_stop') { this.sons = []; clearTimeout(this.minuteurSon); return this.ecrire('SON_STOP') }
    if (m?.type === 'son_debut') {
      const f = String(Number(m.f) || 24000), attendu = Number(m.n) > 0 ? Number(m.n) * 2 : 0
      if (!attendu && !this.sons?.length) return this.ecrire('SON_DEBUT', f)   // ancienne tablette : au fil de l'eau
      ;(this.sons ||= []).push({ f, attendu, recu: 0, morceaux: [], debut: Date.now(), parti: false })
      return this.viderSons()
    }
    if (!octets) return
    const s = this.sons?.find(x => !x.attendu || x.recu < x.attendu)
    if (!s) return this.ecrire('SON', octets.toString('base64'))
    s.morceaux.push(Buffer.from(octets)); s.recu += octets.length
    this.viderSons()
  }

  /** Joue, dans l'ordre, les sons complets (ou qui attendent depuis plus de 4 s). */
  viderSons() {
    clearTimeout(this.minuteurSon)
    while (this.sons?.length) {
      const s = this.sons[0]
      const complet = s.attendu && s.recu >= s.attendu
      if (!complet && !s.parti && Date.now() - s.debut < 4000) break
      if (!s.parti) { s.parti = true; this.ecrire('SON_DEBUT', s.f) }
      for (const b of s.morceaux) this.ecrire('SON', b.toString('base64'))
      s.morceaux = []
      if (!complet) break                     // en retard : la suite part dès qu'elle arrive
      this.sons.shift()
    }
    if (this.sons?.length) this.minuteurSon = setTimeout(() => this.viderSons(), 300)
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
        if (!t) return
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
      case 'SEGMENT': return             // (dictée : plus utilisée)
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
function lireJson(s) { try { return JSON.parse(s) } catch { return null } }

/** vulkan-1.dll vient avec les pilotes de la carte graphique. */
function vulkanPresent() {
  const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll')
  try { return statSync(sys).isFile() } catch { return false }
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
