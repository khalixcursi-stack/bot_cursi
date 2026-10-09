import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson, validateExternalUrl } from './http.js'

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i

export function isTikTokLink(input = '') {
  try {
    return TIKTOK_HOST.test(new URL(input).hostname)
  } catch {
    return false
  }
}

export function isTikTokUrl(input = '') {
  try {
    const url = new URL(input)
    return TIKTOK_HOST.test(url.hostname) && /\/video\/\d+/.test(url.pathname)
  } catch {
    return false
  }
}

async function expandTikTokUrl(input) {
  let current = String(input)
  for (let hop = 0; hop < 5; hop += 1) {
    const safe = await validateExternalUrl(current)
    if (!TIKTOK_HOST.test(safe.hostname)) throw new UserError('La redirection TikTok quitte le domaine autorisé.')
    if (/\/video\/\d+/.test(safe.pathname)) return safe
    const response = await fetch(safe, {
      method: 'HEAD', redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' }
    })
    const location = response.headers.get('location')
    if (!location) break
    current = new URL(location, safe).toString()
  }
  throw new UserError('Le lien TikTok court n’a pas pu être transformé en URL vidéo.')
}

export async function tiktokOfficialDownload(config, input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new UserError('URL TikTok invalide.')
  }
  if (!TIKTOK_HOST.test(url.hostname)) throw new UserError('Cette URL ne vient pas de TikTok.')
  if (!/\/video\/\d+/.test(url.pathname)) url = await expandTikTokUrl(url)
  const videoId = url.pathname.match(/\/video\/(\d+)/)?.[1]
  if (!videoId) throw new UserError('L’identifiant de cette vidéo TikTok est introuvable.')

  let data
  try {
    const params = new URLSearchParams({ item_ids: videoId })
    data = await fetchJson(`https://www.tiktok.com/player/api/v1/items?${params}`, {
      timeout: 25_000,
      headers: {
        referer: `https://www.tiktok.com/player/v1/${videoId}`,
        'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
      }
    })
  } catch (error) {
    throw asUserError(error, 'L’API officielle du lecteur TikTok ne répond pas')
  }

  const item = data.items?.find(entry => String(entry.id_str || entry.id) === videoId) || data.items?.[0]
  if (!item) throw new UserError('TikTok n’a renvoyé aucune vidéo pour cette URL.')
  if (item.control_info?.allow_download === false) {
    throw new UserError('Le créateur de cette vidéo TikTok n’autorise pas son téléchargement.')
  }
  const profiles = (item.video_info?.profiles || [])
    .filter(profile => profile.play_addr?.url_list?.length)
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))
  const profile = profiles.find(entry => !entry.play_addr?.data_size || entry.play_addr.data_size <= config.maxDownloadBytes) || profiles.at(-1)
  const mediaUrl = profile?.play_addr?.url_list?.[0]
  if (!mediaUrl) throw new UserError('TikTok n’a fourni aucun flux vidéo téléchargeable.')

  try {
    const file = await fetchExternalBuffer(mediaUrl, {
      maxBytes: config.maxDownloadBytes,
      timeout: 90_000,
      headers: { referer: 'https://www.tiktok.com/' }
    })
    return {
      ...file,
      contentType: file.contentType.startsWith('video/') ? file.contentType : 'video/mp4',
      filename: `tiktok-${videoId}.mp4`,
      engine: 'tiktok-player-api'
    }
  } catch (error) {
    throw asUserError(error, 'Le flux vidéo TikTok n’a pas pu être récupéré')
  }
}
