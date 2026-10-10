import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson, fetchText } from './http.js'
import { translateText } from './more-apis.js'

const BLOCKED_SEARCH = /\b(?:porn|porno|hentai|nude|nudite|nudes|nsfw|adult|adulte|sex|sexe|sexuel|erotique|fetish|fetiche|xxx|gore|loli|shota)\b/i
const FORBIDDEN_ADULT_SEARCH = /\b(?:child|children|kid|kids|minor|underage|teen|teenager|young|toddler|baby|babies|loli|lolicon|shota|shotacon|schoolgirl|schoolboy|incest|rape|raped|forced|unconscious|drugged|bestiality|zoophilia|revenge\s*porn|enfant|mineur|mineure|ado|adolescent|adolescente|viol|forcee|force|inconscient|drogue|droguee|zoophilie)\b/i
const ADULT_CONTENT_HINT = /\b(?:18|adult|adulte|nude|nudes|nudity|nudite|naked|erotic|erotique|sensual|sensuel|sexy|lingerie|boudoir|topless|breast|breasts|boob|boobs|glamour|naturism|naturist|nu|nue)\b/i
const MODIFIABLE_LICENSES = new Set(['cc0', 'pdm', 'by', 'by-sa', 'by-nc', 'by-nc-sa'])
const DEFAULT_MIN_SCORE = 0.4
const DEFAULT_PROVIDERS = ['openverse', 'commons', 'bing', 'pixabay', 'pexels', 'unsplash', 'loremflickr']
const SEARCH_STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'a', 'au', 'aux', 'sur', 'dans', 'pour', 'avec',
  'the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'photo', 'image', 'picture', 'pic'
])

function cleanHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      const key = entity.toLowerCase()
      if (key.startsWith('#x')) {
        const code = Number.parseInt(entity.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      if (key.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[key] ?? match
    })
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

// ---------------------------------------------------------------------------
// Score de pertinence : recouvrement des jetons requête ↔ titre/tags.
// Retourne un score entre 0 et 1 ; les résultats sous 0.4 sont écartés.
// ---------------------------------------------------------------------------

export function tokenizeSearchText(value = '') {
  return normalizeSearchText(String(value || ''))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.replace(/^[-']+|[-']+$/g, ''))
    .filter(token => token.length >= 2 && !SEARCH_STOPWORDS.has(token))
}

export function relevanceScore(query, title, tags = []) {
  const queryTokens = tokenizeSearchText(query)
  if (!queryTokens.length) return 0
  const haystack = new Set(tokenizeSearchText(`${title || ''} ${(Array.isArray(tags) ? tags : [tags]).join(' ')}`))
  if (!haystack.size) return 0

  let matched = 0
  for (const token of queryTokens) {
    if (haystack.has(token)) {
      matched += 1
      continue
    }
    for (const entry of haystack) {
      if (entry.length >= 4 && (entry.startsWith(token) || token.startsWith(entry))) {
        matched += 1
        break
      }
    }
  }
  return matched / queryTokens.length
}

async function queryVariants(query) {
  const variants = [query]
  try {
    const { text } = await translateText(query, 'en', 'auto')
    const translated = String(text || '').trim()
    if (translated && translated.toLowerCase() !== query.toLowerCase()) variants.push(translated)
  } catch {
    // La traduction reste facultative : le scoring utilise alors la requête initiale.
  }
  return variants
}

function bestRelevance(variants, item) {
  if (item.synthetic) return 0.5
  let best = 0
  for (const variant of variants) {
    const score = relevanceScore(variant, item.title, item.tags)
    if (score > best) best = score
  }
  return best
}

function normalizeProviders(providers) {
  const requested = Array.isArray(providers) && providers.length
    ? providers.map(value => String(value || '').trim().toLowerCase())
    : DEFAULT_PROVIDERS
  return new Set(requested.filter(name => DEFAULT_PROVIDERS.includes(name)))
}

// ---------------------------------------------------------------------------
// Fournisseurs SFW
// ---------------------------------------------------------------------------

async function openverseSearch(query, modifiable, preferThumbnail, photoOnly) {
  const params = new URLSearchParams({ q: query, page_size: '20', mature: 'false' })
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
      provider: 'Openverse',
      tags: (item.tags || []).map(tag => tag.name || '').filter(Boolean)
    }))
}

async function commonsSearch(query, modifiable, photoOnly) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: photoOnly ? `${query} filemime:image/jpeg` : query,
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
      provider: 'Wikimedia Commons',
      tags: [page.title?.replace(/^File:/, '') || ''].filter(Boolean)
    }
  }).filter(item => {
    if (!item.imageUrl || containsBlockedTerm(item.title)) return false
    if (photoOnly && item.contentType && item.contentType !== 'image/jpeg') return false
    if (!modifiable) return true
    return /CC0|public domain|CC BY|CC-BY/i.test(item.license)
  })
}

async function pixabaySearch(query, apiKey, photoOnly) {
  if (!apiKey) return []
  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    image_type: photoOnly ? 'photo' : 'all',
    safesearch: 'true',
    per_page: '20',
    lang: 'fr'
  })
  const data = await fetchJson(`https://pixabay.com/api/?${params}`, { timeout: 20_000 })
  return (data.hits || []).map(hit => ({
    title: String(hit.tags || query),
    creator: String(hit.user || 'Pixabay'),
    license: 'Pixabay',
    imageUrl: String(hit.largeImageURL || hit.webformatURL || ''),
    sourceUrl: String(hit.pageURL || ''),
    contentType: 'image/jpeg',
    provider: 'Pixabay',
    tags: String(hit.tags || '').split(',').map(tag => tag.trim()).filter(Boolean)
  })).filter(item => item.imageUrl)
}

async function pexelsSearch(query, apiKey, photoOnly) {
  if (!apiKey) return []
  const params = new URLSearchParams({ query, per_page: '20', orientation: 'landscape' })
  const data = await fetchJson(`https://api.pexels.com/v1/search?${params}`, {
    timeout: 20_000,
    headers: { authorization: apiKey }
  })
  return (data.photos || []).map(photo => ({
    title: String(photo.alt || query),
    creator: String(photo.photographer || 'Pexels'),
    license: 'Pexels',
    imageUrl: String(photo.src?.large2x || photo.src?.large || photo.src?.original || ''),
    sourceUrl: String(photo.url || ''),
    contentType: 'image/jpeg',
    provider: 'Pexels',
    tags: [photo.alt || ''].filter(Boolean)
  })).filter(item => item.imageUrl && (!photoOnly || item.contentType === 'image/jpeg'))
}

// Scraping léger de Bing Images : les vignettes exposent un attribut m="…json…"
// contenant l’URL pleine résolution (murl), le titre (t) et la page source (purl).
async function bingImageSearch(query) {
  const params = new URLSearchParams({ q: query, form: 'HDRSC2', first: '1', safesearch: 'Strict' })
  const html = await fetchText(`https://www.bing.com/images/search?${params}`, {
    timeout: 15_000,
    retries: 1,
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    }
  })
  const results = []
  for (const match of html.matchAll(/\sm="([^"]+)"/g)) {
    if (results.length >= 30) break
    try {
      const meta = JSON.parse(decodeHtmlEntities(match[1]))
      if (!meta?.murl) continue
      results.push({
        title: String(meta.t || query),
        creator: 'Bing Images',
        license: 'Voir la page source',
        imageUrl: String(meta.murl),
        sourceUrl: String(meta.purl || meta.murl),
        contentType: '',
        provider: 'Bing Images',
        tags: []
      })
    } catch {
      // Attribut non JSON : ignoré.
    }
  }
  return results.filter(item => item.imageUrl && !containsBlockedTerm(item.title))
}

// Fournisseurs « par thème » : une image étiquetée avec la requête, utilisés
// uniquement comme appoint quand une vraie recherche est demandée.
function themeFallbackCandidates(query) {
  const tags = tokenizeSearchText(query).join(',') || query
  return [
    {
      title: query,
      creator: 'Unsplash',
      license: 'Unsplash',
      imageUrl: `https://source.unsplash.com/800x600/?${encodeURIComponent(query)}`,
      sourceUrl: 'https://unsplash.com/',
      contentType: '',
      provider: 'Unsplash Source',
      tags: [query],
      synthetic: true
    },
    {
      title: query,
      creator: 'Flickr',
      license: 'CC / Flickr',
      imageUrl: `https://loremflickr.com/800/600/${encodeURIComponent(tags)}`,
      sourceUrl: 'https://www.flickr.com/',
      contentType: '',
      provider: 'LoremFlickr',
      tags: [query],
      synthetic: true
    }
  ]
}

export async function searchInternetImages(input, {
  modifiable = false,
  preferThumbnail = false,
  includeFallback = false,
  photoOnly = false,
  minScore = DEFAULT_MIN_SCORE,
  limit = 20,
  providers,
  pixabayApiKey = '',
  pexelsApiKey = ''
} = {}) {
  const query = safeImageQuery(input)
  const enabled = normalizeProviders(providers)

  const tasks = []
  if (enabled.has('openverse')) tasks.push(() => openverseSearch(query, modifiable, preferThumbnail, photoOnly))
  if (enabled.has('commons')) tasks.push(() => commonsSearch(query, modifiable, photoOnly))
  if (!modifiable) {
    if (enabled.has('pixabay')) tasks.push(() => pixabaySearch(query, pixabayApiKey, photoOnly))
    if (enabled.has('pexels')) tasks.push(() => pexelsSearch(query, pexelsApiKey, photoOnly))
    if (enabled.has('bing')) tasks.push(() => bingImageSearch(query))
    if (includeFallback) {
      if (enabled.has('unsplash') || enabled.has('loremflickr')) {
        tasks.push(async () => themeFallbackCandidates(query).filter(item =>
          (item.provider === 'Unsplash Source' && enabled.has('unsplash')) ||
          (item.provider === 'LoremFlickr' && enabled.has('loremflickr'))
        ))
      }
    }
  }

  const [variants, settled] = await Promise.all([
    queryVariants(query),
    Promise.allSettled(tasks.map(run => run()))
  ])

  const candidates = []
  const seen = new Set()
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled' || !Array.isArray(outcome.value)) continue
    for (const item of outcome.value) {
      const key = String(item.imageUrl || item.sourceUrl || '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (containsBlockedTerm(`${item.title || ''} ${(item.tags || []).join(' ')}`)) continue
      candidates.push({ ...item, tags: item.tags || [], relevance: bestRelevance(variants, item) })
    }
  }

  const relevant = candidates
    .filter(item => item.relevance >= minScore)
    .sort((a, b) => b.relevance - a.relevance || Number(a.synthetic === true) - Number(b.synthetic === true))

  if (!relevant.length) {
    throw new UserError(`Aucune image pertinente trouvée pour « ${query} ». Reformule avec des mots-clés précis.`)
  }
  return relevant.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Recherche adulte (18+), avec vérification de pertinence
// ---------------------------------------------------------------------------

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
    provider: 'Openverse',
    tags: (item.tags || []).map(tag => tag.name || '').filter(Boolean)
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
      provider: 'Wikimedia Commons',
      tags: [page.title?.replace(/^File:/, '') || ''].filter(Boolean)
    }
  }).filter(item =>
    item.imageUrl &&
    item.contentType === 'image/jpeg' &&
    containsAdultHint(item.title) &&
    !containsForbiddenAdultTerm(item.title)
  )
}

export async function searchAdultImages(input, { minScore = DEFAULT_MIN_SCORE, limit = 12 } = {}) {
  const query = safeAdultImageQuery(input)
  const candidates = []
  const seen = new Set()
  let lastError
  for (const search of [openverseAdultSearch, commonsAdultSearch]) {
    try {
      const results = await search(query)
      for (const item of results) {
        const key = String(item.imageUrl || item.sourceUrl || '')
        if (!key || seen.has(key)) continue
        seen.add(key)
        candidates.push({ ...item, tags: item.tags || [], relevance: relevanceScore(query, item.title, item.tags) })
      }
    } catch (error) {
      lastError = error
    }
  }

  const relevant = candidates
    .filter(item => item.relevance >= minScore)
    .sort((a, b) => b.relevance - a.relevance)

  if (relevant.length) return relevant.slice(0, limit)
  if (lastError && !candidates.length) {
    throw asUserError(lastError, 'La recherche de contenu adulte a échoué')
  }
  throw new UserError(`Aucun contenu adulte pertinent trouvé pour « ${query} ».`)
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
    if (file.contentType === 'image/svg+xml') throw new Error('la ressource trouvée est un SVG non exploitable')
    if (photoOnly && !/^image\/jpe?g$/i.test(file.contentType)) {
      throw new Error('la ressource trouvée n’est pas une photo JPEG')
    }
    return file
  } catch (error) {
    throw asUserError(error, 'L’image trouvée n’a pas pu être téléchargée')
  }
}
