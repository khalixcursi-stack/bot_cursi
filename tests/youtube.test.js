import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isYouTubeUrl,
  parseInvidiousResults,
  parsePipedResults,
  parseYouTubeApiResults,
  resolveYouTube,
  searchYouTube,
  youtubeSearchMode
} from '../src/services/youtube.js'
import { downloaderReadiness } from '../src/services/downloader.js'
import { fakeDownloader } from './helpers/fake-downloader.js'
import { mockHttp, jsonResponse } from './helpers/http-fixture.js'

test('normalise les résultats des fournisseurs YouTube pris en charge', () => {
  const official = parseYouTubeApiResults({ items: [{ id: { videoId: 'abc123XYZ' }, snippet: { title: 'A &amp; B', channelTitle: 'Chaîne' } }] })
  const invidious = parseInvidiousResults([{ type: 'video', videoId: 'inv123XYZ', title: 'Titre', author: 'Auteur' }])
  const piped = parsePipedResults({ items: [{ type: 'stream', url: '/watch?v=pipe123XYZ', title: 'Piped', uploaderName: 'Canal' }] })

  assert.deepEqual(official[0], {
    title: 'A & B', author: 'Chaîne', description: '', url: 'https://www.youtube.com/watch?v=abc123XYZ'
  })
  assert.equal(invidious[0].url, 'https://www.youtube.com/watch?v=inv123XYZ')
  assert.equal(piped[0].author, 'Canal')
  assert.equal(piped[0].url, 'https://www.youtube.com/watch?v=pipe123XYZ')
})

test('accepte uniquement les URL YouTube dans les commandes YouTube', async () => {
  const config = {}
  assert.equal(isYouTubeUrl('https://youtu.be/abc123XYZ'), true)
  assert.equal(isYouTubeUrl('https://music.youtube.com/watch?v=abc123XYZ'), true)
  assert.equal(isYouTubeUrl('https://example.com/video'), false)
  await assert.rejects(() => resolveYouTube(config, 'https://example.com/video'), /uniquement une URL YouTube/)
})

test('explique la configuration manquante pour une recherche par titre', async t => {
  // Le repli Invidious tente le réseau : on le simule en échec rapide.
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('unavailable', { status: 503 })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(() => resolveYouTube({}, 'un titre'), error => {
    assert.equal(error.userFacing, true)
    assert.match(error.message, /YOUTUBE_API_KEY/)
    assert.match(error.message, /\.dlstatus/)
    return true
  })
})

test('calcule la disponibilité des téléchargements sans exposer les secrets', () => {
  assert.deepEqual(downloaderReadiness({}), {
    local: false, cobalt: true, search: true, directYouTube: true, titleYouTube: true, social: true
  })
  assert.equal(downloaderReadiness({ cobaltApiUrl: 'https://cobalt.example', youtubeApiKey: 'secret' }).titleYouTube, true)
  assert.equal(downloaderReadiness({ localDownloaderEnabled: true }).titleYouTube, true)
  assert.equal(youtubeSearchMode({ localDownloaderEnabled: true }), 'moteur local yt-dlp + repli Invidious')
  assert.equal(youtubeSearchMode({ youtubeSearchApiUrl: 'https://inv.example', youtubeSearchProvider: 'invidious' }), 'API Invidious configurée + repli Invidious')
})


test('une recherche locale en erreur ou vide bascule automatiquement sur Invidious', async t => {
  const fake = await fakeDownloader(t, `
if (args.at(-1).includes('vide')) { console.log(JSON.stringify({ entries: [] })); process.exit(0) }
console.error('ERROR: local search unavailable'); process.exit(1)
`)
  if (!fake) return
  const calls = mockHttp(t, url => url.hostname === 'fallback.example' ? jsonResponse([
    { type: 'video', videoId: 'abc123XYZ', title: 'A &amp; B', author: 'Auteur' }
  ]) : jsonResponse({ error: 'API unavailable' }, 503))
  for (const query of ['échec', 'vide']) {
    const videos = await searchYouTube({ ...fake.config, invidiousInstances: ['https://fallback.example'] }, query)
    assert.equal(videos[0].url, 'https://www.youtube.com/watch?v=abc123XYZ')
    assert.equal(videos[0].title, 'A & B')
  }
  assert.equal(calls.length, 2)
  const results = await searchYouTube({ ...fake.config, youtubeApiKey: 'test', invidiousInstances: ['https://fallback.example'] }, 'échec')
  assert.equal(results.length, 1)
  assert.equal(calls.at(-2).url.hostname, 'www.googleapis.com')
  assert.equal(calls.at(-1).url.hostname, 'fallback.example')
})
