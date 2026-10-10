import { UserError, asUserError } from '../core/errors.js'
import { fetchJson, fetchExternalBuffer, validateExternalUrl } from './http.js'
import { DEFAULT_INVIDIOUS_INSTANCES } from './more-apis.js'

// Instances Cobalt publiques essayées en cascade après COBALT_API_URL.
// La liste communautaire évolue : surchargez-la avec COBALT_INSTANCES.
export const DEFAULT_COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://cobalt-api.meowing.de',
  'https://cobalt-backend.canine.tools',
  'https://capi.3kh0.net',
  'https://cobalt-api.kwiatekmiki.com',
  'https://co.wuk.sh'
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

export function cobaltInstanceList(config) {
  const configured = [config?.cobaltApiUrl, ...(config?.cobaltInstances || [])]
    .map(value => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean)
  return [...new Set([...configured, ...DEFAULT_COBALT_INSTANCES])]
}

function cobaltHeaders(config) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json'
  }
  if (config?.cobaltApiKey) headers.authorization = `Api-Key ${config.cobaltApiKey}`
  return headers
}

function cobaltError(result = {}) {
  const code = result.error?.code || result.error?.message || result.code || result.text || result.status || 'réponse inconnue'
  const context = result.error?.context?.service || result.error?.context?.limit || ''
  return context ? `${code} · ${context}` : String(code)
}

function mediaUrlFrom(result = {}) {
  if (result.status === 'error' || result.error) return ''
  if (result.status === 'local-processing') return ''
  return result.url || result.picker?.find(item => item?.url)?.url || ''
}

export function downloaderReadiness(config) {
  const cobalt = cobaltInstanceList(config).length > 0
  const local = Boolean(config.localDownloaderEnabled)
  const invidious = (Array.isArray(config.invidiousInstances) && config.invidiousInstances.length
    ? config.invidiousInstances
    : DEFAULT_INVIDIOUS_INSTANCES).length > 0
  const search = Boolean(config.youtubeApiKey || config.youtubeSearchApiUrl) || local || invidious
  return {
    local,
    cobalt,
    search,
    directYouTube: local || cobalt,
    titleYouTube: local || (cobalt && search),
    social: local || cobalt
  }
}

// Sonde légère des instances Cobalt pour .dlstatus : aucune URL sensible n’est
// envoyée, seule la racine de l’API est interrogée.
export async function probeCobaltInstances(config, { timeout = 6_000 } = {}) {
  const instances = cobaltInstanceList(config)
  return Promise.all(instances.map(async instance => {
    try {
      await fetchJson(instance, { timeout, retries: 1 })
      return { instance, hostname: hostnameOf(instance), status: 'ok', detail: 'répond' }
    } catch (error) {
      const http = String(error?.message || '').match(/HTTP (\d+)/)
      return {
        instance,
        hostname: hostnameOf(instance),
        status: http ? 'reachable' : 'down',
        detail: http ? `HTTP ${http[1]}` : 'injoignable'
      }
    }
  }))
}

export async function cobaltDownload(config, url, downloadMode = 'auto') {
  await validateExternalUrl(url).catch(error => { throw asUserError(error, 'URL de téléchargement refusée') })

  const instances = cobaltInstanceList(config).slice(0, 4)
  const failures = []
  for (const instance of instances) {
    let result
    try {
      result = await fetchJson(instance, {
        method: 'POST',
        timeout: 45_000,
        headers: cobaltHeaders(config),
        body: JSON.stringify({
          url,
          downloadMode: downloadMode === 'video' ? 'auto' : downloadMode,
          audioFormat: 'mp3',
          videoQuality: '720'
        })
      })
    } catch (error) {
      failures.push(`${hostnameOf(instance)} : ${shortError(error)}`)
      continue
    }

    const mediaUrl = mediaUrlFrom(result)
    if (!mediaUrl) {
      failures.push(`${hostnameOf(instance)} : ${cobaltError(result)}`)
      continue
    }

    try {
      const file = await fetchExternalBuffer(mediaUrl, {
        maxBytes: config.maxDownloadBytes,
        timeout: 120_000
      })
      return { ...file, engine: `cobalt · ${hostnameOf(instance)}` }
    } catch (error) {
      failures.push(`${hostnameOf(instance)} : ${shortError(error)}`)
    }
  }

  throw new UserError([
    'Aucune instance Cobalt n’a pu préparer ce média.',
    ...failures.slice(0, 4).map(failure => `• ${failure}`),
    'Réessaie dans un instant ou consulte .dlstatus.'
  ].join('\n'))
}

function youtubeVideoId(input = '') {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase()
    if (host === 'youtu.be' || host.endsWith('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || ''
    if (host.includes('youtube.com')) return url.searchParams.get('v') || ''
  } catch {
    return ''
  }
  return ''
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
          String(format.type || '').startsWith('audio/') ||
          ['m4a', 'mp3', 'opus', 'webm'].includes(String(format.container || '').toLowerCase())
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
      return {
        ...file,
        contentType: file.contentType?.startsWith('audio/') ? file.contentType : 'audio/mp4',
        filename: `audio-${videoId}.m4a`,
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
