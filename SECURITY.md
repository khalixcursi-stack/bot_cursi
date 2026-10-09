# Sécurité

&gt; Baileys n'est pas l'API officielle WhatsApp. Les garde-fous réduisent les comportements abusifs mais ne garantissent pas la conformité ni l'absence de restriction. Voir [WHATSAPP_RULES.md](WHATSAPP_RULES.md).

## Principes du projet

- aucun identifiant WhatsApp ou secret fourni par défaut;
- aucun numéro développeur privilégié;
- aucune commande `eval`, `exec`, shell ou exécution distante;
- jumelage local, sans service tiers de génération de session;
- mode privé par défaut;
- commandes sensibles réservées au propriétaire;
- téléchargements directs limités en taille avec filtrage des réseaux privés;
- clés API chargées uniquement depuis les variables d'environnement;
- automatisations intrusives désactivées par défaut;
- prise en charge de PostgreSQL pour les plateformes à disque éphémère;
- chiffrement applicatif AES-256-GCM facultatif des sessions et réglages PostgreSQL.

## Différences volontaires avec le dépôt de référence

L'examen statique du dépôt Flash‑MD‑V3 fourni a montré des éléments incompatibles avec ces objectifs :

1. une session WhatsApp était codée en dur comme valeur par défaut;
2. certains numéros développeur recevaient des privilèges supplémentaires;
3. des commandes permettaient d'exécuter JavaScript ou des commandes système;
4. de nombreuses fonctions dépendaient d'API tierces non authentifiées et difficiles à auditer;
5. le manifeste déclarait MIT alors que le fichier de licence contenait GPL‑3.0.

Aucun de ces éléments n'a été recopié.

## Fonctions non incluses

- **révélation de médias "vue unique"** : respecte l'intention de confidentialité de l'expéditeur;
- **anti-suppression généralisée** : peut conserver du contenu retiré par son auteur;
- **exec/eval** : donne le contrôle complet du serveur à distance;
- **kickall et diffusion massive** : trop faciles à déclencher par erreur ou à utiliser pour du spam;
- **session partagée/base64 dans `.env`** : un dossier `.auth` local est utilisé à la place.

## Bonnes pratiques de déploiement

1. utilise un numéro dédié;
2. garde `MODE=private` pendant les tests;
3. ne publie jamais `.env`, `.auth/` ou `data/settings.json`;
4. monte `.auth/` et `data/` sur un volume persistant;
5. limite les personnes ajoutées avec `.sudo`;
6. renouvelle immédiatement la session WhatsApp si le dossier `.auth/` est divulgué;
7. utilise une instance Cobalt de confiance;
8. applique régulièrement les mises à jour après test;
9. sur Northflank, conserve `STORAGE_ENCRYPTION_KEY` dans un Secret Group et dans un gestionnaire de mots de passe;
10. ne lance jamais plusieurs répliques avec le même `BOT_INSTANCE_ID`.

## Signaler un problème

Ne publie jamais de clé, numéro complet ou contenu du dossier `.auth` dans un rapport. Décris la version, la commande concernée et les étapes permettant de reproduire le problème.
