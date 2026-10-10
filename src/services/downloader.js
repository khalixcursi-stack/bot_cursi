import { UserError, asUserError } from '../core/errors.js'
import { fetchJson, fetchExternalBuffer, validateExternalUrl } from './http.js'
import { DEFAULT_INVIDIOUS_INSTANCES } from './more-apis.js'
import { decodeMediaUrl } from '../utils/html.js'

// Sans configuration, les cinq instances publiques sont essayées dans cet ordre.
// Une instance configurée reste prioritaire, sans supprimer les replis publics.
export const DEFAULT_COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://co.wuk.sh',
  'https://cobalt-api.kwiatekmiki.com',
  'https://cobalt.dreamapi.cloud',
  'https://api-cobalt.deno.dev'
]

function hostnameOf(instance) {
  try {
    return new URL(instance).hostname
  } catch {
    return String(instance)
  }
}

function shortError(error) {
  return String(error?.message || error).replace(/\s+/g, ' ').trim().slice(0, 140)
}

export function cobaltInstanceList(config = {}) {
  const configured = [config.cobaltApiUrl, ...(config.cobaltInstances || [])]
    .map(value => String(value || '').trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return [...new Set([...configured, ...DEFAULT_COBALT_INSTANCES])]
}

function cobaltHeaders(config, instance) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  // Ne jamais transmettre la clé de l'instance privée aux instances publiques.
  if (config.cobaltApiKey && config.cobaltApiUrl) {
    try {
      if (new URL(instance).origin === new URL(config.cobaltApiUrl).origin) {
        headers.authorization = `Api-Key ${config.cobaltApiKey}`
      }
    } catch {
      // Une URL configurée invalide échouera normalement dans la cascade.
    }
  }
  return headers
}

function cobaltError(result = {}) {
  const code = result.error?.code || result.error?.message || result.code || result.text || result.status || 'réponse inconnue'
  const context = result.error?.context?.service || result.error?.context?.limit || ''
  return context ? `${code} · ${context}` : String(code)
}

export function isNoVideoError(error) {
  return Boolean(error?.noVideo) || /\bno[ ._-]*video\b/i.test(String(error?.message || error || ''))
}

function mediaEntriesFrom(result, mode) {
  if (!result || result.status === 'error' || result.error || result.status === 'local-processing') return []
  if (mode === 'audio' && (result.audio || result.audioUrl)) {
    return [{ url: result.audio || result.audioUrl, type: 'audio', filename: result.audioFilename }]
  }
  if (Array.isArray(result.picker)) {
    // Un picker est un album, pas uniquement son premier élément.
    return result.picker.filter(item => item?.url)
  }
  return result.url ? [{ url: result.url, filename: result.filename }] : []
}

function normalizeCobaltFile(file, entry, mode) {
  if (!file.buffer.length) throw new Error('Le média Cobalt est vide.')
  if (file.contentType === 'image/svg+xml' || /^(?:text\/|application\/(?:json|xhtml\+xml))/i.test(file.contentType)) {
    throw new Error('L’instance Cobalt a renvoyé une page au lieu du média.')
  }
  const filename = String(entry.filename || file.filename || 'fichier')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'fichier'
  let contentType = file.contentType
  if (contentType === 'application/octet-stream') {
    const extension = (filename.match(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mp3|m4a)$/i)?.[1] ||
      new URL(file.finalUrl).pathname.match(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mp3|m4a)$/i)?.[1])?.toLowerCase()
    contentType = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
      mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4'
    }[extension] || ({ photo: 'image/jpeg', image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mpeg' }[entry.type]) || contentType
  }
  if (mode === 'audio' && contentType.startsWith('image/')) throw new Error('Ce post contient des photos, pas d’audio.')
  return { ...file, contentType, filename }
}

export function downloaderReadiness(config = {}) {
  const cobalt = cobaltInstanceList(config).length > 0
  const local = Boolean(config.localDownloaderEnabled)
  const invidious = (Array.isArray(config.invidiousInstances) && config.invidiousInstances.length
    ? config.invidiousInstances
    : DEFAULT_INVIDIOUS_INSTANCES).length > 0
  const search = Boolean(config.youtubeApiKey || config.youtubeSearchApiUrl) || local || invidious
  return { local, cobalt, search, directYouTube: local || cobalt, titleYouTube: local || (cobalt && search), social: local || cobalt }
}

// Sonde légère pour .dlstatus : aucune URL de contenu ni clé n’est envoyée.
export async function probeCobaltInstances(config, { timeout = 6_000 } = {}) {
  return Promise.all(cobaltInstanceList(config).map(async instance => {
    try {
      await fetchJson(instance, { timeout, retries: 1 })
      return { instance, hostname: hostnameOf(instance), status: 'ok', detail: 'répond' }
    } catch (error) {
      const http = String(error?.message || '').match(/HTTP (\d+)/)
      return {
        instance, hostname: hostnameOf(instance), status: http ? 'reachable' : 'down',
        detail: http ? `HTTP ${http[1]}` : 'injoignable'
      }
    }
  }))
}

// Renvoie un fichier pour un média unique, ou un tableau de fichiers pour un album.
// Toutes les erreurs (y compris « no video » et un CDN inaccessible) laissent
// poursuivre la cascade; le marqueur noVideo permet ensuite le repli Open Graph.
export async function cobaltDownload(config = {}, url, downloadMode = 'auto') {
  await validateExternalUrl(url).catch(error => { throw asUserError(error, 'URL de téléchargement refusée') })
  const mode = downloadMode === 'video' ? 'auto' : downloadMode
  const failures = []
  let noVideo = false

  for (const instance of cobaltInstanceList(config)) {
    try {
      const result = await fetchJson(instance, {
        method: 'POST', timeout: 25_000, retries: 1, redirect: 'error',
        headers: cobaltHeaders(config, instance),
        body: JSON.stringify({ url, downloadMode: mode, audioFormat: 'mp3', videoQuality: '720' })
      })
      const entries = mediaEntriesFrom(result, mode)
      if (!entries.length) throw new Error(cobaltError(result || {}))
      if (entries.length > 20) throw new Error('Cet album dépasse la limite de 20 médias.')

      const files = []
      let totalBytes = 0
      const maxBytes = config.maxDownloadBytes || 50 * 1024 * 1024
      for (const entry of entries) {
        const file = normalizeCobaltFile(await fetchExternalBuffer(decodeMediaUrl(entry.url), {
          maxBytes, timeout: 120_000
        }), entry, mode)
        totalBytes += file.buffer.length
        if (totalBytes > maxBytes) throw new Error('L’album dépasse la limite de téléchargement en mémoire.')
        files.push({ ...file, engine: `cobalt · ${hostnameOf(instance)}` })
      }
      return files.length === 1 ? files[0] : files
    } catch (error) {
      noVideo ||= isNoVideoError(error)
      failures.push(`${hostnameOf(instance)} : ${shortError(error)}`)
    }
  }

  const error = new UserError([
    'Aucune instance Cobalt n’a pu préparer ce média.',
    ...failures.map(failure => `• ${failure}`),
    'Réessaie dans un instant ou consulte .dlstatus.'
  ].join('\n'))
  error.noVideo = noVideo
  throw error
}

function youtubeVideoId(input = '') {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    const id = host === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0]
      : host === 'youtube.com' || host.endsWith('.youtube.com')
        ? url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1]
        : ''
    return /^[A-Za-z0-9_-]{6,}$/.test(id || '') ? id : ''
  } catch {
    return ''
  }
}

// Repli audio YouTube via les instances Invidious : utile quand yt-dlp est
// bloqué par l’anti-bot et que Cobalt échoue également.
export async function invidiousAudioDownload(config, url, { instances, timeout = 15_000 } = {}) {
  const videoId = youtubeVideoId(url)
  if (!videoId) throw new UserError('URL YouTube invalide pour le repli Invidious.')

  const list = (Array.isArray(instances) && instances.length ? instances : DEFAULT_INVIDIOUS_INSTANCES)
    .map(value => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean)
    .slice(0, 6)
  const failures = []

  for (const base of list) {
    try {
      const data = await fetchJson(`${base}/api/v1/videos/${encodeURIComponent(videoId)}`, { timeout, retries: 1 })
      const formats = [...(data.adaptiveFormats || []), ...(data.formatStreams || [])]
        .filter(format =>
          format.url && (String(format.type || '').startsWith('audio/') ||
          (!format.type && ['m4a', 'mp3', 'opus'].includes(String(format.container || '').toLowerCase())))
        )
        .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))
      const audio = formats[0]
      if (!audio?.url) {
        failures.push(`${hostnameOf(base)} : aucun flux audio`)
        continue
      }
      const file = await fetchExternalBuffer(audio.url, {
        maxBytes: config.maxDownloadBytes,
        timeout: 120_000
      })
      if (!file.buffer.length || /^(?:text\/|application\/(?:json|xhtml\+xml))/i.test(file.contentType)) {
        throw new Error('Invidious n’a pas renvoyé un fichier audio exploitable.')
      }
      const contentType = file.contentType.startsWith('audio/') ? file.contentType
        : String(audio.type || 'audio/mp4').split(';')[0]
      const extension = { 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'opus' }[contentType] || 'm4a'
      return {
        ...file, contentType,
        filename: `audio-${videoId}.${extension}`,
        engine: `invidious · ${hostnameOf(base)}`
      }
    } catch (error) {
      failures.push(`${hostnameOf(base)} : ${shortError(error)}`)
    }
  }

  throw new UserError([
    'Aucune instance Invidious n’a fourni l’audio demandé.',
    ...failures.slice(0, 3).map(failure => `• ${failure}`)
  ].join('\n'))
}
