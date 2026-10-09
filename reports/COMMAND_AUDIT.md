# Audit fonctionnel complet — ᴄᴜʀsɪ愛 v0.22.0

Date : 2026-08-19

## Résultat global

- Registre : **110 commandes** dans 13 catégories.
- Couverture planifiée : **110/110 commandes**.
- Tests automatisés locaux : **62/62 réussis**.
- Tests en direct Internet : **27/30 réussis**; les trois téléchargements YouTube ont été refusés par le contrôle anti-bot lié à l'adresse IP du banc de test.
- Vérification statique : **41 fichiers JavaScript**, aucun `eval`, shell `exec` ou session intégrée.
- Audit npm : **0 vulnérabilité**.

## Simulation locale WhatsApp

Une socket WhatsApp factice, un stockage en mémoire et des métadonnées de groupe simulées valident :

- toutes les commandes de groupe, y compris `.automod` et `.antilink`;
- toutes les commandes propriétaire et leurs interrupteurs;
- menu principal, sous-menus, boutons et réponses;
- commandes de profil, confidentialité et `.save`;
- réactions de succès et d'échec du dispatcher;
- persistance locale et PostgreSQL;
- création IPC, isolement, limite, code, liste et révocation des sessions secondaires.

## Sessions WhatsApp secondaires

Les commandes `.pair`, `.pairbot`, `.botsessions` et `.unpairbot` sont testées avec des processus enfants simulés. Les tests vérifient l'isolation des dossiers, la limite de deux sessions, le refus du numéro de contrôle, l'utilisation autorisée de `OWNER_NUMBER` comme compte secondaire, le refus de `.pair` en groupe, l'envoi privé du code, l'ajout du propriétaire principal comme sudo lorsque nécessaire et la suppression ciblée.

## Bannissement et retrait collectif de groupe

`.ban`, `.unban` et `.banlist` sont couverts par la simulation WhatsApp. Les tests vérifient la normalisation des JID, la limite de 100 entrées, la persistance locale et PostgreSQL, ainsi que le retrait automatique lorsqu'un membre banni écrit à nouveau. Le gestionnaire d'arrivée retire également les bannis avant tout message de bienvenue.

`.kickall` est testé avec un groupe simulé comprenant propriétaire, administrateur, bot, propriétaire principal et membres ordinaires. Le test confirme qu'aucun retrait ne se produit sans `CONFIRMER` et que seuls les membres ordinaires sont ensuite retirés.

## Résolution sudo LID → PN

Les tests construisent un vrai `CommandContext` avec `participant` en LID et `participantAlt` en PN. Ils confirment que le PN enregistré est reconnu comme sudo. Le cas sans `participantAlt` est aussi résolu avant le contrôle d'accès grâce à `signalRepository.lidMapping`. `.sudo add @mention` est testé avec la résolution par métadonnées et par la table Baileys; l'ancienne valeur LID est supprimée.

## Filtre de mots

`.delword` est testé pour l'ajout, la liste, le retrait et la suppression automatique. Le test confirme qu'un mot entier est reconnu sans tenir compte de la casse, qu'une sous-chaîne n'est pas supprimée et que les administrateurs restent exemptés.

## Médias

Des médias synthétiques sont créés localement puis traités réellement avec FFmpeg et Sharp :

- sticker depuis une image;
- sticker depuis une vidéo;
- sticker vers PNG;
- vidéo vers MP3;
- découpage vidéo;
- préparation des photos de profil utilisateur et groupe.

## IA

Les commandes `.ai`, `.vision` et `.imagine` sont exécutées contre une API compatible OpenAI simulée localement. Elles sont fonctionnelles; l'utilisation réelle exige toujours `AI_API_KEY`.

## Recherche et Internet

Les commandes suivantes ont répondu en direct :

`.weather`, `.translate`, `.github`, `.npm`, `.lyrics`, `.define`, `.exchange` avec XAF, `.bible`, `.joke`, `.advice`, `.yts`, `.images`, `.nsfw`, `.anime`, `.waifu`, `.neko`, `.kitsune`, `.husbando`, `.stickers`.

`.images` a envoyé une photo SFW réelle avec auteur, licence et source. `.nsfw` a envoyé un JPEG adulte après confirmation `18+`; les catégories interdites sont couvertes par les tests locaux. `.videos` avait produit un MP4 réel lors des audits précédents, mais YouTube a demandé une authentification anti-bot à l'adresse IP du banc actuel. Les requêtes GET réessaient automatiquement jusqu'à trois fois lors d'une panne temporaire.

## Téléchargements réels

Des fichiers ont été réellement extraits, téléchargés et vérifiés au cours des audits successifs :

- YouTube audio `.play` : MP3 valide lors des audits précédents; contrôle anti-bot IP lors du dernier passage;
- YouTube vidéo `.ytmp4` : MP4 valide lors des audits précédents; même contrôle anti-bot lors du dernier passage;
- TikTok `.tiktok` : MP4 via le repli officiel du lecteur TikTok;
- Instagram `.instagram` : MP4 valide;
- Facebook `.facebook` : MP4 valide;
- X/Twitter `.twitter` : MP4 valide;
- `.alldl`, `.fetchurl`, `.gitclone` et `.dlstatus` : réussis.

Le rapport détaillé avec tailles et durées est disponible dans `reports/live-smoke.md`. Le moteur testé est la nightly officielle `2026.08.16.020253`; `.dlstatus` vérifie désormais le binaire réellement exécuté.

## Limites normales

Les médias privés, supprimés, payants, géobloqués, interdits au téléchargement par leur créateur ou exigeant une connexion peuvent être refusés par la plateforme. Cela ne constitue pas une panne du bot.

La commande adulte applique des termes interdits et filtre les métadonnées des sources, mais une recherche publique ne peut pas certifier l'âge ou le consentement d'une personne à partir d'une image. Elle doit rester désactivée si l'opérateur ne peut pas garantir un usage réservé à des adultes et conforme aux règles du groupe et de WhatsApp.
