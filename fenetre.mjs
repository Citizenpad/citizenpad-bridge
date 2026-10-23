// ═══════════════════════════════════════════════════════════════════════════
//  DIALOGUE AVEC LA FENÊTRE (aide.cs)
// ═══════════════════════════════════════════════════════════════════════════
//  La fenêtre est un petit programme à part, CitizenPad-Bridge-Aide.exe
//  (source : aide.cs). Node et lui se parlent par lignes de texte, champs
//  séparés par une tabulation :
//    Node → fenêtre   ETAT, CODE, COMPTEUR, MAJ, MAJPROG, MSG, TEST, AFFICHER, FIN
//    fenêtre → Node   PRET, CODE, MAJ, CHANGER, JOURNAL, QUITTER, ERREUR
// ═══════════════════════════════════════════════════════════════════════════

/** « é » → « \u00e9 » : l'entrée d'un programme Windows ne lit pas toujours
 *  l'UTF-8, la fenêtre redécode ces séquences. */
export function ascii(s) {
  return String(s).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}
