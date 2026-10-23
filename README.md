# CitizenPad Bridge

Le petit programme Windows qui relie la [Button Box CitizenPad](https://citizenpad.com) à Star Citizen : quand tu appuies sur un bouton de ta tablette, il presse la vraie touche sur ton PC.

**Télécharger :** [CitizenPad-Bridge-Setup.exe](https://github.com/Citizenpad/citizenpad-bridge/releases/latest/download/CitizenPad-Bridge-Setup.exe), ou depuis citizenpad.com → Réglages → Bridge.

## Pourquoi le code est public

Un programme qui simule des touches doit pouvoir être vérifié. Tout est dans [`bridge.mjs`](bridge.mjs) :

- il n'appuie **que** sur les touches d'une liste blanche (table `SC`) ;
- il n'écoute que les écrans autorisés de **ton** compte ;
- il ne lit ni la mémoire du jeu, ni ses fichiers, ni ce que tu tapes ;
- il ne se met **jamais** à jour tout seul : il propose, tu choisis ton moment.

Les installateurs sont fabriqués par GitHub Actions à partir de ce code (voir [`.github/workflows/construire.yml`](.github/workflows/construire.yml)), et chaque version publie l'empreinte SHA-256 de son installateur.

## Licence

Code lisible, pas libre de droits : voir [LICENCE.txt](LICENCE.txt).
