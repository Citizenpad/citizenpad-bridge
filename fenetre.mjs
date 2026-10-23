// ═══════════════════════════════════════════════════════════════════════════
//  LA FENÊTRE DU BRIDGE
// ═══════════════════════════════════════════════════════════════════════════
//  Une vraie fenêtre Windows à la place de la console noire : état de la
//  liaison, champ pour le code d'appairage avec un bouton Valider, mise à
//  jour en un clic, et une icône près de l'horloge.
//
//  Comment : comme pour le clavier, un PowerShell reste ouvert. Il compile
//  au lancement le petit programme C# ci-dessous (Windows Forms, présent sur
//  tous les Windows 10 et 11) et l'affiche. Aucune dépendance à installer,
//  rien de binaire caché : tout est lisible ici.
//
//  Node et la fenêtre se parlent par lignes de texte, champs séparés par une
//  tabulation :
//    Node → fenêtre   ETAT, CODE, COMPTEUR, MAJ, MAJPROG, MSG, AFFICHER, FIN
//    fenêtre → Node   PRET, CODE, MAJ, CHANGER, JOURNAL, QUITTER
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
  static readonly Color FOND = Color.FromArgb(11, 16, 22);
  static readonly Color PANNEAU = Color.FromArgb(20, 28, 38);
  static readonly Color TEXTE = Color.FromArgb(230, 237, 243);
  static readonly Color DOUX = Color.FromArgb(138, 155, 171);
  static readonly Color BLEU = Color.FromArgb(59, 158, 255);
  static readonly Color VERT = Color.FromArgb(46, 204, 113);
  static readonly Color AMBRE = Color.FromArgb(240, 180, 41);
  static readonly Color ROUGE = Color.FromArgb(255, 93, 93);
  static Form f;
  static NotifyIcon tray;
  static ToolStripMenuItem menuMaj;
  static Label lblPoint, lblEtat, lblDetail, lblCompteur, lblErreur, lblMaj, lblMajNote, lblMajInfo, lblMsg, lblTest;
  static Panel pnlCode, pnlMaj;
  static TextBox txtCode;
  static Button btnValider, btnMaj;
  static bool fr = true, quitter = false, bulleVue = false;
  static string T(string a, string b) { return fr ? a : b; }
  static readonly object verrou = new object();
  static void Envoyer(string l) { lock (verrou) { Console.Out.WriteLine(l); Console.Out.Flush(); } }
  public static void Run(string exe, string version, string cacher, string langue) {
    fr = langue == "fr";
    if (cacher == "1") ShowWindow(GetConsoleWindow(), 0);
    try { SetProcessDPIAware(); } catch { }
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Construire(exe, version);
    f.Shown += delegate {
      Thread t = new Thread(Lire);
      t.IsBackground = true;
      t.Start();
      Envoyer("PRET");
    };
    Application.Run(f);
  }
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
  static void Construire(string exe, string version) {
    f = new Form();
    f.Text = "CitizenPad Bridge";
    f.BackColor = FOND; f.ForeColor = TEXTE;
    f.FormBorderStyle = FormBorderStyle.FixedSingle; f.MaximizeBox = false;
    f.StartPosition = FormStartPosition.CenterScreen;
    f.AutoScaleMode = AutoScaleMode.Dpi;
    f.AutoScaleDimensions = new SizeF(96f, 96f);
    Icon icone = null;
    try { icone = Icon.ExtractAssociatedIcon(exe); f.Icon = icone; } catch { }
    FlowLayoutPanel racine = new FlowLayoutPanel();
    racine.FlowDirection = FlowDirection.TopDown; racine.WrapContents = false;
    racine.AutoSize = true; racine.AutoSizeMode = AutoSizeMode.GrowAndShrink;
    racine.Padding = new Padding(18, 14, 18, 10); racine.BackColor = FOND;
    f.Controls.Add(racine);
    f.AutoSize = true; f.AutoSizeMode = AutoSizeMode.GrowAndShrink;
    // En-tête
    Panel tete = new Panel(); tete.Size = new Size(420, 58); tete.Margin = new Padding(0);
    if (icone != null) {
      PictureBox pic = new PictureBox();
      pic.Image = new Icon(icone, 48, 48).ToBitmap(); pic.SizeMode = PictureBoxSizeMode.Zoom;
      pic.Location = new Point(0, 4); pic.Size = new Size(46, 46);
      tete.Controls.Add(pic);
    }
    tete.Controls.Add(Texte("CitizenPad Bridge", 15f, TEXTE, FontStyle.Bold, 54, 2, 300, 30));
    tete.Controls.Add(Texte("version " + version, 9f, DOUX, FontStyle.Regular, 56, 32, 150, 20));
    lblTest = Texte(T("VERSION DE TEST", "TEST VERSION"), 8.5f, Color.White, FontStyle.Bold, 300, 8, 120, 20);
    lblTest.BackColor = Color.FromArgb(194, 83, 10); lblTest.TextAlign = ContentAlignment.MiddleCenter; lblTest.Visible = false;
    tete.Controls.Add(lblTest);
    racine.Controls.Add(tete);
    // État de la liaison
    Panel etat = new Panel(); etat.Size = new Size(420, 92); etat.BackColor = PANNEAU; etat.Margin = new Padding(0, 6, 0, 0);
    lblPoint = Texte("●", 18f, DOUX, FontStyle.Regular, 10, 8, 30, 34);
    lblEtat = Texte(T("Démarrage…", "Starting…"), 12.5f, TEXTE, FontStyle.Bold, 40, 12, 370, 26);
    lblDetail = Texte("", 9.5f, DOUX, FontStyle.Regular, 42, 40, 370, 22);
    lblCompteur = Texte("", 9f, DOUX, FontStyle.Regular, 42, 64, 370, 20);
    etat.Controls.Add(lblPoint); etat.Controls.Add(lblEtat); etat.Controls.Add(lblDetail); etat.Controls.Add(lblCompteur);
    racine.Controls.Add(etat);
    // Appairage
    pnlCode = new Panel(); pnlCode.Size = new Size(420, 150); pnlCode.Margin = new Padding(0, 12, 0, 0); pnlCode.Visible = false;
    pnlCode.Controls.Add(Texte(T("Relie ce PC à ta tablette (une seule fois)", "Link this PC to your tablet (once only)"), 11f, TEXTE, FontStyle.Bold, 0, 0, 420, 24));
    pnlCode.Controls.Add(Texte(T("Sur ta tablette, ouvre la Button Box et appuie sur APPAIRER. Tape ici le code qui s'affiche sur ta tablette :",
      "On your tablet, open the Button Box and tap PAIR. Type here the code shown on your tablet:"), 9.5f, DOUX, FontStyle.Regular, 0, 26, 420, 40));
    txtCode = new TextBox();
    txtCode.Font = new Font("Consolas", 18f, FontStyle.Bold); txtCode.CharacterCasing = CharacterCasing.Upper;
    txtCode.BackColor = PANNEAU; txtCode.ForeColor = TEXTE; txtCode.BorderStyle = BorderStyle.FixedSingle;
    txtCode.TextAlign = HorizontalAlignment.Center; txtCode.MaxLength = 12;
    txtCode.Location = new Point(0, 70); txtCode.Size = new Size(260, 40);
    btnValider = Bouton(T("Valider", "Confirm"), BLEU, 272, 69, 148, 38);
    btnValider.Click += delegate { Valider(); };
    lblErreur = Texte("", 9.5f, ROUGE, FontStyle.Regular, 0, 116, 420, 34);
    pnlCode.Controls.Add(txtCode); pnlCode.Controls.Add(btnValider); pnlCode.Controls.Add(lblErreur);
    racine.Controls.Add(pnlCode);
    // Mise à jour
    pnlMaj = new Panel(); pnlMaj.Size = new Size(420, 128); pnlMaj.Margin = new Padding(0, 12, 0, 0); pnlMaj.Visible = false;
    pnlMaj.BackColor = Color.FromArgb(32, 27, 14);
    lblMaj = Texte("", 11f, AMBRE, FontStyle.Bold, 12, 8, 400, 24);
    lblMajNote = Texte("", 9f, DOUX, FontStyle.Regular, 12, 32, 400, 34);
    btnMaj = Bouton(T("Installer maintenant", "Install now"), Color.FromArgb(25, 135, 84), 12, 70, 190, 34);
    btnMaj.Click += delegate { DemanderMaj(); };
    lblMajInfo = Texte(T("Rien ne s'installe sans toi. Le Bridge se coupe une dizaine de secondes : pas en plein combat !",
      "Nothing installs without you. The Bridge stops for about ten seconds: not in the middle of a fight!"), 8.5f, DOUX, FontStyle.Regular, 210, 68, 204, 52);
    pnlMaj.Controls.Add(lblMaj); pnlMaj.Controls.Add(lblMajNote); pnlMaj.Controls.Add(btnMaj); pnlMaj.Controls.Add(lblMajInfo);
    racine.Controls.Add(pnlMaj);
    // Messages ponctuels
    lblMsg = Texte("", 9.5f, AMBRE, FontStyle.Regular, 0, 0, 420, 40); lblMsg.Margin = new Padding(0, 8, 0, 0); lblMsg.Visible = false;
    racine.Controls.Add(lblMsg);
    // Pied
    Panel pied = new Panel(); pied.Size = new Size(420, 32); pied.Margin = new Padding(0, 10, 0, 0);
    LinkLabel lCompte = Lien(T("Changer de compte", "Switch account"), 0, delegate { Changer(); });
    LinkLabel lJournal = Lien(T("Journal", "Log"), 150, delegate { Envoyer("JOURNAL"); });
    LinkLabel lQuitter = Lien(T("Quitter", "Quit"), 350, delegate { Quitter(); });
    pied.Controls.Add(lCompte); pied.Controls.Add(lJournal); pied.Controls.Add(lQuitter);
    racine.Controls.Add(pied);
    f.AcceptButton = btnValider;
    // Icône près de l'horloge
    tray = new NotifyIcon();
    tray.Icon = icone != null ? icone : SystemIcons.Application;
    tray.Text = "CitizenPad Bridge";
    ContextMenuStrip menu = new ContextMenuStrip();
    menu.Items.Add(T("Ouvrir", "Open"), null, delegate { Montrer(); });
    menuMaj = new ToolStripMenuItem(T("Installer la mise à jour", "Install the update"), null, delegate { Montrer(); DemanderMaj(); });
    menuMaj.Visible = false;
    menu.Items.Add(menuMaj);
    menu.Items.Add(T("Journal", "Log"), null, delegate { Envoyer("JOURNAL"); });
    menu.Items.Add(new ToolStripSeparator());
    menu.Items.Add(T("Quitter le Bridge", "Quit the Bridge"), null, delegate { Quitter(); });
    tray.ContextMenuStrip = menu;
    tray.DoubleClick += delegate { Montrer(); };
    tray.Visible = true;
    // La croix cache la fenêtre : le Bridge continue, l'icône reste près de l'horloge.
    f.FormClosing += delegate(object s, FormClosingEventArgs e) {
      if (quitter || e.CloseReason != CloseReason.UserClosing) return;
      e.Cancel = true;
      f.Hide();
      if (!bulleVue) {
        bulleVue = true;
        tray.ShowBalloonTip(6000, "CitizenPad Bridge",
          T("Le Bridge continue de fonctionner ici. Clic droit sur l'icône pour le quitter.",
            "The Bridge keeps running here. Right-click the icon to quit."), ToolTipIcon.Info);
      }
    };
  }
  static void Montrer() {
    f.Show();
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
  static void Fermer() { quitter = true; try { tray.Visible = false; tray.Dispose(); } catch { } Application.Exit(); }
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
        lblPoint.ForeColor = c; lblEtat.Text = titre; lblDetail.Text = Champ(p, 2);
        tray.Text = ("CitizenPad Bridge · " + titre).Length > 63 ? "CitizenPad Bridge" : "CitizenPad Bridge · " + titre;
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
        pnlMaj.Visible = dispo; menuMaj.Visible = dispo;
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
