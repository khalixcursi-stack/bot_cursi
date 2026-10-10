import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson } from './http.js'
import { decodeMediaUrl } from '../utils/html.js'

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i
const POST_PATH = /\/(?:video|photo)\/(\d+)/
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'

export function isTikTokLink(input = '') {
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) && TIKTOK_HOST.test(url.hostname)
  } catch {
    return false
  }
}

export function isTikTokUrl(input = '') {
  try {
    return isTikTokLink(input) && POST_PATH.test(new URL(input).pathname)
  } catch {
    return false
  }
}

async function expandTikTokUrl(input) {
  // HEAD évite de télécharger une page entière; http.js valide chaque saut,
  // interdit les adresses privées et conserve la restriction de domaine.
  const response = await fetchExternalBuffer(input, {
    method: 'HEAD', redirects: 5, timeout: 20_000,
    allowedHosts: ['tiktok.com'], headers: { 'user-agent': USER_AGENT }
  })
  const url = new URL(response.finalUrl)
  if (!POST_PATH.test(url.pathname)) throw new UserError('Le lien TikTok court n’a pas pu être transformé en URL de post.')
  return url
}

function cdnUrls(...addresses) {
  const urls = addresses.flatMap(address => {
    if (typeof address === 'string') return [address]
    if (Array.isArray(address)) return address
    return address?.url_list || address?.urlList || (address?.url ? [address.url] : [])
  }).map(decodeMediaUrl).filter(url => /^https?:\/\//i.test(url))
  return [...new Set(urls)].slice(0, 3)
}

async function downloadFromCdns(config, urls, kind, filename) {
  let lastError
  for (const url of urls) {
    try {
      const file = await fetchExternalBuffer(url, {
        maxBytes: config.maxDownloadBytes, timeout: 90_000,
        headers: { referer: 'https://www.tiktok.com/', 'user-agent': USER_AGENT }
      })
      if (file.buffer.length <= 1024) throw new Error('Le CDN TikTok a renvoyé un fichier vide ou incomplet (≤ 1024 octets).')
      if (file.contentType === 'image/svg+xml' || (file.contentType !== 'application/octet-stream' && !file.contentType.startsWith(`${kind}/`))) {
        throw new Error('Le CDN TikTok n’a pas renvoyé le média attendu.')
      }
      const contentType = file.contentType === 'application/octet-stream'
        ? kind === 'image' ? 'image/jpeg' : 'video/mp4'
        : file.contentType
      const extension = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[contentType]
      return {
        ...file, contentType,
        filename: extension ? filename.replace(/\.[^.]+$/, `.${extension}`) : filename,
        engine: 'tiktok-player-api'
      }
    } catch (error) {
      lastError = error
    }
  }
  throw asUserError(lastError, `Aucun des trois CDN TikTok n’a fourni le ${kind === 'image' ? 'fichier photo' : 'flux vidéo'}`)
}

export async function tiktokOfficialDownload(config, input, mode = 'auto') {
  if (!isTikTokLink(input)) throw new UserError('URL TikTok invalide ou domaine non autorisé.')
  let url = new URL(input)
  if (!POST_PATH.test(url.pathname)) url = await expandTikTokUrl(url)
  const postId = url.pathname.match(POST_PATH)?.[1]
  if (!postId) throw new UserError('L’identifiant de ce post TikTok est introuvable.')

  let data
  try {
    const params = new URLSearchParams({ item_ids: postId })
    data = await fetchJson(`https://www.tiktok.com/player/api/v1/items?${params}`, {
      timeout: 25_000, retries: 1,
      headers: { referer: `https://www.tiktok.com/player/v1/${postId}`, 'user-agent': USER_AGENT }
    })
  } catch (error) {
    throw asUserError(error, 'L’API officielle du lecteur TikTok ne répond pas')
  }

  const rawItems = data?.items || data?.aweme_list || data?.item_list || []
  const items = Array.isArray(rawItems) ? rawItems : []
  const item = items.find(entry => String(entry.id_str || entry.id || entry.aweme_id) === postId) || items[0]
  if (!item) throw new UserError('TikTok n’a renvoyé aucun média pour cette URL.')
  if (item.control_info?.allow_download === false) {
    throw new UserError('Le créateur de ce post TikTok n’autorise pas son téléchargement.')
  }

  const rawPhotos = item.image_post_info?.images || item.imagePost?.images || []
  const photos = Array.isArray(rawPhotos) ? rawPhotos : []
  if (photos.length || Number(item.aweme_type) === 150) {
    if (mode === 'audio') throw new UserError('Ce post TikTok contient des photos, pas un flux audio téléchargeable.')
    if (!photos.length) throw new UserError('TikTok n’a fourni aucune photo pour cet album.')
    if (photos.length > 20) throw new UserError('Cet album TikTok dépasse la limite de 20 photos.')
    const files = []
    let totalBytes = 0
    for (const [index, photo] of photos.entries()) {
      const urls = cdnUrls(photo.display_image, photo.watermark_free_image, photo.image_url, photo.url_list, photo.url)
      if (!urls.length) throw new UserError(`La photo ${index + 1} de cet album n’a aucune URL CDN.`)
      const file = await downloadFromCdns(config, urls, 'image', `tiktok-${postId}-${index + 1}.jpg`)
      totalBytes += file.buffer.length
      if (totalBytes > (config.maxDownloadBytes || 50 * 1024 * 1024)) throw new UserError('L’album TikTok dépasse la limite de téléchargement en mémoire.')
      files.push(file)
    }
    return files.length === 1 ? files[0] : files
  }

  const profiles = (item.video_info?.profiles || [])
    .filter(profile => profile.play_addr?.url_list?.length)
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))
  const suitable = profiles.filter(profile => !profile.play_addr?.data_size || profile.play_addr.data_size <= config.maxDownloadBytes)
  const candidates = suitable.length ? suitable : profiles
  const urls = cdnUrls(
    ...candidates.map(profile => profile.play_addr),
    item.video_info?.play_addr, item.video?.play_addr, item.video?.download_addr
  )
  if (!urls.length) throw new UserError('TikTok n’a fourni aucun flux vidéo téléchargeable.')
  return downloadFromCdns(config, urls, 'video', `tiktok-${postId}.mp4`)
}
