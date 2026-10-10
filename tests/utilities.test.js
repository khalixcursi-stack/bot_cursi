import test from 'node:test'
import assert from 'node:assert/strict'
import commands from '../src/commands/utilities.js'
import { jsonResponse, mockHttp } from './helpers/http-fixture.js'

function context(text) {
  const outputs = []
  return { text, args: text.split(/\s+/).filter(Boolean), outputs, async reply(text) { outputs.push(text) } }
}

test('la météo construit une URL Open-Meteo avec &current, jamais le caractère corrompu', async t => {
  const calls = mockHttp(t, url => url.hostname === 'geocoding-api.open-meteo.com'
    ? jsonResponse({ results: [{ name: 'Brazzaville', country: 'Congo', latitude: -4.27, longitude: 15.28 }] })
    : jsonResponse({ current: { temperature_2m: 28, relative_humidity_2m: 70, apparent_temperature: 30, weather_code: 0, wind_speed_10m: 10 } }))
  const ctx = context('Brazzaville')
  await commands.find(command => command.name === 'weather').run(ctx)
  const forecast = calls[1]
  assert.equal(forecast.url.searchParams.get('latitude'), '-4.27')
  assert.equal(forecast.url.searchParams.get('longitude'), '15.28')
  assert.match(forecast.target, /&current=/)
  assert.ok(!forecast.target.includes('¤'))
  assert.equal(forecast.url.searchParams.get('timezone'), 'auto')
  assert.match(ctx.outputs[0], /28 °C/)
})

test('.translate traduit un message cité et utilise Google après une panne MyMemory', async t => {
  const calls = mockHttp(t, url => url.hostname === 'translate.googleapis.com'
    ? jsonResponse([[['Hello world', null]]]) : jsonResponse({}, 503))
  const ctx = context('en')
  ctx.quoted = { message: { conversation: 'Bonjour le monde' } }
  await commands.find(command => command.name === 'translate').run(ctx)
  assert.match(ctx.outputs[0], /Hello world/)
  assert.match(ctx.outputs[0], /Google Translate/)
  assert.equal(calls[0].url.hostname, 'api.mymemory.translated.net')
  assert.equal(calls[1].url.searchParams.get('q'), 'Bonjour le monde')
})

test('.lyrics privilégie lrclib puis utilise lyrics.ovh lorsque lrclib échoue', async t => {
  let primaryAvailable = true
  const calls = mockHttp(t, url => {
    if (url.hostname === 'lrclib.net') return primaryAvailable
      ? jsonResponse({ artistName: 'Coldplay', trackName: 'Yellow', plainLyrics: 'Look at the stars' }) : jsonResponse({}, 503)
    if (url.hostname === 'api.lyrics.ovh') return jsonResponse({ lyrics: 'Des paroles de secours' })
  })
  const command = commands.find(command => command.name === 'lyrics')
  const first = context('Coldplay | Yellow')
  await command.run(first)
  assert.match(first.outputs[0], /lrclib.net/)
  assert.equal(calls.length, 1)
  primaryAvailable = false
  const second = context('Coldplay | Yellow')
  await command.run(second)
  assert.match(second.outputs[0], /lyrics.ovh/)
  assert.match(second.outputs[0], /secours/)
})

test('les paramètres manquants sont des erreurs utilisateur sans appel réseau', async t => {
  const calls = mockHttp(t, () => jsonResponse({}))
  for (const name of ['weather', 'translate', 'lyrics']) {
    await assert.rejects(() => commands.find(command => command.name === name).run(context('')), error => error.userFacing)
  }
  assert.equal(calls.length, 0)
})
