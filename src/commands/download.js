import { UserError, asUserError } from '../core/errors.js'
import { cobaltDownload, downloaderReadiness, invidiousAudioDownload, isNoVideoError, probeCobaltInstances } from '../services/downloader.js'
import { fetchExternalBuffer } from '../services/http.js'
import { localDownload, localDownloaderDiagnostics, localDownloaderInfo } from '../services/local-downloader.js'
import { isTikTokLink, tiktokOfficialDownload } from '../services/tiktok.js'
import { isYouTubeUrl, searchYouTube, youtubeSearchMode } from '../services/youtube.js'
import { formatBytes, truncate } from '../utils/format.js'
import { decodeMediaUrl } from '../utils/html.js'

async function sendDownload(ctx, file, caption = '', forceAudio = false) {
  if (Array.isArray(file)) {
    for (const [index, media] of file.entries()) {
      await sendDownload(ctx, media, [caption, `📎 ${index + 1}/${file.length}`].filter(Boolean).join('\n'), forceAudio)
    }
    return
  }
  if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length) throw new UserError('Aucun média valide à envoyer.')
  const mime = file.contentType || 'application/octet-stream'
  if (forceAudio || mime.startsWith('audio/')) {
    return ctx.send({ audio: file.buffer, mimetype: mime.startsWith('audio/') ? mime : 'audio/mpeg', fileName: file.filename })
  }
  if (mime.startsWith('video/')) return ctx.send({ video: file.buffer, mimetype: mime, caption })
  if (mime.startsWith('image/')) return ctx.send({ image: file.buffer, mimetype: mime, caption })
  return ctx.send({ document: file.buffer, mimetype: mime, fileName: file.filename, caption })
}

const DIRECT_PAGE_HOSTS = ['instagram.com', 'facebook.com', 'fb.watch', 'pinterest.com', 'pin.it']

function supportsDirectPage(input) {
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) && DIRECT_PAGE_HOSTS.some(host =>
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    )
  } catch {
    return false
  }
}

function openGraphMedia(html, pageUrl) {
  const videos = []
  const images = []
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = {}
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4]
    }
    const property = String(attributes.property || attributes.name || '').toLowerCase()
    const kind = /^og:video(?::(?:url|secure_url))?$/.test(property) ? 'video'
      : /^og:image(?::(?:url|secure_url))?$/.test(property) ? 'image' : ''
    if (!kind || !attributes.content) continue
    try {
      const url = new URL(decodeMediaUrl(attributes.content), pageUrl)
      if (['http:', 'https:'].includes(url.protocol)) (kind === 'video' ? videos : images).push({ url: url.toString(), kind })
    } catch {
      // Une balise mal formée ne bloque pas les suivantes.
    }
  }
  const seen = new Set()
  return [...videos, ...images].filter(item => !seen.has(item.url) && seen.add(item.url))
}

// Dernier repli pour les publications publiques photo/vidéo. La page ET les
// URL des médias sont récupérées par http.js (SSRF, redirections, délai, taille).
export async function tryDirectImageDownload(config, input, mode = 'auto') {
  if (mode === 'audio' || !supportsDirectPage(input)) return null
  const page = await fetchExternalBuffer(input, {
    maxBytes: 2 * 1024 * 1024, timeout: 20_000, allowedHosts: DIRECT_PAGE_HOSTS,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; CURSI-MD)', accept: 'text/html,application/xhtml+xml' }
  })
  const candidates = openGraphMedia(page.buffer.toString('utf8'), page.finalUrl)
  let lastError
  for (const candidate of candidates) {
    try {
      const file = await fetchExternalBuffer(candidate.url, {
        maxBytes: config.maxDownloadBytes, timeout: 60_000, headers: { referer: page.finalUrl }
      })
      if (!file.buffer.length || !file.contentType.startsWith(`${candidate.kind}/`) || file.contentType === 'image/svg+xml') {
        throw new Error('La balise Open Graph ne contient pas de média exploitable.')
      }
      return { ...file, engine: 'open-graph-direct' }
    } catch (error) {
      lastError = error
    }
  }
  throw asUserError(lastError, 'Aucun média public og:image/og:video trouvé sur cette page')
}

function ready(value) {
  return value ? '✅ prêt' : '❌ à configurer'
}

// Chaîne de téléchargement : moteur local → TikTok officiel → instances Cobalt
// → Invidious (audio YouTube) → Open Graph (photos/vidéos sociales).
// Un post sans vidéo passe immédiatement au repli photo; un échec n'est pas fatal.
export async function downloadWithFallback(ctx, input, mode, { youtube = false } = {}) {
  const value = String(input || '').trim()
  const isUrl = /^https?:\/\//i.test(value)
  if (youtube && isUrl && !isYouTubeUrl(value)) {
    throw new UserError('Cette commande accepte uniquement un titre ou une URL YouTube.')
  }

  const failures = []
  let directAttempted = false
  async function directFallback() {
    if (directAttempted || mode === 'audio' || !supportsDirectPage(value)) return null
    directAttempted = true
    try {
      return await tryDirectImageDownload(ctx.config, value, mode)
    } catch (error) {
      failures.push(`Open Graph : ${truncate(error.message || error, 140)}`)
      ctx.logger?.warn?.({ err: error }, 'Repli direct Open Graph indisponible; poursuite des replis')
      return null
    }
  }

  if (ctx.config.localDownloaderEnabled) {
    try {
      return await localDownload(ctx.config, value, mode, { youtubeSearch: youtube && !isUrl, logger: ctx.logger })
    } catch (error) {
      failures.push(`moteur local : ${truncate(error.message || error, 140)}`)
      ctx.logger?.warn?.({ err: error, mode }, 'Téléchargeur local indisponible; essai des replis')
      if (isNoVideoError(error)) {
        const photo = await directFallback()
        if (photo) return photo
      }
    }
  }

  if (isUrl && isTikTokLink(value)) {
    try {
      return await tiktokOfficialDownload(ctx.config, value, mode)
    } catch (error) {
      failures.push(`TikTok : ${truncate(error.message || error, 140)}`)
      ctx.logger?.warn?.({ err: error }, 'Repli officiel TikTok indisponible; essai de Cobalt')
    }
  }

  let targetUrl = value
  if (youtube && !isUrl) {
    // Les replis suivants ont besoin d’une URL : la recherche YouTube embarque
    // son propre repli Invidious lorsque le moteur local est indisponible.
    try {
      const [video] = await searchYouTube(ctx.config, value)
      if (video?.url) targetUrl = video.url
      else failures.push('recherche YouTube : aucun résultat')
    } catch (error) {
      failures.push(`recherche YouTube : ${truncate(error.message || error, 140)}`)
    }
  }

  if (/^https?:\/\//i.test(targetUrl)) {
    try {
      return await cobaltDownload(ctx.config, targetUrl, mode === 'video' ? 'auto' : mode)
    } catch (error) {
      failures.push(`cobalt : ${truncate(error.message || error, 140)}`)
      ctx.logger?.warn?.({ err: error }, 'Repli Cobalt indisponible')
    }

    if (mode === 'audio' && isYouTubeUrl(targetUrl)) {
      try {
        return await invidiousAudioDownload(ctx.config, targetUrl, { instances: ctx.config.invidiousInstances })
      } catch (error) {
        failures.push(`invidious : ${truncate(error.message || error, 140)}`)
        ctx.logger?.warn?.({ err: error }, 'Repli audio Invidious indisponible')
      }
    }
  }

  const direct = await directFallback()
  if (direct) return direct

  throw new UserError([
    'Téléchargement impossible malgré tous les replis (moteur local, TikTok, Cobalt, Invidious, Open Graph).',
    ...failures.slice(0, 5).map(failure => `• ${failure}`),
    'Réessaie dans un instant ou consulte .dlstatus.'
  ].join('\n'))
}

function socialCommand(name, aliases, label) {
  return {
    name, aliases, category: 'Téléchargement', usage: '<URL>', cooldown: 12,
    description: `Télécharge les médias ${label} avec le moteur local ou les replis Cobalt/Open Graph.`,
    async run(ctx) {
      if (!/^https?:\/\//i.test(ctx.text)) throw new UserError('Indiquez une URL HTTP(S) complète.')
      const file = await downloadWithFallback(ctx, ctx.text, 'auto')
      await sendDownload(ctx, file, `⬇️ ${label} · ${formatBytes((Array.isArray(file) ? file : [file]).reduce((total, item) => total + item.buffer.length, 0))}`)
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
    description: 'Vérifie tous les moteurs de téléchargement et leur disponibilité réelle.', cooldown: 3,
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
      const probes = await probeCobaltInstances(ctx.config).catch(() => [])
      const cobaltOk = probes.filter(probe => probe.status !== 'down')
      const probeLines = probes.slice(0, 8).map(probe => {
        const icon = probe.status === 'ok' ? '✅' : probe.status === 'reachable' ? '⚠️' : '❌'
        return `  ${icon} ${probe.hostname} — ${probe.detail}`
      })
      const functional = localReady || cobaltOk.length > 0

      await ctx.reply([
        '⬇️ *État des téléchargements*',
        `Moteur local ${local.version} : ${ready(localReady)}`,
        `Version exécutée : ${diagnostics?.reportedVersion || 'indisponible'}`,
        `Plateforme : ${local.platform}`,
        `Cobalt : ${probes.length} instance(s) testée(s), ${cobaltOk.length} utilisable(s)${ctx.config.cobaltApiKey ? ' · clé API présente' : ''}`,
        ...probeLines,
        `Recherche YouTube : ${youtubeSearchMode(ctx.config)}`,
        `YouTube par URL : ${ready(localReady || cobaltOk.length > 0)}`,
        `YouTube par titre (.play/.ytmp4) : ${ready(localReady || cobaltOk.length > 0 || state.search)}`,
        `Réseaux sociaux : ${ready(localReady || cobaltOk.length > 0)}`,
        diagnosticError ? `Erreur locale : ${diagnosticError}` : '',
        `Limite par fichier : ${formatBytes(ctx.config.maxDownloadBytes)}`,
        `Délai maximal : ${Math.round(ctx.config.localDownloadTimeoutMs / 1000)} s`,
        '',
        `*Téléchargements fonctionnels : ${functional ? '✅ OUI' : '❌ NON'}*`,
        localReady
          ? 'Le moteur vérifié est exécutable; aucune clé n’est nécessaire.'
          : state.local
            ? 'Le moteur est activé mais son diagnostic a échoué; vérifiez la ligne Erreur locale ci-dessus.'
            : 'Activez LOCAL_DOWNLOADER_ENABLED=true pour le moteur local sans clé.',
        cobaltOk.length
          ? 'Les instances Cobalt répondent et servent de repli automatique.'
          : 'Aucune instance Cobalt ne répond actuellement; ajoutez-en via COBALT_INSTANCES.',
        'Les téléchargements YouTube bloqués basculent automatiquement vers Cobalt puis Invidious.',
        '_Téléchargez uniquement les contenus que vous avez le droit de conserver._'
      ].join('\n'))
    }
  },
  {
    name: 'videos', aliases: ['videosearch', 'findvideo'], category: 'Recherche', usage: '<recherche>',
    description: 'Recherche des vidéos sur Internet : envoie la meilleure et propose les autres résultats numérotés.', cooldown: 20,
    async run(ctx) {
      const query = String(ctx.text || '').trim().slice(0, 180)
      if (!query) throw new UserError(`Indique une recherche, par exemple : ${ctx.runtime.prefix}videos documentaire Congo`)
      const videos = await searchYouTube(ctx.config, query)
      if (!videos.length) throw new UserError(`Aucune vidéo trouvée pour « ${query} ».`)

      const top = videos.slice(0, 3)
      let lastError
      for (const [index, video] of top.entries()) {
        try {
          const downloaded = await downloadWithFallback(ctx, video.url, 'video', { youtube: true })
          const file = (Array.isArray(downloaded) ? downloaded : [downloaded]).find(item => item.contentType?.startsWith('video/'))
          if (!file?.buffer?.length) throw new UserError('Le résultat ne contient aucune vidéo exploitable.')
          const mime = file.contentType
          const alternatives = top
            .filter((_, position) => position !== index)
            .map((item, position) => `${position + 2}. *${truncate(item.title, 120)}*\n   ${item.url}`)
          await ctx.send({
            video: file.buffer,
            mimetype: mime,
            fileName: file.filename,
            caption: [
              `🎬 *${truncate(video.title, 180)}*`,
              video.author ? `👤 ${video.author}` : '',
              `🔎 Recherche : ${truncate(query, 120)}`,
              `🔗 ${video.url}`,
              alternatives.length ? `\n📺 *Autres résultats :*\n${alternatives.join('\n')}` : ''
            ].filter(Boolean).join('\n')
          })
          return
        } catch (error) {
          lastError = error
          ctx.logger?.warn?.({ err: error, source: video.url }, 'Vidéo de recherche ignorée; essai du résultat suivant')
        }
      }
      throw asUserError(lastError, `Aucune vidéo téléchargeable pour « ${query} »`)
    }
  },
  {
    name: 'yts', aliases: ['ytsearch'], category: 'Recherche', usage: '<recherche>',
    description: 'Recherche des vidéos YouTube via le fournisseur configuré (repli Invidious).', cooldown: 6,
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
    description: 'Télécharge l’audio d’un titre YouTube (yt-dlp puis Cobalt puis Invidious).', cooldown: 15,
    async run(ctx) {
      if (!ctx.text) throw new UserError('Indiquez un titre ou une URL YouTube.')
      const file = await downloadWithFallback(ctx, ctx.text, 'audio', { youtube: true })
      await sendDownload(ctx, file, '', true)
    }
  },
  {
    name: 'ytmp4', aliases: ['ytvideo'], category: 'Téléchargement', usage: '<titre ou URL YouTube>',
    description: 'Télécharge la vidéo d’un titre YouTube (yt-dlp puis Cobalt puis Invidious).', cooldown: 15,
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
