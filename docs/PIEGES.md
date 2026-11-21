# Pièges connus du Bridge — et ce qui a marché

À lire AVANT de toucher à la fabrication, au lancement ou aux fichiers livrés.
À compléter APRÈS chaque problème résolu : le symptôme, la cause, la solution
qui a marché (et ce qui n'a pas marché). Le plus récent en haut de chaque partie.

## ⛔ Antivirus, navigateurs, SmartScreen, Microsoft Store

### « Téléchargement dangereux bloqué » (Chrome) — Bridge 1.6.0-dev — 19 nov. 2026 — EXPLIQUÉ
- Symptôme : Chrome bloque `CitizenPad-Bridge-1.6.0-dev.zip` (artefact GitHub Actions) comme **dangereux** (pas seulement « inhabituel »).
- Contexte : chaque nouvelle version du Bridge s'est fait signaler ; la 1.6.0 ajoute d'un coup plusieurs programmes non signés :
  `CitizenPad-Bridge-Voix.exe` (écoute le micro, sans fenêtre), `whisper-server.exe`, `whisper-server-vulkan.exe` (46 Mo, ouvre un port local), `libvosk.dll`.
- Causes envisagées avant la mesure :
  1. Rien n'est signé → aucune réputation, chaque version est un fichier « jamais vu ».
  2. `CitizenPad-Bridge.exe` est un **node.exe modifié** : signature OpenJS retirée, blob Node SEA injecté (postject), sous-système PE réécrit à la main (console → GUI). C'est le schéma des voleurs de mots de passe écrits en Node (pkg / SEA) : les classifieurs le reconnaissent.
  3. Un programme caché qui écoute le micro + un serveur local = profil « logiciel espion » pour les heuristiques.
- **Mesure (VirusTotal, 19 nov.) : 1 / 65.** Seul DeepInstinct (classifieur automatique connu pour ses faux positifs) le signale ; **Microsoft (Defender), Google, Kaspersky, BitDefender, ESET… : rien.**
- Conclusion : le fichier n'est PAS vu comme un virus. Le blocage de Chrome vient de la **réputation** : exécutable non signé, jamais vu, téléchargé depuis le stockage des artefacts GitHub (hébergement très utilisé par les vrais malwares). Chaque nouvelle version repart de zéro.
- Donc : ne pas réécrire la fabrication pour ça (le montage node.exe n'est pas en cause d'après la mesure). Pour un essai : Ctrl+J → « Conserver le fichier dangereux ». Pour les joueurs : le **Microsoft Store** (signé par Microsoft).
- Si un jour Defender ou Google se mettent à le signaler : refaire la mesure, puis envisager la piste « node.exe intact » ci-dessous.

### Programme qui en lance un autre — 16 nov. 2026 — RÉSOLU
- Symptôme : antivirus méfiant quand l'icône épinglée lançait le Bridge via l'aide.
- Solution : identifiant d'application commun (AppUserModelID `CitizenPad.Bridge`), plus de lancement en chaîne pour l'épinglage (commit 5cecbb6).

### Droits administrateur — 16 nov. 2026 — RÉSOLU
- Symptôme : fenêtre UAC jaune (fait fuir les nouveaux) ; Microsoft a **refusé** `allowElevation` au Store.
- Solution : `asInvoker` depuis la 1.5.2, plus de capacité allowElevation dans le MSIX.
- ⚠ Reste à surveiller : si Star Citizen tourne en administrateur, Windows (UIPI) bloque les touches d'un programme ordinaire.

### PowerShell compilé au lancement — 1.4.x — RÉSOLU
- Symptôme : antivirus et navigateurs se méfiaient ; icône PowerShell dans la barre des tâches.
- Cause : la fenêtre et le clavier étaient du C# compilé à chaque lancement par un PowerShell caché.
- Solution : vrai programme `CitizenPad-Bridge-Aide.exe` compilé une fois par GitHub Actions (commit a1452e3). **Ne jamais revenir à PowerShell / compilation à la volée.**

### Signature de node.exe — RÉSOLU (mais voir 1.6.0)
- Une fois node.exe modifié (SEA), sa signature est cassée ; on la retire plutôt que livrer une signature invalide (plus suspecte). Conséquence : l'exécutable n'est pas signé du tout.

## 🔨 Fabrication (GitHub Actions, Windows)

### `Console.OutputEncoding` dans un programme sans console — 19 nov. 2026 — RÉSOLU
- Symptôme : `CitizenPad-Bridge-Voix.exe` plantait au démarrage (`IOException: The handle is invalid`).
- Cause : un programme `/target:winexe` n'a pas de console ; changer son encodage est interdit.
- Solution : écrire en UTF-8 dans un `StreamWriter` sur `Console.OpenStandardOutput()`.

### whisper.cpp avec Vulkan : `SPIRV-Headers` introuvable — 19 nov. 2026 — RÉSOLU
- Cause : le SDK Vulkan minimal (`humbletim/install-vulkan-sdk`) n'a pas les en-têtes SPIR-V.
- Solution : cloner `KhronosGroup/SPIRV-Headers` (tag `vulkan-sdk-1.4.309.0`), l'installer, passer `CMAKE_PREFIX_PATH`.

### C# 5 seulement
- Le compilateur est celui de .NET Framework 4 (présent sur tout Windows) : pas de `$"…"`, pas de `?.`, pas de `=>`. Tester localement avec `mcs -langversion:5`.

### whisper-server-vulkan.exe ne démarre pas sur la machine GitHub
- Normal : pas de pilote Vulkan sur le runner. Le test l'accepte.

## 🎙️ NOA sur le PC

### 1.6.0 : la dictée par le PC ne comprenait rien — 19 nov. 2026 — RÉSOLU (1.6.1)
- Cause : pour savoir quand on parle, le programme se fiait au moteur des COMMANDES ; un mot hors de sa liste (« un », un pseudo) ne le faisait pas réagir → aucune phrase n'était envoyée à Whisper.
- Solution : détection de la voix par l'énergie du son, indépendante du vocabulaire ; chaque fin de phrase envoie le son à Whisper, avec un numéro qui relie la lecture de Vosk et celle de Whisper ; Whisper chargé dès l'ouverture de NOA.
- Mesure (banc `citizenpad/tests/voix`) : Whisper seul est mauvais sur les mots courts ; Vosk seul sur les noms. La tablette choisit la meilleure lecture des deux à chaque étape → 42/42 (micro PC), 41/42 (micro tablette).
- Vosk avec plusieurs lectures (`set_max_alternatives`) ne donne plus la certitude de chaque mot : on fait tourner DEUX lecteurs sur le même son (un pour la certitude, un pour les 6 lectures).
- Une phrase sans mot reconnu n'est envoyée que pendant une dictée avec de la voix, sinon le bruit de fond fait dire « pas compris ».

### Whisper retiré — 1.6.7 — 20 nov. 2026
- Les messages de NOA se font maintenant par numéros (annuaire, catégorie, phrase) : chaque écran n'écoute que ses choix, Vosk suffit et répond tout de suite. Whisper ne servait plus (et c'était lui le plus lent).
- Retiré : compilation dans `construire.yml` (15 min la première fois), `whisper-server*.exe` (installateur, MSIX), le code dans `noa.mjs`. Au démarrage, le dossier `%LOCALAPPDATA%\CitizenPad\noa\whisper` (jusqu'à 547 Mo) est effacé (`effacerWhisper`).
- Les commandes `dictee` et `SEGMENT` sont ignorées sans erreur (anciennes tablettes).
- ⚠ Ne pas le remettre pour « mieux comprendre » : le vrai gain a été de réduire ce qu'on attend, pas d'ajouter un plus gros moteur.

### Whisper ne s'installait JAMAIS : « modèle abîmé (empreinte différente) » — 20 nov. 2026 — RÉSOLU (1.6.6)
- Symptôme (journal de Veensce) : 115 fois « WHISPER modèle abîmé », parfois toutes les 20 s ; Whisper jamais installé, donc la dictée par le PC n'a jamais tourné chez lui. 547 Mo retéléchargés à chaque essai.
- Cause : l'empreinte SHA-256 de Hugging Face (`X-Linked-Etag`) est sur la REDIRECTION de `huggingface.co/…/resolve/…`. `fetch` suivait la redirection d'office et lisait l'`etag` du stockage final (Xet), qui n'est pas le SHA-256 du fichier → vérification toujours ratée.
- Solution : premier appel en `redirect: 'manual'`, lire `x-linked-etag`, puis suivre `location` à la main. Après un échec : plus d'essai pendant 30 min (`echecModele`). Le message d'erreur donne maintenant les deux empreintes et la taille reçue.
- ⚠ Soupçon : ces téléchargements à répétition saturaient la connexion et pouvaient faire tomber le salon (fenêtre qui alterne « Prêt » / « Connexion »). Depuis la 1.6.6, chaque état du salon est écrit dans le journal (`SALON …`) : regarder là d'abord.

### NOA s'arrêtait en pleine phrase puis reprenait (son sur le PC) — 20 nov. 2026 — 1.6.6
- Symptôme : présentation de NOA (une seule phrase longue, un seul fichier) coupée un long moment au milieu, puis la suite.
- Cause probable : le son partait au PC morceau par morceau et se jouait à l'arrivée ; un renvoi de paquets sur le Wi-Fi (SCTP du lien direct) retarde la suite de plusieurs secondes.
- Solution : la tablette annonce la taille du son (`son_debut … n`), le Bridge le garde jusqu'à l'avoir entier, puis le joue d'un bloc (filet : au bout de 4 s il joue ce qu'il a et le reste au fil de l'eau). Une tablette ancienne (sans `n`) garde l'ancien fonctionnement.

### Le son de NOA sur le PC — 1.6.3
- La tablette rend le son elle-même (voix + effets, volume), en 24 kHz mono 16 bits, et l'envoie par le lien direct (octet 2 en tête) ; le PC le joue avec waveOut sur la sortie par défaut de Windows. Les sons se jouent les uns après les autres (pas mélangés).
- Le micro de la tablette passe par le même lien, avec l'octet 1 en tête (avant la 1.6.3 : sans octet, incompatible).
- Le lien direct est partagé (écoute, touches, son) et reste ouvert : arrêter l'écoute ne le ferme pas.

## 🔗 Appairage

### QR code dans la fenêtre — 1.6.5 — 20 nov. 2026
- Le Bridge tire son code (alphabet du site, `ABC-DEF`), envoie la matrice à la fenêtre (`QR <taille> <0101…>`, ligne par ligne de haut en bas), et interroge `claim` toutes les 1,2 s (5 s après 10 min) sur citizenpad.com ET sur le site de test, à tour de rôle. Le premier qui aboutit, du QR ou du code tapé, gagne.
- Le QR mène au site de test seulement si ce PC y était déjà relié (ou `CITIZENPAD_URL`) ; le scanner de la page de test lit quand même un QR du site normal (il ne garde que le code).
- La carte blanche autour du QR fait la marge exigée par les lecteurs : `DessinerQR` ne laisse qu'une case de marge dans son cadre.
- Vérification sans Windows : la matrice envoyée est relue par `jsqr` (bon lien relu). La fenêtre WinForms ne s'affiche PAS sous Mono + Xvfb (aucune fenêtre créée) : ne pas y perdre de temps.
- `mcs` s'installe dans le conteneur après `apt-get update` (`apt-get install mono-devel`) : `mcs -langversion:5 -target:winexe -r:System.Windows.Forms.dll -r:System.Drawing.dll aide.cs`.

## 🖥️ Au lancement chez le joueur

### Chemins avec accents (Kaldi / Vosk)
- Kaldi lit les chemins en ANSI : un nom d'utilisateur accentué casserait le chargement du modèle. On passe le nom court Windows (8.3).

### Microsoft Store : on ne lance pas un .exe du Store par son chemin
- Solution : alias `CitizenPadBridge.exe` (AppExecutionAlias) ; pas d'auto-mise à jour quand on vient du Store.

### `windowsHide` sur la fenêtre
- Windows démarrerait la fenêtre cachée : ne pas le mettre pour l'aide « fenetre ».

### Clavier AZERTY / QWERTZ
- `MapVirtualKey` donnait la position de la disposition ACTIVE : A Q Z W M échouaient. Solution : table de scan codes QWERTY écrite en dur.

### Touches collées
- Toute perte de liaison (salon, lien direct de NOA, aide qui s'arrête) → on relâche TOUT. Ne jamais retirer ce filet.

### Node < 22 n'a pas de WebSocket
- `ws` en transport pour les vieux Node ; l'exécutable embarque Node 22.

## Ce qu'il faut essayer (antivirus / « dangereux »), par ordre
1. **Mesurer** avant de changer : envoyer l'installateur et les .exe un par un sur VirusTotal, noter quels moteurs et quel fichier.
2. **Ne plus modifier node.exe** : livrer le node.exe officiel, intact et signé, + `bridge.cjs` en fichier ; `CitizenPad-Bridge.exe` devient notre petit programme C# (fenêtre) qui le lance.
3. **Microsoft Store** : paquet signé par Microsoft = plus aucune alerte (gratuit). Diffusion privée possible pour tester.
4. Signaler les faux positifs : Google (Safe Browsing) et Microsoft (Defender, portail de soumission).
5. Certificat de signature (payant, ~10 €/mois Azure Trusted Signing) : dernier recours.
