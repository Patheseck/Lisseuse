# Ce que dit la recherche — et ce que la liseuse en fait

Synthèse des travaux récents en sciences cognitives / neurosciences de l'apprentissage
qui fondent les choix de la V6. Chaque principe est suivi de sa traduction concrète dans
l'application. Niveau de preuve : ★★★ robuste (méta-analyses concordantes), ★★ solide
mais dépendant du contexte, ★ prometteur / préliminaire.

---

## 1. Pratique de récupération (« testing effect ») — ★★★

Se tester renforce davantage la mémoire que relire. La méta-analyse de Yang et al. (2021,
*Psychological Bulletin*, 222 études, 48 478 élèves) trouve un effet moyen en classe
(g ≈ 0,50), généralisable à tous les niveaux scolaires et 18 disciplines. L'effet augmente
avec un **retour correctif**, la **répétition des tests** et la **correspondance entre le
format d'entraînement et l'usage final**. Une méta-analyse 2025 limitée aux mathématiques
(Murray et al.) trouve un effet plus faible et incertain : l'effet dépend du type de contenu.

**Dans l'app :**
- La fiche devient une **question → réponse** explicite (indice de récupération clair),
  au lieu d'un mot-image seul.
- En révision, l'utilisateur **écrit ou dicte sa réponse avant de voir la correction**
  (rappel, pas reconnaissance), puis voit toujours la réponse de référence (retour correctif).

## 2. Espacement — ★★★

Répartir les révisions dans le temps est l'effet le plus constant (méta-analyse 2025 :
g ≈ 0,28 en contexte de cours, 0,43 en apprentissage isolé). L'algorithme FSRS, entraîné
sur des centaines de millions de révisions réelles, prédit le moment où la probabilité de
rappel tombe à la cible (90 % par défaut).

**Dans l'app :**
- Planification par **ts-fsrs** (bibliothèque officielle open-spaced-repetition, MIT,
  FSRS-6) au lieu d'une réimplémentation maison : moins de bugs, mises à jour possibles
  (FSRS-7 est en cours).
- Les révisions le même jour ont un effet très faible sur la mémoire à long terme
  (benchmarks FSRS) : pas d'incitation à « bachoter » une fiche plusieurs fois par jour.

## 3. Réapprentissage successif (« successive relearning ») — ★★★

Rawson & Dunlosky : récupérer jusqu'à réussir une fois, puis recommencer lors de sessions
espacées. Même une seule session de réapprentissage améliore nettement les examens réels.

**Dans l'app :** une fiche ratée (« Encore ») **revient dans la même séance** jusqu'à
un rappel réussi (étapes de réapprentissage de ts-fsrs), puis repart dans l'espacement.

## 4. Effet de génération et auto-explication — ★★

Produire soi-même une explication (même imparfaite) encode plus profondément que lire une
explication correcte. L'interrogation élaborative (« pourquoi est-ce vrai ? ») est
efficace surtout quand l'élaboration est **précise** et **auto-générée** (Dunlosky 2013 :
utilité « modérée »).

**Dans l'app :**
- Création de fiche guidée : l'utilisateur **écrit lui-même** la question et la réponse
  (avec des modèles de questions « Pourquoi… ? », « Quelle différence… ? »).
- Les **suggestions automatiques** (TextRank) sont retirées : elles court-circuitent
  l'effet de génération.

## 5. Pré-test et rappel libre — ★★

Répondre à des questions *avant* d'étudier améliore la rétention, même en se trompant,
surtout avec un retour immédiat (Mera et al., 2025). Les apprenants sous-estiment
systématiquement ce bénéfice (Pan & Rivers, 2023) : il faut le proposer, pas l'attendre.

**Dans l'app :**
- **Rappel libre de fin de chapitre** (2 minutes) : « Écris tout ce dont tu te souviens »,
  puis comparaison avec ses propres passages surlignés.
- **Pré-questions à la relecture** : en rouvrant un chapitre qui a déjà des fiches,
  proposer d'y répondre avant de relire.

## 6. Métacognition et effet d'hypercorrection — ★★

Les erreurs commises avec une **forte confiance** sont plus souvent corrigées ensuite
(effet d'hypercorrection, répliqué en classe). On surestime ce qu'on sait après une
lecture fluide : la seule mesure fiable de la maîtrise est un rappel réel.

**Dans l'app :**
- Avant de révéler la réponse : **« Quelle est ta confiance ? »** (faible / moyenne / forte).
- Une erreur à forte confiance est **mise en évidence** (« Surprise ! Lis bien la
  correction ») pour exploiter l'hypercorrection.
- Le tableau de bord affiche la **calibration** (confiance vs réussite réelle) au lieu
  d'indicateurs de « compréhension prouvée » calculés par similarité de mots, peu fiables.

## 7. Entrelacement — ★★

Mélanger les sujets pendant la révision aide à discriminer les concepts (utilité « modérée »).

**Dans l'app :** la file de révision **mélange livres et chapitres** au lieu de les grouper.

## 8. Mnémotechniques et méthode des lieux — ★★ (pour les listes ordonnées)

La méthode des lieux (palais mental) a un effet important sur le **rappel ordonné**
(méta-analyses 2021 et 2025, *British Journal of Psychology*). Elle est utile pour des
séquences, listes et données brutes, moins pour la compréhension conceptuelle. L'imagerie
**animée** (êtres vivants, actions) améliore la rétention chez les débutants.

**Dans l'app :**
- Le palais mental et la table Mojor sont **conservés comme aide-mémoire optionnel**
  rattaché à une fiche, principalement pour les **séquences**.
- Le coach d'encodage conseille une image concrète, **animée** et en action.
- Le « parcours du palais » devient un mode de la révision (indice = le lieu), pas un
  module séparé.

## 9. Sommeil et consolidation — ★ (non transposable tel quel)

La réactivation ciblée pendant le sommeil (sons associés à l'apprentissage rejoués pendant
le sommeil lent) améliore la consolidation en laboratoire, surtout pour le matériel
difficile (npj Science of Learning, 2025). Les résultats restent variables et exigent un
dispositif de détection du sommeil.

**Dans l'app :** rien d'automatique (non fiable sans capteur). Seulement un réglage de
**rappel quotidien** à l'heure choisie (ex. le soir) et un conseil : réviser avant de
dormir, puis faire un rappel bref le matin.

## 10. Lecture sur écran — ★★

Plusieurs méta-analyses trouvent une compréhension légèrement inférieure sur écran pour les
textes informatifs **longs** ; l'écart disparaît pour les textes courts (< 1 000 mots) et
est plus faible sur appareil tenu en main que sur ordinateur.

**Dans l'app :**
- Sections courtes : indicateur de temps de lecture par chapitre et pause de rappel libre.
- Mode concentration conservé ; typographie réglable conservée.

---

## Ce qui est retiré faute de preuves

| Fonction V5.7 | Raison du retrait |
|---|---|
| « Valeur d'apprentissage /100 » et classement automatique du passage | Heuristique sur mots-clés, précision illusoire |
| « Compréhension prouvée » par similarité de mots | Un recouvrement de racines ne mesure pas la compréhension ; remplacé par auto-évaluation + calibration |
| Suggestions automatiques TextRank | Supprime l'effet de génération |
| Mode professeur séparé | Fusionné dans la révision (filtre « ce chapitre ») + rappel libre de fin de chapitre |
| Mode « Pages » | Non fonctionnel ; à réintroduire plus tard proprement |

## Sources

- Yang, Luo, Vadillo, Yu & Shanks (2021). *Testing (quizzing) boosts classroom learning.* Psychological Bulletin. https://scholars.hkbu.edu.hk/en/publications/testing-quizzing-boosts-classroom-learning-a-systematic-and-meta-/
- Murray, Horner & Göbel (2025). *A meta-analytic review of the effectiveness of spacing and retrieval practice for mathematics learning.* Educational Psychology Review. https://link.springer.com/article/10.1007/s10648-025-10035-1
- Bego et al. (2024). *Single-paper meta-analyses of the effects of spaced retrieval practice in nine introductory STEM courses.* IJ STEM Ed. https://link.springer.com/article/10.1186/s40594-024-00468-5
- Rawson & Dunlosky (2022). *Successive relearning: an underexplored but potent technique.* Current Directions in Psychological Science. https://journals.sagepub.com/doi/full/10.1177/09637214221100484
- Mera et al. (2025). *The pretesting effect: exploring the impact of feedback and final test timing.* Journal of Cognition. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12292081/
- Pan & Rivers (2023). Croyances des apprenants sur le pré-test. https://link.springer.com/10.1007/s10648-023-09805-6
- Hypercorrection en classe. https://pubmed.ncbi.nlm.nih.gov/29781391/ · Duke (Fazio) : https://dukespace.lib.duke.edu/items/d6ab09ca-f55c-4efb-9d32-2788bc5838b2
- Revue des techniques d'apprentissage (Dunlosky et al. 2013, synthèse). https://blogs.learnquebec.ca/2021/02/a-review-of-learning-techniques-and-their-efficacy/
- Méthode des lieux, méta-analyse 2025 (British Journal of Psychology, doi 10.1111/bjop.12799). https://www.muni.cz/en/research/publications/2496979
- Réactivation ciblée personnalisée pendant le sommeil (2025). https://www.nature.com/articles/s41539-025-00340-3
- Lecture écran vs papier (synthèse 2024). https://www.shanahanonliteracy.com/blog/is-comprehension-better-with-digital-text-1
- ts-fsrs (FSRS-6, MIT). https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/README.md
- FSRS et révisions du même jour. https://forums.ankiweb.net/t/about-fsrs-algorithms-first-rating/50055/2
