import crypto from 'node:crypto'
import { fork } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { UserError } from '../core/errors.js'

const state = {
  configured: false,
  config: null,
  logger: null,
  controlNumber: '',
  directory: '',
  manifest: '',
  entries: new Map(),
  workers: new Map(),
  forkImpl: fork,
  stopping: false
}

function normalizeNumber(value = '') {
  return String(value).replace(/\D/g, '')
}

function idFor(number) {
  return crypto.createHash('sha256').update(`cursi-linked:${number}`).digest('hex').slice(0, 16)
}

function publicEntry(entry) {
  return {
    id: entry.id,
    number: entry.number,
    status: entry.status,
    createdAt: entry.createdAt,
    connectedAt: entry.connectedAt || ''
  }
}

async function saveManifest() {
  const data = JSON.stringify({ version: 1, entries: [...state.entries.values()] }, null, 2) + '\n'
  const temporary = `${state.manifest}.tmp`
  await fs.mkdir(state.directory, { recursive: true, mode: 0o700 })
  await fs.writeFile(temporary, data, { mode: 0o600 })
  await fs.rename(temporary, state.manifest)
}

async function prepareInstance(entry) {
  const root = path.join(state.directory, 'instances', entry.id)
  const authDir = path.join(root, 'auth')
  const dataDir = path.join(root, 'data')
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 })
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const settings = path.join(dataDir, 'settings.json')
  try {
    await fs.access(settings)
  } catch {
    const sudo = state.config.ownerNumber && state.config.ownerNumber !== entry.number
      ? [state.config.ownerNumber]
      : []
    await fs.writeFile(settings, JSON.stringify({ global: {}, groups: {}, sudo }, null, 2) + '\n', { mode: 0o600 })
  }
  return { root, authDir, dataDir }
}

function workerEnvironment(entry, paths) {
  return {
    ...process.env,
    LINKED_BOT_WORKER: 'true',
    LINKED_BOT_ID: entry.id,
    OWNER_NUMBER: entry.number,
    PAIRING_NUMBER: entry.number,
    PAIRING_CODE: 'true',
    AUTH_DIR: paths.authDir,
    DATA_DIR: paths.dataDir,
    STORAGE_DRIVER: 'local',
    DATABASE_URL: '',
    POSTGRES_URI: '',
    BOT_INSTANCE_ID: `linked-${entry.id}`,
    PORT: '0',
    STARTUP_NOTIFICATION: 'false',
    FIRST_CONNECTION_WELCOME: 'true'
  }
}

async function mark(entry, patch) {
  Object.assign(entry, patch)
  state.entries.set(entry.id, entry)
  await saveManifest()
}

async function spawnWorker(entry, { waitForCode = false } = {}) {
  if (state.workers.has(entry.id)) throw new UserError('Cette session liée est déjà démarrée.')
  const paths = await prepareInstance(entry)
  const child = state.forkImpl(path.resolve('src/index.js'), [], {
    cwd: process.cwd(),
    env: workerEnvironment(entry, paths),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })
  state.workers.set(entry.id, child)

  let resolveCode
  let rejectCode
  let timeout
  const codePromise = waitForCode
    ? new Promise((resolve, reject) => {
        resolveCode = resolve
        rejectCode = reject
        timeout = setTimeout(() => reject(new UserError('Le code de jumelage n’a pas été généré dans le délai prévu.')), 45_000)
      })
    : null

  child.on('message', message => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'pairing-code' && resolveCode) {
      clearTimeout(timeout)
      resolveCode(String(message.code))
      resolveCode = null
      rejectCode = null
    }
    if (message.type === 'pairing-error' && rejectCode) {
      clearTimeout(timeout)
      rejectCode(new UserError(`Code de jumelage impossible : ${message.error || 'erreur inconnue'}`))
      resolveCode = null
      rejectCode = null
    }
    if (message.type === 'connected') {
      mark(entry, { status: 'connected', connectedAt: new Date().toISOString() }).catch(error => state.logger?.warn({ err: error }, 'État de session liée non enregistré'))
    }
    if (message.type === 'logged-out') {
      mark(entry, { status: 'logged-out' }).catch(() => {})
    }
  })
  child.once('exit', (code, signal) => {
    state.workers.delete(entry.id)
    if (rejectCode) {
      clearTimeout(timeout)
      rejectCode(new UserError(`Le processus de jumelage s’est arrêté (${code ?? signal ?? 'inconnu'}).`))
      rejectCode = null
      resolveCode = null
    }
    if (!state.stopping && state.entries.has(entry.id) && !['removing', 'logged-out'].includes(entry.status)) {
      mark(entry, { status: 'stopped', lastError: `exit:${code ?? signal ?? 'unknown'}` }).catch(() => {})
    }
  })
  child.once('error', error => {
    if (rejectCode) {
      clearTimeout(timeout)
      rejectCode(new UserError(`Impossible de lancer la session liée : ${error.message}`))
      rejectCode = null
      resolveCode = null
    }
  })
  await mark(entry, { status: waitForCode ? 'pairing' : 'starting', lastError: '' })
  return codePromise
}

export async function configureLinkedBotManager({ config, logger, forkImpl = fork, controlNumber = '' }) {
  state.config = config
  state.logger = logger
  state.controlNumber = normalizeNumber(controlNumber)
  state.directory = path.join(config.dataDir, 'linked-bots')
  state.manifest = path.join(state.directory, 'registry.json')
  state.forkImpl = forkImpl
  state.stopping = false
  state.entries.clear()
  state.workers.clear()
  await fs.mkdir(state.directory, { recursive: true, mode: 0o700 })
  try {
    const saved = JSON.parse(await fs.readFile(state.manifest, 'utf8'))
    for (const entry of saved.entries || []) {
      if (entry?.id && entry?.number) state.entries.set(entry.id, entry)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') logger?.warn({ err: error }, 'Registre des sessions liées invalide; registre vide utilisé')
  }
  state.configured = true
}

export function setLinkedBotControlNumber(value = '') {
  state.controlNumber = normalizeNumber(value)
}

function requireManager() {
  if (!state.configured) throw new UserError('Le gestionnaire de sessions liées n’est pas initialisé.')
  if (state.config.linkedBotWorker) throw new UserError('Une session secondaire ne peut pas créer d’autres sessions.')
}

export async function restoreLinkedBots() {
  requireManager()
  for (const entry of state.entries.values()) {
    if (entry.status === 'pairing') {
      entry.status = 'stopped'
      continue
    }
    if (entry.status === 'logged-out') continue
    await spawnWorker(entry).catch(error => {
      entry.status = 'error'
      entry.lastError = error.message
      state.logger?.warn({ err: error, id: entry.id }, 'Session liée non restaurée')
    })
  }
  await saveManifest()
}

export async function createLinkedBot(rawNumber) {
  requireManager()
  const number = normalizeNumber(rawNumber)
  if (number.length < 8 || number.length > 15) throw new UserError('Numéro international invalide.')
  if (state.controlNumber && number === state.controlNumber) {
    throw new UserError('Le numéro de contrôle utilise déjà cette session WhatsApp.')
  }
  const current = [...state.entries.values()].filter(entry => entry.status !== 'removing')
  if (current.length >= state.config.maxLinkedBots) {
    throw new UserError(`Limite atteinte : ${state.config.maxLinkedBots} session(s) supplémentaire(s).`)
  }
  const id = idFor(number)
  if (state.entries.has(id)) throw new UserError('Une session existe déjà pour ce numéro.')
  const entry = { id, number, status: 'new', createdAt: new Date().toISOString(), connectedAt: '', lastError: '' }
  state.entries.set(id, entry)
  await saveManifest()
  try {
    const code = await spawnWorker(entry, { waitForCode: true })
    return { ...publicEntry(entry), code }
  } catch (error) {
    const worker = state.workers.get(id)
    worker?.kill?.('SIGTERM')
    state.workers.delete(id)
    state.entries.delete(id)
    await fs.rm(path.join(state.directory, 'instances', id), { recursive: true, force: true })
    await saveManifest()
    throw error
  }
}

export function listLinkedBots() {
  requireManager()
  return [...state.entries.values()].map(publicEntry)
}

export async function removeLinkedBot(identifier) {
  requireManager()
  const raw = String(identifier || '').trim()
  const number = normalizeNumber(raw)
  const entry = state.entries.get(raw) || [...state.entries.values()].find(item => item.number === number)
  if (!entry) throw new UserError('Session liée introuvable.')
  await mark(entry, { status: 'removing' })
  const child = state.workers.get(entry.id)
  if (child?.connected) child.send({ type: 'logout' })
  await new Promise(resolve => setTimeout(resolve, child ? 500 : 0))
  if (child && !child.killed) child.kill('SIGTERM')
  state.workers.delete(entry.id)
  state.entries.delete(entry.id)
  await fs.rm(path.join(state.directory, 'instances', entry.id), { recursive: true, force: true })
  await saveManifest()
  return publicEntry(entry)
}

export async function stopLinkedBots() {
  state.stopping = true
  for (const child of state.workers.values()) {
    if (!child.killed) child.kill('SIGTERM')
  }
  state.workers.clear()
}
