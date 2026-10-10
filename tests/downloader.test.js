import test from 'node:test'
import assert from 'node:assert/strict'
import commands, { downloadWithFallback, tryDirectImageDownload } from '../src/commands/download.js'
import { cobaltDownload, cobaltInstanceList, DEFAULT_COBALT_INSTANCES, invidiousAudioDownload, isNoVideoError } from '../src/services/downloader.js'
import { fakeDownloader } from './helpers/fake-downloader.js'
import { jsonResponse, mediaResponse, mockHttp } from './helpers/http-fixture.js'

const LIMIT = 1024 * 1024
const POST = 'https://www.instagram.com/p/test-post/'
const ALBUM = [{ type: 'photo', url: 'https://cdn.example/one.jpg' }, { type: 'video', url: 'https://cdn.example/two.mp4' }]

function context(text = POST, config = {}) {
  const outputs = []
  return {
    outputs, text, args: text.split(/\s+/), config: { localDownloaderEnabled: false, maxDownloadBytes: LIMIT, ...config },
    runtime: { prefix: '.' }, logger: { warn() {} },
    async send(content) { outputs.push(content) }, async reply(text) { outputs.push({ text }) }
  }
}

function graphPage(image = 'https://cdn.example/photo.jpg') {
  return new Response(`<html><meta content="${image}" property="og:image"></html>`, { headers: { 'content-type': 'text/html' } })
}

test('Cobalt conserve les cinq instances exactes, dans l’ordre et sans troncature', () => {
  assert.deepEqual(DEFAULT_COBALT_INSTANCES, [
    'https://api.cobalt.tools', 'https://co.wuk.sh', 'https://cobalt-api.kwiatekmiki.com',
    'https://cobalt.dreamapi.cloud', 'https://api-cobalt.deno.dev'
  ])
  assert.deepEqual(cobaltInstanceList({}), DEFAULT_COBALT_INSTANCES)
  assert.deepEqual(cobaltInstanceList({ cobaltApiUrl: 'https://private.example/', cobaltInstances: ['https://private.example', 'https://co.wuk.sh/'] }), [
    'https://private.example', 'https://co.wuk.sh', ...DEFAULT_COBALT_INSTANCES.filter(url => url !== 'https://co.wuk.sh')
  ])
})

test('Cobalt essaie les cinq instances après HTTP, no video, JSON invalide et panne CDN', async t => {
  const calls = mockHttp(t, url => {
    if (url.origin === DEFAULT_COBALT_INSTANCES[0]) return jsonResponse({ error: 'unavailable' }, 503)
    if (url.origin === DEFAULT_COBALT_INSTANCES[1]) return jsonResponse({ status: 'error', error: { code: 'error.api.no_video' } })
    if (url.origin === DEFAULT_COBALT_INSTANCES[2]) return new Response('not JSON')
    if (url.origin === DEFAULT_COBALT_INSTANCES[3]) return jsonResponse({ status: 'tunnel', url: 'https://cdn.example/broken.mp4' })
    if (url.origin === DEFAULT_COBALT_INSTANCES[4]) return jsonResponse({ status: 'redirect', url: 'https://cdn.example/good.mp4' })
    if (url.pathname === '/good.mp4') return mediaResponse('video/mp4')
  })
  const file = await cobaltDownload({ maxDownloadBytes: LIMIT }, POST)
  assert.ok(Buffer.isBuffer(file.buffer))
  assert.equal(file.contentType, 'video/mp4')
  assert.match(file.engine, /api-cobalt.deno.dev/)
  const requests = calls.filter(call => call.options.method === 'POST')
  assert.deepEqual(requests.map(call => call.url.origin), DEFAULT_COBALT_INSTANCES)
  assert.equal(JSON.parse(requests[0].options.body).downloadMode, 'auto')
})

test('la clé Cobalt privée ne part jamais vers une instance publique', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'private.example') return jsonResponse({ status: 'error', text: 'unavailable' })
    if (url.hostname === 'api.cobalt.tools') return jsonResponse({ url: 'https://cdn.example/good.mp4' })
    if (url.hostname === 'cdn.example') return mediaResponse('video/mp4')
  })
  await cobaltDownload({ maxDownloadBytes: LIMIT, cobaltApiUrl: 'https://private.example', cobaltApiKey: 'private-test-key' }, POST)
  assert.equal(calls[0].options.headers.authorization, 'Api-Key private-test-key')
  assert.equal(calls[0].options.redirect, 'error')
  assert.ok(calls.slice(1).every(call => !call.options.headers.authorization))
})

test('un picker télécharge tous les médias de l’album, pas seulement le premier', async t => {
  const calls = mockHttp(t, url => url.hostname === 'api.cobalt.tools'
    ? jsonResponse({ status: 'picker', picker: ALBUM })
    : mediaResponse(url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4'))
  const files = await cobaltDownload({ maxDownloadBytes: LIMIT }, POST)
  assert.equal(files.length, 2)
  assert.ok(files.every(file => Buffer.isBuffer(file.buffer)))
  assert.deepEqual(files.map(file => file.contentType), ['image/jpeg', 'video/mp4'])
  assert.equal(calls.filter(call => call.url.hostname === 'cdn.example').length, 2)
})

test('un CDN de picker défaillant fait essayer l’album complet sur l’instance suivante', async t => {
  mockHttp(t, url => {
    if (url.hostname === 'api.cobalt.tools') return jsonResponse({ status: 'picker', picker: [...ALBUM.slice(0, 1), { url: 'https://cdn.example/broken.mp4' }] })
    if (url.hostname === 'co.wuk.sh') return jsonResponse({ status: 'picker', picker: ALBUM })
    if (url.pathname === '/one.jpg') return mediaResponse('application/octet-stream')
    if (url.pathname === '/two.mp4') return mediaResponse('video/mp4')
  })
  const files = await cobaltDownload({ maxDownloadBytes: LIMIT }, POST)
  assert.equal(files.length, 2)
  assert.equal(files[0].contentType, 'image/jpeg')
  assert.ok(files.every(file => file.engine === 'cobalt · co.wuk.sh'))
})

test('no video est marqué non fatal après avoir épuisé toutes les instances', async t => {
  const calls = mockHttp(t, () => jsonResponse({ status: 'error', text: 'no video in this post' }))
  await assert.rejects(() => cobaltDownload({ maxDownloadBytes: LIMIT }, POST), error => {
    assert.equal(error.userFacing, true)
    assert.equal(isNoVideoError(error), true)
    return true
  })
  assert.equal(calls.length, 5)
})

test('Open Graph préfère og:video, puis récupère og:image avec attributs inversés et URL décodée', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'www.instagram.com') return new Response(String.raw`<meta PROPERTY='og:video:secure_url' content='https://cdn.example/broken.mp4'>
      <meta content='https:&#x2F;&#x2F;cdn.example/photo.jpg?a=1\u0026b=2&amp;c=3' NAME='og:image'>`)
    if (url.pathname === '/photo.jpg') return mediaResponse('image/jpeg')
  })
  const file = await tryDirectImageDownload({ maxDownloadBytes: LIMIT }, POST)
  assert.equal(file.engine, 'open-graph-direct')
  assert.equal(file.contentType, 'image/jpeg')
  assert.equal(calls[1].url.pathname, '/broken.mp4')
  assert.equal(calls[2].url.search, '?a=1&b=2&c=3')
})

test('Open Graph prend aussi en charge Facebook/Pinterest et une vidéo valide', async t => {
  mockHttp(t, url => {
    if (url.hostname === 'cdn.example') return mediaResponse('video/mp4')
    return new Response('<meta property="og:video:url" content="https://cdn.example/video.mp4">')
  })
  for (const url of ['https://www.facebook.com/post/123', 'https://www.pinterest.com/pin/123']) {
    const file = await tryDirectImageDownload({ maxDownloadBytes: LIMIT }, url)
    assert.equal(file.contentType, 'video/mp4')
    assert.ok(Buffer.isBuffer(file.buffer))
  }
})

test('Open Graph ne remplace pas de l’audio et refuse les liens médias privés', async t => {
  const calls = mockHttp(t, () => graphPage('http://127.0.0.1/private.jpg'))
  assert.equal(await tryDirectImageDownload({}, POST, 'audio'), null)
  assert.equal(await tryDirectImageDownload({}, 'https://example.com/page'), null)
  assert.equal(calls.length, 0)
  await assert.rejects(() => tryDirectImageDownload({}, POST), /privée|locale/)
  assert.equal(calls.length, 1, 'aucun appel vers l’adresse privée')
})

test('Cobalt est utilisé même sans COBALT_API_URL et Open Graph reste le dernier repli', async t => {
  const calls = mockHttp(t, url => {
    if (DEFAULT_COBALT_INSTANCES.includes(url.origin)) return jsonResponse({ status: 'error', error: { code: 'error.api.no_video' } })
    if (url.hostname === 'www.instagram.com') return graphPage()
    if (url.hostname === 'cdn.example') return mediaResponse('image/jpeg')
  })
  const file = await downloadWithFallback(context(), POST, 'auto')
  assert.equal(file.engine, 'open-graph-direct')
  assert.deepEqual(calls.slice(0, 5).map(call => call.url.origin), DEFAULT_COBALT_INSTANCES)
  assert.equal(calls[5].url.hostname, 'www.instagram.com')
})

test('les commandes sociales envoient chaque buffer d’un album Cobalt', async t => {
  mockHttp(t, url => url.hostname === 'api.cobalt.tools'
    ? jsonResponse({ status: 'picker', picker: ALBUM })
    : mediaResponse(url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4'))
  const ctx = context()
  await commands.find(command => command.name === 'instagram').run(ctx)
  assert.equal(ctx.outputs.length, 2)
  assert.ok(Buffer.isBuffer(ctx.outputs[0].image))
  assert.ok(Buffer.isBuffer(ctx.outputs[1].video))
  assert.match(ctx.outputs[0].caption, /1\/2/)
  assert.match(ctx.outputs[1].caption, /2\/2/)
})

test('yt-dlp no video déclenche immédiatement Open Graph; un échec photo poursuit Cobalt', async t => {
  const fake = await fakeDownloader(t, "console.error('ERROR: no video in this post'); process.exit(1)")
  if (!fake) return
  let pageAvailable = true
  const calls = mockHttp(t, url => {
    if (url.hostname === 'www.instagram.com') return pageAvailable ? graphPage() : new Response('no metadata')
    if (url.hostname === 'api.cobalt.tools') return jsonResponse({ url: 'https://cdn.example/cobalt.mp4' })
    if (url.hostname === 'cdn.example') return mediaResponse(url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4')
  })
  const first = await downloadWithFallback(context(POST, fake.config), POST, 'auto')
  assert.equal(first.engine, 'open-graph-direct')
  assert.equal(calls[0].url.hostname, 'www.instagram.com')
  assert.ok(!calls.some(call => call.options.method === 'POST'))

  pageAvailable = false
  const second = await downloadWithFallback(context(POST, fake.config), POST, 'auto')
  assert.equal(second.engine, 'cobalt · api.cobalt.tools')
})

test('.videos est dans download.js, recherche puis envoie le premier résultat vidéo exploitable', async t => {
  const calls = mockHttp(t, (url, options) => {
    if (url.hostname === 'search.example') return jsonResponse([
      { type: 'video', videoId: 'first123XYZ', title: 'Premier', author: 'Test' },
      { type: 'video', videoId: 'second123XYZ', title: 'Deuxième', author: 'Test' }
    ])
    if (DEFAULT_COBALT_INSTANCES.includes(url.origin)) {
      const target = JSON.parse(options.body).url
      if (target.includes('first123XYZ')) return jsonResponse({ url: 'https://cdn.example/not-video.jpg' })
      return jsonResponse({ url: 'https://cdn.example/video.mp4' })
    }
    if (url.hostname === 'cdn.example') return mediaResponse(url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4')
  })
  const ctx = context('documentaire', { invidiousInstances: ['https://search.example'] })
  await commands.find(command => command.name === 'videos').run(ctx)
  assert.equal(ctx.outputs.length, 1)
  assert.ok(Buffer.isBuffer(ctx.outputs[0].video))
  assert.equal(ctx.outputs[0].mimetype, 'video/mp4')
  assert.match(ctx.outputs[0].caption, /Deuxième/)
  assert.match(ctx.outputs[0].caption, /Autres résultats/)
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 2)
})

test('le repli Invidious audio ignore les pistes vidéo WebM et reconnaît les liens shorts', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'inv.example') return jsonResponse({ adaptiveFormats: [
      { type: 'video/webm', container: 'webm', bitrate: 10000, url: 'https://cdn.example/video.webm' },
      { type: 'audio/webm; codecs="opus"', container: 'webm', bitrate: 1000, url: 'https://cdn.example/audio.webm' }
    ] })
    if (url.pathname === '/audio.webm') return mediaResponse('audio/webm')
  })
  const file = await invidiousAudioDownload({ maxDownloadBytes: LIMIT }, 'https://www.youtube.com/shorts/abc123XYZ', { instances: ['https://inv.example'] })
  assert.equal(file.contentType, 'audio/webm')
  assert.equal(file.filename, 'audio-abc123XYZ.webm')
  assert.ok(!calls.some(call => call.url.pathname === '/video.webm'))
})


test('Cobalt utilise un nom nettoyé pour typer les tunnels application/octet-stream', async t => {
  mockHttp(t, url => url.hostname === 'api.cobalt.tools'
    ? jsonResponse({ status: 'tunnel', url: 'https://cdn.example/tunnel', filename: '../clip.mp4' })
    : mediaResponse('application/octet-stream'))
  const file = await cobaltDownload({ maxDownloadBytes: LIMIT }, POST)
  assert.equal(file.contentType, 'video/mp4')
  assert.equal(file.filename, '.._clip.mp4')
})
