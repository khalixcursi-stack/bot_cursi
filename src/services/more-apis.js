import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson } from './http.js'

// ---------------------------------------------------------------------------
// Traduction : MyMemory → Google Translate (non officiel) → LibreTranslate
// ---------------------------------------------------------------------------

const LIBRE_TRANSLATE_INSTANCES = [
  'https://libretranslate.com',
  'https://translate.argosopentech.com',
  'https://libretranslate.de'
]

export async function translateText(text, target = 'fr', source = 'auto') {
  const query = String(text || '').trim().slice(0, 1500)
  if (!query) throw new UserError('Indiquez un texte à traduire.')
  const to = String(target || 'fr').toLowerCase().slice(0, 12)
  const from = String(source || 'auto').toLowerCase().slice(0, 12)
  const errors = []

  try {
    const langpair = `${from === 'auto' ? 'Autodetect' : from}|${to}`
    const data = await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=${encodeURIComponent(langpair)}`, {
      timeout: 12_000, retries: 1
    })
    const translated = String(data?.responseData?.translatedText || '').trim()
    if (translated && !/MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(translated)) {
      return { text: translated, provider: 'MyMemory' }
    }
  } catch (error) {
    errors.push(error)
  }

  try {
    const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', q: query })
    const data = await fetchJson(`https://translate.googleapis.com/translate_a/single?${params}`, { timeout: 12_000, retries: 1 })
    const translated = Array.isArray(data?.[0])
      ? data[0].map(part => part?.[0] || '').join('').trim()
      : ''
    if (translated) return { text: translated, provider: 'Google Translate' }
  } catch (error) {
    errors.push(error)
  }

  for (const instance of LIBRE_TRANSLATE_INSTANCES) {
    try {
      const data = await fetchJson(`${instance}/translate`, {
        method: 'POST',
        timeout: 12_000,
        retries: 1,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query, source: from === 'auto' ? 'auto' : from, target: to, format: 'text' })
      })
      const translated = String(data?.translatedText || '').trim()
      if (translated) return { text: translated, provider: 'LibreTranslate' }
    } catch (error) {
      errors.push(error)
    }
  }

  throw asUserError(errors.at(-1), 'Aucun service de traduction disponible pour le moment')
}

// ---------------------------------------------------------------------------
// Paroles : lrclib.net (priorité) → lyrics.ovh
// ---------------------------------------------------------------------------

export async function fetchLyrics(artist, title) {
  const cleanArtist = String(artist || '').trim()
  const cleanTitle = String(title || '').trim()
  if (!cleanArtist || !cleanTitle) {
    throw new UserError('Indiquez un artiste et un titre, par exemple : Coldplay | Yellow')
  }
  const errors = []

  try {
    const params = new URLSearchParams({ artist_name: cleanArtist, track_name: cleanTitle })
    const data = await fetchJson(`https://lrclib.net/api/get?${params}`, { timeout: 12_000, retries: 1 })
    const lyrics = String(data?.plainLyrics || data?.lyrics || '').trim()
    if (lyrics) {
      return {
        lyrics,
        artist: String(data.artistName || cleanArtist),
        title: String(data.trackName || cleanTitle),
        provider: 'lrclib.net'
      }
    }
  } catch (error) {
    errors.push(error)
  }

  try {
    const params = new URLSearchParams({ q: `${cleanArtist} ${cleanTitle}` })
    const data = await fetchJson(`https://lrclib.net/api/search?${params}`, { timeout: 12_000, retries: 1 })
    const match = (Array.isArray(data) ? data : []).find(item => item?.plainLyrics || item?.lyrics)
    const lyrics = String(match?.plainLyrics || match?.lyrics || '').trim()
    if (lyrics) {
      return {
        lyrics,
        artist: String(match.artistName || cleanArtist),
        title: String(match.trackName || cleanTitle),
        provider: 'lrclib.net'
      }
    }
  } catch (error) {
    errors.push(error)
  }

  try {
    const data = await fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`, {
      timeout: 15_000, retries: 1
    })
    const lyrics = String(data?.lyrics || '').trim()
    if (lyrics) return { lyrics, artist: cleanArtist, title: cleanTitle, provider: 'lyrics.ovh' }
  } catch (error) {
    errors.push(error)
  }

  throw asUserError(errors.at(-1), `Paroles introuvables pour « ${cleanArtist} — ${cleanTitle} »`)
}

// ---------------------------------------------------------------------------
// Wikipédia : API action (recherche) + REST (résumé), multi-langues
// ---------------------------------------------------------------------------

export const WIKIPEDIA_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ar', 'ru']

export function normalizeWikipediaLang(lang) {
  const value = String(lang || '').toLowerCase().slice(0, 8)
  return WIKIPEDIA_LANGUAGES.includes(value) ? value : ''
}

export async function wikipediaSummary(query, lang = 'fr') {
  const clean = String(query || '').trim().slice(0, 240)
  if (!clean) throw new UserError('Indiquez un terme à rechercher sur Wikipédia.')
  const language = normalizeWikipediaLang(lang) || 'fr'

  const search = await fetchJson(
    `https://${language}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(clean)}&srlimit=1&format=json&utf8=1`,
    { timeout: 15_000 }
  )
  const hit = search?.query?.search?.[0]
  if (!hit?.title) throw new UserError(`Aucun article Wikipédia trouvé pour « ${clean} ».`)

  const titlePath = encodeURIComponent(hit.title.replace(/ /g, '_'))
  const summary = await fetchJson(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${titlePath}`, { timeout: 15_000 })
  return {
    title: String(summary?.title || hit.title),
    extract: String(summary?.extract || ''),
    description: String(summary?.description || ''),
    url: String(summary?.content_urls?.desktop?.page || `https://${language}.wikipedia.org/wiki/${titlePath}`),
    image: String(summary?.originalimage?.source || summary?.thumbnail?.source || ''),
    language
  }
}

// ---------------------------------------------------------------------------
// Cryptomonnaies : CoinGecko (sans clé)
// ---------------------------------------------------------------------------

export async function cryptoPrice(ids) {
  const idsToQuery = (Array.isArray(ids) ? ids : String(ids || '').split(/[\s,]+/))
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
  if (!idsToQuery.length) throw new UserError('Indiquez au moins une cryptomonnaie.')

  const params = new URLSearchParams({
    ids: idsToQuery.join(','),
    vs_currencies: 'usd,eur',
    include_24hr_change: 'true'
  })
  let data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?${params}`, { timeout: 15_000 })

  // Les symboles courts (btc, eth…) ne sont pas des identifiants CoinGecko :
  // on tente une recherche pour compléter les jetons absents de la réponse.
  const missing = idsToQuery.filter(id => !data?.[id])
  if (missing.length) {
    const extra = []
    for (const token of missing.slice(0, 4)) {
      try {
        const found = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(token)}`, {
          timeout: 12_000, retries: 1
        })
        const coin = (found?.coins || []).find(item =>
          String(item.id || '').toLowerCase() === token ||
          String(item.symbol || '').toLowerCase() === token ||
          String(item.name || '').toLowerCase() === token
        ) || found?.coins?.[0]
        if (coin?.id) extra.push(coin.id)
      } catch {
        // La recherche reste facultative : on ignore silencieusement cet identifiant.
      }
    }
    if (extra.length) {
      const second = new URLSearchParams({
        ids: [...idsToQuery, ...extra].join(','),
        vs_currencies: 'usd,eur',
        include_24hr_change: 'true'
      })
      data = { ...data, ...await fetchJson(`https://api.coingecko.com/api/v3/simple/price?${second}`, { timeout: 15_000 }) }
    }
  }
  return data || {}
}

// ---------------------------------------------------------------------------
// PokéAPI : fiche Pokémon avec artwork officiel et nom français
// ---------------------------------------------------------------------------

const TYPE_FR = {
  normal: 'Normal', fire: 'Feu', water: 'Eau', electric: 'Électrique', grass: 'Plante',
  ice: 'Glace', fighting: 'Combat', poison: 'Poison', ground: 'Sol', flying: 'Vol',
  psychic: 'Psy', bug: 'Insecte', rock: 'Roche', ghost: 'Spectre', dragon: 'Dragon',
  dark: 'Ténèbres', steel: 'Acier', fairy: 'Fée', stellar: 'Astrale', unknown: 'Inconnu'
}

export function pokemonTypeNameFr(type) {
  const key = String(type || '').toLowerCase()
  return TYPE_FR[key] || String(type || '').trim()
}

export async function pokemonInfo(nameOrId) {
  const raw = String(nameOrId || '').trim().toLowerCase().replace(/^#/, '')
  if (!raw) throw new UserError('Indiquez un nom ou un numéro de Pokémon.')

  let pokemon
  try {
    pokemon = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(raw)}`, { timeout: 15_000 })
  } catch (error) {
    throw asUserError(error, `Pokémon introuvable pour « ${raw} »`)
  }

  let nameFr = ''
  let genusFr = ''
  try {
    const species = await fetchJson(`https://pokeapi.co/api/v2/pokemon-species/${pokemon.id}`, { timeout: 15_000, retries: 1 })
    nameFr = String(species?.names?.find(entry => entry.language?.name === 'fr')?.name || '')
    genusFr = String(species?.genera?.find(entry => entry.language?.name === 'fr')?.genus || '')
  } catch {
    // Le nom français reste facultatif.
  }

  return {
    id: pokemon.id,
    name: String(pokemon.name || raw),
    nameFr,
    genusFr,
    types: (pokemon.types || []).map(entry => entry?.type?.name).filter(Boolean),
    height: Number(pokemon.height) || 0,
    weight: Number(pokemon.weight) || 0,
    abilities: (pokemon.abilities || []).map(entry => entry?.ability?.name).filter(Boolean),
    image: String(
      pokemon.sprites?.other?.['official-artwork']?.front_default ||
      pokemon.sprites?.other?.home?.front_default ||
      pokemon.sprites?.front_default ||
      ''
    )
  }
}

// ---------------------------------------------------------------------------
// REST Countries v3.1
// ---------------------------------------------------------------------------

export async function countryInfo(name) {
  const query = String(name || '').trim()
  if (!query) throw new UserError('Indiquez un pays, par exemple : .country Congo')

  let data
  try {
    const fields = 'name,capital,population,flags,currencies,languages'
    data = await fetchJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=${fields}`, { timeout: 15_000 })
  } catch (error) {
    throw asUserError(error, `Pays introuvable pour « ${query} »`)
  }
  const country = Array.isArray(data) ? data[0] : data
  if (!country) throw new UserError(`Pays introuvable pour « ${query} ».`)

  return {
    name: String(country.name?.common || query),
    officialName: String(country.name?.official || ''),
    capital: Array.isArray(country.capital) ? country.capital.join(', ') : String(country.capital || ''),
    population: Number.isFinite(country.population) ? country.population : null,
    flag: String(country.flags?.png || country.flags?.svg || ''),
    flagAlt: String(country.flags?.alt || ''),
    currencies: Object.entries(country.currencies || {}).map(([code, info]) =>
      `${code} — ${info?.name || 'devise'}${info?.symbol ? ` (${info.symbol})` : ''}`
    ),
    languages: Object.values(country.languages || {}).map(String)
  }
}

// ---------------------------------------------------------------------------
// Prénoms : Agify + Genderize + Nationalize en parallèle
// ---------------------------------------------------------------------------

export async function nameInfo(name) {
  const clean = String(name || '').trim().slice(0, 60)
  if (!clean) throw new UserError('Indiquez un prénom, par exemple : .nameguess Marie')
  const target = encodeURIComponent(clean)

  const [age, gender, nationality] = await Promise.all([
    fetchJson(`https://api.agify.io?name=${target}`, { timeout: 10_000, retries: 1 }).catch(() => null),
    fetchJson(`https://api.genderize.io?name=${target}`, { timeout: 10_000, retries: 1 }).catch(() => null),
    fetchJson(`https://api.nationalize.io?name=${target}`, { timeout: 10_000, retries: 1 }).catch(() => null)
  ])

  const nationalities = (nationality?.country || [])
    .slice(0, 3)
    .map(item => ({ country: String(item.country_id || ''), probability: Number(item.probability) || 0 }))
    .filter(item => item.country)

  if (age?.age == null && !gender?.gender && !nationalities.length) {
    throw new UserError(`Aucune estimation trouvée pour le prénom « ${clean} ».`)
  }

  return {
    name: clean,
    age: Number.isFinite(age?.age) ? age.age : null,
    ageCount: Number.isFinite(age?.count) ? age.count : null,
    gender: gender?.gender ? String(gender.gender) : null,
    genderProbability: Number.isFinite(gender?.probability) ? gender.probability : null,
    nationality: nationalities[0]?.country || null,
    nationalities
  }
}

// ---------------------------------------------------------------------------
// Faits, citations, animaux
// ---------------------------------------------------------------------------

const CAT_FACTS_FALLBACK = [
  'Un chat passe en moyenne 70 % de sa vie à dormir.',
  'Les chats ont plus de 20 muscles dédiés au mouvement de leurs oreilles.',
  'Le ronronnement d’un chat se situe généralement entre 25 et 150 Hz.',
  'Un chat peut sauter jusqu’à cinq fois sa propre hauteur.',
  'Le nez d’un chat est unique, comme une empreinte digitale humaine.'
]

const QUOTES_FALLBACK = [
  { quote: 'La simplicité est la sophistication suprême.', author: 'Léonard de Vinci' },
  { quote: 'Ce qui ne me tue pas me rend plus fort.', author: 'Friedrich Nietzsche' },
  { quote: 'La vie est un défi à relever, un bonheur à mériter.', author: 'Mère Teresa' },
  { quote: 'Il n’y a qu’une façon d’apprendre, c’est par l’action.', author: 'Paulo Coelho' }
]

export async function catFact() {
  try {
    const data = await fetchJson('https://catfact.ninja/fact', { timeout: 10_000, retries: 1 })
    const fact = String(data?.fact || '').trim()
    if (fact) return fact
  } catch {
    // Repli local ci-dessous.
  }
  return CAT_FACTS_FALLBACK[Math.floor(Math.random() * CAT_FACTS_FALLBACK.length)]
}

export async function dogImageUrl() {
  const data = await fetchJson('https://dog.ceo/api/breeds/image/random', { timeout: 10_000, retries: 2 })
  const url = String(data?.message || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new UserError('Aucune photo de chien disponible pour le moment.')
  return url
}

export async function randomQuote() {
  try {
    const data = await fetchJson('https://api.quotable.io/random', { timeout: 10_000, retries: 1 })
    const quote = String(data?.content || '').trim()
    if (quote) return { quote, author: String(data.author || 'Anonyme') }
  } catch {
    // Repli local ci-dessous.
  }
  return QUOTES_FALLBACK[Math.floor(Math.random() * QUOTES_FALLBACK.length)]
}

// ---------------------------------------------------------------------------
// Comics XKCD (avec image jointe)
// ---------------------------------------------------------------------------

export async function xkcd(num) {
  const raw = String(num ?? '').trim().toLowerCase()
  let target = raw

  if (['random', 'aléatoire', 'aleatoire'].includes(raw)) {
    try {
      const latest = await fetchJson('https://xkcd.com/info.0.json', { timeout: 12_000, retries: 1 })
      const max = Number(latest?.num) || 1
      target = String(1 + Math.floor(Math.random() * max))
    } catch (error) {
      throw asUserError(error, 'Impossible de choisir un comic XKCD aléatoire')
    }
  } else if (!raw) {
    target = 'latest'
  }

  let info
  try {
    info = await fetchJson(
      target === 'latest' ? 'https://xkcd.com/info.0.json' : `https://xkcd.com/${encodeURIComponent(target)}/info.0.json`,
      { timeout: 12_000, retries: 1 }
    )
  } catch (error) {
    throw asUserError(error, `Le comic XKCD « ${raw || 'dernier'} » est introuvable`)
  }
  if (!info?.img) throw new UserError('Le comic XKCD demandé n’a pas d’image exploitable.')

  let file
  try {
    file = await fetchExternalBuffer(info.img, { maxBytes: 10 * 1024 * 1024, timeout: 30_000 })
  } catch (error) {
    throw asUserError(error, 'L’image du comic XKCD n’a pas pu être téléchargée')
  }
  return {
    num: info.num,
    title: String(info.title || `XKCD ${info.num}`),
    img: String(info.img),
    alt: String(info.alt || ''),
    year: String(info.year || ''),
    buffer: file.buffer,
    contentType: file.contentType.startsWith('image/') ? file.contentType : 'image/png'
  }
}

// ---------------------------------------------------------------------------
// Quiz : The Trivia API → OpenTDB
// ---------------------------------------------------------------------------

function decodeTriviaEntities(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, '')
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
    .replace(/\s+/g, ' ')
    .trim()
}

export async function triviaQuestion() {
  const errors = []

  try {
    const data = await fetchJson('https://the-trivia-api.com/v2/questions?limit=1&type=multiple', { timeout: 12_000, retries: 1 })
    const item = Array.isArray(data) ? data[0] : null
    const question = decodeTriviaEntities(item?.question?.question || item?.question || '')
    const correct = decodeTriviaEntities(item?.correctAnswer || '')
    if (question && correct) {
      return {
        question,
        correct,
        incorrect: (item.incorrectAnswers || []).map(decodeTriviaEntities).filter(Boolean).slice(0, 3),
        category: decodeTriviaEntities(item.category || 'Culture générale'),
        difficulty: String(item.difficulty || ''),
        provider: 'The Trivia API'
      }
    }
  } catch (error) {
    errors.push(error)
  }

  try {
    const data = await fetchJson('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 12_000, retries: 1 })
    const item = data?.results?.[0]
    const question = decodeTriviaEntities(item?.question || '')
    const correct = decodeTriviaEntities(item?.correct_answer || '')
    if (question && correct) {
      return {
        question,
        correct,
        incorrect: (item.incorrect_answers || []).map(decodeTriviaEntities).filter(Boolean).slice(0, 3),
        category: decodeTriviaEntities(item.category || 'Culture générale'),
        difficulty: String(item.difficulty || ''),
        provider: 'OpenTDB'
      }
    }
  } catch (error) {
    errors.push(error)
  }

  throw asUserError(errors.at(-1), 'Le quiz est momentanément indisponible, réessaie dans un instant.')
}

// ---------------------------------------------------------------------------
// Nombres : Numbers API
// ---------------------------------------------------------------------------

export async function numberFact(n) {
  const value = String(n ?? '').trim()
  if (!/^-?\d+$/.test(value)) throw new UserError('Indiquez un nombre entier, par exemple : .number 42')

  let data
  try {
    data = await fetchJson(`https://numbersapi.com/${value}?json`, { timeout: 12_000, retries: 1 })
  } catch (error) {
    throw asUserError(error, 'Le service de faits numériques est momentanément indisponible')
  }
  const fact = String(data?.text || '').trim()
  if (!fact) throw new UserError(`Aucun fait insolite trouvé pour le nombre ${value}.`)
  return { number: Number(value), fact, type: String(data.type || ''), found: data.found !== false }
}

// ---------------------------------------------------------------------------
// Picsum : photo aléatoire
// ---------------------------------------------------------------------------

export function picsumUrl(width = 800, height = 600) {
  const w = Math.min(1600, Math.max(200, Number.parseInt(width, 10) || 800))
  const h = Math.min(1600, Math.max(200, Number.parseInt(height, 10) || 600))
  return `https://picsum.photos/${w}/${h}`
}

// ---------------------------------------------------------------------------
// Rick & Morty API
// ---------------------------------------------------------------------------

export async function rickMortyCharacter(id) {
  const raw = String(id ?? '').trim()
  if (raw && !/^\d+$/.test(raw)) throw new UserError('Indiquez un identifiant numérique de personnage ou laisse vide.')
  const target = raw || String(1 + Math.floor(Math.random() * 826))

  let data
  try {
    data = await fetchJson(`https://rickandmortyapi.com/api/character/${encodeURIComponent(target)}`, { timeout: 12_000, retries: 1 })
  } catch (error) {
    throw asUserError(error, `Le personnage Rick & Morty « ${target} » est introuvable`)
  }

  return {
    id: data.id,
    name: String(data.name || ''),
    status: String(data.status || ''),
    species: String(data.species || ''),
    gender: String(data.gender || ''),
    image: String(data.image || ''),
    origin: String(data.origin?.name || 'inconnu'),
    location: String(data.location?.name || 'inconnue'),
    episodeCount: Array.isArray(data.episode) ? data.episode.length : 0
  }
}

// ---------------------------------------------------------------------------
// Recherche YouTube de repli sur les instances Invidious
// ---------------------------------------------------------------------------

export const DEFAULT_INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks',
  'https://invidious.f5.si'
]

export async function searchYouTubeInvidious(query, { instances, timeout = 8_000, limit = 5 } = {}) {
  const clean = String(query || '').trim().slice(0, 180)
  if (!clean) throw new UserError('Indiquez une recherche YouTube.')
  const list = (Array.isArray(instances) && instances.length ? instances : DEFAULT_INVIDIOUS_INSTANCES)
    .map(value => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean)
    .slice(0, 6)
  const errors = []

  for (const base of list) {
    try {
      const params = new URLSearchParams({ q: clean, type: 'video', sort_by: 'relevance' })
      const data = await fetchJson(`${base}/api/v1/search?${params}`, { timeout, retries: 1 })
      const items = (Array.isArray(data) ? data : data?.items || [])
        .filter(item => !item.type || item.type === 'video')
      const results = items.map(item => ({
        title: String(item.title || '').trim(),
        author: String(item.author || item.authorName || '').trim(),
        description: String(item.description || '').slice(0, 300),
        url: item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : '',
        videoId: String(item.videoId || ''),
        duration: Number(item.lengthSeconds) || 0
      })).filter(item => item.title && item.url).slice(0, limit)
      if (results.length) return { results, provider: new URL(base).hostname }
    } catch (error) {
      errors.push(error)
    }
  }

  throw asUserError(errors.at(-1), 'Aucune instance Invidious disponible pour cette recherche YouTube.')
}
