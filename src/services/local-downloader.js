import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, validateExternalUrl } from './http.js'

export const LOCAL_DOWNLOADER_VERSION = 'nightly@2026.08.16.020253'
const YT_DLP_RELEASE_TAG = '2026.08.16.020253'
const YT_DLP_REPOSITORY = 'yt-dlp/yt-dlp-nightly-builds'
const SUPPORTED_MEDIA_HOSTS = [
  'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com', 'fb.watch',
  'twitter.com', 'x.com', 'soundcloud.com', 'vimeo.com', 'twitch.tv', 'reddit.com',
  'pinterest.com', 'pin.it', 'streamable.com'
]
let installPromise = null

function releaseAsset() {
  const key = `${process.platform}-${process.arch}`
  const assets = {
    'linux-x64': 'yt-dlp_linux',
    'linux-arm64': 'yt-dlp_linux_aarch64',
    'win32-x64': 'yt-dlp.exe',
    'win32-arm64': 'yt-dlp_arm64.exe',
    'darwin-x64': 'yt-dlp_macos',
    'darwin-arm64': 'yt-dlp_macos'
  }
  const asset = assets[key]
  if (!asset) throw new UserError(`Téléchargeur local indisponible pour ${key}. Configurez Cobalt comme solution de repli.`)
  return asset
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function existingBinary(binary, marker) {
  try {
    const [version, saved] = (await fs.readFile(marker, 'utf8')).trim().split(/\s+/)
    if (version !== LOCAL_DOWNLOADER_VERSION || !/^[a-f0-9]{64}$/i.test(saved)) return false
    if (sha256(await fs.readFile(binary)) !== saved.toLowerCase()) return false
    if (process.platform !== 'win32') await fs.chmod(binary, 0o700)
    await fs.access(binary, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function installYtDlp(config) {
  const asset = releaseAsset()
  const bundledBinary = path.resolve(process.cwd(), 'bin', asset)
  if (await existingBinary(bundledBinary, `${bundledBinary}.sha256`)) return bundledBinary

  const directory = config.localDownloaderDir
  const binary = path.join(directory, asset)
  const marker = `${binary}.sha256`
  if (await existingBinary(binary, marker)) return binary

  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const base = `https://github.com/${YT_DLP_REPOSITORY}/releases/download/${YT_DLP_RELEASE_TAG}`
  let sums
  let file
  try {
    ;[sums, file] = await Promise.all([
      fetchExternalBuffer(`${base}/SHA2-256SUMS`, { maxBytes: 1024 * 1024, timeout: 60_000 }),
      fetchExternalBuffer(`${base}/${asset}`, { maxBytes: 60 * 1024 * 1024, timeout: 180_000 })
    ])
  } catch (error) {
    throw asUserError(error, 'Impossible d’installer automatiquement le moteur yt-dlp')
  }

  const expected = sums.buffer.toString('utf8')
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts.at(-1)?.replace(/^\*/, '') === asset)?.[0]
  const actual = sha256(file.buffer)
  if (!expected || expected.toLowerCase() !== actual) {
    throw new UserError('La vérification de sécurité du moteur yt-dlp a échoué; installation annulée.')
  }

  const temporary = `${binary}.tmp-${process.pid}`
  await fs.writeFile(temporary, file.buffer, { mode: 0o700 })
  if (process.platform !== 'win32') await fs.chmod(temporary, 0o700)
  await fs.rename(temporary, binary)
  await fs.writeFile(marker, `${LOCAL_DOWNLOADER_VERSION} ${actual}\n`, { mode: 0o600 })
  return binary
}

export async function ensureLocalDownloader(config) {
  if (!config.localDownloaderEnabled) throw new UserError('Le téléchargeur local est désactivé par LOCAL_DOWNLOADER_ENABLED=false.')
  if (!installPromise) {
    installPromise = installYtDlp(config).catch(error => {
      installPromise = null
      throw error
    })
  }
  return installPromise
}

function processError(stderr = '') {
  const lines = String(stderr).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const useful = [...lines].reverse().find(line => /error|failed|unable|unavailable|requested/i.test(line)) || lines.at(-1) || ''
  return useful.replace(/^ERROR:\s*/i, '').slice(0, 260)
}

function runProcess(binary, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const append = (current, chunk) => (current + chunk.toString()).slice(-2 * 1024 * 1024)
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new UserError('Le téléchargement local a dépassé le délai autorisé.'))
    }, timeout)
    child.once('error', error => {
      clearTimeout(timer)
      reject(asUserError(error, 'Impossible de démarrer le moteur de téléchargement local'))
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new UserError(`Le moteur local a refusé ce média${processError(stderr) ? ` (${processError(stderr)})` : ''}.`))
    })
  })
}

function mimeFromExtension(extension) {
  return {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', wav: 'audio/wav',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
  }[extension] || 'application/octet-stream'
}

function commonArgs(config, directory) {
  return [
    '--no-warnings',
    '--no-progress',
    '--no-playlist',
    '--socket-timeout', '20',
    '--retries', '3',
    '--fragment-retries', '3',
    '--max-filesize', String(config.maxDownloadBytes),
    '--paths', directory,
    '--output', 'media.%(ext)s'
  ]
}

export async function localDownload(config, input, mode = 'auto', { youtubeSearch = false } = {}) {
  const value = String(input || '').trim()
  if (!value) throw new UserError('Indiquez un titre ou une URL à télécharger.')
  const isUrl = /^https?:\/\//i.test(value)
  if (isUrl) {
    const safeUrl = await validateExternalUrl(value).catch(error => { throw asUserError(error, 'URL de téléchargement refusée') })
    const hostname = safeUrl.hostname.toLowerCase()
    if (!SUPPORTED_MEDIA_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`))) {
      throw new UserError('Ce domaine n’est pas pris en charge par le téléchargeur social sécurisé.')
    }
  }
  if (!isUrl && !youtubeSearch) throw new UserError('Cette commande nécessite une URL HTTP(S) complète.')

  const binary = await ensureLocalDownloader(config)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-download-'))
  const source = isUrl ? value : `ytsearch1:${value.slice(0, 180)}`
  const args = commonArgs(config, directory)
  if (mode === 'audio') {
    args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5')
  } else if (mode === 'video') {
    args.push('-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best', '--merge-output-format', 'mp4')
  } else {
    args.push('-f', 'best[ext=mp4]/best')
  }
  if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath)
  args.push('--', source)

  try {
    await runProcess(binary, args, config.localDownloadTimeoutMs)
    const files = (await fs.readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && !entry.name.endsWith('.part'))
    if (!files.length) throw new UserError('Le moteur local n’a produit aucun fichier exploitable.')
    const candidates = await Promise.all(files.map(async entry => ({
      name: entry.name,
      size: (await fs.stat(path.join(directory, entry.name))).size
    })))
    const selected = candidates.sort((a, b) => b.size - a.size)[0]
    if (!selected.size) throw new UserError('Le fichier téléchargé est vide.')
    if (selected.size > config.maxDownloadBytes) throw new UserError(`Le fichier dépasse la limite de ${Math.floor(config.maxDownloadBytes / 1024 / 1024)} Mo.`)
    const buffer = await fs.readFile(path.join(directory, selected.name))
    const extension = path.extname(selected.name).slice(1).toLowerCase()
    return {
      buffer,
      filename: selected.name,
      contentType: mimeFromExtension(extension),
      finalUrl: isUrl ? value : source,
      engine: 'yt-dlp-local'
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

export async function localYouTubeSearch(config, query) {
  const value = String(query || '').trim().slice(0, 180)
  if (!value) throw new UserError('Indiquez une recherche YouTube.')
  const binary = await ensureLocalDownloader(config)
  const { stdout } = await runProcess(binary, [
    '--no-warnings',
    '--flat-playlist',
    '--dump-single-json',
    '--skip-download',
    '--playlist-end', '5',
    '--socket-timeout', '20',
    '--retries', '2',
    '--', `ytsearch5:${value}`
  ], Math.min(config.localDownloadTimeoutMs, 90_000))

  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new UserError('Le moteur local n’a pas renvoyé de résultats YouTube valides.')
  }
  return (data.entries || []).map(item => ({
    title: item.title || 'Vidéo YouTube',
    author: item.channel || item.uploader || '',
    description: item.description || '',
    url: item.webpage_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : '')
  })).filter(item => item.url)
}

export async function localDownloaderDiagnostics(config) {
  const binary = await ensureLocalDownloader(config)
  const { stdout } = await runProcess(binary, ['--version'], 15_000)
  const stat = await fs.stat(binary)
  return {
    ready: true,
    binary,
    bytes: stat.size,
    reportedVersion: stdout.trim().split(/\r?\n/).at(-1) || LOCAL_DOWNLOADER_VERSION
  }
}

export function localDownloaderInfo(config) {
  return {
    enabled: Boolean(config.localDownloaderEnabled),
    version: LOCAL_DOWNLOADER_VERSION,
    platform: `${process.platform}-${process.arch}`,
    directory: config.localDownloaderDir
  }
}
