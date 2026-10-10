import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_DOWNLOADER_VERSION } from '../../src/services/local-downloader.js'

const ASSETS = { 'linux-x64': 'yt-dlp_linux', 'linux-arm64': 'yt-dlp_linux_aarch64', 'darwin-x64': 'yt-dlp_macos', 'darwin-arm64': 'yt-dlp_macos' }

export async function fakeDownloader(t, handler) {
  const asset = ASSETS[`${process.platform}-${process.arch}`]
  if (!asset) { t.skip('faux exécutable réservé à Unix'); return null }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-downloader-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'fake-ytdlp.mjs')
  const log = path.join(directory, 'args.jsonl')
  const code = `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')
if (args.includes('--version')) { console.log('2026.08.16.020253'); process.exit(0) }
${handler}
`
  await fs.writeFile(executable, code, { mode: 0o700 })
  const binary = path.join(directory, asset)
  await fs.symlink(executable, binary)
  const digest = crypto.createHash('sha256').update(code).digest('hex')
  await fs.writeFile(`${binary}.sha256`, `${LOCAL_DOWNLOADER_VERSION} ${digest}\n`)
  return {
    config: { localDownloaderEnabled: true, localDownloaderDir: directory, localDownloadTimeoutMs: 10_000, maxDownloadBytes: 1024 * 1024 },
    async calls() { return (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) }
  }
}
