import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson } from './http.js'
import { decodeHtmlEntities } from '../utils/html.js'

async function jsonCascade(attempts, usable, message) {
  let lastError
  for (const attempt of attempts) {
    try {
      const data = await attempt()
      if (usable(data)) return data
      lastError = new Error('Le service a renvoyé une réponse vide ou inexploitable.')
    } catch (error) {
      lastError = error
    }
  }
  throw asUserError(lastError, message)
}

function uniqueUrls(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(value => /^https?:\/\//i.test(value)))]
}

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
    if ((!data?.responseStatus || Number(data.responseStatus) === 200) && translated && !/MYMEMORY WARNING|INVALID|QUERY LENGTH|PLEASE SELECT|USED ALL AVAILABLE/i.test(translated)) {
      return { text: translated, provider: 'MyMemory' }
    }
  } catch (error) {
    errors.push(error)
  }

  for (const base of ['https://translate.googleapis.com', 'https://translate.google.com']) {
    try {
      const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', q: query })
      const data = await fetchJson(`${base}/translate_a/single?${params}`, { timeout: 12_000, retries: 1 })
      const translated = Array.isArray(data?.[0])
        ? data[0].map(part => part?.[0] || '').join('').trim()
        : ''
      if (translated) return { text: translated, provider: 'Google Translate' }
    } catch (error) {
      errors.push(error)
    }
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

function lyricsText(data) {
  return String(data?.plainLyrics || data?.lyrics || data?.syncedLyrics || '')
    .replace(/^\[\d{1,2}:\d{2}(?:\.\d+)?\]\s*/gm, '').trim()
}

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
    const lyrics = lyricsText(data)
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
    const match = (Array.isArray(data) ? data : []).find(item =>
      lyricsText(item) && String(item.artistName || '').toLowerCase() === cleanArtist.toLowerCase() &&
      String(item.trackName || '').toLowerCase() === cleanTitle.toLowerCase()
    )
    const lyrics = lyricsText(match)
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
  const base = `https://${language}.wikipedia.org`
  let title = clean
  try {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: clean, srlimit: '1', format: 'json', utf8: '1' })
    const search = await fetchJson(`${base}/w/api.php?${params}`, { timeout: 12_000, retries: 1 })
    title = search?.query?.search?.[0]?.title || clean
  } catch {
    // La recherche n'est pas un prérequis : le titre saisi peut être une page valide.
  }
  const titlePath = encodeURIComponent(title.replace(/ /g, '_'))
  const params = new URLSearchParams({
    action: 'query', prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1',
    piprop: 'original|thumbnail', pithumbsize: '640', inprop: 'url', redirects: '1', titles: title, format: 'json'
  })
  const summary = await jsonCascade([
    () => fetchJson(`${base}/api/rest_v1/page/summary/${titlePath}`, { timeout: 12_000, retries: 1 }),
    async () => {
      const data = await fetchJson(`${base}/w/api.php?${params}`, { timeout: 12_000, retries: 1 })
      const page = Object.values(data?.query?.pages || {}).find(item => !('missing' in item) && item.extract)
      return page ? { ...page, originalimage: page.original, content_urls: { desktop: { page: page.fullurl } } } : null
    }
  ], data => Boolean(data?.extract), `Aucun résumé Wikipédia trouvé pour « ${clean} »`)
  const images = uniqueUrls([summary.originalimage?.source, summary.thumbnail?.source])
  return {
    title: String(summary.title || title), extract: String(summary.extract), description: String(summary.description || ''),
    url: String(summary.content_urls?.desktop?.page || `${base}/wiki/${titlePath}`), image: images[0] || '', images, language
  }
}

// ---------------------------------------------------------------------------
// Cryptomonnaies : CoinGecko (sans clé)
// ---------------------------------------------------------------------------

export async function cryptoPrice(ids) {
  const requested = [...new Set((Array.isArray(ids) ? ids : String(ids || '').split(/[\s,]+/))
    .map(value => String(value || '').trim().toLowerCase()).filter(Boolean))].slice(0, 8)
  if (!requested.length) throw new UserError('Indiquez au moins une cryptomonnaie.')
  const aliases = { btc: 'bitcoin', xbt: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin', doge: 'dogecoin', xrp: 'ripple' }
  const canonical = requested.map(id => aliases[id] || id)
  const errors = []

  async function pricesFor(tokens) {
    const params = new URLSearchParams({ ids: tokens.join(','), vs_currencies: 'usd,eur', include_24hr_change: 'true' })
    let data = {}
    try {
      const response = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?${params}`, { timeout: 12_000, retries: 1 })
      if (response && !Array.isArray(response) && typeof response === 'object') data = response
    } catch (error) {
      errors.push(error)
    }
    const missing = tokens.filter(id => !Number.isFinite(data[id]?.usd) && !Number.isFinite(data[id]?.eur))
    if (missing.length) {
      // Autre route CoinGecko lorsque /simple/price échoue ou ignore des IDs.
      const [usd, eur] = await Promise.all(['usd', 'eur'].map(async currency => {
        const marketParams = new URLSearchParams({ vs_currency: currency, ids: missing.join(','), price_change_percentage: '24h' })
        try {
          return await fetchJson(`https://api.coingecko.com/api/v3/coins/markets?${marketParams}`, { timeout: 12_000, retries: 1 })
        } catch (error) {
          errors.push(error)
          return []
        }
      }))
      for (const [currency, coins] of [['usd', usd], ['eur', eur]]) {
        for (const coin of Array.isArray(coins) ? coins : []) {
          if (missing.includes(coin.id) && Number.isFinite(coin.current_price)) {
            data[coin.id] = { ...data[coin.id], [currency]: coin.current_price, [`${currency}_24h_change`]: coin.price_change_percentage_24h }
          }
        }
      }
    }
    return data
  }

  const data = await pricesFor(canonical)
  for (const token of canonical.filter(id => !data[id]).slice(0, 4)) {
    try {
      const found = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(token)}`, { timeout: 12_000, retries: 1 })
      const coins = Array.isArray(found?.coins) ? found.coins : []
      const coin = coins.find(item => [item.id, item.symbol, item.name].some(value => String(value || '').toLowerCase() === token)) || coins[0]
      if (coin?.id) {
        const extra = await pricesFor([coin.id])
        if (extra[coin.id]) data[token] = extra[coin.id]
      }
    } catch (error) {
      errors.push(error)
    }
  }
  const result = {}
  for (const [index, token] of requested.entries()) {
    const price = data[canonical[index]]
    if (Number.isFinite(price?.usd) || Number.isFinite(price?.eur)) result[token] = price
  }
  if (!Object.keys(result).length) throw asUserError(errors.at(-1), 'Aucun cours CoinGecko disponible pour ces cryptomonnaies')
  return result
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

async function pokeResource(resource, identifier) {
  const github = 'https://api.github.com/repos/PokeAPI/api-data/contents/data/api/v2'
  const options = { timeout: 12_000, retries: 1 }
  return jsonCascade([
    () => fetchJson(`https://pokeapi.co/api/v2/${resource}/${encodeURIComponent(identifier)}`, options),
    async () => {
      const mirrorOptions = { ...options, headers: { accept: 'application/vnd.github.raw+json' } }
      let id = String(identifier)
      if (!/^\d+$/.test(id)) {
        const index = await fetchJson(`${github}/${resource}/index.json`, mirrorOptions)
        const match = index?.results?.find(entry => entry.name === id)
        id = match?.url?.match(/\/(\d+)\/?$/)?.[1] || ''
        if (!id) throw new Error('Nom absent du miroir officiel PokéAPI.')
      }
      return fetchJson(`${github}/${resource}/${id}/index.json`, mirrorOptions)
    }
  ], data => resource === 'pokemon-species' ? Array.isArray(data?.names) : Boolean(data?.id && data?.name), 'PokéAPI et son miroir officiel sont indisponibles')
}

export async function pokemonInfo(nameOrId) {
  const raw = String(nameOrId || '').trim().toLowerCase().replace(/^#/, '')
  if (!raw) throw new UserError('Indiquez un nom ou un numéro de Pokémon.')
  const pokemon = await pokeResource('pokemon', raw)
  let nameFr = ''
  let genusFr = ''
  try {
    const species = await pokeResource('pokemon-species', pokemon.species?.url?.match(/\/(\d+)\/?$/)?.[1] || pokemon.id)
    nameFr = String(species.names?.find(entry => entry.language?.name === 'fr')?.name || '')
    genusFr = String(species.genera?.find(entry => entry.language?.name === 'fr')?.genus || '')
  } catch {
    // Le nom français reste facultatif si les deux routes sont indisponibles.
  }
  const images = uniqueUrls([
    pokemon.sprites?.other?.['official-artwork']?.front_default,
    pokemon.sprites?.other?.home?.front_default, pokemon.sprites?.front_default
  ])
  return {
    id: pokemon.id, name: String(pokemon.name || raw), nameFr, genusFr,
    types: (pokemon.types || []).map(entry => entry?.type?.name).filter(Boolean),
    height: Number(pokemon.height) || 0, weight: Number(pokemon.weight) || 0,
    abilities: (pokemon.abilities || []).map(entry => entry?.ability?.name).filter(Boolean),
    image: images[0] || '', images
  }
}

// ---------------------------------------------------------------------------
// REST Countries v3.1
// ---------------------------------------------------------------------------

export async function countryInfo(name) {
  const query = String(name || '').trim().slice(0, 100)
  if (!query) throw new UserError('Indiquez un pays, par exemple : .country Congo')
  const fields = 'name,capital,population,flags,currencies,languages,cca2'
  const attempts = ['name', 'translation', ...(/^[a-z]{2,3}$/i.test(query) ? ['alpha'] : [])].map(route => async () => {
    const data = await fetchJson(`https://restcountries.com/v3.1/${route}/${encodeURIComponent(query)}?fields=${fields}`, { timeout: 12_000, retries: 1 })
    const countries = Array.isArray(data) ? data : [data]
    return countries.find(item => String(item?.name?.common || '').toLowerCase() === query.toLowerCase()) || countries[0]
  })
  const country = await jsonCascade(attempts, data => Boolean(data?.name?.common), `Pays introuvable pour « ${query} »`)
  const code = String(country.cca2 || '').toLowerCase()
  const flagUrls = uniqueUrls([country.flags?.png, /^[a-z]{2}$/.test(code) ? `https://flagcdn.com/w640/${code}.png` : ''])
  return {
    name: String(country.name.common), officialName: String(country.name.official || ''),
    capital: Array.isArray(country.capital) ? country.capital.join(', ') : String(country.capital || ''),
    population: Number.isFinite(country.population) ? country.population : null,
    flag: flagUrls[0] || '', flagUrls, flagAlt: String(country.flags?.alt || ''),
    currencies: Object.entries(country.currencies || {}).map(([currency, info]) =>
      `${currency} — ${info?.name || 'devise'}${info?.symbol ? ` (${info.symbol})` : ''}`
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
    return await jsonCascade([
      async () => (await fetchJson('https://catfact.ninja/fact', { timeout: 10_000, retries: 1 }))?.fact,
      async () => (await fetchJson('https://meowfacts.herokuapp.com/', { timeout: 10_000, retries: 1 }))?.data?.[0]
    ], data => typeof data === 'string' && Boolean(data.trim()), 'Faits sur les chats indisponibles')
  } catch {
    return CAT_FACTS_FALLBACK[Math.floor(Math.random() * CAT_FACTS_FALLBACK.length)]
  }
}

export async function dogImageUrl({ excludedUrls = [] } = {}) {
  return jsonCascade([
    async () => (await fetchJson('https://dog.ceo/api/breeds/image/random', { timeout: 10_000, retries: 1 }))?.message,
    async () => (await fetchJson('https://random.dog/woof.json', { timeout: 10_000, retries: 1 }))?.url,
    async () => (await fetchJson('https://dog.ceo/api/breed/retriever/images/random', { timeout: 10_000, retries: 1 }))?.message
  ], url => typeof url === 'string' && /^https?:\/\//i.test(url) &&
    !/\.(mp4|webm|mov|gif)(?:[?#]|$)/i.test(url) && !excludedUrls.includes(url), 'Aucune photo de chien disponible pour le moment')
}

export async function randomQuote() {
  try {
    return await jsonCascade([
      async () => {
        const data = await fetchJson('https://api.quotable.io/random', { timeout: 10_000, retries: 1 })
        return { quote: String(data?.content || '').trim(), author: String(data?.author || 'Anonyme') }
      },
      async () => {
        const data = await fetchJson('https://zenquotes.io/api/random', { timeout: 10_000, retries: 1 })
        return { quote: String(data?.[0]?.q || '').trim(), author: String(data?.[0]?.a || 'Anonyme') }
      }
    ], data => Boolean(data?.quote), 'Citations indisponibles')
  } catch {
    return QUOTES_FALLBACK[Math.floor(Math.random() * QUOTES_FALLBACK.length)]
  }
}

// ---------------------------------------------------------------------------
// Comics XKCD (avec image jointe)
// ---------------------------------------------------------------------------

async function xkcdInfo(target) {
  const path = target === 'latest' ? '/info.0.json' : `/${target}/info.0.json`
  return jsonCascade(['https://xkcd.com', 'https://www.xkcd.com'].map(base =>
    () => fetchJson(`${base}${path}`, { timeout: 12_000, retries: 1 })
  ), data => Boolean(data?.img && Number(data.num) > 0), 'Le comic XKCD demandé est introuvable')
}

export async function xkcd(num) {
  const raw = String(num ?? '').trim().toLowerCase()
  let target = raw || 'latest'
  if (['random', 'aléatoire', 'aleatoire'].includes(raw)) {
    const latest = await xkcdInfo('latest')
    const max = Math.max(1, Number(latest.num))
    // Le numéro 404 est volontairement absent du catalogue XKCD.
    target = String(1 + Math.floor(Math.random() * (max >= 404 ? max - 1 : max)))
    if (Number(target) >= 404) target = String(Number(target) + 1)
  } else if (target !== 'latest' && !/^[1-9]\d*$/.test(target)) {
    throw new UserError('Indiquez un numéro XKCD positif, latest ou random.')
  }
  const info = await xkcdInfo(target)
  let file
  try {
    file = await fetchExternalBuffer(info.img, { maxBytes: 10 * 1024 * 1024, timeout: 30_000 })
    if (!file.buffer.length || !file.contentType.startsWith('image/') || file.contentType === 'image/svg+xml') {
      throw new Error('XKCD n’a pas renvoyé une image exploitable.')
    }
  } catch (error) {
    throw asUserError(error, 'L’image du comic XKCD n’a pas pu être téléchargée')
  }
  return {
    num: info.num, title: String(info.title || `XKCD ${info.num}`), img: String(info.img),
    alt: String(info.alt || ''), year: String(info.year || ''), buffer: file.buffer, contentType: file.contentType
  }
}

// ---------------------------------------------------------------------------
// Quiz : The Trivia API → OpenTDB
// ---------------------------------------------------------------------------

function decodeTriviaEntities(value = '') {
  return decodeHtmlEntities(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

export async function triviaQuestion() {
  const errors = []

  try {
    const data = await fetchJson('https://the-trivia-api.com/v2/questions?limit=1&type=multiple', { timeout: 12_000, retries: 1 })
    const item = Array.isArray(data) ? data[0] : null
    const question = decodeTriviaEntities(item?.question?.question || item?.question || '')
    const correct = decodeTriviaEntities(item?.correctAnswer || '')
    if (question && correct && Array.isArray(item?.incorrectAnswers) && item.incorrectAnswers.length >= 3) {
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
    if (question && correct && Array.isArray(item?.incorrect_answers) && item.incorrect_answers.length >= 3) {
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
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new UserError('Indiquez un nombre entier sûr, par exemple : .number 42')
  }
  // Numbers API peut ne pas servir HTTPS : son endpoint HTTP est le repli.
  const data = await jsonCascade([
    `https://numbersapi.com/${value}?json`,
    `http://numbersapi.com/${value}?json`,
    `http://numbersapi.com/${value}/trivia?json`
  ].map(url => () => fetchJson(url, { timeout: 10_000, retries: 1 })),
  item => Boolean(item?.text), 'Le service de faits numériques est momentanément indisponible')
  return { number: Number(value), fact: String(data.text).trim(), type: String(data.type || ''), found: data.found !== false }
}

// ---------------------------------------------------------------------------
// Picsum : photo aléatoire
// ---------------------------------------------------------------------------

export function picsumUrl(width = 800, height = 600, seed = '') {
  const w = Math.min(1600, Math.max(200, Number.parseInt(width, 10) || 800))
  const h = Math.min(1600, Math.max(200, Number.parseInt(height, 10) || 600))
  return `https://picsum.photos/${seed ? `seed/${encodeURIComponent(String(seed).slice(0, 60))}/` : ''}${w}/${h}`
}

// ---------------------------------------------------------------------------
// Rick & Morty API
// ---------------------------------------------------------------------------

export async function rickMortyCharacter(id) {
  const raw = String(id ?? '').trim()
  if (raw && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) {
    throw new UserError('Indiquez un identifiant positif de personnage ou laisse vide.')
  }
  const target = raw || String(1 + Math.floor(Math.random() * 826))
  const data = await jsonCascade([
    () => fetchJson(`https://rickandmortyapi.com/api/character/${target}`, { timeout: 12_000, retries: 1 }),
    async () => {
      const response = await fetchJson('https://rickandmortyapi.com/graphql', {
        method: 'POST', timeout: 12_000, retries: 1, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `query { character(id: ${target}) { id name status species gender image origin { name } location { name } episode { id } } }` })
      })
      return response?.data?.character
    }
  ], item => Boolean(item?.id && item?.name), `Le personnage Rick & Morty « ${target} » est introuvable`)
  return {
    id: Number(data.id), name: String(data.name), status: String(data.status || ''), species: String(data.species || ''),
    gender: String(data.gender || ''), image: String(data.image || ''), origin: String(data.origin?.name || 'inconnu'),
    location: String(data.location?.name || 'inconnue'), episodeCount: Array.isArray(data.episode) ? data.episode.length : 0
  }
}

// ---------------------------------------------------------------------------
// Recherche YouTube de repli sur les instances Invidious
// ---------------------------------------------------------------------------

export const DEFAULT_INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks'
]

export async function searchYouTubeInvidious(query, { instances, timeout = 8_000, limit = 5 } = {}) {
  const clean = String(query || '').trim().slice(0, 180)
  if (!clean) throw new UserError('Indiquez une recherche YouTube.')
  const configured = (Array.isArray(instances) ? instances : [])
    .map(value => String(value || '').trim().replace(/\/+$/, '')).filter(Boolean).slice(0, 8)
  const list = [...new Set([...configured, ...DEFAULT_INVIDIOUS_INSTANCES])]
  const count = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 5))
  const errors = []

  for (const base of list) {
    try {
      const params = new URLSearchParams({ q: clean, type: 'video', sort_by: 'relevance' })
      const data = await fetchJson(`${base}/api/v1/search?${params}`, { timeout, retries: 1 })
      const items = (Array.isArray(data) ? data : data?.items || [])
        .filter(item => !item.type || item.type === 'video')
      const results = items.map(item => ({
        title: decodeHtmlEntities(item.title || '').trim(),
        author: decodeHtmlEntities(item.author || item.authorName || '').trim(),
        description: decodeHtmlEntities(item.description || '').slice(0, 300),
        url: item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : '',
        videoId: String(item.videoId || ''),
        duration: Number(item.lengthSeconds) || 0
      })).filter(item => item.title && /^[A-Za-z0-9_-]{6,}$/.test(item.videoId)).slice(0, count)
      if (results.length) return { results, provider: new URL(base).hostname }
    } catch (error) {
      errors.push(error)
    }
  }

  throw asUserError(errors.at(-1), 'Aucune instance Invidious disponible pour cette recherche YouTube.')
}
