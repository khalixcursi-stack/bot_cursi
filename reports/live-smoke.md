# Rapport de test global en direct

- Date : 2026-08-19T14:15:55.915Z
- Version : 0.22.0
- Plateforme : linux-x64
- Résultat : **27/30 tests en direct réussis**

| Domaine | Commande | État | Durée | Résultat |
|---|---|---:|---:|---|
| Recherche en ligne | `.weather` | OK | 1351 ms | 122 caractères |
| Recherche en ligne | `.translate` | OK | 59 ms | 32 caractères |
| Recherche en ligne | `.github` | OK | 174 ms | 133 caractères |
| Recherche en ligne | `.npm` | OK | 190 ms | 101 caractères |
| Recherche en ligne | `.lyrics` | OK | 439 ms | 957 caractères |
| Recherche en ligne | `.define` | OK | 203 ms | 65 caractères |
| Recherche en ligne | `.exchange` | OK | 575 ms | 26 caractères |
| Recherche en ligne | `.bible` | OK | 279 ms | 148 caractères |
| Recherche en ligne | `.joke` | OK | 589 ms | 321 caractères |
| Recherche en ligne | `.advice` | OK | 543 ms | 57 caractères |
| Recherche en ligne | `.images` | OK | 2356 ms | 6463378 octets · image/jpeg |
| Recherche adulte | `.nsfw` | OK | 10801 ms | 420594 octets · image/jpeg |
| Recherche en ligne | `.videos` | ÉCHEC | 4246 ms | Le moteur local a refusé ce média ([youtube] jNQXAC9IVRw: Sign in to confirm you're not a bot.) |
| Téléchargement | `.yts` | OK | 1871 ms | 533 caractères |
| Téléchargement | `.play` | ÉCHEC | 2749 ms | Le moteur local a refusé ce média ([youtube] anti-bot) |
| Téléchargement | `.ytmp4` | ÉCHEC | 1989 ms | Le moteur local a refusé ce média ([youtube] anti-bot) |
| Téléchargement | `.tiktok` | OK | 2422 ms | 621350 octets · video/mp4 |
| Téléchargement | `.instagram` | OK | 2314 ms | 1949801 octets · video/mp4 |
| Téléchargement | `.facebook` | OK | 3476 ms | 12474254 octets · video/mp4 |
| Téléchargement | `.twitter` | OK | 2580 ms | 3491833 octets · video/mp4 |
| Téléchargement | `.alldl` | OK | 2281 ms | 621350 octets · video/mp4 |
| Téléchargement | `.fetchurl` | OK | 185 ms | 26259 octets · image/png |
| Téléchargement | `.gitclone` | OK | 369 ms | 387 octets · application/zip |
| Téléchargement | `.dlstatus` | OK | 958 ms | 571 caractères |
| Anime SFW | `.anime` | OK | 396 ms | 3/3 images |
| Anime SFW | `.waifu` | OK | 1119 ms | 3/3 images |
| Anime SFW | `.neko` | OK | 1310 ms | 3/3 images |
| Anime SFW | `.kitsune` | OK | 786 ms | 3/3 images |
| Anime SFW | `.husbando` | OK | 335 ms | 3/3 images |
| Recherche en ligne | `.stickers` | OK | 7145 ms | 34070 octets |

Les commandes WhatsApp, de groupe, propriétaire, médias et IA sont testées séparément avec des sockets et services simulés par `npm test`.
