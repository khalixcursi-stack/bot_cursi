# Journal des changements

## 0.22.0 — 2026-08-19

- nouvelle commande privée propriétaire `.pair` pour générer un code de connexion depuis un numéro WhatsApp de contrôle déjà actif;
- `.pair` sans argument cible le numéro propriétaire; `.pair <numéro>` cible un autre compte autorisé;
- code numérique renvoyé directement dans la conversation privée avec les étapes Appareils connectés;
- refus systématique de `.pair` dans les groupes et depuis une session secondaire;
- distinction entre le numéro WhatsApp de contrôle réellement connecté et `OWNER_NUMBER`;
- le propriétaire peut donc être connecté comme session secondaire d’un numéro de contrôle dédié;
- protection contre la création d’une session secondaire pour le numéro de contrôle lui-même;
- conservation de `.pairbot <numéro> CONFIRMER`, `.botsessions` et `.unpairbot`;
- rappel documenté : seul le premier démarrage du numéro de contrôle nécessite QR/console; les jumelages suivants se font depuis WhatsApp;
- 110 commandes disponibles.

## 0.21.0 — 2026-08-17

- nouvelle commande de groupe `.kickall CONFIRMER` pour retirer collectivement les membres ordinaires;
- prévisualisation du nombre de personnes concernées avant confirmation obligatoire;
- conservation de tous les administrateurs, du propriétaire du groupe, du propriétaire principal et du bot;
- traitement par lots de 20 avec une limite finie de 1 000 retraits par exécution et compte rendu en cas d’interruption;
- correction de `.sudo add|del @mention` lorsque WhatsApp fournit un identifiant LID;
- résolution du véritable numéro PN via les métadonnées du groupe puis la table de correspondance Baileys;
- suppression automatique de l’ancienne entrée LID lors de l’ajout ou du retrait sudo;
- reconnaissance de `participantAlt` pour que le numéro PN enregistré obtienne réellement les droits sudo;
- tests dédiés au filtrage de `.kickall`, à la conversion LID → PN et à l’autorisation sudo;
- 109 commandes disponibles.

## 0.20.0 — 2026-08-16

- nouvelle commande de groupe `.ban <@mention|numéro>` réservée aux administrateurs;
- retrait immédiat du membre présent puis ajout à une liste de bannissement persistante propre au groupe;
- retrait automatique d’un membre banni lorsqu’il rejoint à nouveau ou lorsqu’il écrit dans le groupe;
- nouvelles commandes `.unban` et `.banlist` pour gérer la liste;
- persistance locale et PostgreSQL, limite finie de 100 membres bannis par groupe;
- protection du propriétaire principal, du bot, de l’administrateur qui lance la commande et du propriétaire du groupe;
- bannissement automatique soumis à l’autorisation globale des automatisations de groupe et aux droits administrateur du bot;
- tests de commande, correspondance JID, limite, persistance et retrait automatique;
- 108 commandes disponibles.

## 0.19.0 — 2026-08-16

- nouvelle commande séparée `.nsfw 18+ <recherche>` pour les contenus réservés aux adultes;
- activation explicite par `NSFW_ENABLED`, autorisée dans l’archive privée du propriétaire;
- accès soumis au mode général du bot, donc disponible aux utilisateurs et groupes lorsque le bot les autorise;
- confirmation `18+` obligatoire à chaque demande pour éviter les déclenchements accidentels;
- recherche de photos JPEG adultes via Openverse avec Wikimedia Commons en repli, attribution et source incluses;
- blocage permanent des requêtes impliquant des mineurs, l’absence de consentement, la zoophilie ou des catégories illégales;
- `.images`, Anime et Stickers restent SFW;
- 105 commandes disponibles.

## 0.18.0 — 2026-08-16

- nouvelle commande Recherche `.videos <recherche>` : sélection du meilleur résultat YouTube, téléchargement local et envoi direct de la vidéo dans WhatsApp;
- nouvelle commande Recherche `.images <recherche>` : envoi d’une image Internet SFW avec auteur, licence et lien source;
- recherche d’images via Openverse avec contenu mature exclu, termes explicites bloqués et Wikimedia Commons en repli;
- essai de plusieurs résultats lorsqu’un hébergeur d’image refuse le téléchargement;
- examen du dépôt Flash-Md-V3 fourni au commit `9dbdd8e7c1a1b19b0ec48d2a9b31fc7c01036666`;
- flux « recherche puis envoi direct » reproduit sans reprendre ses clés codées en dur ni ses dépendances aux endpoints Noobs, Nayan, BK9 et Tiksave;
- moteur nightly yt-dlp, repli TikTok officiel et comportement des téléchargeurs existants conservés;
- 104 commandes disponibles.

## 0.17.0 — 2026-08-16

- remplacement de yt-dlp stable par la dernière version nightly vérifiée `2026.08.16.020253`;
- téléchargement depuis le dépôt officiel des builds nightly avec contrôle SHA-256;
- marqueur de version ajouté au binaire pour forcer le remplacement automatique des anciennes éditions;
- `.dlstatus` exécute désormais réellement le binaire et affiche la version active ou l’erreur locale exacte;
- disponibilité YouTube et réseaux sociaux calculée à partir du diagnostic réel, plus seulement de la configuration;
- repli officiel TikTok conservé lorsque l’extracteur yt-dlp rencontre le problème connu de page inattendue;
- téléchargements réels revérifiés pour TikTok, Instagram, Facebook, X/Twitter, YouTube audio et vidéo;
- 102 commandes disponibles.

## 0.16.0 — 2026-08-16

- nouvelle commande WhatsApp/groupe `.delword` pour gérer un filtre automatique de mots;
- `.delword add <mot>` supprime les nouveaux messages contenant ce mot entier;
- `.delword remove <mot>`, `.delword list` et `.delword clear CONFIRMER` gèrent la liste persistante;
- comparaison Unicode insensible à la casse, sans correspondance partielle (`test` ne correspond pas à `testament`);
- filtre limité à 50 mots par groupe, réservé aux administrateurs et nécessitant que le bot soit administrateur;
- propriétaires et administrateurs du groupe exemptés pour pouvoir gérer le filtre;
- réglages persistés en stockage local et PostgreSQL;
- repli local pour `.joke` et `.advice` lorsque leurs services Internet sont indisponibles;
- tests du mot entier, ajout/liste/retrait, suppression automatique et exemption administrateur;
- 102 commandes disponibles.

## 0.15.0 — 2026-08-16

- gestion propriétaire de deux sessions WhatsApp secondaires isolées sur le même hébergement;
- `.pairbot <numéro> CONFIRMER` génère un code dans un processus séparé et l’envoie en privé au numéro autorisé;
- `.botsessions` liste les identifiants masqués et l’état des sessions secondaires;
- `.unpairbot <id|numéro> CONFIRMER` déconnecte et supprime uniquement la session ciblée;
- chaque compte possède ses propres dossiers d’authentification et de réglages sous `data/linked-bots/`;
- le nouveau numéro est propriétaire de sa session et le propriétaire principal est ajouté comme sudo;
- restauration automatique des sessions connectées au redémarrage;
- arrêt des processus secondaires lorsque le parent s’arrête ou se déconnecte;
- aucun jumelage automatique par `.sudo` : la commande reste strictement réservée au propriétaire principal;
- limite configurable `MAX_LINKED_BOTS`, fixée à 2 dans l’archive privée;
- tests avec processus IPC simulés pour création, limite, code, liste, persistance et révocation;
- 101 commandes disponibles.

## 0.14.0 — 2026-08-16

- audit global couvrant explicitement les 98 commandes du registre;
- simulation locale d’une conversation WhatsApp pour les commandes générales, groupes, propriétaire, profil et sauvegarde;
- tests réels FFmpeg/Sharp pour sticker image/vidéo, sticker vers image, MP3, découpage et photos de profil;
- simulation locale des trois commandes IA avec une API compatible OpenAI factice;
- 27 tests en direct de recherche, téléchargements, Anime et stickers, tous concluants;
- téléchargements réels validés pour YouTube MP3/MP4, TikTok, Instagram, Facebook et X/Twitter;
- ajout d’un repli utilisant l’API officielle du lecteur TikTok lorsque l’extracteur yt-dlp est bloqué;
- prise en charge des liens TikTok complets et courts avec validation des redirections;
- relances automatiques des recherches GET après une panne réseau temporaire;
- rapport reproductible via `npm run smoke:live` dans `reports/live-smoke.md`;
- 98 commandes disponibles.

## 0.13.0 — 2026-08-16

- correction de l’interprétation entre auto-modération de groupe et garde-fous anti-rafale;
- restauration de `.automod` et `.antilink off|warn|delete|kick`;
- profil privé `CLOSED_TEST_MODE=true` permettant d’activer mode public, automatisations de groupe et de statut sans verrou persistant;
- limites du profil personnel relevées pour les essais avec les deux numéros, tout en conservant des plafonds finis contre les boucles accidentelles;
- vérification en direct de la météo, traduction, GitHub, npm, paroles, dictionnaire, Bible et devises;
- ajout d’un repli de conversion monétaire prenant en charge le franc CFA XAF;
- vérification en direct de la recherche YouTube locale et des téléchargements MP3/MP4;
- recherche Anime et sources d’images SFW de secours conservées;
- 98 commandes disponibles.

## 0.12.0 — 2026-08-16

- suppression complète de toute auto-modération de groupe;
- suppression des commandes `.automod` et `.antilink`;
- retrait du filtre anti-lien du dispatcher : les messages et liens ordinaires ne sont plus inspectés;
- aucune suppression, aucun avertissement et aucune exclusion ne peuvent désormais être déclenchés automatiquement;
- migration au démarrage supprimant les anciens champs `automod` et `antilink` du stockage;
- commandes manuelles de groupe et bienvenue/départ facultatifs conservés;
- quotas internes anti-rafale conservés uniquement pour empêcher la saturation du bot;
- 96 commandes disponibles.

## 0.11.1 — 2026-08-16

- `.save` conserve son rôle unique et `.vv` reste supprimée;
- dans le test fermé autorisé avec les deux numéros du propriétaire, `.save` accepte désormais la vue unique quel que soit le numéro expéditeur;
- la photo ou vidéo récupérée est envoyée uniquement dans le chat personnel du numéro propriétaire;
- aucun média n’est republié dans le groupe où la commande est exécutée;
- tests adaptés pour couvrir une vue unique envoyée par le second numéro.

## 0.11.0 — 2026-08-16

- suppression complète de la commande `.vv` à la demande du propriétaire;
- `.save` redevient la commande unique de sauvegarde vers le chat personnel : texte, image, vidéo, audio, sticker et document;
- `.save` prend aussi en charge les vues uniques personnelles du propriétaire sans republier le média dans le groupe;
- binaire yt-dlp Linux déplacé dans `bin/` dans l’archive HidenCloud pour éviter les volumes `data/` potentiellement non exécutables;
- vérification SHA-256 du binaire présent avant chaque première utilisation du moteur;
- test réel de `.play <titre>` avec production et envoi d’un MP3;
- test réel de `.ytmp4 <URL>` avec production d’un MP4;
- deuxième source SFW Danbooru ajoutée à `.waifu`, `.neko`, `.kitsune` et `.husbando` si nekos.best est indisponible;
- AniList et Jikan restent les deux sources de `.anime <titre>`;
- boutons natifs du menu et sous-menus sans description conservés;
- 98 commandes disponibles.

## 0.10.0 — 2026-08-16

- moteur local yt-dlp activé par défaut pour rendre les téléchargements utilisables sans Cobalt ni clé YouTube;
- installation automatique multi-plateforme d’un binaire yt-dlp épinglé avec vérification SHA-256 officielle;
- prise en charge locale de `.play <titre>`, `.play <URL>`, `.ytmp4`, `.yts` et des commandes de réseaux sociaux;
- FFmpeg intégré utilisé pour extraire le MP3 et fusionner les vidéos jusqu’à 720p;
- Cobalt conservé comme repli facultatif au lieu d’être un prérequis;
- `.dlstatus` affiche maintenant le moteur local, sa version, la plateforme, la limite et le délai;
- fichiers temporaires supprimés automatiquement et taille maximale contrôlée après téléchargement;
- nouvelle commande propriétaire `.vv` pour sauvegarder une vue unique personnelle dans le chat avec soi-même;
- `.vv` refuse la copie des vues uniques envoyées par d’autres participants afin de préserver leur confidentialité;
- comportement des boutons du menu et absence de descriptions conservés et couverts par les tests;
- 99 commandes disponibles.

## 0.9.0 — 2026-08-16

- menu principal redessiné sur le modèle fourni : photo, état du bot et catégories réunis dans un seul bloc;
- cartes de sous-menu également réunies dans un seul message image + texte;
- descriptions retirées des sous-menus pour une présentation plus compacte;
- bouton WhatsApp natif `Choisir un sous-menu` avec liste interactive des 13 catégories;
- bouton de sélection des commandes et bouton de retour dans chaque sous-menu;
- réponses des boutons reconnues comme de vraies commandes par le dispatcher;
- repli automatique vers une carte image + texte si le client WhatsApp refuse les boutons interactifs;
- nouvelle commande `.anime <titre>` recherchant trois affiches SFW via AniList avec repli Jikan;
- `.waifu`, `.neko`, `.kitsune` et `.husbando` renforcées avec plusieurs candidats, reprises réseau et contrôle du type d’image;
- menu de première connexion regroupé lui aussi dans un seul bloc;
- 98 commandes disponibles.

## 0.8.0 — 2026-08-16

- nouvelle commande de groupe `.automod on|off|status`, accessible aux administrateurs;
- `.automod off` suspend clairement la modération facultative sans toucher aux quotas anti-rafale obligatoires;
- la règle anti-lien précédente est conservée puis restaurée par `.automod on`, avec `warn` comme repli prudent;
- `.antilink` synchronise désormais explicitement l’état de l’auto-modération;
- toutes les commandes reconnues reçoivent `⏳`, puis `✅` ou `❌` selon leur résultat;
- erreurs de configuration sûres et visibles pour les utilisateurs, sans divulgation de secrets;
- nouvelle commande `.dlstatus` pour diagnostiquer Cobalt et la recherche YouTube;
- prise en charge de `COBALT_API_KEY` et du mode audio MP3 de Cobalt;
- `.play <titre>`, `.ytmp4 <titre>` et `.yts` prennent en charge YouTube Data v3 ou une API Invidious/Piped configurée;
- validation des URL YouTube directes et messages d’action précis quand un service manque;
- aucune instance Cobalt publique non autorisée n’est codée en dur;
- guide de mise à jour HidenCloud préservant `.env`, `.auth/` et `data/`;
- 97 commandes disponibles.

## 0.7.0 — 2026-08-16

- nouvelle catégorie `Anime` dans le menu hiérarchique;
- `.waifu`, `.neko`, `.kitsune` et `.husbando` envoient chacune trois images SFW;
- images Anime fournies par nekos.best avec artiste et source;
- nouvelle catégorie `Stickers`;
- `.stickers <recherche>` recherche une image Openverse SFW et sous licence modifiable;
- conversion automatique de l’image trouvée en sticker WebP 512 × 512;
- attribution de l’auteur et de la licence après le sticker;
- recherches explicites bloquées et contenu mature exclu;
- `.sticker` et `.toimg` déplacées dans le sous-menu Stickers;
- 95 commandes disponibles.

## 0.6.0 — 2026-08-16

- menu principal allégé avec 11 catégories numérotées;
- sous-menus accessibles par nom (`.menu general`, `.menu groupe`, etc.) ou numéro (`.menu 1`, `.menu 2`, etc.);
- photo affichée avec le menu principal et chaque sous-menu;
- descriptions et syntaxes affichées dans les sous-menus;
- raccourci propriétaire `.public CONFIRMER` pour activer le mode public;
- raccourci propriétaire `.private` pour revenir immédiatement au mode privé;
- `.mode public CONFIRMER` et `.mode private` également pris en charge;
- autorisation du mode persistée dans le stockage local ou PostgreSQL;
- 95 commandes disponibles.

## 0.5.2 — 2026-08-16

- ajout de la photo au début de chaque exécution de `.menu`;
- menu long conservé dans un second message texte pour éviter la troncature des légendes WhatsApp;
- même présentation photo + texte lors d’une future première connexion;
- repli automatique sur le menu texte si l’envoi de l’image échoue.

## 0.5.1 — 2026-08-16

- ajout d’un point d’entrée `/index.js` compatible avec HidenCloud;
- commande `npm start` alignée sur le fichier racine;
- approbation explicite des scripts d’installation Baileys, FFmpeg et protobufjs pour npm récent.

## 0.5.0 — 2026-08-15

- message de félicitations après la première connexion WhatsApp réussie;
- confirmation du stockage de session et du mode actif;
- lancement automatique du rendu de `.menu` après l’accueil;
- accueil envoyé une seule fois par compte grâce à un marqueur persistant;
- aucune répétition lors des reconnexions ou redémarrages Northflank;
- générateur de menu partagé entre la commande manuelle et l’accueil automatique.

## 0.4.0 — 2026-08-15

- intégration de la photo de profil fournie, optimisée en 640 × 640;
- identité propriétaire configurée sur `ᴄᴜʀsɪㅤ愛`;
- numéro propriétaire conservé uniquement dans la configuration locale privée;
- activation contrôlée des catégories `public`, `groups` et `statuses` via `.safety ... CONFIRMER`;
- persistance PostgreSQL des autorisations choisies;
- commande `.safety strict CONFIRMER` pour restaurer immédiatement le profil strict;
- quotas anti-rafale impossibles à désactiver depuis WhatsApp.

## 0.3.0 — 2026-08-15

- identité par défaut renommée en `ᴄᴜʀsɪㅤ愛`;
- profil strict d’utilisation responsable pour la phase Baileys;
- mode public et automatisations de groupes/statuts verrouillés par défaut;
- quotas de commandes, file d’envoi temporisée et plafond quotidien;
- réactions de commandes et notification de démarrage désactivées par défaut;
- commande propriétaire `.safety` pour consulter les protections;
- prise en charge d’une photo de profil versionnée dans `assets/profile.jpg`;
- mise à jour automatique et unique de la photo après connexion;
- ajout du document `WHATSAPP_RULES.md` et plan de migration vers l’API officielle;
- 95 commandes disponibles.

## 0.2.0 — 2026-08-15

- adaptation complète au Northflank Developer Sandbox;
- stockage des identifiants Baileys dans PostgreSQL;
- persistance PostgreSQL des réglages, groupes et utilisateurs sudo;
- chiffrement AES-256-GCM facultatif des valeurs sensibles en base;
- sélection automatique du stockage local ou PostgreSQL;
- reconnexion après redéploiement sans nouveau jumelage;
- endpoint `/health` compatible avec une liveness probe pendant le jumelage;
- endpoint `/ready` pour contrôler strictement la connexion WhatsApp;
- outil de réinitialisation d’une session PostgreSQL;
- guide Northflank détaillé et exemple de variables d’environnement.

## 0.1.0 — 2026-08-15

- première architecture indépendante;
- connexion par code de jumelage ou QR;
- registre modulaire de 87 commandes;
- gestion de groupes et anti-lien;
- conversions média avec Sharp et FFmpeg;
- recherche via API officielles, IA et téléchargements facultatifs;
- persistance JSON des réglages;
- endpoint de santé et fichiers Docker;
- contrôles de sécurité et tests automatisés.
