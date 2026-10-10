import test from 'node:test'
import assert from 'node:assert/strict'
import { isAntiBotError, localDownload, localDownloaderDiagnostics, localYouTubeSearch } from '../src/services/local-downloader.js'
import { fakeDownloader } from './helpers/fake-downloader.js'

const CLIENTS = 'youtube:player_client=ios,android,tv,web'
const USER_AGENT = 'com.google.ios.youtube/19.29.1 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X; en_US)'

function value(args, option) { return args[args.indexOf(option) + 1] }

test('yt-dlp utilise tous les arguments anti-bot en téléchargement/recherche et conserve la rotation', async t => {
  const fake = await fakeDownloader(t, `
if (args.includes('--dump-single-json')) {
  console.log(JSON.stringify({ entries: [{ id: 'abc123XYZ', title: 'Titre test', channel: 'Chaîne test' }] }))
  process.exit(0)
}
if (args.at(-1).includes('antibot') && args.includes(${JSON.stringify(CLIENTS)})) {
  console.error('ERROR: Sign in to confirm you are not a bot')
  process.exit(1)
}
fs.writeFileSync(path.join(args[args.indexOf('--paths') + 1], 'media.mp3'), Buffer.from('audio-test'))
`)
  if (!fake) return
  const diagnostics = await localDownloaderDiagnostics(fake.config)
  assert.equal(diagnostics.ready, true)
  assert.equal(diagnostics.reportedVersion, '2026.08.16.020253')

  const file = await localDownload(fake.config, 'un titre', 'audio', { youtubeSearch: true })
  assert.equal(file.contentType, 'audio/mpeg')
  assert.equal(file.buffer.toString(), 'audio-test')
  assert.equal(file.engine, 'yt-dlp-local')
  const videos = await localYouTubeSearch(fake.config, 'un titre')
  assert.equal(videos[0].url, 'https://www.youtube.com/watch?v=abc123XYZ')

  let retries = 0
  await localDownload(fake.config, 'antibot', 'audio', { youtubeSearch: true, logger: { warn() { retries += 1 } } })
  assert.equal(retries, 1)
  const calls = (await fake.calls()).filter(args => !args.includes('--version'))
  for (const args of calls.slice(0, 3)) {
    assert.equal(value(args, '--extractor-args'), CLIENTS)
    assert.equal(value(args, '--user-agent'), USER_AGENT)
    assert.equal(value(args, '--referer'), 'https://www.youtube.com/')
    assert.ok(args.includes('--no-check-certificates'))
    assert.ok(args.includes('--geo-bypass'))
    assert.equal(args.at(-2), '--', 'la source n’est jamais interprétée comme un argument ou une commande shell')
  }
  assert.equal(value(calls[3], '--extractor-args'), 'youtube:player_client=web_embedded,android')
  assert.match(value(calls[3], '--user-agent'), /^Mozilla/)
})

test('reconnaît les erreurs anti-bot, mais ne répète pas un post simplement sans vidéo', () => {
  assert.equal(isAntiBotError(new Error('Sign in to confirm you are not a bot')), true)
  assert.equal(isAntiBotError(new Error('HTTP Error 429')), true)
  assert.equal(isAntiBotError(new Error('no video in this post')), false)
})
