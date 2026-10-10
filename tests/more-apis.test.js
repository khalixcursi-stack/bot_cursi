import test from 'node:test'
import assert from 'node:assert/strict'
import {
  catFact,
  cryptoPrice,
  fetchLyrics,
  numberFact,
  pokemonInfo,
  searchYouTubeInvidious,
  translateText,
  wikipediaSummary
} from '../src/services/more-apis.js'

async function withFetch(routes, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    calls.push({ target, options })
    const route = routes.find(([pattern]) => pattern.test(target))
    if (!route) return new Response('not found', { status: 404 })
    const [pattern, payload, status = 200] = route
    void pattern
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
    return new Response(body, { status, headers: { 'content-type': typeof payload === 'string' ? 'text/plain' : 'application/json' } })
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

test('translateText bascule MyMemory → Google puis LibreTranslate', async () => {
  await withFetch([
    [/translate\.googleapis\.com/, [[['Hello world', 'Hello world', null, null]]]],
    [/api\.mymemory\.translated\.net/, { responseData: { translatedText: '' }, responseStatus: 200 }]
  ], async () => {
    const result = await translateText('Bonjour le monde', 'en')
    assert.equal(result.text, 'Hello world')
    assert.equal(result.provider, 'Google Translate')
  })

  await withFetch([
    [/api\.mymemory\.translated\.net/, { responseData: { translatedText: 'Hello world' }, responseStatus: 200 }]
  ], async () => {
    const result = await translateText('Bonjour le monde', 'en')
    assert.equal(result.provider, 'MyMemory')
    assert.equal(result.text, 'Hello world')
  })
})

test('fetchLyrics interroge lrclib.net avant lyrics.ovh', async () => {
  await withFetch([
    [/lrclib\.net\/api\/get/, { plainLyrics: 'Look at the stars', artistName: 'Coldplay', trackName: 'Yellow' }]
  ], async calls => {
    const result = await fetchLyrics('Coldplay', 'Yellow')
    assert.equal(result.provider, 'lrclib.net')
    assert.match(result.lyrics, /Look at the stars/)
    assert.match(calls[0].target, /lrclib\.net\/api\/get/)
  })

  await withFetch([
    [/lrclib\.net/, null],
    [/api\.lyrics\.ovh/, { lyrics: 'Des paroles de secours' }]
  ], async () => {
    const result = await fetchLyrics('Artiste', 'Titre')
    assert.equal(result.provider, 'lyrics.ovh')
    assert.match(result.lyrics, /secours/)
  })
})

test('wikipediaSummary recherche puis renvoie résumé, URL et image', async () => {
  await withFetch([
    [/fr\.wikipedia\.org\/w\/api\.php/, { query: { search: [{ title: 'Brazzaville' }] } }],
    [/fr\.wikipedia\.org\/api\/rest_v1\/page\/summary/, {
      title: 'Brazzaville',
      extract: 'Brazzaville est la capitale de la République du Congo.',
      description: 'capitale du Congo',
      thumbnail: { source: 'https://upload.wikimedia.org/brazzaville.jpg' },
      content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Brazzaville' } }
    }]
  ], async calls => {
    const result = await wikipediaSummary('Brazzaville')
    assert.equal(result.title, 'Brazzaville')
    assert.match(result.extract, /capitale/)
    assert.equal(result.image, 'https://upload.wikimedia.org/brazzaville.jpg')
    assert.match(calls[1].target, /rest_v1\/page\/summary\/Brazzaville/)
  })
})

test('cryptoPrice renvoie les cours CoinGecko et complète par recherche', async () => {
  await withFetch([
    [/simple\/price\?ids=bitcoin/, { bitcoin: { usd: 82000, eur: 73000, usd_24h_change: 1.2 } }]
  ], async () => {
    const prices = await cryptoPrice(['bitcoin'])
    assert.equal(prices.bitcoin.usd, 82000)
    assert.equal(prices.bitcoin.usd_24h_change, 1.2)
  })
})

test('pokemonInfo renvoie la fiche avec l’artwork et le nom français', async () => {
  await withFetch([
    [/pokeapi\.co\/api\/v2\/pokemon\/pikachu$/, {
      id: 25, name: 'pikachu', height: 4, weight: 60,
      types: [{ type: { name: 'electric' } }],
      abilities: [{ ability: { name: 'static' } }],
      sprites: { other: { 'official-artwork': { front_default: 'https://img/pikachu.png' } } }
    }],
    [/pokeapi\.co\/api\/v2\/pokemon-species\/25/, {
      names: [{ language: { name: 'fr' }, name: 'Pikachu' }],
      genera: [{ language: { name: 'fr' }, genus: 'Souris Pokémon' }]
    }]
  ], async () => {
    const pokemon = await pokemonInfo('pikachu')
    assert.equal(pokemon.id, 25)
    assert.equal(pokemon.nameFr, 'Pikachu')
    assert.equal(pokemon.genusFr, 'Souris Pokémon')
    assert.deepEqual(pokemon.types, ['electric'])
    assert.equal(pokemon.image, 'https://img/pikachu.png')
  })
})

test('searchYouTubeInvidious essaie les instances jusqu’au premier résultat', async () => {
  await withFetch([
    [/invidious\.dead\.example/, null],
    [/yewtu\.be\/api\/v1\/search/, [{ type: 'video', videoId: 'abc123XYZ', title: 'Titre Invidious', author: 'Auteur' }]]
  ], async calls => {
    const { results, provider } = await searchYouTubeInvidious('ma recherche', {
      instances: ['https://invidious.dead.example', 'https://yewtu.be']
    })
    assert.equal(provider, 'yewtu.be')
    assert.equal(results[0].url, 'https://www.youtube.com/watch?v=abc123XYZ')
    assert.equal(calls.length, 2)
  })
})

test('catFact et numberFact ont des replis exploitables', async () => {
  await withFetch([], async () => {
    const fact = await catFact()
    assert.ok(fact.length > 10)
  })
  await withFetch([[/numbersapi\.com\/42\?json/, { text: '42 is the answer.', number: 42, type: 'trivia' }]], async () => {
    const result = await numberFact('42')
    assert.equal(result.number, 42)
    assert.match(result.fact, /answer/)
  })
})
