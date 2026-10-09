import { UserError, asUserError } from '../core/errors.js'
import { fetchJson, fetchExternalBuffer, validateExternalUrl } from './http.js'

function cobaltHeaders(config) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json'
  }
  if (config.cobaltApiKey) headers.authorization = `Api-Key ${config.cobaltApiKey}`
  return headers
}

function cobaltError(result = {}) {
  const code = result.error?.code || result.code || result.text || result.status || 'réponse inconnue'
  const context = result.error?.context?.service || result.error?.context?.limit || ''
  return context ? `${code} · ${context}` : String(code)
}

function mediaUrlFrom(result = {}) {
  if (result.status === 'error' || result.error) throw new UserError(`Cobalt a refusé ce téléchargement (${cobaltError(result)}).`)
  if (result.status === 'local-processing') {
    throw new UserError('Cette réponse Cobalt exige un traitement local avancé; le moteur yt-dlp local doit rester activé.')
  }
  return result.url || result.picker?.find(item => item?.url)?.url || ''
}

export function downloaderReadiness(config) {
  const cobalt = Boolean(config.cobaltApiUrl)
  const local = Boolean(config.localDownloaderEnabled)
  const search = Boolean(config.youtubeApiKey || config.youtubeSearchApiUrl || local)
  return {
    local,
    cobalt,
    search,
    directYouTube: local || cobalt,
    titleYouTube: local || (cobalt && search),
    social: local || cobalt
  }
}

export async function cobaltDownload(config, url, downloadMode = 'auto') {
  if (!config.cobaltApiUrl) {
    throw new UserError('Téléchargements non configurés : ajoutez COBALT_API_URL dans .env, puis consultez .dlstatus.')
  }
  await validateExternalUrl(url).catch(error => { throw asUserError(error, 'URL de téléchargement refusée') })

  let result
  try {
    result = await fetchJson(config.cobaltApiUrl, {
      method: 'POST',
      timeout: 45_000,
      headers: cobaltHeaders(config),
      body: JSON.stringify({
        url,
        downloadMode,
        ...(downloadMode === 'audio' ? { audioFormat: 'mp3' } : {})
      })
    })
  } catch (error) {
    throw asUserError(error, 'Impossible de joindre Cobalt; vérifiez COBALT_API_URL et COBALT_API_KEY')
  }

  const mediaUrl = mediaUrlFrom(result)
  if (!mediaUrl) throw new UserError(`Cobalt n’a fourni aucun média (${cobaltError(result)}).`)

  try {
    return await fetchExternalBuffer(mediaUrl, { maxBytes: config.maxDownloadBytes, timeout: 90_000 })
  } catch (error) {
    throw asUserError(error, 'Le média préparé par Cobalt n’a pas pu être récupéré')
  }
}
