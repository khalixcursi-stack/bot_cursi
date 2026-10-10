import test from 'node:test'
import assert from 'node:assert/strict'
import {
  catFact, countryInfo, cryptoPrice, DEFAULT_INVIDIOUS_INSTANCES, dogImageUrl, fetchLyrics, nameInfo,
  numberFact, picsumUrl, pokemonInfo, randomQuote, rickMortyCharacter, searchYouTubeInvidious,
  translateText, triviaQuestion, wikipediaSummary, xkcd
} from '../src/services/more-apis.js'
import { jsonResponse, mediaResponse, mockHttp } from './helpers/http-fixture.js'

test('une erreur MyMemory au format HTTP 200 ne se fait pas passer pour une traduction', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'api.mymemory.translated.net') return jsonResponse({ responseStatus: 403, responseData: { translatedText: 'PLEASE SELECT TWO DISTINCT LANGUAGES' } })
    if (url.hostname === 'translate.googleapis.com') return jsonResponse([[['Hello ', null], ['world', null]]])
  })
  assert.deepEqual(await translateText('Bonjour le monde', 'en'), { text: 'Hello world', provider: 'Google Translate' })
  assert.equal(calls.length, 2)
})

test('la traduction peut atteindre LibreTranslate après les deux endpoints Google', async t => {
  const calls = mockHttp(t, url => url.hostname === 'libretranslate.com' ? jsonResponse({ translatedText: 'Hello' }) : jsonResponse({}, 503))
  assert.equal((await translateText('Bonjour', 'en')).provider, 'LibreTranslate')
  assert.deepEqual(calls.slice(1, 3).map(call => call.url.hostname), ['translate.googleapis.com', 'translate.google.com'])
  assert.equal(calls.at(-1).options.method, 'POST')
})

test('lrclib accepte les paroles synchronisées et supprime les timestamps', async t => {
  mockHttp(t, () => jsonResponse({ syncedLyrics: '[00:12.30]Look at the stars\n[01:02.00]Look how they shine', artistName: 'Coldplay', trackName: 'Yellow' }))
  const lyrics = await fetchLyrics('Coldplay', 'Yellow')
  assert.equal(lyrics.provider, 'lrclib.net')
  assert.equal(lyrics.lyrics, 'Look at the stars\nLook how they shine')
})

test('la recherche lrclib n’accepte pas les paroles d’un autre artiste', async t => {
  const calls = mockHttp(t, url => {
    if (url.pathname === '/api/get') return jsonResponse({}, 404)
    if (url.pathname === '/api/search') return jsonResponse([{ artistName: 'Autre', trackName: 'Titre', plainLyrics: 'Mauvaises paroles' }])
    if (url.hostname === 'api.lyrics.ovh') return jsonResponse({ lyrics: 'Paroles correctes' })
  })
  const result = await fetchLyrics('Artiste', 'Titre')
  assert.equal(result.provider, 'lyrics.ovh')
  assert.equal(result.lyrics, 'Paroles correctes')
  assert.equal(calls.length, 3)
})

test('Wikipédia utilise REST même quand la recherche est indisponible', async t => {
  const calls = mockHttp(t, url => url.pathname.includes('/api/rest_v1/')
    ? jsonResponse({ title: 'Brazzaville', extract: 'Capitale du Congo.' }) : jsonResponse({}, 503))
  const summary = await wikipediaSummary('Brazzaville')
  assert.equal(summary.extract, 'Capitale du Congo.')
  assert.equal(calls.length, 2)
})

test('Wikipédia se replie sur les extraits de l’API action après une panne REST', async t => {
  const calls = mockHttp(t, url => {
    if (url.searchParams.get('list') === 'search') return jsonResponse({ query: { search: [{ title: 'Brazzaville' }] } })
    if (url.searchParams.get('prop')) return jsonResponse({ query: { pages: { 42: {
      title: 'Brazzaville', extract: 'Capitale du Congo.', fullurl: 'https://fr.wikipedia.org/wiki/Brazzaville',
      original: { source: 'https://cdn.example/original.jpg' }, thumbnail: { source: 'https://cdn.example/thumb.jpg' }
    } } } })
    return jsonResponse({}, 503)
  })
  const summary = await wikipediaSummary('Brazzaville')
  assert.equal(summary.images.length, 2)
  assert.equal(summary.url, 'https://fr.wikipedia.org/wiki/Brazzaville')
  assert.equal(calls.length, 3)
})

test('CoinGecko se replie sur coins/markets et conserve USD, EUR et variation 24 h', async t => {
  const calls = mockHttp(t, url => url.pathname.endsWith('/coins/markets') ? jsonResponse([
    { id: 'bitcoin', current_price: url.searchParams.get('vs_currency') === 'usd' ? 82000 : 73000, price_change_percentage_24h: 1.2 }
  ]) : jsonResponse({}, 503))
  const prices = await cryptoPrice(['btc'])
  assert.equal(prices.btc.usd, 82000)
  assert.equal(prices.btc.eur, 73000)
  assert.equal(prices.btc.usd_24h_change, 1.2)
  assert.equal(calls.length, 3)
})

test('CoinGecko résout un symbole inconnu et restitue le cours sous la clé demandée', async t => {
  mockHttp(t, url => {
    if (url.pathname.endsWith('/search')) return jsonResponse({ coins: [{ id: 'test-coin', symbol: 'test', name: 'Test Coin' }] })
    if (url.pathname.endsWith('/simple/price') && url.searchParams.get('ids') === 'test-coin') return jsonResponse({ 'test-coin': { usd: 2, eur: 1.8 } })
    return jsonResponse({})
  })
  assert.equal((await cryptoPrice(['test'])).test.usd, 2)
})

test('PokéAPI dispose du miroir officiel GitHub, avec résolution nom → ID', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'pokeapi.co') return jsonResponse({}, 503)
    if (url.pathname.endsWith('/pokemon/index.json')) return jsonResponse({ results: [{ name: 'pikachu', url: '/api/v2/pokemon/25/' }] })
    if (url.pathname.endsWith('/pokemon/25/index.json')) return jsonResponse({ id: 25, name: 'pikachu', sprites: { front_default: 'https://cdn.example/pikachu.png' } })
    if (url.pathname.endsWith('/pokemon-species/25/index.json')) return jsonResponse({ names: [{ language: { name: 'fr' }, name: 'Pikachu' }] })
  })
  const pokemon = await pokemonInfo('pikachu')
  assert.equal(pokemon.id, 25)
  assert.equal(pokemon.nameFr, 'Pikachu')
  assert.equal(pokemon.image, 'https://cdn.example/pikachu.png')
  assert.ok(calls.filter(call => call.url.hostname === 'api.github.com').every(call => call.options.headers.accept === 'application/vnd.github.raw+json'))
})

test('REST Countries essaie les traductions et produit un drapeau PNG de secours', async t => {
  const calls = mockHttp(t, url => url.pathname.includes('/translation/') ? jsonResponse([{
    name: { common: 'Germany', official: 'Federal Republic of Germany' }, cca2: 'DE', capital: ['Berlin'], population: 84000000,
    flags: { svg: 'https://cdn.example/de.svg' }, currencies: { EUR: { name: 'Euro', symbol: '€' } }, languages: { deu: 'German' }
  }]) : jsonResponse({}, 404))
  const country = await countryInfo('Allemagne')
  assert.equal(country.name, 'Germany')
  assert.equal(country.flag, 'https://flagcdn.com/w640/de.png')
  assert.equal(calls.length, 2)
})

test('Agify, Genderize et Nationalize démarrent en parallèle et tolèrent une panne partielle', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const calls = mockHttp(t, async url => {
    await gate
    if (url.hostname === 'api.agify.io') return jsonResponse({}, 503)
    if (url.hostname === 'api.genderize.io') return jsonResponse({ gender: 'female', probability: 0.99 })
    return jsonResponse({ country: [{ country_id: 'FR', probability: 0.7 }] })
  })
  const request = nameInfo('Marie')
  assert.equal(calls.length, 3, 'les trois appels démarrent avant de recevoir une réponse')
  release()
  const result = await request
  assert.equal(result.age, null)
  assert.equal(result.gender, 'female')
  assert.equal(result.nationality, 'FR')
})

test('faits chats, chiens et citations utilisent des fournisseurs alternatifs', async t => {
  mockHttp(t, url => {
    if (url.hostname === 'meowfacts.herokuapp.com') return jsonResponse({ data: ['Les chats dorment beaucoup.'] })
    if (url.hostname === 'dog.ceo') return jsonResponse({ message: 'https://cdn.example/not-photo.mp4' })
    if (url.hostname === 'random.dog') return jsonResponse({ url: 'https://cdn.example/dog.jpg' })
    if (url.hostname === 'zenquotes.io') return jsonResponse([{ q: 'Une citation de secours.', a: 'Auteur' }])
    return jsonResponse({}, 503)
  })
  assert.equal(await catFact(), 'Les chats dorment beaucoup.')
  assert.equal(await dogImageUrl(), 'https://cdn.example/dog.jpg')
  assert.equal((await randomQuote()).quote, 'Une citation de secours.')
})

test('faits chats et citations conservent un repli local après panne de toutes les API', async t => {
  mockHttp(t, () => jsonResponse({}, 503))
  assert.ok((await catFact()).length > 10)
  assert.ok((await randomQuote()).quote.length > 10)
})

test('XKCD essaie le second domaine et renvoie un buffer image validé', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'xkcd.com') return jsonResponse({}, 503)
    if (url.hostname === 'www.xkcd.com') return jsonResponse({ num: 42, title: 'Comic', img: 'https://cdn.example/comic.png' })
    return mediaResponse('image/png')
  })
  const comic = await xkcd('42')
  assert.ok(Buffer.isBuffer(comic.buffer))
  assert.equal(comic.contentType, 'image/png')
  assert.deepEqual(calls.slice(0, 2).map(call => call.url.hostname), ['xkcd.com', 'www.xkcd.com'])
})

test('XKCD random ne choisit jamais le numéro 404 inexistant', async t => {
  t.mock.method(Math, 'random', () => 403 / 499)
  const calls = mockHttp(t, url => url.hostname === 'cdn.example' ? mediaResponse('image/png') : jsonResponse({ num: 500, img: 'https://cdn.example/comic.png' }))
  await xkcd('random')
  assert.equal(calls[1].url.pathname, '/405/info.0.json')
})

test('Trivia se replie sur OpenTDB et décode les entités HTML sans RangeError', async t => {
  mockHttp(t, url => url.hostname === 'opentdb.com' ? jsonResponse({ results: [{
    question: 'A &amp; B &#x110000; ?', correct_answer: '&#x50;aris', incorrect_answers: ['Lyon', 'Nice', 'Toulon']
  }] }) : jsonResponse({}, 503))
  const question = await triviaQuestion()
  assert.equal(question.provider, 'OpenTDB')
  assert.equal(question.correct, 'Paris')
  assert.equal(question.question, 'A & B &#x110000; ?')
})

test('Numbers API utilise HTTP en repli si HTTPS échoue', async t => {
  const calls = mockHttp(t, url => url.protocol === 'http:' ? jsonResponse({ text: '42 is the answer.', type: 'trivia', found: true }) : jsonResponse({}, 503))
  const result = await numberFact('42')
  assert.equal(result.fact, '42 is the answer.')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.protocol, 'http:')
})

test('Picsum borne les dimensions et échappe la graine de l’URL de repli', () => {
  assert.equal(picsumUrl(0, 0), 'https://picsum.photos/800/600')
  assert.equal(picsumUrl(99999, -1), 'https://picsum.photos/1600/200')
  assert.equal(picsumUrl(800, 600, 'a/b?x=1'), 'https://picsum.photos/seed/a%2Fb%3Fx%3D1/800/600')
})

test('Rick & Morty se replie sur GraphQL sans require ni appel fetch direct', async t => {
  const calls = mockHttp(t, url => url.pathname === '/graphql' ? jsonResponse({ data: { character: {
    id: '1', name: 'Rick Sanchez', image: 'https://cdn.example/rick.jpg', episode: [{ id: 1 }, { id: 2 }]
  } } }) : jsonResponse({}, 503))
  const character = await rickMortyCharacter('1')
  assert.equal(character.id, 1)
  assert.equal(character.episodeCount, 2)
  assert.equal(calls[1].options.method, 'POST')
  assert.match(JSON.parse(calls[1].options.body).query, /character\(id: 1\)/)
})

test('Invidious essaie les quatre instances publiques et décode les résultats', async t => {
  assert.equal(DEFAULT_INVIDIOUS_INSTANCES.length, 4)
  const calls = mockHttp(t, url => url.origin === DEFAULT_INVIDIOUS_INSTANCES.at(-1) ? jsonResponse([
    { type: 'channel', title: 'À ignorer', videoId: 'ignoreXYZ' },
    { type: 'video', title: 'A &amp; B', videoId: 'abc123XYZ', lengthSeconds: 42 }
  ]) : jsonResponse([]))
  const { results } = await searchYouTubeInvidious('recherche')
  assert.equal(results[0].title, 'A & B')
  assert.equal(results[0].duration, 42)
  assert.deepEqual(calls.map(call => call.url.origin), DEFAULT_INVIDIOUS_INSTANCES)
})

test('les entrées invalides sont refusées avant tout appel distant', async t => {
  const calls = mockHttp(t, () => jsonResponse({}))
  for (const action of [
    () => translateText(''), () => fetchLyrics('', ''), () => wikipediaSummary(''), () => cryptoPrice([]),
    () => pokemonInfo(''), () => countryInfo(''), () => nameInfo(''), () => numberFact('1.5'),
    () => rickMortyCharacter('-1'), () => xkcd('../'), () => searchYouTubeInvidious('')
  ]) {
    await assert.rejects(action, error => error.userFacing === true)
  }
  assert.equal(calls.length, 0)
})
