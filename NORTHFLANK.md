# Déployer ᴄᴜʀsɪ愛 gratuitement sur Northflank

Cette version est conçue pour le **Developer Sandbox** de Northflank :

- le service Node.js reste toujours actif;
- la session WhatsApp est stockée dans l'addon PostgreSQL;
- les réglages, groupes et utilisateurs sudo sont également dans PostgreSQL;
- les valeurs sensibles en base sont chiffrées en AES-256-GCM avec `STORAGE_ENCRYPTION_KEY`;
- un redéploiement du conteneur ne nécessite pas un nouveau jumelage.

Documentation Northflank utile :

- [Developer Sandbox](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)
- [Déployer PostgreSQL](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank)
- [Construire et déployer du code](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code)

## 1. Mettre le projet sur GitHub

Crée un dépôt GitHub privé ou public et ajoute le contenu de `nova-md/`.

Ne publie jamais :

- `.env`;
- `.auth/`;
- `data/settings.json`;
- une clé `STORAGE_ENCRYPTION_KEY`;
- un dossier `node_modules/`.

La façon la plus simple est de créer un dépôt vide sur GitHub, puis depuis le terminal du dossier :

```bash
git remote add origin https://github.com/TON-COMPTE/TON-DEPOT.git
git branch -M main
git push -u origin main
```

Si `origin` existe déjà :

```bash
git remote set-url origin https://github.com/TON-COMPTE/TON-DEPOT.git
git push -u origin main
```

## 2. Créer le projet Northflank

1. Connecte-toi sur [Northflank](https://northflank.com/).
2. Crée un projet.
3. Sélectionne **Developer Sandbox**.
4. Choisis une région disponible.

## 3. Créer l'addon PostgreSQL

1. Dans le projet, clique sur **Create new → Addon**.
2. Sélectionne **PostgreSQL**.
3. Nom conseillé : `nova-db`.
4. Choisis le plan gratuit disponible dans le Developer Sandbox.
5. Laisse une seule réplique.
6. Active TLS si Northflank le propose.
7. Ne rends pas la base publiquement accessible : le service et la base sont dans le même projet.
8. Crée l'addon et attends l'état `Running`.

## 4. Créer le service du bot

1. Clique sur **Create new → Combined service**.
2. Connecte ton compte GitHub et sélectionne le dépôt du bot.
3. Branche : `main`.
4. Build type : **Dockerfile**.
5. Dockerfile path : `/Dockerfile`.
6. Deployment plan : plan gratuit du Developer Sandbox.
7. Instances/replicas : **1 uniquement**.
8. Ajoute un port HTTP :
   - nom : `http`;
   - port interne : `3000`;
   - protocole : `HTTP`;
   - public : oui.

Ne lance jamais deux répliques du même `BOT_INSTANCE_ID` : deux connexions simultanées avec la même session WhatsApp peuvent provoquer des déconnexions.

## 5. Créer la clé de chiffrement

Sur ton ordinateur, dans un terminal où Node.js est installé :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copie la valeur affichée. Elle ressemble à une longue chaîne terminée par `=`.

**Conserve cette clé dans un gestionnaire de mots de passe.** Si tu la perds ou la modifies, les données déjà enregistrées dans PostgreSQL ne pourront plus être déchiffrées.

## 6. Créer le Secret Group

1. Clique sur **Create new → Secret group**.
2. Choisis des secrets de type **Runtime environment**.
3. Nom conseillé : `nova-secrets`.
4. Copie les variables de `northflank.env.example` dans l'éditeur ENV.
5. Remplace au minimum (garde ton numéro réel uniquement dans le Secret Group privé) :

```dotenv
BOT_NAME=ᴄᴜʀsɪ愛
OWNER_NAME=ᴄᴜʀsɪ愛
OWNER_NUMBER=24206XXXXXXX
BOT_INSTANCE_ID=principal
STORAGE_ENCRYPTION_KEY=LA_CLE_GENEREE
```

Le numéro doit être international, sans `+`, espace ni tiret.

6. Dans **Linked addons**, sélectionne `nova-db`.
7. Sélectionne la valeur **POSTGRES_URI**.
8. Ajoute-lui exactement l'alias :

```text
DATABASE_URL
```

9. Restreins/applique le Secret Group au service du bot.
10. Vérifie dans l'environnement du service que `DATABASE_URL` est bien héritée.

Ne copie pas l'adresse PostgreSQL dans GitHub et ne l'ajoute pas directement à un fichier.

## 7. Configurer le contrôle de santé

Dans les réglages avancés du service, ajoute une **liveness probe HTTP** :

- port : `3000`;
- chemin : `/health`;
- délai initial : `60` secondes;
- période : `30` secondes;
- délai d'expiration : `5` secondes;
- nombre d'échecs : `5`.

N'utilise pas `/ready` comme liveness probe lors du premier déploiement : `/ready` retourne 503 tant que WhatsApp n'est pas jumelé. `/health` reste volontairement à 200 pendant le jumelage.

## 8. Déployer et jumeler WhatsApp

1. Lance le build et le déploiement.
2. Ouvre les logs du conteneur.
3. Cherche :

```text
CODE DE JUMELAGE : XXXX-XXXX
```

4. Sur WhatsApp :
   - ouvre **Appareils connectés**;
   - sélectionne **Connecter un appareil**;
   - choisis **Connecter avec un numéro de téléphone**;
   - saisis le code.
5. Les logs doivent ensuite afficher que le bot est connecté.
6. Le propriétaire reçoit automatiquement le message **Félicitations**, puis le menu complet correspondant à `.menu`.
7. Envoie `.ping` pour vérifier les réponses.

La session et le marqueur d'accueil sont immédiatement enregistrés dans PostgreSQL. Un redémarrage ou un nouveau build doit réutiliser cette session sans renvoyer l'accueil.

## 9. Vérifier la persistance

Après le premier jumelage :

1. redémarre une fois le service Northflank;
2. vérifie que le bot se reconnecte sans nouveau code;
3. utilise `.mode public`, puis redémarre à nouveau;
4. vérifie avec `.settings` que le mode est resté enregistré.

## 10. Réinitialiser une session déconnectée

Si WhatsApp déconnecte définitivement l'appareil, ouvre le terminal du service et exécute :

```bash
CONFIRM_RESET=yes npm run session:reset
```

Puis redémarre le service. Un nouveau code de jumelage sera généré.

Si tu ne peux pas ouvrir un terminal, crée un **manual job** utilisant le même build, le même Secret Group et cette commande :

```bash
npm run session:reset
```

Ajoute au job :

```dotenv
CONFIRM_RESET=yes
```

Exécute le job une seule fois puis redémarre le service.

## 11. Mettre le bot à jour

Après une modification locale :

```bash
git add .
git commit -m "Mise à jour du bot"
git push
```

Northflank peut reconstruire automatiquement le service. La session restera dans PostgreSQL.

## Dépannage

### `DATABASE_URL ou POSTGRES_URI est requis`

L'addon n'est pas correctement lié. Dans le Secret Group, lie `POSTGRES_URI` et donne-lui l'alias `DATABASE_URL`.

### Erreur TLS PostgreSQL

Si l'URI ne contient pas déjà le mode SSL, essaie :

```dotenv
DATABASE_SSL=require
```

Pour un addon interne créé sans TLS uniquement :

```dotenv
DATABASE_SSL=disable
```

### `Donnée chiffrée invalide` ou erreur d'authentification AES

`STORAGE_ENCRYPTION_KEY` a changé. Restaure exactement la clé utilisée lors du premier déploiement. Ne réinitialise la session que si cette clé est définitivement perdue.

### Aucun code de jumelage

Vérifie :

```dotenv
PAIRING_CODE=true
OWNER_NUMBER=24206XXXXXXX
```

Puis redémarre le service et consulte les nouveaux logs.

### Le conteneur manque de mémoire

Conserve :

```dotenv
NODE_OPTIONS=--max-old-space-size=320
MAX_DOWNLOAD_MB=40
```

Évite plusieurs conversions vidéo simultanées. Si le plan gratuit dispose de moins de mémoire, réduis `MAX_DOWNLOAD_MB` à `20`.

### Le bot redémarre en boucle avant le jumelage

La liveness probe doit utiliser `/health`, pas `/ready`.

## Réactiver une catégorie désactivée

Les catégories à risque sont désactivées au premier lancement. Le propriétaire principal peut les autoriser séparément :

```text
.safety public on CONFIRMER
.safety groups on CONFIRMER
.safety statuses on CONFIRMER
```

Après autorisation, utilise par exemple `.mode public`, `.welcome on` ou `.autoview on`. Pour revenir au profil initial :

```text
.safety strict CONFIRMER
```

Les quotas de commandes, la file d'envoi et le plafond journalier restent actifs dans tous les cas.

## Photo de profil

La photo fournie est intégrée dans `assets/profile.jpg`. Après la première connexion, le bot l'applique automatiquement puis enregistre son empreinte dans PostgreSQL. Elle ne sera renvoyée que si le fichier change.

## Sécurité

- utilise de préférence un numéro WhatsApp dédié;
- garde `MODE=private` pendant les tests;
- ne publie jamais les secrets Northflank;
- ne change pas `BOT_INSTANCE_ID` après le jumelage, sauf pour créer une nouvelle session séparée;
- ne configure qu'une seule instance du service;
- sauvegarde `STORAGE_ENCRYPTION_KEY` hors de Northflank;
- respecte les règles de WhatsApp et évite tout envoi massif.
