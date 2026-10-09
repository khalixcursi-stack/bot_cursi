# Photo de profil

Placez la photo carrée préparée dans ce dossier sous le nom :

```text
profile.jpg
```

Au prochain démarrage, le bot la recadre en 640 × 640, met à jour le profil WhatsApp une seule fois, puis conserve son empreinte dans le stockage local ou PostgreSQL.

Le chemin peut être changé avec `PROFILE_PICTURE_PATH` et la mise à jour automatique désactivée avec `AUTO_SET_PROFILE_PICTURE=false`.
