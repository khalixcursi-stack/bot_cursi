# ᴄᴜʀsɪㅤ愛

Bot WhatsApp multi-appareils écrit en **Node.js 20+** avec **Baileys**. Le projet est inspiré du type de fonctionnalités proposé par Flash‑MD‑V3, mais son code a été reconstruit avec une architecture indépendante et des choix de sécurité plus stricts.

> Le nom `ᴄᴜʀsɪㅤ愛`, le préfixe et tous les textes principaux sont configurables. Aucun numéro développeur, aucune session WhatsApp et aucune clé API ne sont intégrés au code.

## Fonctionnalités

La version actuelle charge **115 commandes** réparties en modules :

- **Général** : menu, aide, ping, état, uptime, informations, propriétaire, sondages;
- **Groupes** : `.automod`, anti-lien facultatif, bannissement persistant `.ban`, `.unban` et `.banlist`, retrait collectif confirmé `.kickall`, bienvenue/départ, ouverture/fermeture, lien, révocation, mentions, promotion, exclusion, demandes d’adhésion et messages éphémères;
- **Médias** : MP3, découpage et photos de profil;
- **Stickers** : conversion image/vidéo, sticker vers image et recherche `.stickers <nom>`;
- **Anime** : `.anime <titre>` cherche trois affiches correspondantes; `.waifu`, `.neko`, `.kitsune` et `.husbando` cherchent trois images SFW sur Internet;
- **Recherche** : météo, traduction, GitHub, npm, paroles, définition, Bible, devises, livres Open Library (`.livre`), Wikipédia FR (`.wiki`), Hacker News (`.hn`), Stack Overflow (`.stackoverflow`), cours crypto (`.crypto`), YouTube, `.videos <recherche>`, `.images <recherche>` SFW et commande adulte séparée `.nsfw 18+ <recherche>` lorsqu’elle est activée;
- **Téléchargements** : `.play <titre>`, YouTube et réseaux sociaux avec un moteur local yt-dlp sans clé, Cobalt facultatif en repli, diagnostic `.dlstatus`, dépôt GitHub et URL directe protégée;
- **IA** : texte, vision et génération d’image via une API compatible OpenAI facultative;
- **WhatsApp** : profil, bio, confidentialité, blocage, suppression, `.save` et filtre automatique `.delword` par groupe;
- **Propriétaire** : mode privé/public, préfixe, sudo, bot de contrôle WhatsApp avec `.pair`, deux sessions secondaires isolées, automatisations et redémarrage contrôlé.

Chaque commande reconnue reçoit automatiquement `⏳` pendant son traitement, puis `✅` en cas de réussite ou `❌` en cas d’échec.

Les fonctions volontairement exclues sont documentées dans [SECURITY.md](SECURITY.md). Les règles d’utilisation responsable sont détaillées dans **[WHATSAPP_RULES.md](WHATSAPP_RULES.md)**.

## Installation locale

### Prérequis

- Node.js 20 ou plus récent;
- un compte WhatsApp, de préférence dédié au bot;
- un terminal accessible lors du premier jumelage.

### Démarrage

```bash
git clone <URL-DE-TON-DEPOT> nova-md
cd nova-md
npm install
cp .env.example .env
```

Modifie au minimum `.env` :

```dotenv
BOT_NAME=MonBot-MD
OWNER_NAME=Mon nom
OWNER_NUMBER=24206XXXXXXX
PREFIX=.
MODE=private
```

Le numéro doit être au format international, **sans `+`, espace ni tiret**.

Lance ensuite :

```bash
npm start
```

Au premier lancement, le terminal affiche un code. Dans WhatsApp :

1. ouvre **Appareils connectés**;
2. choisis **Connecter un appareil**;
3. choisis **Connecter avec un numéro de téléphone**;
4. saisis le code affiché.

En local, les identifiants de session restent dans `.auth/`, qui est ignoré par Git. **Ne publie jamais ce dossier.** Quand `DATABASE_URL` est définie et que le stockage PostgreSQL est activé, la session et les réglages sont enregistrés dans la base à la place.

## Réglages

| Variable | Défaut | Rôle |
|---|---:|---|
| `BOT_NAME` | `ᴄᴜʀsɪㅤ愛` | Nom affiché |
| `OWNER_NUMBER` | vide | Numéro international du propriétaire |
| `PREFIX` | `.` | Préfixe des commandes |
| `MODE` | `private` | `private` ou `public` |
| `TZ` | `Africa/Brazzaville` | Fuseau horaire |
| `PAIRING_CODE` | `true` | Code numérique; sinon QR dans le terminal |
| `AUTO_READ` | `false` | Lecture automatique des messages |
| `AUTO_VIEW_STATUS` | `false` | Lecture automatique des statuts |
| `AUTO_LIKE_STATUS` | `false` | Réaction automatique aux statuts |
| `ANTICALL` | `false` | Rejet automatique des appels |
| `MAX_DOWNLOAD_MB` | `50` | Taille maximale d’un téléchargement |
| `LOCAL_DOWNLOADER_ENABLED` | `true` | Active yt-dlp local sans clé |
| `LOCAL_DOWNLOAD_TIMEOUT_SECONDS` | `180` | Délai maximal du moteur local |
| `MAX_LINKED_BOTS` | `2` | Nombre maximal de sessions WhatsApp secondaires (0–3) |
| `COBALT_API_URL` | vide | Repli Cobalt auto-hébergé/autorisé |
| `COBALT_API_KEY` | vide | Clé facultative de cette instance Cobalt |
| `YOUTUBE_API_KEY` | vide | Recherche officielle YouTube par titre |
| `YOUTUBE_SEARCH_API_URL` | vide | Repli Invidious/Piped contrôlé par l’opérateur |
| `YOUTUBE_SEARCH_PROVIDER` | `invidious` | `invidious` ou `piped` |
| `ALLOW_RESTART` | `false` | Autorise la commande `restart` |
| `STORAGE_DRIVER` | `auto` | Stockage local ou PostgreSQL |
| `DATABASE_URL` | vide | URI PostgreSQL injectée par Northflank |
| `STORAGE_ENCRYPTION_KEY` | vide | Chiffrement des données PostgreSQL |
| `AUTO_SET_PROFILE_PICTURE` | `true` | Applique `assets/profile.jpg` lorsqu’il change |
| `FIRST_CONNECTION_WELCOME` | `true` | Envoie les félicitations et le menu une seule fois |
| `CLOSED_TEST_MODE` | `false` | Autorise les fonctions optionnelles dans un environnement fermé |
| `NSFW_ENABLED` | `false` | Active la commande adulte séparée `.nsfw` |
| `SAFETY_ENABLED` | `true` | Active les quotas et la file d’envoi |
| `ALLOW_PUBLIC_MODE` | `false` | Verrouille le mode public pendant la phase Baileys |
| `ALLOW_GROUP_AUTOMATION` | `false` | Autorise bienvenue/départ et modération de groupe facultative |
| `ALLOW_STATUS_AUTOMATION` | `false` | Bloque vue et réaction automatiques aux statuts |

Les changements sont enregistrés dans `data/settings.json` en local ou dans PostgreSQL sur Northflank.

## IA facultative

Ajoute une clé et les modèles de ton fournisseur compatible OpenAI :

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=...
AI_MODEL=...
AI_VISION_MODEL=...
AI_IMAGE_MODEL=...
```

Sans clé, le bot fonctionne normalement; seules les trois commandes IA indiquent que le service n’est pas configuré.

## Téléchargements prêts sans clé API

Le moteur local est activé par défaut :

```dotenv
LOCAL_DOWNLOADER_ENABLED=true
LOCAL_DOWNLOAD_TIMEOUT_SECONDS=180
MAX_DOWNLOAD_MB=50
```

L’archive HidenCloud privée contient directement dans `bin/` la version nightly épinglée et vérifiée de **yt-dlp** (`2026.08.16.020253`), puis utilise FFmpeg déjà fourni par le projet. Si le binaire adapté à la plateforme n’est pas fourni, le bot l’installe automatiquement depuis le dépôt officiel dans `data/tools/` au premier usage. Un ancien binaire stable est automatiquement remplacé grâce au marqueur de version et au contrôle SHA-256. Aucune clé YouTube ni URL Cobalt n’est alors nécessaire pour :

```text
.play <titre ou URL YouTube>
.ytmp4 <titre ou URL YouTube>
.yts <recherche>
.videos <recherche>
.alldl <URL>
.tiktok <URL>
.instagram <URL>
.facebook <URL>
.twitter <URL>
```

Lance `.dlstatus` pour exécuter un diagnostic réel du moteur, afficher la version effectivement lancée, la plateforme, la limite, le délai et toute erreur d’exécution. Pour TikTok, le bot essaie d’abord yt-dlp puis utilise automatiquement l’API officielle du lecteur TikTok si l’extracteur est bloqué; les liens complets et courts sont reconnus. Certaines vidéos privées, protégées, payantes, géobloquées ou nécessitant une connexion peuvent rester indisponibles.

`.videos <recherche>` choisit le premier résultat vidéo pertinent et envoie le fichier dans la discussion, pas seulement son URL. `.images <recherche>` utilise Openverse, avec Wikimedia Commons en repli, exclut les recherches explicites et joint le créateur, la licence et le lien source à l’image. Ces deux commandes ne demandent pas de clé API payante.

### Commande adulte séparée

La recherche SFW `.images` reste inchangée. L’opérateur peut activer une commande distincte :

```dotenv
NSFW_ENABLED=true
```

```text
.nsfw 18+ <recherche>
```

Lorsqu’elle est activée, la commande est accessible aux utilisateurs autorisés par le mode général du bot, y compris dans les groupes. Le marqueur `18+` est obligatoire à chaque demande pour éviter un déclenchement accidentel. Le bot envoie une photo JPEG avec sa source et sa licence. Les requêtes impliquant des mineurs, l’absence de consentement, la zoophilie ou d’autres contenus illégaux restent bloquées. L’activation peut exposer le compte à des signalements ou restrictions selon les règles de WhatsApp et celles du groupe.

### Repli Cobalt facultatif

Si l’hébergeur interdit l’exécution d’un binaire ou si une plateforme change son fonctionnement, tu peux ajouter une instance [Cobalt](https://github.com/imputnet/cobalt) que tu contrôles ou que son propriétaire t’autorise explicitement à utiliser :

```dotenv
COBALT_API_URL=https://ton-instance.example
COBALT_API_KEY=
```

`YOUTUBE_API_KEY` ou `YOUTUBE_SEARCH_API_URL` ne sont plus obligatoires; ils servent seulement de solution de recherche supplémentaire si le moteur local est désactivé. Aucune instance publique inconnue n’est codée en dur. Télécharge uniquement les contenus que tu as le droit de conserver et respecte les conditions des plateformes.

## Menus et sous-menus

La commande `.menu` affiche uniquement les catégories. Ouvre ensuite un sous-menu par nom ou par numéro :

```text
.menu general
.menu groupe
.menu whatsapp
.menu media
.menu stickers
.menu telechargement
.menu recherche
.menu ia
.menu anime
.menu outils
.menu finance
.menu fun
.menu proprietaire
```

Les formes `.menu 1`, `.menu 2`, etc. sont également acceptées. La photo, les informations et la liste sont réunies dans **un seul bloc WhatsApp**, comme une carte. Le bouton `Choisir un sous-menu` ouvre les catégories; chaque sous-menu possède ensuite un bouton de commandes et un bouton de retour. Les sous-menus n’affichent plus les descriptions. Si WhatsApp refuse temporairement les boutons natifs, le bot envoie automatiquement la même carte image + texte, toujours en un seul bloc.

## Mode public ou privé

Seul le propriétaire principal peut basculer le mode :

```text
.public CONFIRMER
.private
```

Les variantes `.mode public CONFIRMER` et `.mode private` sont équivalentes. Les quotas anti-rafale restent actifs en mode public.

### Autoriser un utilisateur sudo

```text
.sudo add <numéro|@mention>
.sudo del <numéro|@mention>
.sudo list
```

Lorsqu’une mention WhatsApp fournit un identifiant LID au lieu du téléphone, le bot cherche maintenant le PN correspondant dans les métadonnées du groupe puis dans la table de correspondance Baileys. Seul le véritable numéro international est enregistré. Une ancienne entrée LID correspondant à la mention est supprimée automatiquement. Les messages ultérieurs reconnaissent `participantAlt`; s’il est absent, la table LID → PN est interrogée avant le contrôle d’accès. L’accès sudo fonctionne ainsi dans les groupes utilisant le nouveau mode LID.

## Connexion depuis un numéro WhatsApp de contrôle

Un numéro WhatsApp dédié peut servir de panneau de connexion, comme le bot Telegram indiqué en référence. Ce numéro de contrôle doit être connecté **une seule fois** au serveur par QR ou depuis la console : un compte WhatsApp ne peut pas créer sa toute première session sans ce démarrage initial. Une fois sa session persistée, les autres connexions se font entièrement dans sa discussion WhatsApp, sans retourner au terminal.

Depuis le numéro propriétaire, ouvre le chat privé du bot de contrôle et envoie :

```text
.pair
```

Le bot génère le code numérique dans cette conversation. Sur le téléphone du compte propriétaire : **WhatsApp → Appareils connectés → Connecter un appareil → Connecter avec un numéro de téléphone**, puis saisis le code. Pour connecter un autre numéro autorisé :

```text
.pair 24206XXXXXXX
```

La commande reste réservée au propriétaire principal et refuse les groupes. Une session secondaire ne peut pas créer d’autres sessions. Le bot distingue maintenant le numéro de contrôle connecté de `OWNER_NUMBER`, ce qui permet au numéro propriétaire de devenir lui-même une session secondaire. L’ancien flux confirmé reste disponible :

```text
.pairbot 24206XXXXXXX CONFIRMER
.botsessions
.unpairbot <identifiant-ou-numéro> CONFIRMER
```

Chaque session possède son authentification et ses réglages sous `data/linked-bots/`, redémarre automatiquement après un redéploiement et ne partage jamais les identifiants du numéro de contrôle. Le numéro connecté devient propriétaire de sa session; le propriétaire principal reçoit aussi les droits sudo lorsque les deux numéros diffèrent. Chaque session consomme de la mémoire, donc `MAX_LINKED_BOTS=2` reste la limite livrée pour HidenCloud.

## Profil fermé et modération des groupes

Le profil personnel livré utilise `CLOSED_TEST_MODE=true` : le mode public et les automatisations facultatives peuvent être activés sans être bloqués par les anciens verrous persistants. Les limites ont été relevées pour les essais avec les deux numéros, tout en gardant un plafond fini contre une boucle accidentelle.

Les commandes de modération de groupe sont conservées :

```text
.automod status
.automod off
.automod on
.antilink off|warn|delete|kick
```

La modération reste désactivable groupe par groupe. Les commandes manuelles d’administration restent disponibles.

### Retrait collectif

`.kickall` prépare le retrait de tous les membres ordinaires et affiche d’abord le nombre de personnes concernées. L’action destructive ne démarre qu’avec :

```text
.kickall CONFIRMER
```

Tous les administrateurs, le propriétaire du groupe, le propriétaire principal et le bot sont conservés. Les retraits sont envoyés par petits lots avec une limite finie de 1 000 membres par exécution. Le bot doit être administrateur et seul un administrateur du groupe peut lancer cette commande. Contrairement à `.ban`, les personnes retirées par `.kickall` ne sont pas ajoutées à la liste de bannissement.

### Bannissement persistant

Lorsque le bot est administrateur et que les automatisations de groupe sont autorisées :

```text
.ban <@mention|numéro>
.unban <@mention|numéro>
.banlist
```

`.ban` retire immédiatement le membre s’il est présent, puis conserve son identité dans la liste persistante du groupe. S’il revient par un nouveau lien ou une nouvelle invitation, le bot le retire automatiquement. `.unban` autorise à nouveau son retour. La liste est limitée à 100 membres par groupe; seuls les administrateurs peuvent la gérer. Le propriétaire principal, le bot, l’administrateur qui lance la commande et le propriétaire du groupe sont protégés.

### Suppression automatique par mot entier

Dans un groupe où le bot est administrateur :

```text
.delword add mot
.delword remove mot
.delword list
.delword clear CONFIRMER
```

Seuls les administrateurs peuvent modifier la liste. Après `.delword add test`, tout **nouveau** message d’un membre contenant le mot entier `test` est supprimé; `testament` n’est pas concerné. La comparaison ignore les majuscules/minuscules et prend en charge les accents. Les propriétaires et administrateurs sont exemptés afin de pouvoir gérer la liste. Maximum : 50 mots persistants par groupe.

## Commande `.save`

`.vv` a été supprimée. Réponds désormais à un texte ou média avec `.save` : le contenu est envoyé dans la conversation personnelle du numéro propriétaire, jamais republié dans le groupe courant. Dans l’environnement de test fermé et autorisé décrit par le propriétaire, la même commande sauvegarde aussi la photo ou vidéo en vue unique envoyée par le second numéro. N’utilise pas ce comportement sur les contenus de tiers sans leur accord.

## Protection d’utilisation responsable

La phase Baileys reste en mode privé et applique par défaut :

- quotas par utilisateur et par discussion;
- file d’envoi temporisée sans rafales;
- plafond de 300 messages sortants par jour;
- blocage du mode public;
- blocage des messages automatiques de groupes et de statuts;
- absence de broadcast et de notification de démarrage;
- une seule instance par session.

Utilise `.safety` pour consulter les compteurs. Le propriétaire principal peut réactiver une catégorie avec `.safety public|groups|statuses on CONFIRMER`, puis revenir au profil strict avec `.safety strict CONFIRMER`. Les quotas anti-rafale restent toujours actifs. Ces protections ne rendent pas le client non officiel conforme et ne garantissent pas l’absence de restriction. Consulte [WHATSAPP_RULES.md](WHATSAPP_RULES.md).

## Photo de profil

Place une image JPG, PNG ou WebP dans :

```text
assets/profile.jpg
```

Au prochain démarrage, le bot la recadre en 640 × 640, met à jour le profil puis mémorise son empreinte dans le stockage. Il ne répète l’opération que lorsque le fichier change. La commande `.menu` utilise cette même photo comme en-tête de sa carte interactive; le texte et les boutons restent attachés au même message.

## Première connexion

Après le premier jumelage réussi, le propriétaire reçoit automatiquement :

1. un message de félicitations confirmant la connexion et le stockage de la session;
2. le rendu complet de la commande `.menu`.

L’accueil est enregistré par compte et ne se répète pas à chaque reconnexion. Il peut être désactivé avec `FIRST_CONNECTION_WELCOME=false`.

## Mise à jour HidenCloud sans perdre la session

Arrête le service, remplace uniquement les fichiers de l’application avec l’archive de version, puis redémarre. **Ne supprime jamais** `.auth/` ni `data/`, notamment `data/linked-bots/` qui contient les sessions secondaires. L’archive standard créée depuis Git ne contient ni session ni secret. L’archive personnalisée `-prive.zip`, lorsqu’elle est demandée, contient aussi le `.env` personnel prêt à l’emploi et ne doit jamais être partagée. La v0.22.0 garde les réactions de commandes actives dans le code; un ancien `COMMAND_REACTIONS=false` reste sans effet.

## Northflank Developer Sandbox

L’authentification WhatsApp et les réglages sont persistés dans l’addon PostgreSQL et peuvent être chiffrés avec AES-256-GCM. Consulte le guide complet **[NORTHFLANK.md](NORTHFLANK.md)**.

Sur Northflank, lie `POSTGRES_URI` de l’addon avec l’alias `DATABASE_URL` dans un Secret Group.

## Docker

```bash
docker compose up -d --build
```

Le fichier `docker-compose.yml` conserve `.auth` et `data` dans des volumes locaux. Sur Northflank, PostgreSQL remplace ces volumes pour les données importantes.

## Vérifications

```bash
npm test
npm run check
npm run smoke:live
```

`npm test` simule notamment une conversation WhatsApp, les actions de groupe/propriétaire, les médias FFmpeg/Sharp et une API IA locale. `npm run check` valide les modules et cherche notamment une session intégrée, `eval`, `Function` dynamique ou une commande shell. `npm run smoke:live` vérifie en direct les recherches, tous les téléchargeurs, Anime et stickers, puis produit `reports/live-smoke.md`.

## API de santé

- `GET /` : nom, version, état et nombre de commandes;
- `GET /health` : liveness HTTP 200 tant que le processus fonctionne, y compris pendant le jumelage;
- `GET /ready` : HTTP 200 quand WhatsApp est connecté, 503 sinon.

## Avertissement

Baileys utilise le protocole WhatsApp Web et n’est pas l’API officielle WhatsApp Business. Une automatisation abusive peut provoquer des limitations ou un bannissement. N’utilise pas ce projet pour le spam, le harcèlement, la collecte non consentie ou le contournement des règles de WhatsApp.

## Licence

MIT — voir [LICENSE](LICENSE).
