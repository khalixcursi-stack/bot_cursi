import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson } from './http.js'

const BLOCKED_SEARCH = /\b(?:porn|porno|hentai|nude|nudite|nudes|nsfw|adult|adulte|sex|sexe|sexuel|erotique|fetish|fetiche|xxx|gore|loli|shota)\b/i
const FORBIDDEN_ADULT_SEARCH = /\b(?:child|children|kid|kids|minor|underage|teen|teenager|young|toddler|baby|babies|loli|lolicon|shota|shotacon|schoolgirl|schoolboy|incest|rape|raped|forced|unconscious|drugged|bestiality|zoophilia|revenge\s*porn|enfant|mineur|mineure|ado|adolescent|adolescente|viol|forcee|force|inconscient|drogue|droguee|zoophilie)\b/i
const ADULT_CONTENT_HINT = /\b(?:18|adult|adulte|nude|nudes|nudity|nudite|naked|erotic|erotique|sensual|sensuel|sexy|lingerie|boudoir|topless|breast|breasts|boob|boobs|glamour|naturism|naturist|nu|nue)\b/i
const MODIFIABLE_LICENSES = new Set(['cc0', 'pdm', 'by', 'by-sa', 'by-nc', 'by-nc-sa'])

function cleanHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeSearchText(value = '') {
  return String(value).normalize('NFKD').replace(/\p{Mark}/gu, '')
}

function containsBlockedTerm(value = '') {
  return BLOCKED_SEARCH.test(normalizeSearchText(value))
}

function containsForbiddenAdultTerm(value = '') {
  return FORBIDDEN_ADULT_SEARCH.test(normalizeSearchText(value))
}

function containsAdultHint(value = '') {
  return ADULT_CONTENT_HINT.test(normalizeSearchText(value))
}

export function safeImageQuery(input = '') {
  const query = String(input || '').trim().slice(0, 80)
  if (!query) throw new UserError('Indique une recherche d’image.')
  if (containsBlockedTerm(query)) throw new UserError('Cette recherche n’est pas autorisée en mode SFW.')
  return query
}

export function safeAdultImageQuery(input = '') {
  const query = String(input || '').trim().slice(0, 80)
  if (!query) throw new UserError('Indique une recherche réservée aux adultes.')
  if (containsForbiddenAdultTerm(query)) {
    throw new UserError('Cette recherche adulte est interdite par les protections du bot.')
  }
  return query
}

async function openverseSearch(query, modifiable, preferThumbnail, photoOnly) {
  const params = new URLSearchParams({ q: query, page_size: '12', mature: 'false' })
  if (modifiable) params.set('license_type', 'modification')
  if (photoOnly) params.set('extension', 'jpg')
  const data = await fetchJson(`https://api.openverse.org/v1/images/?${params}`, { timeout: 20_000 })
  return (data.results || [])
    .filter(item =>
      (item.thumbnail || item.url) &&
      item.mature !== true &&
      !containsBlockedTerm(`${item.title || ''} ${(item.tags || []).map(tag => tag.name || '').join(' ')}`) &&
      (!modifiable || MODIFIABLE_LICENSES.has(String(item.license || '').toLowerCase()))
    )
    .map(item => ({
      title: item.title || query,
      creator: item.creator || 'auteur inconnu',
      license: String(item.license || 'licence ouverte').toUpperCase(),
      imageUrl: preferThumbnail ? (item.thumbnail || item.url) : (item.url || item.thumbnail),
      sourceUrl: item.foreign_landing_url || item.detail_url || item.url,
      contentType: item.filetype ? `image/${item.filetype === 'jpg' ? 'jpeg' : item.filetype}` : '',
      provider: 'Openverse'
    }))
}

async function commonsSearch(query, modifiable, photoOnly) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: photoOnly ? `${query} filemime:image/jpeg` : query,
    gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1200', format: 'json', origin: '*'
  })
  const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { timeout: 25_000 })
  return Object.values(data.query?.pages || {}).map(page => {
    const info = page.imageinfo?.[0] || {}
    const metadata = info.extmetadata || {}
    return {
      title: cleanHtml(metadata.ImageDescription?.value) || page.title?.replace(/^File:/, '') || query,
      creator: cleanHtml(metadata.Artist?.value) || 'auteur inconnu',
      license: cleanHtml(metadata.LicenseShortName?.value) || 'Wikimedia Commons',
      imageUrl: info.thumburl || info.url,
      sourceUrl: info.descriptionurl || info.url,
      contentType: info.mime || '',
      provider: 'Wikimedia Commons'
    }
  }).filter(item => {
    if (!item.imageUrl || containsBlockedTerm(item.title)) return false
    if (photoOnly && item.contentType !== 'image/jpeg') return false
    if (!modifiable) return true
    return /CC0|public domain|CC BY|CC-BY/i.test(item.license)
  })
}

export async function searchInternetImages(input, {
  modifiable = false,
  preferThumbnail = false,
  includeFallback = false,
  photoOnly = false
} = {}) {
  const query = safeImageQuery(input)
  const candidates = []
  let openverseError
  try {
    candidates.push(...await openverseSearch(query, modifiable, preferThumbnail, photoOnly))
    if (candidates.length && !includeFallback) return candidates
  } catch (error) {
    openverseError = error
  }
  try {
    const commons = await commonsSearch(query, modifiable, photoOnly)
    const knownSources = new Set(candidates.map(item => item.sourceUrl))
    candidates.push(...commons.filter(item => !knownSources.has(item.sourceUrl)))
  } catch (error) {
    if (!candidates.length) {
      throw asUserError(error, 'Les services de recherche d’images sont momentanément indisponibles')
    }
  }
  if (candidates.length) return candidates
  if (openverseError) throw asUserError(openverseError, 'La recherche d’images a échoué')
  throw new UserError(`Aucune image SFW trouvée pour « ${query} ».`)
}

async function openverseAdultSearch(query) {
  const params = new URLSearchParams({
    q: `${query} adult erotic nude`,
    page_size: '20',
    mature: 'true',
    extension: 'jpg'
  })
  const data = await fetchJson(`https://api.openverse.org/v1/images/?${params}`, { timeout: 20_000 })
  return (data.results || []).filter(item => {
    const metadata = `${item.title || ''} ${(item.tags || []).map(tag => tag.name || '').join(' ')}`
    return item.url && item.filetype === 'jpg' && containsAdultHint(metadata) && !containsForbiddenAdultTerm(metadata)
  }).map(item => ({
    title: item.title || query,
    creator: item.creator || 'auteur inconnu',
    license: String(item.license || 'licence ouverte').toUpperCase(),
    imageUrl: item.url,
    sourceUrl: item.foreign_landing_url || item.detail_url || item.url,
    contentType: 'image/jpeg',
    provider: 'Openverse'
  }))
}

async function commonsAdultSearch(query) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${query} adult nude filemime:image/jpeg`,
    gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1200', format: 'json', origin: '*'
  })
  const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { timeout: 25_000 })
  return Object.values(data.query?.pages || {}).map(page => {
    const info = page.imageinfo?.[0] || {}
    const metadata = info.extmetadata || {}
    return {
      title: cleanHtml(metadata.ImageDescription?.value) || page.title?.replace(/^File:/, '') || query,
      creator: cleanHtml(metadata.Artist?.value) || 'auteur inconnu',
      license: cleanHtml(metadata.LicenseShortName?.value) || 'Wikimedia Commons',
      imageUrl: info.thumburl || info.url,
      sourceUrl: info.descriptionurl || info.url,
      contentType: info.mime || '',
      provider: 'Wikimedia Commons'
    }
  }).filter(item =>
    item.imageUrl &&
    item.contentType === 'image/jpeg' &&
    containsAdultHint(item.title) &&
    !containsForbiddenAdultTerm(item.title)
  )
}

export async function searchAdultImages(input) {
  const query = safeAdultImageQuery(input)
  const candidates = []
  let lastError
  for (const search of [openverseAdultSearch, commonsAdultSearch]) {
    try {
      const results = await search(query)
      const knownSources = new Set(candidates.map(item => item.sourceUrl))
      candidates.push(...results.filter(item => !knownSources.has(item.sourceUrl)))
    } catch (error) {
      lastError = error
    }
  }
  if (candidates.length) return candidates
  if (lastError) throw asUserError(lastError, 'La recherche de contenu adulte a échoué')
  throw new UserError(`Aucun contenu adulte autorisé trouvé pour « ${query} ».`)
}

export async function downloadInternetImage(config, result, {
  maxBytes = 12 * 1024 * 1024,
  photoOnly = false
} = {}) {
  try {
    const file = await fetchExternalBuffer(result.imageUrl, {
      maxBytes: Math.min(config.maxDownloadBytes, maxBytes),
      timeout: 45_000
    })
    if (!file.contentType.startsWith('image/')) throw new Error('la ressource trouvée n’est pas une image')
    if (photoOnly && !/^image\/jpe?g$/i.test(file.contentType)) {
      throw new Error('la ressource trouvée n’est pas une photo JPEG')
    }
    return file
  } catch (error) {
    throw asUserError(error, 'L’image trouvée n’a pas pu être téléchargée')
  }
}
