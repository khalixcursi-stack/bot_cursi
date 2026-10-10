import test from 'node:test'
import assert from 'node:assert/strict'
import commands from '../src/commands/download.js'
import { isTikTokLink, isTikTokUrl, tiktokOfficialDownload } from '../src/services/tiktok.js'
import { jsonResponse, mediaResponse, mockHttp } from './helpers/http-fixture.js'

const ID = '7661265253874896148'
const URL = `https://www.tiktok.com/@test/video/${ID}`
const CONFIG = { localDownloaderEnabled: false, maxDownloadBytes: 1024 * 1024 }

function videoItem(urls, extra = {}) {
  return { id_str: ID, video_info: { profiles: [{ bitrate: 1000, play_addr: { url_list: urls } }] }, ...extra }
}

function photoItem() {
  return {
    aweme_id: ID, aweme_type: 150,
    image_post_info: { images: [
      { display_image: { url_list: ['https://cdn.example/broken.jpg', 'https://cdn.example/one.jpg'] } },
      { display_image: { url_list: ['https://cdn.example/two.jpg'] } }
    ] }
  }
}

test('reconnaît les liens vidéo, photo et courts TikTok, jamais un domaine ressemblant', () => {
  assert.equal(isTikTokUrl(URL), true)
  assert.equal(isTikTokUrl(`https://www.tiktok.com/@test/photo/${ID}`), true)
  assert.equal(isTikTokUrl('https://www.tiktok.com/@test'), false)
  assert.equal(isTikTokLink('https://vm.tiktok.com/ABC123/'), true)
  assert.equal(isTikTokUrl('https://example.com/@test/video/123'), false)
  assert.equal(isTikTokLink('https://tiktok.com.evil.example/video/123'), false)
  assert.equal(isTikTokLink('ftp://tiktok.com/video/123'), false)
})

test('TikTok essaie trois CDN distincts, décode les URL et rejette un buffer de 1024 octets', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'www.tiktok.com') return jsonResponse({ items: [videoItem([
      String.raw`https:&#x2F;&#x2F;cdn.example/one.mp4?a=1\u0026b=2`,
      'https://cdn.example/two.mp4', 'https://cdn.example/three.mp4', 'https://cdn.example/four.mp4'
    ])] })
    if (url.pathname === '/one.mp4') return mediaResponse('video/mp4', 1024)
    if (url.pathname === '/two.mp4') return jsonResponse({ error: 'unavailable' }, 503)
    if (url.pathname === '/three.mp4') return mediaResponse('video/mp4', 1025)
  })
  const file = await tiktokOfficialDownload(CONFIG, URL)
  assert.equal(file.buffer.length, 1025)
  assert.equal(file.filename, `tiktok-${ID}.mp4`)
  assert.equal(file.engine, 'tiktok-player-api')
  assert.deepEqual(calls.slice(1).map(call => call.url.pathname), ['/one.mp4', '/two.mp4', '/three.mp4'])
  assert.equal(calls[1].url.search, '?a=1&b=2')
})

test('TikTok rejette une page HTML même volumineuse et conserve le repli CDN', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'www.tiktok.com') return jsonResponse({ items: [videoItem(['https://cdn.example/html.mp4', 'https://cdn.example/good.mp4'])] })
    return mediaResponse(url.pathname === '/html.mp4' ? 'text/html' : 'video/mp4', 3000)
  })
  const file = await tiktokOfficialDownload(CONFIG, URL)
  assert.equal(file.finalUrl, 'https://cdn.example/good.mp4')
  assert.equal(calls.length, 3)
})

test('TikTok déduplique les URL et choisit un profil respectant la limite de taille', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'www.tiktok.com') return jsonResponse({ items: [{ id: ID, video_info: { profiles: [
      { bitrate: 3000, play_addr: { data_size: 2 * CONFIG.maxDownloadBytes, url_list: ['https://cdn.example/too-big.mp4'] } },
      { bitrate: 1000, play_addr: { data_size: 3000, url_list: ['https://cdn.example/good.mp4', 'https://cdn.example/good.mp4'] } }
    ] } }] })
    return mediaResponse('video/mp4')
  })
  await tiktokOfficialDownload(CONFIG, URL)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.pathname, '/good.mp4')
})

test('les albums photo image_post_info / aweme_type=150 téléchargent toutes les images', async t => {
  const calls = mockHttp(t, url => {
    if (url.hostname === 'www.tiktok.com') return jsonResponse({ aweme_list: [photoItem()] })
    if (url.pathname === '/one.jpg') return mediaResponse('image/jpeg')
    if (url.pathname === '/two.jpg') return mediaResponse('image/png')
  })
  const files = await tiktokOfficialDownload(CONFIG, `https://www.tiktok.com/@test/photo/${ID}`)
  assert.equal(files.length, 2)
  assert.ok(files.every(file => Buffer.isBuffer(file.buffer) && file.buffer.length > 1024))
  assert.deepEqual(files.map(file => file.filename), [`tiktok-${ID}-1.jpg`, `tiktok-${ID}-2.png`])
  assert.equal(calls.filter(call => call.url.hostname === 'cdn.example').length, 3)
})

test('.tiktok envoie chaque photo de l’album comme buffer média', async t => {
  mockHttp(t, url => {
    if (url.hostname === 'www.tiktok.com') return jsonResponse({ items: [photoItem()] })
    if (url.pathname !== '/broken.jpg') return mediaResponse('image/jpeg')
  })
  const sent = []
  await commands.find(command => command.name === 'tiktok').run({
    text: `https://www.tiktok.com/@test/photo/${ID}`, config: CONFIG, logger: { warn() {} },
    async send(content) { sent.push(content) }
  })
  assert.equal(sent.length, 2)
  assert.ok(sent.every(message => Buffer.isBuffer(message.image)))
  assert.match(sent[1].caption, /2\/2/)
})

test('les liens courts sont résolus en HEAD et peuvent mener à un post photo', async t => {
  const calls = mockHttp(t, (url, options) => {
    if (url.hostname === 'vm.tiktok.com') return new Response(null, { status: 302, headers: { location: `https://www.tiktok.com/@test/photo/${ID}` } })
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'text/html' } })
    if (url.hostname === 'www.tiktok.com') return jsonResponse({ items: [photoItem()] })
    if (url.pathname !== '/broken.jpg') return mediaResponse('image/jpeg')
  })
  const files = await tiktokOfficialDownload(CONFIG, 'https://vm.tiktok.com/ABC123/')
  assert.equal(files.length, 2)
  assert.equal(calls[0].options.method, 'HEAD')
  assert.equal(calls[1].options.method, 'HEAD')
  assert.equal(calls[2].url.pathname, '/player/api/v1/items')
})

test('une redirection courte hors TikTok n’est jamais suivie', async t => {
  const calls = mockHttp(t, () => new Response(null, { status: 302, headers: { location: 'https://evil.example/video/123' } }))
  await assert.rejects(() => tiktokOfficialDownload(CONFIG, 'https://vm.tiktok.com/ABC123/'), /domaine autorisé/)
  assert.equal(calls.length, 1)
})

test('les restrictions créateur et le mode audio empêchent l’envoi de photos inadaptées', async t => {
  let item = videoItem(['https://cdn.example/video.mp4'], { control_info: { allow_download: false } })
  const calls = mockHttp(t, () => jsonResponse({ items: [item] }))
  await assert.rejects(() => tiktokOfficialDownload(CONFIG, URL), /n’autorise pas/)
  assert.equal(calls.length, 1)
  item = photoItem()
  await assert.rejects(() => tiktokOfficialDownload(CONFIG, URL, 'audio'), /photos, pas un flux audio/)
  assert.equal(calls.length, 2)
})

test('trois fichiers incomplets produisent une erreur utilisateur et non un faux média', async t => {
  const calls = mockHttp(t, url => url.hostname === 'www.tiktok.com'
    ? jsonResponse({ items: [videoItem(['https://cdn.example/one.mp4', 'https://cdn.example/two.mp4', 'https://cdn.example/three.mp4'])] })
    : mediaResponse('video/mp4', 100))
  await assert.rejects(() => tiktokOfficialDownload(CONFIG, URL), error => {
    assert.equal(error.userFacing, true)
    assert.match(error.message, /1024/)
    return true
  })
  assert.equal(calls.length, 4)
})
