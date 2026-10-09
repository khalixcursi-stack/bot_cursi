import { UserError, asUserError } from '../core/errors.js'
import { cobaltDownload, downloaderReadiness } from '../services/downloader.js'
import { fetchExternalBuffer } from '../services/http.js'
import { localDownload, localDownloaderDiagnostics, localDownloaderInfo } from '../services/local-downloader.js'
import { isTikTokLink, tiktokOfficialDownload } from '../services/tiktok.js'
import { isYouTubeUrl, resolveYouTube, searchYouTube, youtubeSearchMode } from '../services/youtube.js'
import { formatBytes } from '../utils/format.js'

async function sendDownload(ctx, file, caption = '', forceAudio = false) {
  const mime = file.contentType || 'application/octet-stream'
  if (forceAudio || mime.startsWith('audio/')) {
    return ctx.send({ audio: file.buffer, mimetype: mime.startsWith('audio/') ? mime : 'audio/mpeg', fileName: file.filename })
  }
  if (mime.startsWith('video/')) return ctx.send({ video: file.buffer, mimetype: mime, caption })
  if (mime.startsWith('image/')) return ctx.send({ image: file.buffer, mimetype: mime, caption })
  return ctx.send({ document: file.buffer, mimetype: mime, fileName: file.filename, caption })
}

function ready(value) {
  return value ? '✅ prêt' : '❌ à configurer'
}

export async function downloadWithFallback(ctx, input, mode, { youtube = false } = {}) {
  const value = String(input || '').trim()
  const isUrl = /^https?:\/\//i.test(value)
  if (youtube && isUrl && !isYouTubeUrl(value)) {
    throw new UserError('Cette commande accepte uniquement un titre ou une URL YouTube.')
  }

  let localError
  if (ctx.config.localDownloaderEnabled) {
    try {
      return await localDownload(ctx.config, value, mode, { youtubeSearch: youtube && !isUrl })
    } catch (error) {
      localError = error
      ctx.logger.warn({ err: error, mode }, 'Téléchargeur local indisponible; essai du repli Cobalt')
    }
  }

  if (isUrl && mode === 'auto' && isTikTokLink(value)) {
    try {
      return await tiktokOfficialDownload(ctx.config, value)
    } catch (error) {
      localError = error
      ctx.logger.warn({ err: error }, 'Repli officiel TikTok indisponible; essai de Cobalt')
    }
  }

  if (ctx.config.cobaltApiUrl) {
    let url = value
    if (youtube && !isUrl) {
      // Évite de relancer yt-dlp après son échec : le repli Cobalt utilise uniquement
      // la clé YouTube ou le fournisseur de recherche explicitement configuré.
      url = await resolveYouTube({ ...ctx.config, localDownloaderEnabled: false }, value)
    }
    return cobaltDownload(ctx.config, url, mode === 'video' ? 'auto' : mode)
  }
  if (localError) throw localError
  return cobaltDownload(ctx.config, value, mode)
}

function socialCommand(name, aliases, label) {
  return {
    name, aliases, category: 'Téléchargement', usage: '<URL>', cooldown: 12,
    description: `Télécharge un média ${label} avec le moteur local ou Cobalt en repli.`,
    async run(ctx) {
      if (!/^https?:\/\//i.test(ctx.text)) throw new UserError('Indiquez une URL HTTP(S) complète.')
      const file = await downloadWithFallback(ctx, ctx.text, 'auto')
      await sendDownload(ctx, file, `⬇️ ${label} · ${formatBytes(file.buffer.length)}`)
    }
  }
}

export default [
  socialCommand('alldl', ['download', 'dl'], 'social'),
  socialCommand('tiktok', ['tk', 'tiktokdl'], 'TikTok'),
  socialCommand('instagram', ['insta', 'ig', 'igdl'], 'Instagram'),
  socialCommand('facebook', ['fb', 'fbdl'], 'Facebook'),
  socialCommand('twitter', ['x', 'tw', 'xdl'], 'X/Twitter'),
  {
    name: 'dlstatus', aliases: ['downloadstatus', 'dlconfig'], category: 'Téléchargement',
    description: 'Vérifie la configuration des téléchargements sans afficher les secrets.', cooldown: 3,
    async run(ctx) {
      const state = downloaderReadiness(ctx.config)
      const local = localDownloaderInfo(ctx.config)
      let diagnostics = null
      let diagnosticError = ''
      if (state.local) {
        try {
          diagnostics = await localDownloaderDiagnostics(ctx.config)
        } catch (error) {
          diagnosticError = String(error.message || error).slice(0, 220)
        }
      }
      const localReady = state.local && Boolean(diagnostics)
      await ctx.reply([
        '⬇️ *État des téléchargements*',
        `Moteur local ${local.version} : ${ready(localReady)}`,
        `Version exécutée : ${diagnostics?.reportedVersion || 'indisponible'}`,
        `Plateforme : ${local.platform}`,
        `Cobalt (repli facultatif) : ${state.cobalt ? '✅ configuré' : '➖ non configuré'}${ctx.config.cobaltApiKey ? ' · clé API présente' : ''}`,
        `Recherche YouTube : ${youtubeSearchMode(ctx.config)}`,
        `YouTube par URL : ${ready(localReady || state.cobalt)}`,
        `YouTube par titre (.play/.ytmp4) : ${ready(localReady || (state.cobalt && state.search))}`,
        `Réseaux sociaux : ${ready(localReady || state.cobalt)}`,
        diagnosticError ? `Erreur locale : ${diagnosticError}` : '',
        `Limite par fichier : ${formatBytes(ctx.config.maxDownloadBytes)}`,
        `Délai maximal : ${Math.round(ctx.config.localDownloadTimeoutMs / 1000)} s`,
        '',
        localReady
          ? 'Le moteur vérifié est exécutable; aucune clé n’est nécessaire.'
          : state.local
            ? 'Le moteur est activé mais son diagnostic a échoué; vérifiez la ligne Erreur locale ci-dessus.'
            : 'Activez LOCAL_DOWNLOADER_ENABLED=true ou configurez une instance Cobalt autorisée.',
        state.cobalt
          ? 'Cobalt sera essayé si le moteur local échoue.'
          : 'COBALT_API_URL reste facultatif lorsque le moteur local est actif.',
        '_Téléchargez uniquement les contenus que vous avez le droit de conserver._'
      ].join('\n'))
    }
  },
  {
    name: 'yts', aliases: ['ytsearch'], category: 'Recherche', usage: '<recherche>',
    description: 'Recherche des vidéos YouTube via le fournisseur configuré.', cooldown: 6,
    async run(ctx) {
      if (!ctx.text) throw new UserError('Indiquez une recherche YouTube.')
      const videos = await searchYouTube(ctx.config, ctx.text)
      if (!videos.length) throw new UserError('Aucun résultat YouTube trouvé.')
      await ctx.reply(videos.map((video, index) => [
        `*${index + 1}. ${video.title}*`,
        video.author || 'Chaîne inconnue',
        video.url
      ].join('\n')).join('\n\n'))
    }
  },
  {
    name: 'play', aliases: ['ytmp3', 'mp3'], category: 'Téléchargement', usage: '<titre ou URL YouTube>',
    description: 'Trouve un titre puis télécharge son audio avec le moteur local, sans clé obligatoire.', cooldown: 15,
    async run(ctx) {
      if (!ctx.text) throw new UserError('Indiquez un titre ou une URL YouTube.')
      const file = await downloadWithFallback(ctx, ctx.text, 'audio', { youtube: true })
      await sendDownload(ctx, file, '', true)
    }
  },
  {
    name: 'ytmp4', aliases: ['ytvideo'], category: 'Téléchargement', usage: '<titre ou URL YouTube>',
    description: 'Trouve un titre puis télécharge sa vidéo avec le moteur local, sans clé obligatoire.', cooldown: 15,
    async run(ctx) {
      if (!ctx.text) throw new UserError('Indiquez un titre ou une URL YouTube.')
      const file = await downloadWithFallback(ctx, ctx.text, 'video', { youtube: true })
      await sendDownload(ctx, file, `▶️ ${ctx.text}`)
    }
  },
  {
    name: 'gitclone', aliases: ['gitzip'], category: 'Téléchargement', usage: '<URL GitHub>',
    description: 'Télécharge un dépôt GitHub public en ZIP.', cooldown: 10,
    async run(ctx) {
      const match = ctx.text.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)
      if (!match) throw new UserError('Indiquez une URL complète de dépôt GitHub public.')
      const [, owner, rawRepo] = match
      const repo = rawRepo.replace(/\.git$/i, '')
      try {
        const file = await fetchExternalBuffer(`https://api.github.com/repos/${owner}/${repo}/zipball`, {
          maxBytes: ctx.config.maxDownloadBytes,
          headers: { accept: 'application/vnd.github+json' }
        })
        await ctx.send({ document: file.buffer, mimetype: 'application/zip', fileName: `${owner}-${repo}.zip`, caption: `📦 ${owner}/${repo}` })
      } catch (error) {
        throw asUserError(error, 'Le dépôt GitHub n’a pas pu être téléchargé')
      }
    }
  },
  {
    name: 'fetchurl', aliases: ['fetch'], category: 'Téléchargement', ownerOnly: true, usage: '<URL directe>',
    description: 'Télécharge une URL HTTP(S) avec protection SSRF et limite de taille.', cooldown: 5,
    async run(ctx) {
      if (!ctx.text) throw new UserError('Indiquez une URL HTTP(S) directe.')
      try {
        const file = await fetchExternalBuffer(ctx.text, { maxBytes: ctx.config.maxDownloadBytes })
        await sendDownload(ctx, file, `📎 ${file.filename} · ${formatBytes(file.buffer.length)}`)
      } catch (error) {
        throw asUserError(error, 'Cette URL n’a pas pu être téléchargée')
      }
    }
  }
]
