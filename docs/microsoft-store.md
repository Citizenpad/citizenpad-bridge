# Publier le Bridge sur le Microsoft Store

Pourquoi : un programme installé depuis le Store n'a **pas d'alerte SmartScreen**
(Microsoft signe le paquet lui-même). Gratuit pour un compte particulier.

## 1. Récupérer le paquet

À chaque envoi de code, GitHub Actions fabrique le paquet Store :
Actions → la dernière exécution « Construire le Bridge » → **Artifacts** →
`CitizenPad-Bridge-<version>-Store-MSIX` (un .zip qui contient le `.msix`).

Le paquet n'est pas signé : c'est normal, Microsoft le signe à la publication.
Il ne s'installe donc pas en double-cliquant dessus sur un PC.

## 2. Partner Center (CitizenPad Bridge)

https://partner.microsoft.com/dashboard → Apps et jeux → CitizenPad Bridge →
**Démarrer la soumission**, puis remplir les rubriques :

### Tarification et disponibilité
- Marchés : tous. Visibilité : publique. Prix : **Gratuit**.

### Propriétés
- Catégorie : **Utilitaires et outils** (sous-catégorie : aucune).
- Politique de confidentialité : `https://citizenpad.com/legal/confidentialite`
- Site web : `https://citizenpad.com` — Support : `https://citizenpad.com`
- Configuration matérielle : clavier, souris (rien de particulier).
- « Ce produit accède à des informations personnelles » : **Oui** (code
  d'appairage et identifiant de compte CitizenPad, voir la politique).

### Classification par âge (questionnaire IARC)
- Catégorie : **Application (pas un jeu)**, utilitaire.
- Pas de violence, pas de contenu sexuel, pas de jeux d'argent.
- Échange entre utilisateurs : **Non** (le Bridge n'affiche aucun message
  d'autres joueurs ; il reçoit seulement des touches de la tablette du joueur).
- Partage de position : Non. Achats numériques dans l'app : Non.

### Packages
- Déposer le `.msix`. Familles d'appareils : **Windows 10/11 Desktop**.

### Justification des capacités restreintes (champ « Submission options » /
« Restricted capabilities »)

> **runFullTrust**: CitizenPad Bridge is a classic Win32 desktop program
> (packaged with the MSIX Packaging Tool approach). It needs full trust to run.
>
> **allowElevation**: CitizenPad Bridge turns a tablet or phone into a button
> box for the PC game Star Citizen. When the player taps a button on the
> tablet, the Bridge sends the matching keyboard key to the game with
> SendInput. Star Citizen runs with administrator privileges, and Windows
> (UIPI) blocks keyboard input sent by a non-elevated process to an elevated
> window. The Bridge therefore asks for elevation (UAC) when it starts. It only
> sends keys that the paired tablet requests, never reads other windows, and
> does not modify game files. Source code is public:
> https://github.com/Citizenpad/citizenpad-bridge

### Notes pour la certification (« Notes for certification »)

> The Bridge needs a paired CitizenPad account to do anything. To test without
> an account: start the Bridge (accept the UAC prompt); the window shows
> "Waiting for the code". That is the expected first-run state. Pairing is
> done from https://citizenpad.com on a tablet or phone (Button Box › PAIR).
> No game is required to verify that the app starts and runs.

## 3. Fiche du Store (Store listings)

Ajouter les langues : anglais (par défaut), français, allemand, espagnol,
portugais (Brésil). Captures d'écran (1920×1080) : dans le dossier envoyé par
Claude (1_bridge, 2_button_box, 3_crew, 4_trade). Logo : `build/icone.png`.

### English
**Short description** (field « Short description »):
> Turn your tablet or phone into a button box for Star Citizen.

**Description:**
> CitizenPad Bridge links your CitizenPad Button Box to Star Citizen on this PC.
>
> Open the Button Box on your tablet or phone (citizenpad.com), pair it once
> with this PC, and every button you tap presses the real key in the game:
> flight, power, shields, quantum, landing, on foot, emotes and more.
>
> • Free. Every screen of the Button Box is free.
> • Uses your own Star Citizen key bindings.
> • Does not touch game files: it only presses keys, like a keyboard.
> • Keys are released automatically if the connection drops.
> • Open source.
>
> CitizenPad also brings trade and mining helpers, and the Citizen Syndicate:
> a job board to find a crew and talk in translated phrases.
>
> Fan project, not affiliated with Cloud Imperium Games. Star Citizen® is a
> trademark of Cloud Imperium Rights LLC.

**Features** (one per line):
> Your tablet or phone as a Star Citizen button box
> Pair once, then it reconnects by itself
> Uses your own key bindings
> Keys released automatically if the connection drops
> Free and open source

**Keywords:** Star Citizen, button box, tablet, companion, CitizenPad, keybinds, HOTAS

### Français
**Description courte :**
> Ta tablette ou ton téléphone devient une button box pour Star Citizen.

**Description :**
> CitizenPad Bridge relie ta Button Box CitizenPad à Star Citizen sur ce PC.
>
> Ouvre la Button Box sur ta tablette ou ton téléphone (citizenpad.com),
> appaire-la une seule fois avec ce PC, et chaque bouton que tu touches appuie
> sur la vraie touche dans le jeu : vol, puissance, boucliers, quantum,
> atterrissage, à pied, émotes et plus.
>
> • Gratuit. Tous les écrans de la Button Box sont gratuits.
> • Utilise tes propres touches de Star Citizen.
> • Ne touche pas aux fichiers du jeu : il appuie seulement sur des touches, comme un clavier.
> • Les touches sont relâchées automatiquement si la connexion coupe.
> • Code source public.
>
> CitizenPad apporte aussi le commerce et le minage, et le Citizen Syndicate :
> un Job board pour trouver un équipage et parler en phrases traduites.
>
> Projet de fan, sans lien avec Cloud Imperium Games. Star Citizen® est une
> marque de Cloud Imperium Rights LLC.

### Deutsch
**Kurzbeschreibung:**
> Dein Tablet oder Handy wird zur Button Box für Star Citizen.

**Beschreibung:**
> CitizenPad Bridge verbindet deine CitizenPad Button Box mit Star Citizen auf
> diesem PC.
>
> Öffne die Button Box auf Tablet oder Handy (citizenpad.com), kopple sie einmal
> mit diesem PC, und jeder Knopf drückt die echte Taste im Spiel: Flug, Energie,
> Schilde, Quantum, Landung, zu Fuß, Emotes und mehr.
>
> • Kostenlos. Alle Bildschirme der Button Box sind kostenlos.
> • Nutzt deine eigene Tastenbelegung.
> • Verändert keine Spieldateien: drückt nur Tasten, wie eine Tastatur.
> • Tasten werden automatisch losgelassen, wenn die Verbindung abbricht.
> • Quellcode öffentlich.
>
> Fanprojekt, nicht mit Cloud Imperium Games verbunden. Star Citizen® ist eine
> Marke von Cloud Imperium Rights LLC.

### Español
**Descripción corta:**
> Tu tableta o tu móvil se convierte en una button box para Star Citizen.

**Descripción:**
> CitizenPad Bridge conecta tu Button Box de CitizenPad con Star Citizen en este PC.
>
> Abre la Button Box en tu tableta o móvil (citizenpad.com), emparéjala una sola
> vez con este PC, y cada botón que tocas pulsa la tecla real en el juego: vuelo,
> energía, escudos, cuántico, aterrizaje, a pie, emotes y más.
>
> • Gratis. Todas las pantallas de la Button Box son gratis.
> • Usa tus propias teclas de Star Citizen.
> • No toca los archivos del juego: solo pulsa teclas, como un teclado.
> • Las teclas se sueltan solas si se corta la conexión.
> • Código fuente público.
>
> Proyecto de fans, sin relación con Cloud Imperium Games. Star Citizen® es una
> marca de Cloud Imperium Rights LLC.

### Português (Brasil)
**Descrição curta:**
> Seu tablet ou celular vira uma button box para Star Citizen.

**Descrição:**
> O CitizenPad Bridge liga sua Button Box do CitizenPad ao Star Citizen neste PC.
>
> Abra a Button Box no tablet ou celular (citizenpad.com), pareie uma única vez
> com este PC, e cada botão que você toca aperta a tecla real no jogo: voo,
> energia, escudos, quantum, pouso, a pé, emotes e mais.
>
> • Grátis. Todas as telas da Button Box são grátis.
> • Usa as suas próprias teclas do Star Citizen.
> • Não mexe nos arquivos do jogo: só aperta teclas, como um teclado.
> • As teclas são soltas automaticamente se a conexão cair.
> • Código-fonte público.
>
> Projeto de fã, sem vínculo com a Cloud Imperium Games. Star Citizen® é uma
> marca da Cloud Imperium Rights LLC.

## 4. Après l'acceptation
- Sur le site (page Installation) : badge « Disponible sur Microsoft Store »
  en grand, téléchargement direct en lien secondaire.
- La version Store ne cherche pas de mise à jour elle-même (`STORE` dans
  bridge.mjs) : le Store s'en charge. Chaque nouvelle version = nouvelle
  soumission du `.msix`.
