import test from 'node:test'
import assert from 'node:assert/strict'
import extra from '../src/commands/extra.js'
import { CommandRegistry } from '../src/core/registry.js'
import { jsonResponse, mediaResponse, mockHttp } from './helpers/http-fixture.js'

function context(text = '') {
  const outputs = []
  return {
    text, args: text.split(/\s+/), outputs, from: 'test@s.whatsapp.net', runtime: { prefix: '.' },
    config: { maxDownloadBytes: 1024 * 1024 }, logger: { warn() {} },
    async reply(text) { outputs.push({ text }) }, async send(content) { outputs.push(content) }
  }
}

const POKEMON = {
  id: 25, name: 'pikachu', height: 4, weight: 60, types: [{ type: { name: 'electric' } }],
  sprites: { other: { 'official-artwork': { front_default: 'https://cdn.example/pikachu.png' }, home: { front_default: 'https://cdn.example/home.png' } } }
}
const COUNTRY = {
  name: { common: 'Congo', official: 'Republic of the Congo' }, cca2: 'CG', capital: ['Brazzaville'], population: 6000000,
  currencies: { XAF: { name: 'CFA franc' } }, languages: { fra: 'French' }, flags: { png: 'https://cdn.example/cg.png' }
}

function allApis(url) {
  if (url.hostname === 'cdn.example' || url.hostname === 'picsum.photos') return mediaResponse('image/png')
  if (url.hostname === 'fr.wikipedia.org') return url.searchParams.get('list') === 'search'
    ? jsonResponse({ query: { search: [{ title: 'Brazzaville' }] } })
    : jsonResponse({ title: 'Brazzaville', extract: 'Capitale du Congo.', thumbnail: { source: 'https://cdn.example/wiki.png' } })
  if (url.hostname === 'catfact.ninja') return jsonResponse({ fact: 'Les chats ont des moustaches.' })
  if (url.hostname === 'dog.ceo') return jsonResponse({ message: 'https://cdn.example/dog.png' })
  if (url.hostname === 'api.quotable.io') return jsonResponse({ content: 'Une citation.', author: 'Auteur' })
  if (url.hostname === 'api.coingecko.com') return jsonResponse({ bitcoin: { usd: 82000, eur: 73000, usd_24h_change: 1.2 } })
  if (url.hostname === 'pokeapi.co') return url.pathname.includes('/pokemon-species/')
    ? jsonResponse({ names: [{ language: { name: 'fr' }, name: 'Pikachu' }] }) : jsonResponse(POKEMON)
  if (url.hostname === 'restcountries.com') return jsonResponse([COUNTRY])
  if (url.hostname === 'xkcd.com') return jsonResponse({ num: 42, title: 'Comic', img: 'https://cdn.example/comic.png' })
  if (url.hostname === 'the-trivia-api.com') return jsonResponse([{
    question: { question: 'Capitale du Congo ?' }, correctAnswer: 'Brazzaville', incorrectAnswers: ['Paris', 'Kinshasa', 'Dakar']
  }])
  if (url.hostname === 'numbersapi.com') return jsonResponse({ text: '42 is the answer.', number: 42 })
  if (url.hostname === 'api.agify.io') return jsonResponse({ age: 30, count: 100 })
  if (url.hostname === 'api.genderize.io') return jsonResponse({ gender: 'female', probability: 0.9 })
  if (url.hostname === 'api.nationalize.io') return jsonResponse({ country: [{ country_id: 'FR', probability: 0.8 }] })
  if (url.hostname === 'rickandmortyapi.com') return jsonResponse({ id: 1, name: 'Rick Sanchez', image: 'https://cdn.example/rick.png' })
}

test('les 13 commandes et tous les alias demandés sont enregistrés sans doublons', () => {
  const registry = new CommandRegistry({ info() {} })
  for (const command of extra) registry.register(command)
  assert.equal(registry.all().length, 13)
  const aliases = { wp: 'wiki', catfact: 'fact', chien: 'dog', citation: 'quote', btc: 'crypto', eth: 'crypto', pkmn: 'pokemon', pays: 'country', quiz: 'trivia', chiffre: 'number', name: 'nameguess', ram: 'rickmorty' }
  for (const [alias, name] of Object.entries(aliases)) assert.equal(registry.find(alias).name, name)
})

test('les 13 commandes répondent et chaque commande image envoie un buffer, jamais une URL', async t => {
  mockHttp(t, allApis)
  const inputs = { wiki: 'Brazzaville', crypto: 'bitcoin', pokemon: 'pikachu', country: 'Congo', number: '42', nameguess: 'Marie', rickmorty: '1' }
  const imageCommands = ['wiki', 'dog', 'pokemon', 'country', 'xkcd', 'picsum', 'rickmorty']
  for (const command of extra) {
    const ctx = context(inputs[command.name] || '')
    await command.run(ctx)
    assert.ok(ctx.outputs.length > 0, command.name)
    if (imageCommands.includes(command.name)) {
      assert.ok(Buffer.isBuffer(ctx.outputs[0].image), `${command.name} doit envoyer le buffer image`)
      assert.ok(ctx.outputs[0].mimetype.startsWith('image/'))
    } else assert.equal(typeof ctx.outputs[0].text, 'string')
    assert.ok(!ctx.outputs.some(item => item.image?.url), 'jamais de média { url }')
  }
})

test('.country récupère le drapeau sur le CDN de secours si l’image principale échoue', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'restcountries.com') return jsonResponse([COUNTRY])
    if (url.hostname === 'flagcdn.com') return mediaResponse('image/png')
  })
  const ctx = context('Congo')
  await extra.find(command => command.name === 'country').run(ctx)
  assert.ok(Buffer.isBuffer(ctx.outputs[0].image))
  assert.match(ctx.outputs[0].caption, /Brazzaville/)
  assert.equal(calls.at(-1).target, 'https://flagcdn.com/w640/cg.png')
})

test('.country ne remplace jamais un drapeau indisponible par un simple texte/lien', async t => {
  mockHttp(t, url => url.hostname === 'restcountries.com' ? jsonResponse([COUNTRY]) : null)
  const ctx = context('Congo')
  await assert.rejects(() => extra.find(command => command.name === 'country').run(ctx), error => error.userFacing)
  assert.equal(ctx.outputs.length, 0)
})

test('.pokemon utilise le second sprite si l’artwork ne peut pas être téléchargé', async t => {
  mockHttp(t, url => {
    if (url.hostname === 'pokeapi.co') return url.pathname.includes('/pokemon-species/') ? jsonResponse({ names: [] }) : jsonResponse(POKEMON)
    if (url.pathname === '/home.png') return mediaResponse('image/png')
  })
  const ctx = context('pikachu')
  await extra.find(command => command.name === 'pokemon').run(ctx)
  assert.ok(Buffer.isBuffer(ctx.outputs[0].image))
})

test('.dog change de fournisseur après une URL image défaillante', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'dog.ceo') return jsonResponse({ message: 'https://cdn.example/broken.jpg' })
    if (url.hostname === 'random.dog') return jsonResponse({ url: 'https://cdn.example/good.jpg' })
    if (url.pathname === '/good.jpg') return mediaResponse('image/jpeg')
  })
  const ctx = context()
  await extra.find(command => command.name === 'dog').run(ctx)
  assert.ok(Buffer.isBuffer(ctx.outputs[0].image))
  assert.equal(calls.filter(call => call.url.pathname === '/broken.jpg').length, 1)
  assert.ok(calls.some(call => call.url.hostname === 'random.dog'))
})

test('.btc et .eth sans arguments ciblent leur monnaie respective', async t => {
  const calls = mockHttp(t, url => jsonResponse({
    [url.searchParams.get('ids')]: { usd: 100, eur: 90, usd_24h_change: 0 }
  }))
  for (const [alias, id] of [['btc', 'bitcoin'], ['eth', 'ethereum']]) {
    const ctx = context()
    ctx.body = `.${alias}`
    ctx.commandName = 'crypto'
    await extra.find(command => command.name === 'crypto').run(ctx)
    assert.equal(calls.at(-1).url.searchParams.get('ids'), id)
  }
})

test('.picsum essaie une URL avec graine après un retour HTML invalide', async t => {
  const calls = mockHttp(t, url => url.pathname.startsWith('/seed/') ? mediaResponse('image/jpeg') : mediaResponse('text/html'))
  const ctx = context('900 700')
  await extra.find(command => command.name === 'picsum').run(ctx)
  assert.ok(Buffer.isBuffer(ctx.outputs[0].image))
  assert.equal(calls.length, 2)
  assert.ok(calls[1].url.pathname.endsWith('/900/700'))
})
