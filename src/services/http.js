import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'

const USER_AGENT = 'CURSI-MD/0.17 (+WhatsApp bot)'

function isPrivateIPv4(ip) {
  const octets = ip.split('.').map(Number)
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip)
  if (!net.isIPv6(ip)) return true
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIPv4(mapped[1]) : false
}

export async function validateExternalUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error('URL invalide')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Seules les URL HTTP(S) sont acceptées')
  if (url.username || url.password) throw new Error('Les identifiants intégrés à une URL sont interdits')
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new Error('Adresse locale interdite')

  const records = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true })
  if (!records.length || records.some(record => isPrivateIp(record.address))) {
    throw new Error('Adresse privée ou non résolue interdite')
  }
  return url
}

export async function fetchJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const attempts = Math.max(1, options.retries ?? (['GET', 'HEAD'].includes(method) ? 3 : 1))
  const { retries: _retries, ...fetchOptions } = options
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout || 15_000)
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(fetchOptions.headers || {}) },
        signal: controller.signal
      })
      const text = await response.text()
      if (!response.ok) {
        const error = new Error(`Service distant : HTTP ${response.status} ${text.slice(0, 160)}`)
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      try {
        return JSON.parse(text)
      } catch {
        const error = new Error('Le service distant n’a pas renvoyé de JSON valide')
        error.retryable = true
        throw error
      }
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error('Le service distant a dépassé le délai autorisé')
        : error
      const retryable = error.name === 'AbortError' || error.retryable || !/HTTP 4\d\d/.test(String(error.message))
      if (attempt >= attempts || !retryable) throw lastError
      await new Promise(resolve => setTimeout(resolve, attempt * 350))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

export async function fetchText(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const attempts = Math.max(1, options.retries ?? (['GET', 'HEAD'].includes(method) ? 2 : 1))
  const { retries: _retries, ...fetchOptions } = options
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout || 15_000)
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', ...(fetchOptions.headers || {}) },
        signal: controller.signal
      })
      const text = await response.text()
      if (!response.ok) {
        const error = new Error(`Service distant : HTTP ${response.status} ${text.slice(0, 160)}`)
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      return text
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error('Le service distant a dépassé le délai autorisé')
        : error
      const retryable = error.name === 'AbortError' || error.retryable || !/HTTP 4\d\d/.test(String(error.message))
      if (attempt >= attempts || !retryable) throw lastError
      await new Promise(resolve => setTimeout(resolve, attempt * 350))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

function filenameFromResponse(response, finalUrl) {
  const disposition = response.headers.get('content-disposition') || ''
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plain = disposition.match(/filename="?([^";]+)"?/i)
  const raw = utf?.[1] || plain?.[1] || path.basename(new URL(finalUrl).pathname) || 'fichier'
  try {
    return decodeURIComponent(raw).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'fichier'
  } catch {
    return 'fichier'
  }
}

export async function fetchExternalBuffer(input, { maxBytes = 50 * 1024 * 1024, timeout = 45_000, redirects = 4, headers = {} } = {}) {
  let current = String(input)
  for (let hop = 0; hop <= redirects; hop += 1) {
    const safeUrl = await validateExternalUrl(current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    let response
    try {
      response = await fetch(safeUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, ...headers }
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error('Redirection sans destination')
        current = new URL(location, safeUrl).toString()
        continue
      }
      if (!response.ok) throw new Error(`Téléchargement impossible : HTTP ${response.status}`)
      const announced = Number(response.headers.get('content-length') || 0)
      if (announced > maxBytes) throw new Error(`Fichier trop volumineux (${Math.ceil(announced / 1024 / 1024)} Mo)`)

      const chunks = []
      let size = 0
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new Error(`Fichier supérieur à la limite de ${Math.floor(maxBytes / 1024 / 1024)} Mo`)
        }
        chunks.push(Buffer.from(value))
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
        filename: filenameFromResponse(response, safeUrl.toString()),
        finalUrl: safeUrl.toString()
      }
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Le téléchargement a expiré')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('Trop de redirections')
}
