# Règles d'utilisation responsable de ᴄᴜʀsɪ愛

## Limite importante

Cette version utilise Baileys, un client non officiel du protocole WhatsApp Web. Les protections ci-dessous réduisent les comportements à risque, mais **ne rendent pas Baileys officiellement autorisé et ne garantissent jamais l'absence de restriction ou de bannissement**.

Pour une conformité maximale, la cible finale est une migration vers la [WhatsApp Business Platform](https://business.whatsapp.com/products/business-platform).

Références officielles :

- [Conditions d'utilisation de WhatsApp](https://www.whatsapp.com/legal/terms-of-service)
- [Règles de messagerie WhatsApp](https://www.whatsapp.com/legal/messaging-guidelines)
- [Utiliser WhatsApp de façon responsable](https://faq.whatsapp.com/361005896189245/)
- [Politique de messagerie WhatsApp Business](https://business.whatsapp.com/policy)

## Règles obligatoires

1. **Pas de messages non sollicités.** Le bot répond uniquement à une commande reçue ou à une action explicitement configurée par un administrateur.
2. **Pas de diffusion massive.** Aucune commande de broadcast, kickall ou envoi à une liste de numéros n'est incluse.
3. **Pas de collecte de contacts.** Ne pas exporter, acheter, aspirer ou réutiliser des numéros, photos, statuts ou données personnelles sans autorisation.
4. **Consentement préalable.** Toute personne contactée doit avoir donné son numéro et accepté de recevoir les catégories de messages prévues.
5. **Respect immédiat du refus.** Si une personne demande l'arrêt, ne plus lui envoyer de message; la bloquer/supprimer des listes si nécessaire.
6. **Pas d'usurpation ni de tromperie.** Le nom, la photo et la description du bot doivent identifier clairement son propriétaire ou son organisation.
7. **Pas de contenu illégal, frauduleux, harcelant, haineux ou trompeur.**
8. **Pas de contournement des protections WhatsApp.** Ne pas chercher à masquer l'automatisation, falsifier des appareils, résoudre automatiquement des restrictions ou contourner des limites.
9. **Une seule instance.** Une seule réplique Northflank doit utiliser un `BOT_INSTANCE_ID` donné.
10. **Numéro dédié recommandé.** Ne pas tester avec un numéro personnel indispensable.
11. **Mode privé par défaut.** `MODE=private` et `ALLOW_PUBLIC_MODE=false` restent les réglages normaux.
12. **Automatisations contrôlées.** Les vues/réactions aux statuts, messages de bienvenue/départ et anti-lien restent facultatifs et doivent être activés explicitement dans les environnements concernés.

## Limites techniques internes

Ces limites sont des garde-fous conservateurs du projet; **ce ne sont pas des seuils publiés par WhatsApp** :

- 6 commandes par utilisateur et par minute;
- 12 commandes par chat et par minute;
- 20 messages sortants par minute au total;
- 8 messages sortants par minute dans un même chat;
- au moins 1,1 seconde entre deux envois globaux;
- au moins 1,8 seconde entre deux envois dans un même chat;
- 300 messages sortants maximum par jour;
- file d'attente limitée à 50 messages.

Le bot ralentit les envois au lieu de créer des rafales. Une fois la limite journalière atteinte, il cesse d'émettre jusqu'au jour suivant.

## Activation contrôlée des fonctions optionnelles

Seul le propriétaire principal peut modifier ces autorisations, avec le mot de confirmation explicite :

```text
.safety public on CONFIRMER
.safety groups on CONFIRMER
.safety statuses on CONFIRMER
```

Ensuite, les fonctions concernées peuvent être activées normalement, par exemple `.mode public`, `.welcome on` ou `.autoview on`. Pour les désactiver :

```text
.safety public off
.safety groups off
.safety statuses off
```

Pour revenir immédiatement au profil le plus strict :

```text
.safety strict CONFIRMER
```

La commande `.safety` ne permet jamais de désactiver les quotas anti-rafale, la file d'envoi ou le plafond journalier. Les réactions `⏳`, `✅` et `❌` des commandes passent par la même file d'envoi protégée.

## Configuration stricte recommandée

```dotenv
MODE=private
ALLOW_PUBLIC_MODE=false
ALLOW_GROUP_AUTOMATION=false
ALLOW_STATUS_AUTOMATION=false
STARTUP_NOTIFICATION=false
SAFETY_ENABLED=true

SAFETY_COMMANDS_PER_USER_MINUTE=6
SAFETY_COMMANDS_PER_CHAT_MINUTE=12
SAFETY_COMMAND_BLOCK_SECONDS=60
SAFETY_OUTGOING_MIN_INTERVAL_MS=1100
SAFETY_OUTGOING_CHAT_INTERVAL_MS=1800
SAFETY_OUTGOING_PER_MINUTE=20
SAFETY_OUTGOING_PER_CHAT_MINUTE=8
SAFETY_OUTGOING_PER_DAY=300
SAFETY_MAX_QUEUE=50
```

## Quand migrer vers l'API officielle

La migration devient nécessaire si le bot doit :

- répondre à des clients réels;
- fonctionner pour une entreprise;
- initier des conversations;
- envoyer des notifications ou confirmations;
- traiter un volume important;
- être exploité par plusieurs personnes;
- nécessiter une conformité contractuelle stricte.

L'API officielle imposera notamment le consentement, les modèles approuvés pour certaines conversations initiées par l'entreprise et une fenêtre de service client. Plusieurs fonctions liées aux groupes ou au profil d'un compte personnel ne seront alors plus disponibles.
