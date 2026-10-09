import { UserError, asUserError } from '../core/errors.js'
import { fetchJson } from './http.js'
import { localYouTubeSearch } from './local-downloader.js'

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be'
])

function decodeHtml(text = '') {
  return String(text)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function videoUrl(videoId = '') {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''
}

function idFromPath(value = '') {
  const match = String(value).match(/[?&]v=([A-Za-z0-9_-]{6,})|youtu\.be\/([A-Za-z0-9_-]{6,})|\/watch\?v=([A-Za-z0-9_-]{6,})/i)
  return match?.[1] || match?.[2] || match?.[3] || ''
}

export function isYouTubeUrl(input = '') {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase()
    return url.protocol.startsWith('http') && (YOUTUBE_HOSTS.has(host) || host.endsWith('.youtube.com'))
  } catch {
    return false
  }
}

export function parseYouTubeApiResults(data = {}) {
  return (data.items || []).map(item => ({
    title: decodeHtml(item.snippet?.title),
    author: decodeHtml(item.snippet?.channelTitle),
    description: decodeHtml(item.snippet?.description),
    url: videoUrl(item.id?.videoId)
  })).filter(item => item.title && item.url)
}

export function parseInvidiousResults(data = []) {
  const items = Array.isArray(data) ? data : data.items || []
  return items
    .filter(item => !item.type || item.type === 'video')
    .map(item => ({
      title: decodeHtml(item.title),
      author: decodeHtml(item.author || item.authorName),
      description: decodeHtml(item.description || item.descriptionHtml),
      url: videoUrl(item.videoId || idFromPath(item.url))
    }))
    .filter(item => item.title && item.url)
}

export function parsePipedResults(data = {}) {
  const items = Array.isArray(data) ? data : data.items || []
  return items
    .filter(item => !item.type || ['stream', 'video'].includes(item.type))
    .map(item => ({
      title: decodeHtml(item.title),
      author: decodeHtml(item.uploaderName || item.uploader || item.author),
      description: decodeHtml(item.shortDescription || item.description),
      url: videoUrl(item.videoId || idFromPath(item.url))
    }))
    .filter(item => item.title && item.url)
}

function searchEndpoint(base, provider, query) {
  const url = new URL(base)
  const rootPath = !url.pathname || url.pathname === '/'
  if (rootPath) url.pathname = provider === 'piped' ? '/search' : '/api/v1/search'
  url.searchParams.set('q', query)
  if (provider === 'piped') url.searchParams.set('filter', 'videos')
  else {
    url.searchParams.set('type', 'video')
    url.searchParams.set('sort_by', 'relevance')
  }
  return url.toString()
}

export function youtubeSearchMode(config) {
  if (config.youtubeApiKey) return 'YouTube Data API v3'
  if (config.youtubeSearchApiUrl) {
    return config.youtubeSearchProvider === 'piped' ? 'API Piped configurée' : 'API Invidious configurée'
  }
  if (config.localDownloaderEnabled) return 'moteur local yt-dlp'
  return 'non configurée'
}

export async function searchYouTube(config, query) {
  const cleanQuery = String(query || '').trim().slice(0, 200)
  if (!cleanQuery) throw new UserError('Indiquez un titre ou une recherche YouTube.')

  try {
    if (config.youtubeApiKey) {
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        maxResults: '5',
        safeSearch: 'moderate',
        q: cleanQuery,
        key: config.youtubeApiKey
      })
      return parseYouTubeApiResults(await fetchJson(`https://www.googleapis.com/youtube/v3/search?${params}`))
    }

    if (config.youtubeSearchApiUrl) {
      const provider = config.youtubeSearchProvider === 'piped' ? 'piped' : 'invidious'
      const data = await fetchJson(searchEndpoint(config.youtubeSearchApiUrl, provider, cleanQuery), { timeout: 20_000 })
      return provider === 'piped' ? parsePipedResults(data) : parseInvidiousResults(data)
    }

    if (config.localDownloaderEnabled) return await localYouTubeSearch(config, cleanQuery)
  } catch (error) {
    throw asUserError(error, 'La recherche YouTube a échoué')
  }

  throw new UserError([
    'La recherche par titre est désactivée.',
    'Activez LOCAL_DOWNLOADER_ENABLED=true ou configurez YOUTUBE_API_KEY/YOUTUBE_SEARCH_API_URL.',
    'Consultez .dlstatus.'
  ].join(' '))
}

export async function resolveYouTube(config, query) {
  const value = String(query || '').trim()
  if (!value) throw new UserError('Indiquez un titre ou une URL YouTube.')
  if (/^https?:\/\//i.test(value)) {
    if (!isYouTubeUrl(value)) throw new UserError('Cette commande accepte uniquement une URL YouTube ou un titre.')
    return value
  }
  const [video] = await searchYouTube(config, value)
  if (!video) throw new UserError('Aucune vidéo YouTube trouvée pour cette recherche.')
  return video.url
}
