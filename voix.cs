// ═══════════════════════════════════════════════════════════════════════════
//  CITIZENPAD-BRIDGE-VOIX.EXE — les oreilles de NOA sur le PC
// ═══════════════════════════════════════════════════════════════════════════
//  Petit programme sans fenêtre, lancé par le Bridge quand la tablette demande
//  à NOA d'écouter par le PC. Il :
//    - écoute le micro du PC (le casque), OU reçoit le son du micro de la
//      tablette (envoyé par le Wi-Fi, que le Bridge lui passe) ;
//    - reconnaît les commandes avec Vosk (libvosk.dll), sur une liste fermée
//      de phrases : rapide et sûr ;
//    - pendant la dictée d'un message, découpe les phrases dites et les rend
//      au Bridge, qui les fait transcrire par Whisper.
//  RIEN n'est écrit sur le disque : le son ne vit qu'en mémoire, quelques
//  secondes, le temps d'être reconnu.
//
//  Il parle au Bridge par lignes de texte (champs séparés par des tabulations)
//  sur son entrée et sa sortie, comme l'aide.
//
//  ⚠ C# 5 (compilateur de .NET Framework) : pas de $"…", pas de ?., pas de =>.
// ═══════════════════════════════════════════════════════════════════════════
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class Voix {
  // ── Vosk (API C de libvosk) ───────────────────────────────────────────────
  const string V = "libvosk";
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern void vosk_set_log_level(int niveau);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr vosk_model_new(byte[] chemin);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_new(IntPtr modele, float frequence);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_new_grm(IntPtr modele, float frequence, byte[] grammaire);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern void vosk_recognizer_set_words(IntPtr r, int mots);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern int vosk_recognizer_accept_waveform(IntPtr r, byte[] donnees, int longueur);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_partial_result(IntPtr r);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_result(IntPtr r);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_final_result(IntPtr r);
  [DllImport(V, CallingConvention = CallingConvention.Cdecl)] static extern void vosk_recognizer_free(IntPtr r);

  // ── Micro Windows (waveIn, winmm.dll) ─────────────────────────────────────
  [StructLayout(LayoutKind.Sequential)]
  struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }
  [StructLayout(LayoutKind.Sequential)]
  struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct WAVEINCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved1; }
  [DllImport("winmm.dll")] static extern int waveInGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int waveInGetDevCapsW(IntPtr id, ref WAVEINCAPS caps, int taille);
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, int peripherique, ref WAVEFORMATEX f, IntPtr rappel, IntPtr instance, int options);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr entete, int taille);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr entete, int taille);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr entete, int taille);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetShortPathNameW(string longue, StringBuilder courte, int taille);
  const int CALLBACK_EVENT = 0x50000, WHDR_DONE = 1, WAVE_MAPPER = -1;

  const int FREQ = 16000;                       // 16 kHz, mono, 16 bits : ce qu'attendent Vosk et Whisper
  static readonly object verrou = new object();
  static void Envoyer(string l) { lock (verrou) { Console.Out.WriteLine(l); Console.Out.Flush(); } }
  static string Une(string s) { return s.Replace("\r", " ").Replace("\n", " ").Replace("\t", " "); }

  // Tout ce que le fil de reconnaissance doit faire passe par cette file :
  // le son (byte[]) ET les ordres (Action), dans l'ordre d'arrivée.
  static readonly BlockingCollection<object> file = new BlockingCollection<object>(new ConcurrentQueue<object>(), 400);

  // État du fil de reconnaissance (n'y touche que lui).
  static IntPtr modele = IntPtr.Zero, reco = IntPtr.Zero;
  static bool sourd = false, dictee = false, filtrer = false;
  static string dernierPartiel = "";
  static readonly List<byte[]> enCours = new List<byte[]>();     // la phrase en train d'être dite
  static readonly List<byte[]> derniere = new List<byte[]>();    // la phrase précédente (pour la réécouter)
  // Dictée : la phrase continue tant qu'on reparle dans les 0,7 s ; puis elle part à Whisper.
  static readonly List<byte[]> segment = new List<byte[]>();
  static int echantillonsDepuisFin = -1;
  static bool parole = false;
  // Avant la phrase : 300 ms gardés pour ne pas couper la première syllabe.
  static readonly Queue<byte[]> avant = new Queue<byte[]>();
  static int avantOctets = 0;

  // Micro du PC
  static Thread filMicro;
  static volatile bool microActif = false;
  static int microVoulu = int.MinValue;

  // Niveau (pour l'anneau de NOA), 10 fois par seconde au plus.
  static DateTime dernierNiveau = DateTime.MinValue;

  // Filtre du micro de la tablette : on n'y garde que ce qui dépasse nettement
  // le bruit de fond (le jeu dans les enceintes, la ventilation).
  static double plancher = 0.003;
  static int ouvertEncore = 0;
  // Fin de phrase plus rapide que Vosk (qui attend ~0,7 s) : 300 ms de calme
  // après des mots reconnus suffisent. C'est ce qui rend NOA vif en combat.
  static double fond = 0.003;                    // bruit de fond, tous micros confondus
  static int calme = 0;
  const int CALME_FIN = FREQ * 3 / 10;

  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    Console.InputEncoding = new UTF8Encoding(false);
    try { vosk_set_log_level(-1); }
    catch (Exception e) { Envoyer("ERREUR\tlibvosk introuvable : " + Une(e.Message)); return 2; }
    Thread fil = new Thread(Reconnaissance); fil.IsBackground = true; fil.Start();
    Envoyer("PRET");
    string ligne;
    var entree = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), false, 1 << 16);
    while ((ligne = entree.ReadLine()) != null) {
      try { if (!Ordre(ligne)) break; }
      catch (Exception e) { Envoyer("ERREUR\t" + Une(e.Message)); }
    }
    ArreterMicro();
    return 0;
  }

  // ── Les ordres du Bridge ──────────────────────────────────────────────────
  static bool Ordre(string ligne) {
    string[] p = ligne.Split('\t');
    switch (p[0]) {
      case "PCM":                                // son du micro de la tablette (base64, 16 bits)
        if (p.Length > 1) Pousser(Convert.FromBase64String(p[1]), true);
        return true;
      case "MODELE": {
        string chemin = p[1];
        file.Add((Action)delegate { ChargerModele(chemin); });
        return true;
      }
      case "GRAMMAIRE": {
        string g = p.Length > 1 ? p[1] : "";
        bool rejouer = p.Length > 2 && p[2] == "1";
        file.Add((Action)delegate { NouvelleGrammaire(g, rejouer); });
        return true;
      }
      case "SOURD": { bool v = p.Length > 1 && p[1] == "1"; file.Add((Action)delegate { sourd = v; if (v) Oublier(); }); return true; }
      case "DICTEE": { bool v = p.Length > 1 && p[1] == "1"; file.Add((Action)delegate { dictee = v; segment.Clear(); echantillonsDepuisFin = -1; }); return true; }
      case "SOURCE":                             // pc <numéro> | externe | aucune
        if (p.Length > 1 && p[1] == "pc") {
          int n = WAVE_MAPPER; if (p.Length > 2) int.TryParse(p[2], out n);
          filtrer = false; DemarrerMicro(n);
        } else { ArreterMicro(); filtrer = p.Length > 1 && p[1] == "externe"; }
        return true;
      case "MICROS": Envoyer("MICROS\t" + ListeMicros()); return true;
      case "INFOS": Envoyer("INFOS\t" + CartesGraphiques()); return true;
      case "QUITTER": return false;
    }
    return true;
  }

  static void Pousser(byte[] son, bool externe) {
    if (externe && filtrer) son = Filtre(son);
    // File pleine (PC débordé) : on jette le plus ancien son plutôt que de bloquer.
    if (!file.TryAdd(son)) { object x; file.TryTake(out x); file.TryAdd(son); }
  }

  // ── Fil de reconnaissance ─────────────────────────────────────────────────
  static void Reconnaissance() {
    foreach (object o in file.GetConsumingEnumerable()) {
      try {
        Action a = o as Action;
        if (a != null) { a(); continue; }
        Traiter((byte[])o);
      } catch (Exception e) { Envoyer("ERREUR\t" + Une(e.Message)); }
    }
  }

  static void ChargerModele(string chemin) {
    if (modele != IntPtr.Zero) { Envoyer("MODELE_OK"); return; }
    // Kaldi lit le chemin en ANSI : un nom d'utilisateur accentué le perdrait.
    // Le nom court (8.3) de Windows n'a que des caractères simples.
    string c = chemin;
    try { var sb = new StringBuilder(1024); if (GetShortPathNameW(chemin, sb, 1024) > 0) c = sb.ToString(); } catch { }
    byte[] b = Chaine(c, Environment.OSVersion.Platform == PlatformID.Win32NT ? Encoding.Default : Encoding.UTF8);
    modele = vosk_model_new(b);
    if (modele == IntPtr.Zero) { Envoyer("ERREUR\tmodèle illisible : " + Une(chemin)); return; }
    Envoyer("MODELE_OK");
  }

  static void NouvelleGrammaire(string g, bool rejouer) {
    if (modele == IntPtr.Zero) { Envoyer("ERREUR\tgrammaire avant le modèle"); return; }
    IntPtr ancien = reco;
    reco = string.IsNullOrEmpty(g) ? vosk_recognizer_new(modele, FREQ) : vosk_recognizer_new_grm(modele, FREQ, Chaine(g, Encoding.UTF8));
    if (reco == IntPtr.Zero) { reco = ancien; Envoyer("ERREUR\tgrammaire refusée"); return; }
    vosk_recognizer_set_words(reco, 1);
    if (ancien != IntPtr.Zero) vosk_recognizer_free(ancien);
    dernierPartiel = "";
    if (rejouer) {
      // La phrase qui vient d'être dite est réécoutée avec le nouveau vocabulaire.
      var audio = new List<byte[]>(derniere); audio.AddRange(enCours); enCours.Clear();
      foreach (byte[] m in audio) Reconnaitre(m, false);
      byte[] silence = new byte[FREQ / 5 * 2];
      for (int i = 0; i < 4; i++) Reconnaitre(silence, false);
    }
    Envoyer("GRAMMAIRE_OK");
  }

  static void Oublier() { enCours.Clear(); segment.Clear(); echantillonsDepuisFin = -1; avant.Clear(); avantOctets = 0; }

  static void Traiter(byte[] son) {
    Niveau(son);
    if (sourd || reco == IntPtr.Zero) return;
    Reconnaitre(son, true);
  }

  static void Reconnaitre(byte[] son, bool garder) {
    if (garder) {
      enCours.Add(son);
      if (enCours.Count > 400) enCours.RemoveAt(0);          // ~16 s au plus
      if (dictee) {
        if (segment.Count == 0 && !parole) { avant.Enqueue(son); avantOctets += son.Length; while (avantOctets > FREQ * 2 * 3 / 10) avantOctets -= avant.Dequeue().Length; }
        else segment.Add(son);
      }
    }
    int fin = vosk_recognizer_accept_waveform(reco, son, son.Length);
    // Nos propres fins de phrase : des mots entendus, puis 300 ms nettement plus calmes.
    double rms = Rms(son);
    fond = rms < fond ? fond * 0.8 + rms * 0.2 : fond * 0.998 + rms * 0.002;
    if (fond < 0.0003) fond = 0.0003;
    if (rms < Math.Max(fond * 2.5, 0.002)) calme += son.Length / 2; else calme = 0;
    bool forcer = fin == 0 && calme >= CALME_FIN && dernierPartiel.Length > 0 && !PartielVide(dernierPartiel);
    if (fin != 0 || forcer) {
      string r = Lire(forcer ? vosk_recognizer_final_result(reco) : vosk_recognizer_result(reco));
      calme = 0;
      Envoyer("RESULTAT\t" + Une(r));
      dernierPartiel = "";
      if (garder) { derniere.Clear(); derniere.AddRange(enCours); enCours.Clear(); }
      if (parole) { parole = false; echantillonsDepuisFin = 0; }
    } else {
      string p = Lire(vosk_recognizer_partial_result(reco));
      bool parle = !PartielVide(p);
      if (p != dernierPartiel) { dernierPartiel = p; if (parle) Envoyer("PARTIEL\t" + Une(p)); }
      if (parle && garder && dictee && !parole) {
        parole = true; echantillonsDepuisFin = -1;
        if (segment.Count == 0) { segment.AddRange(avant); avant.Clear(); avantOctets = 0; }
      }
    }
    // Dictée : 0,7 s de silence après la fin d'une phrase → le morceau part à Whisper.
    if (garder && dictee && echantillonsDepuisFin >= 0 && !parole) {
      echantillonsDepuisFin += son.Length / 2;
      if (echantillonsDepuisFin > FREQ * 7 / 10) {
        echantillonsDepuisFin = -1;
        int total = 0; foreach (byte[] m in segment) total += m.Length;
        if (total > FREQ * 2 * 3 / 10) {
          byte[] tout = new byte[total]; int k = 0;
          foreach (byte[] m in segment) { Buffer.BlockCopy(m, 0, tout, k, m.Length); k += m.Length; }
          Envoyer("SEGMENT\t" + Convert.ToBase64String(tout));
        }
        segment.Clear();
      }
    }
  }

  static void Niveau(byte[] son) {
    if ((DateTime.UtcNow - dernierNiveau).TotalMilliseconds < 100) return;
    dernierNiveau = DateTime.UtcNow;
    double s = 0; int n = son.Length / 2;
    for (int i = 0; i < n; i++) { double x = BitConverter.ToInt16(son, i * 2) / 32768.0; s += x * x; }
    double rms = n > 0 ? Math.Sqrt(s / n) : 0;
    Envoyer("NIVEAU\t" + Math.Min(1.0, rms * 6).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));
  }

  // Porte de bruit douce : sous le seuil (3× le bruit de fond), le son est
  // fortement baissé ; elle reste ouverte 400 ms après la voix pour ne pas
  // couper les fins de mots.
  static byte[] Filtre(byte[] son) {
    int n = son.Length / 2; double s = 0;
    for (int i = 0; i < n; i++) { double x = BitConverter.ToInt16(son, i * 2) / 32768.0; s += x * x; }
    double rms = n > 0 ? Math.Sqrt(s / n) : 0;
    // Le plancher suit le bruit de fond : il descend vite, monte lentement.
    plancher = rms < plancher ? plancher * 0.7 + rms * 0.3 : plancher * 0.995 + rms * 0.005;
    if (plancher < 0.0005) plancher = 0.0005;
    if (rms > plancher * 3) ouvertEncore = FREQ * 4 / 10;
    else ouvertEncore -= n;
    if (ouvertEncore > 0) return son;
    byte[] r = new byte[son.Length];
    for (int i = 0; i < n; i++) { short v = (short)(BitConverter.ToInt16(son, i * 2) / 8); r[i * 2] = (byte)(v & 0xff); r[i * 2 + 1] = (byte)((v >> 8) & 0xff); }
    return r;
  }

  // ── Micro du PC ───────────────────────────────────────────────────────────
  static void DemarrerMicro(int numero) {
    if (microActif && microVoulu == numero) return;
    ArreterMicro();
    microVoulu = numero; microActif = true;
    filMicro = new Thread(delegate() { BoucleMicro(numero); });
    filMicro.IsBackground = true; filMicro.Start();
  }

  static void ArreterMicro() {
    microActif = false;
    Thread t = filMicro; filMicro = null;
    if (t != null) t.Join(1500);
  }

  static void BoucleMicro(int numero) {
    IntPtr h = IntPtr.Zero;
    AutoResetEvent ev = new AutoResetEvent(false);
    const int NB = 8, TAILLE = FREQ * 2 / 25;      // 8 tampons de 40 ms
    IntPtr[] entetes = new IntPtr[NB];
    int tailleEntete = Marshal.SizeOf(typeof(WAVEHDR));
    int decalageDrapeaux = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwFlags");
    int decalageOctets = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwBytesRecorded");
    try {
      WAVEFORMATEX f = new WAVEFORMATEX();
      f.wFormatTag = 1; f.nChannels = 1; f.nSamplesPerSec = FREQ; f.wBitsPerSample = 16;
      f.nBlockAlign = 2; f.nAvgBytesPerSec = FREQ * 2; f.cbSize = 0;
      int r = waveInOpen(out h, numero, ref f, ev.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, CALLBACK_EVENT);
      if (r != 0) { Envoyer("ERREUR_MICRO\t" + r); microActif = false; return; }
      for (int i = 0; i < NB; i++) {
        WAVEHDR w = new WAVEHDR(); w.lpData = Marshal.AllocHGlobal(TAILLE); w.dwBufferLength = TAILLE;
        entetes[i] = Marshal.AllocHGlobal(tailleEntete);
        Marshal.StructureToPtr(w, entetes[i], false);
        waveInPrepareHeader(h, entetes[i], tailleEntete);
        waveInAddBuffer(h, entetes[i], tailleEntete);
      }
      waveInStart(h);
      Envoyer("MICRO_OK\t" + numero);
      while (microActif) {
        ev.WaitOne(200);
        for (int i = 0; i < NB; i++) {
          if ((Marshal.ReadInt32(entetes[i], decalageDrapeaux) & WHDR_DONE) == 0) continue;
          int n = Marshal.ReadInt32(entetes[i], decalageOctets);
          if (n > 0) {
            byte[] son = new byte[n];
            Marshal.Copy(Marshal.ReadIntPtr(entetes[i]), son, 0, n);
            Pousser(son, false);
          }
          if (!microActif) break;
          waveInUnprepareHeader(h, entetes[i], tailleEntete);
          WAVEHDR w = (WAVEHDR)Marshal.PtrToStructure(entetes[i], typeof(WAVEHDR));
          w.dwFlags = 0; w.dwBytesRecorded = 0;
          Marshal.StructureToPtr(w, entetes[i], false);
          waveInPrepareHeader(h, entetes[i], tailleEntete);
          waveInAddBuffer(h, entetes[i], tailleEntete);
        }
      }
    } catch (Exception e) {
      Envoyer("ERREUR_MICRO\t" + Une(e.Message));
    } finally {
      if (h != IntPtr.Zero) {
        waveInReset(h);
        for (int i = 0; i < NB; i++) {
          if (entetes[i] == IntPtr.Zero) continue;
          waveInUnprepareHeader(h, entetes[i], tailleEntete);
          Marshal.FreeHGlobal(Marshal.ReadIntPtr(entetes[i]));
          Marshal.FreeHGlobal(entetes[i]);
        }
        waveInClose(h);
      }
      Envoyer("MICRO_FERME");
    }
  }

  static string ListeMicros() {
    var sb = new StringBuilder("[");
    try {
      int n = waveInGetNumDevs();
      for (int i = 0; i < n; i++) {
        WAVEINCAPS c = new WAVEINCAPS();
        if (waveInGetDevCapsW(new IntPtr(i), ref c, Marshal.SizeOf(typeof(WAVEINCAPS))) != 0) continue;
        if (sb.Length > 1) sb.Append(',');
        sb.Append("{\"n\":").Append(i).Append(",\"nom\":\"").Append(Json(c.szPname)).Append("\"}");
      }
    } catch { }
    return sb.Append(']').ToString();
  }

  // Cartes graphiques et leur mémoire (pour choisir le modèle Whisper que le PC
  // peut faire tourner sans gêner le jeu). Lu dans le registre de Windows.
  static string CartesGraphiques() {
    var sb = new StringBuilder("[");
    try {
      using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}")) {
        if (k != null) foreach (string sous in k.GetSubKeyNames()) {
          if (sous.Length != 4) continue;
          try {
            using (Microsoft.Win32.RegistryKey c = k.OpenSubKey(sous)) {
              if (c == null) continue;
              object nom = c.GetValue("DriverDesc");
              if (nom == null) continue;
              long vram = 0;
              object q = c.GetValue("HardwareInformation.qwMemorySize");
              if (q is long) vram = (long)q;
              else if (q is byte[] && ((byte[])q).Length >= 8) vram = BitConverter.ToInt64((byte[])q, 0);
              if (vram == 0) {
                object m = c.GetValue("HardwareInformation.MemorySize");
                if (m is int) vram = (uint)(int)m;
                else if (m is byte[] && ((byte[])m).Length >= 4) vram = BitConverter.ToUInt32((byte[])m, 0);
              }
              if (sb.Length > 1) sb.Append(',');
              sb.Append("{\"nom\":\"").Append(Json(nom.ToString())).Append("\",\"vram\":").Append(vram).Append('}');
            }
          } catch { }
        }
      }
    } catch { }
    return sb.Append(']').ToString();
  }

  // ── Petits outils ─────────────────────────────────────────────────────────
  static bool PartielVide(string p) { return p.IndexOf("\"partial\" : \"\"", StringComparison.Ordinal) >= 0 || p.IndexOf("\"partial\":\"\"", StringComparison.Ordinal) >= 0 || p.Length == 0; }
  static double Rms(byte[] son) {
    double s = 0; int n = son.Length / 2;
    for (int i = 0; i < n; i++) { double x = BitConverter.ToInt16(son, i * 2) / 32768.0; s += x * x; }
    return n > 0 ? Math.Sqrt(s / n) : 0;
  }
  static byte[] Chaine(string s, Encoding e) { byte[] b = e.GetBytes(s); byte[] r = new byte[b.Length + 1]; Buffer.BlockCopy(b, 0, r, 0, b.Length); return r; }
  static string Lire(IntPtr p) {
    if (p == IntPtr.Zero) return "";
    int n = 0; while (Marshal.ReadByte(p, n) != 0) n++;
    byte[] b = new byte[n]; Marshal.Copy(p, b, 0, n);
    return Encoding.UTF8.GetString(b);
  }
  static string Json(string s) {
    var sb = new StringBuilder();
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') sb.Append('\\').Append(c);
      else if (c < 32) sb.Append(' ');
      else sb.Append(c);
    }
    return sb.ToString();
  }
}
