import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_DOWNLOADER_VERSION, localDownload, localDownloaderDiagnostics, localYouTubeSearch } from '../src/services/local-downloader.js'

const assetByPlatform = {
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64',
  'darwin-x64': 'yt-dlp_macos',
  'darwin-arm64': 'yt-dlp_macos'
}

test('le moteur local télécharge par titre et recherche YouTube sans clé', async t => {
  const asset = assetByPlatform[`${process.platform}-${process.arch}`]
  if (!asset) return t.skip('test du faux exécutable réservé à Unix')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-ytdlp-test-'))
  const binary = path.join(directory, asset)
  const script = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('2026.08.16.020253')
  process.exit(0)
}
if (args.includes('--dump-single-json')) {
  console.log(JSON.stringify({ entries: [{ id: 'abc123XYZ', title: 'Titre test', channel: 'Chaîne test' }] }))
  process.exit(0)
}
const index = args.indexOf('--paths')
const output = path.join(args[index + 1], 'media.mp3')
fs.writeFileSync(output, Buffer.from('audio-test'))
`
  try {
    await fs.writeFile(binary, script, { mode: 0o700 })
    const digest = crypto.createHash('sha256').update(await fs.readFile(binary)).digest('hex')
    await fs.writeFile(`${binary}.sha256`, `${LOCAL_DOWNLOADER_VERSION} ${digest}\n`)
    const config = {
      localDownloaderEnabled: true,
      localDownloaderDir: directory,
      localDownloadTimeoutMs: 10_000,
      maxDownloadBytes: 1024 * 1024
    }
    const diagnostics = await localDownloaderDiagnostics(config)
    assert.equal(diagnostics.ready, true)
    assert.equal(diagnostics.reportedVersion, '2026.08.16.020253')

    const file = await localDownload(config, 'un titre', 'audio', { youtubeSearch: true })
    assert.equal(file.contentType, 'audio/mpeg')
    assert.equal(file.buffer.toString(), 'audio-test')
    assert.equal(file.engine, 'yt-dlp-local')

    const videos = await localYouTubeSearch(config, 'un titre')
    assert.equal(videos[0].title, 'Titre test')
    assert.equal(videos[0].url, 'https://www.youtube.com/watch?v=abc123XYZ')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
