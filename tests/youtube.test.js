import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isYouTubeUrl,
  parseInvidiousResults,
  parsePipedResults,
  parseYouTubeApiResults,
  resolveYouTube,
  youtubeSearchMode
} from '../src/services/youtube.js'
import { downloaderReadiness } from '../src/services/downloader.js'

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

test('explique la configuration manquante pour une recherche par titre', async () => {
  await assert.rejects(() => resolveYouTube({}, 'un titre'), error => {
    assert.equal(error.userFacing, true)
    assert.match(error.message, /YOUTUBE_API_KEY/)
    assert.match(error.message, /\.dlstatus/)
    return true
  })
})

test('calcule la disponibilité des téléchargements sans exposer les secrets', () => {
  assert.deepEqual(downloaderReadiness({}), {
    local: false, cobalt: false, search: false, directYouTube: false, titleYouTube: false, social: false
  })
  assert.equal(downloaderReadiness({ cobaltApiUrl: 'https://cobalt.example', youtubeApiKey: 'secret' }).titleYouTube, true)
  assert.equal(downloaderReadiness({ localDownloaderEnabled: true }).titleYouTube, true)
  assert.equal(youtubeSearchMode({ localDownloaderEnabled: true }), 'moteur local yt-dlp')
  assert.equal(youtubeSearchMode({ youtubeSearchApiUrl: 'https://inv.example', youtubeSearchProvider: 'invidious' }), 'API Invidious configurée')
})
