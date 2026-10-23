// ═══════════════════════════════════════════════════════════════════════════
//  LA FENÊTRE DU BRIDGE
// ═══════════════════════════════════════════════════════════════════════════
//  Une vraie fenêtre Windows à la place de la console noire : état de la
//  liaison, champ pour le code d'appairage avec un bouton Valider, mise à
//  jour en un clic, et toutes les actions en boutons visibles.
//
//  Comment : comme pour le clavier, un PowerShell reste ouvert. Il compile
//  au lancement le petit programme C# ci-dessous (Windows Forms, présent sur
//  tous les Windows 10 et 11) et l'affiche. Aucune dépendance à installer,
//  rien de binaire caché : tout est lisible ici.
//
//  Node et la fenêtre se parlent par lignes de texte, champs séparés par une
//  tabulation :
//    Node → fenêtre   ETAT, CODE, COMPTEUR, MAJ, MAJPROG, MSG, AFFICHER, FIN
//    fenêtre → Node   PRET, CODE, MAJ, CHANGER, JOURNAL, QUITTER, ERREUR
//
//  Si la fenêtre ne peut pas s'ouvrir, le Bridge garde la console : il
//  fonctionne toujours, juste moins joliment.
//
//  ⚠ C# 5 seulement (le compilateur livré avec Windows) : pas de $"…", pas
//  de ?., pas de =>. Et pas d'accent grave ni de dollar-accolade dans ce
//  texte, qui vit dans une chaîne JavaScript.
// ═══════════════════════════════════════════════════════════════════════════

export const CODE_FENETRE = String.raw`
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.Threading;
using System.Runtime.InteropServices;
public class CPUI {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  // Couleurs du logo et du site : fond clair, bleu CitizenPad, argent.
  static readonly Color FOND = Color.FromArgb(238, 242, 246);
  static readonly Color PANNEAU = Color.White;
  static readonly Color BORD = Color.FromArgb(214, 223, 233);
  static readonly Color TEXTE = Color.FromArgb(22, 32, 43);
  static readonly Color DOUX = Color.FromArgb(95, 111, 128);
  static readonly Color BLEU = Color.FromArgb(22, 104, 196);
  static readonly Color BLEU_CLAIR = Color.FromArgb(30, 143, 255);
  static readonly Color VERT = Color.FromArgb(15, 138, 95);
  static readonly Color AMBRE = Color.FromArgb(176, 112, 0);
  static readonly Color ROUGE = Color.FromArgb(192, 57, 43);
  static Panel barreEtat;
  static Form f;
  static Label lblPoint, lblEtat, lblDetail, lblCompteur, lblErreur, lblMaj, lblMajNote, lblMajInfo, lblMsg, lblTest;
  static Panel pnlCode, pnlMaj;
  static TextBox txtCode;
  static Button btnValider, btnMaj;
  static bool fr = true, quitter = false;
  static string T(string a, string b) { return fr ? a : b; }
  static readonly object verrou = new object();
  static void Envoyer(string l) { lock (verrou) { Console.Out.WriteLine(l); Console.Out.Flush(); } }
  public static void Run(string exe, string version, string cacher, string langue) {
    fr = langue == "fr";
    if (cacher == "1") ShowWindow(GetConsoleWindow(), 0);
    try { SetProcessDPIAware(); } catch { }
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    // Toute erreur est renvoyée au Bridge, qui l'écrit dans son journal.
    Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
    Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) { Envoyer("ERREUR\t" + Une(e.Exception.ToString())); };
    try {
      Construire(exe, version);
      f.Shown += delegate {
        Thread t = new Thread(Lire);
        t.IsBackground = true;
        t.Start();
        Envoyer("PRET");
      };
      Application.Run(f);
    } catch (Exception e) {
      Envoyer("ERREUR\t" + Une(e.ToString()));
    }
  }
  static string Une(string s) { return s.Replace("\r", " ").Replace("\n", " | ").Replace("\t", " "); }
  static Font P(float taille, FontStyle style) { return new Font("Segoe UI", taille, style); }
  static Label Texte(string s, float taille, Color c, FontStyle style, int x, int y, int l, int h) {
    Label lb = new Label();
    lb.Text = s; lb.Font = P(taille, style); lb.ForeColor = c; lb.BackColor = Color.Transparent;
    lb.Location = new Point(x, y); lb.Size = new Size(l, h); lb.AutoSize = false;
    return lb;
  }
  static Button Bouton(string s, Color c, int x, int y, int l, int h) {
    Button b = new Button();
    b.Text = s; b.Font = P(10.5f, FontStyle.Bold); b.ForeColor = Color.White; b.BackColor = c;
    b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderSize = 0; b.Cursor = Cursors.Hand;
    b.Location = new Point(x, y); b.Size = new Size(l, h);
    return b;
  }
  static LinkLabel Lien(string s, int x, EventHandler clic) {
    LinkLabel l = new LinkLabel();
    l.Text = s; l.Font = P(9.5f, FontStyle.Regular); l.AutoSize = true; l.Location = new Point(x, 6);
    l.LinkColor = DOUX; l.ActiveLinkColor = TEXTE; l.LinkBehavior = LinkBehavior.HoverUnderline;
    l.Click += clic;
    return l;
  }
  // Carte blanche à bord fin, comme sur le site.
  static Panel Carte(int l, int h, int haut) {
    Panel c = new Panel(); c.Size = new Size(l, h); c.BackColor = PANNEAU; c.Margin = new Padding(0, haut, 0, 0);
    c.Paint += delegate(object s, PaintEventArgs e) {
      using (Pen p = new Pen(BORD)) e.Graphics.DrawRectangle(p, 0, 0, c.Width - 1, c.Height - 1);
    };
    return c;
  }
  static Button Secondaire(string s, int x, int l) {
    Button b = Bouton(s, PANNEAU, x, 0, l, 36);
    b.Font = P(9.5f, FontStyle.Regular); b.ForeColor = TEXTE;
    b.FlatAppearance.BorderSize = 1; b.FlatAppearance.BorderColor = BORD;
    b.FlatAppearance.MouseOverBackColor = Color.FromArgb(232, 241, 252);
    return b;
  }
  static void Construire(string exe, string version) {
    f = new Form();
    f.Text = "CitizenPad Bridge";
    f.BackColor = FOND; f.ForeColor = TEXTE;
    f.FormBorderStyle = FormBorderStyle.FixedSingle; f.MaximizeBox = false; f.MinimizeBox = true;
    f.StartPosition = FormStartPosition.CenterScreen;
    f.AutoScaleMode = AutoScaleMode.Dpi;
    f.AutoScaleDimensions = new SizeF(96f, 96f);
    Icon icone = null;
    try { icone = Icon.ExtractAssociatedIcon(exe); f.Icon = icone; } catch { }
    FlowLayoutPanel racine = new FlowLayoutPanel();
    racine.FlowDirection = FlowDirection.TopDown; racine.WrapContents = false;
    racine.AutoSize = true; racine.AutoSizeMode = AutoSizeMode.GrowAndShrink;
    racine.Padding = new Padding(0, 0, 0, 12); racine.BackColor = FOND;
    f.Controls.Add(racine);
    f.AutoSize = true; f.AutoSizeMode = AutoSizeMode.GrowAndShrink;
    // En-tête blanc avec le logo, souligné d'un dégradé bleu
    Panel tete = new Panel(); tete.Size = new Size(456, 86); tete.Margin = new Padding(0); tete.BackColor = PANNEAU;
    Image logo = null;
    try { logo = Image.FromFile(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(exe), "logo.png")); } catch { }
    if (logo != null) {
      PictureBox pic = new PictureBox(); pic.Image = logo; pic.SizeMode = PictureBoxSizeMode.Zoom;
      pic.Location = new Point(18, 12); pic.Size = new Size(210, 49);
      tete.Controls.Add(pic);
    } else {
      if (icone != null) {
        PictureBox pic = new PictureBox(); pic.Image = new Icon(icone, 48, 48).ToBitmap(); pic.SizeMode = PictureBoxSizeMode.Zoom;
        pic.Location = new Point(18, 12); pic.Size = new Size(46, 46);
        tete.Controls.Add(pic);
      }
      tete.Controls.Add(Texte("CitizenPad", 16f, TEXTE, FontStyle.Bold, 70, 16, 200, 32));
    }
    Label sous = Texte("BRIDGE  ·  v" + version, 9f, BLEU, FontStyle.Bold, 240, 34, 140, 20);
    tete.Controls.Add(sous);
    lblTest = Texte(T("TEST", "TEST"), 8f, Color.White, FontStyle.Bold, 384, 34, 54, 20);
    lblTest.BackColor = Color.FromArgb(194, 83, 10); lblTest.TextAlign = ContentAlignment.MiddleCenter; lblTest.Visible = false;
    tete.Controls.Add(lblTest);
    Panel degrade = new Panel(); degrade.Location = new Point(0, 80); degrade.Size = new Size(456, 6);
    degrade.Paint += delegate(object s, PaintEventArgs e) {
      using (LinearGradientBrush b = new LinearGradientBrush(degrade.ClientRectangle, BLEU_CLAIR, BLEU, LinearGradientMode.Horizontal))
        e.Graphics.FillRectangle(b, degrade.ClientRectangle);
    };
    tete.Controls.Add(degrade);
    racine.Controls.Add(tete);
    // Le reste, avec des marges
    FlowLayoutPanel corps = new FlowLayoutPanel();
    corps.FlowDirection = FlowDirection.TopDown; corps.WrapContents = false;
    corps.AutoSize = true; corps.AutoSizeMode = AutoSizeMode.GrowAndShrink;
    corps.Margin = new Padding(18, 14, 18, 0); corps.BackColor = FOND;
    racine.Controls.Add(corps);
    // État de la liaison : une carte, avec une barre de couleur à gauche
    Panel etat = Carte(420, 104, 0);
    barreEtat = new Panel(); barreEtat.Location = new Point(0, 0); barreEtat.Size = new Size(6, 104); barreEtat.BackColor = DOUX;
    lblPoint = Texte("●", 14f, DOUX, FontStyle.Regular, 16, 12, 24, 28);
    lblEtat = Texte(T("Démarrage…", "Starting…"), 12.5f, TEXTE, FontStyle.Bold, 40, 12, 370, 26);
    lblDetail = Texte("", 9.5f, DOUX, FontStyle.Regular, 42, 40, 368, 40);
    lblCompteur = Texte("", 9f, BLEU, FontStyle.Regular, 42, 80, 368, 20);
    etat.Controls.Add(barreEtat); etat.Controls.Add(lblPoint); etat.Controls.Add(lblEtat); etat.Controls.Add(lblDetail); etat.Controls.Add(lblCompteur);
    corps.Controls.Add(etat);
    // Appairage
    pnlCode = Carte(420, 162, 12); pnlCode.Visible = false;
    pnlCode.Controls.Add(Texte(T("Relie ce PC à ta tablette (une seule fois)", "Link this PC to your tablet (once only)"), 11f, TEXTE, FontStyle.Bold, 14, 12, 392, 24));
    pnlCode.Controls.Add(Texte(T("Sur ta tablette, ouvre la Button Box et appuie sur APPAIRER. Tape ici le code qui s'affiche sur ta tablette :",
      "On your tablet, open the Button Box and tap PAIR. Type here the code shown on your tablet:"), 9.5f, DOUX, FontStyle.Regular, 14, 38, 392, 40));
    txtCode = new TextBox();
    txtCode.Font = new Font("Consolas", 18f, FontStyle.Bold); txtCode.CharacterCasing = CharacterCasing.Upper;
    txtCode.BackColor = Color.FromArgb(246, 249, 252); txtCode.ForeColor = TEXTE; txtCode.BorderStyle = BorderStyle.FixedSingle;
    txtCode.TextAlign = HorizontalAlignment.Center; txtCode.MaxLength = 12;
    txtCode.Location = new Point(14, 82); txtCode.Size = new Size(240, 40);
    btnValider = Bouton(T("Valider", "Confirm"), BLEU, 264, 81, 142, 38);
    btnValider.Click += delegate { Valider(); };
    lblErreur = Texte("", 9.5f, ROUGE, FontStyle.Regular, 14, 124, 392, 34);
    pnlCode.Controls.Add(txtCode); pnlCode.Controls.Add(btnValider); pnlCode.Controls.Add(lblErreur);
    corps.Controls.Add(pnlCode);
    // Mise à jour
    pnlMaj = Carte(420, 128, 12); pnlMaj.Visible = false;
    pnlMaj.BackColor = Color.FromArgb(255, 247, 228);
    lblMaj = Texte("", 11f, AMBRE, FontStyle.Bold, 14, 10, 392, 24);
    lblMajNote = Texte("", 9f, DOUX, FontStyle.Regular, 14, 34, 392, 34);
    btnMaj = Bouton(T("Installer maintenant", "Install now"), VERT, 14, 74, 186, 36);
    btnMaj.Click += delegate { DemanderMaj(); };
    lblMajInfo = Texte(T("Rien ne s'installe sans toi. Le Bridge se coupe une dizaine de secondes : pas en plein combat !",
      "Nothing installs without you. The Bridge stops for about ten seconds: not in the middle of a fight!"), 8.5f, DOUX, FontStyle.Regular, 208, 70, 202, 52);
    pnlMaj.Controls.Add(lblMaj); pnlMaj.Controls.Add(lblMajNote); pnlMaj.Controls.Add(btnMaj); pnlMaj.Controls.Add(lblMajInfo);
    corps.Controls.Add(pnlMaj);
    // Messages ponctuels
    lblMsg = Texte("", 9.5f, AMBRE, FontStyle.Regular, 0, 0, 420, 40); lblMsg.Margin = new Padding(0, 8, 0, 0); lblMsg.Visible = false;
    corps.Controls.Add(lblMsg);
    // Pied : toutes les actions visibles, sans menu caché.
    Panel pied = new Panel(); pied.Size = new Size(420, 38); pied.Margin = new Padding(0, 14, 0, 0);
    Button bCompte = Secondaire(T("Changer de compte", "Switch account"), 0, 150);
    bCompte.Click += delegate { Changer(); };
    Button bJournal = Secondaire(T("Journal", "Log"), 158, 92);
    bJournal.Click += delegate { Envoyer("JOURNAL"); };
    Button bQuitter = Bouton(T("Quitter le Bridge", "Quit the Bridge"), ROUGE, 258, 0, 162, 36);
    bQuitter.Font = P(9.5f, FontStyle.Bold);
    bQuitter.Click += delegate { Quitter(); };
    pied.Controls.Add(bCompte); pied.Controls.Add(bJournal); pied.Controls.Add(bQuitter);
    corps.Controls.Add(pied);
    Label astuce = Texte(T("Garde cette fenêtre ouverte pendant que tu joues. Tu peux la réduire dans la barre des tâches.",
      "Keep this window open while you play. You can minimize it to the taskbar."), 8.5f, DOUX, FontStyle.Regular, 0, 0, 420, 34);
    astuce.Margin = new Padding(0, 8, 0, 0);
    corps.Controls.Add(astuce);
    f.AcceptButton = btnValider;
    // La croix ferme vraiment le Bridge (après confirmation) : un Bridge
    // caché qu'on oublie, c'est un PC qui accepte encore des touches.
    f.FormClosing += delegate(object s, FormClosingEventArgs e) {
      if (quitter || e.CloseReason != CloseReason.UserClosing) return;
      e.Cancel = true;
      Quitter();
    };
  }
  static void Montrer() {
    f.Show();
    f.TopMost = true; f.TopMost = false;
    if (f.WindowState == FormWindowState.Minimized) f.WindowState = FormWindowState.Normal;
    f.Activate();
    try { SetForegroundWindow(f.Handle); } catch { }
  }
  static void Valider() {
    string c = txtCode.Text.Trim();
    if (c.Length < 4) { lblErreur.Text = T("Tape le code affiché sur ta tablette.", "Type the code shown on your tablet."); return; }
    lblErreur.ForeColor = DOUX; lblErreur.Text = T("Vérification…", "Checking…");
    btnValider.Enabled = false; txtCode.Enabled = false;
    Envoyer("CODE\t" + c.Replace("\t", ""));
  }
  static void DemanderMaj() {
    btnMaj.Enabled = false;
    lblMajInfo.Text = T("Préparation…", "Preparing…");
    Envoyer("MAJ");
  }
  static void Changer() {
    DialogResult r = MessageBox.Show(f,
      T("Relier ce PC à un autre compte CitizenPad ?\n\nLe compte actuel sera oublié sur ce PC, et le Bridge te demandera un nouveau code.",
        "Link this PC to another CitizenPad account?\n\nThe current account will be forgotten on this PC, and the Bridge will ask for a new code."),
      "CitizenPad Bridge", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
    if (r == DialogResult.Yes) Envoyer("CHANGER");
  }
  static void Quitter() {
    DialogResult r = MessageBox.Show(f,
      T("Quitter le Bridge ?\n\nTa tablette ne pourra plus envoyer de touches au jeu.", "Quit the Bridge?\n\nYour tablet will no longer be able to send keys to the game."),
      "CitizenPad Bridge", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
    if (r == DialogResult.Yes) Envoyer("QUITTER");
  }
  static void Lire() {
    string l;
    while ((l = Console.In.ReadLine()) != null) {
      string ligne = l;
      try { f.BeginInvoke(new MethodInvoker(delegate { Traiter(ligne); })); } catch { }
    }
    try { f.BeginInvoke(new MethodInvoker(delegate { Fermer(); })); } catch { }
  }
  static void Fermer() { quitter = true; Application.Exit(); }
  // Node envoie les accents sous la forme \u00e9 : l'entrée de PowerShell ne
  // parle pas UTF-8 sur tous les PC.
  static string Champ(string[] p, int i) {
    if (p.Length <= i) return "";
    return System.Text.RegularExpressions.Regex.Replace(p[i], "\\\\u([0-9a-fA-F]{4})",
      delegate(System.Text.RegularExpressions.Match m) { return ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString(); });
  }
  static void Traiter(string ligne) {
    string[] p = ligne.Split('\t');
    switch (p[0]) {
      case "ETAT": {
        string code = Champ(p, 1);
        Color c = DOUX; string titre = "";
        if (code == "connexion") { c = AMBRE; titre = T("Connexion…", "Connecting…"); }
        else if (code == "pret") { c = VERT; titre = T("Prêt", "Ready"); }
        else if (code == "tablette") { c = VERT; titre = T("Connecté à ta tablette", "Connected to your tablet"); }
        else if (code == "perdu") { c = ROUGE; titre = T("Liaison perdue", "Connection lost"); }
        else if (code == "refuse") { c = AMBRE; titre = T("Compte utilisé sur un autre PC", "Account in use on another PC"); }
        else if (code == "appairage") { c = BLEU; titre = T("En attente du code", "Waiting for the code"); }
        else if (code == "erreur") { c = ROUGE; titre = T("Problème", "Problem"); }
        lblPoint.ForeColor = c; barreEtat.BackColor = c; lblEtat.Text = titre; lblDetail.Text = Champ(p, 2);
        f.Text = "CitizenPad Bridge · " + titre;
        break;
      }
      case "COMPTEUR":
        lblCompteur.Text = T("Commandes transmises : ", "Commands sent: ") + Champ(p, 1) + "   ·   " + T("dernière : ", "last: ") + Champ(p, 2);
        break;
      case "CODE": {
        string q = Champ(p, 1);
        if (q == "demande") { pnlCode.Visible = true; txtCode.Enabled = true; btnValider.Enabled = true; lblErreur.Text = ""; Montrer(); txtCode.Focus(); }
        else if (q == "erreur") { lblErreur.ForeColor = ROUGE; lblErreur.Text = Champ(p, 2); txtCode.Enabled = true; btnValider.Enabled = true; txtCode.SelectAll(); txtCode.Focus(); }
        else if (q == "ok") { pnlCode.Visible = false; txtCode.Text = ""; }
        break;
      }
      case "MAJ": {
        string v = Champ(p, 1);
        bool dispo = v.Length > 0;
        pnlMaj.Visible = dispo;
        if (dispo) {
          lblMaj.Text = "★ " + T("Mise à jour ", "Update ") + v + T(" disponible", " available");
          lblMajNote.Text = Champ(p, 2);
          btnMaj.Visible = Champ(p, 3) != "manuel";
          btnMaj.Enabled = true;
        }
        break;
      }
      case "MAJPROG":
        lblMajInfo.Text = Champ(p, 1);
        if (Champ(p, 2) == "echec") btnMaj.Enabled = true;
        break;
      case "MSG":
        lblMsg.Text = Champ(p, 1); lblMsg.Visible = lblMsg.Text.Length > 0;
        break;
      case "TEST":
        lblTest.Visible = true;
        break;
      case "AFFICHER":
        Montrer();
        break;
      case "FIN":
        Fermer();
        break;
    }
  }
}
`

/** Le script PowerShell complet : compile la fenêtre et l'ouvre. */
export function scriptFenetre({ exe, version, cacherConsole, langue }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @"',
    CODE_FENETRE.trim(),
    '"@',
    `[CPUI]::Run(${q(exe)}, ${q(version)}, ${q(cacherConsole ? '1' : '0')}, ${q(langue)})`,
    // Fenêtre fermée = PowerShell s'arrête = le Bridge le voit et s'arrête
    // aussi. Jamais de Bridge invisible qui tourne encore.
    'exit',
  ].join('\n')
  // PowerShell lit ce script ligne par ligne sur son entrée : une ligne vide
  // au milieu d'un bloc l'interromprait. On les retire toutes. Et les
  // caractères non ASCII deviennent \uXXXX, que C# comprend : l'entrée de
  // PowerShell n'est pas en UTF-8 sur tous les PC.
  //
  // ⚠ Et il FAUT une ligne vide à la fin : en lecture sur l'entrée,
  // PowerShell accumule un bloc de plusieurs lignes et ne l'exécute qu'en
  // recevant une ligne vide (comme l'invite « >> » de la console).
  return ascii(script.split('\n').filter(l => l.trim()).join('\n')) + '\n\n'
}

/** « é » → « \u00e9 ». Utilisé aussi pour chaque message envoyé à la fenêtre. */
export function ascii(s) {
  return String(s).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}
