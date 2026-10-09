import fs from 'node:fs/promises'
import path from 'node:path'
import { DATABASE_TABLES, ensureDatabaseSchema, normalizeInstanceId } from '../services/database.js'
import { createStorageCodec } from '../services/storage-codec.js'

const DEFAULTS = Object.freeze({
  global: {},
  groups: {},
  sudo: []
})

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalize(value = {}) {
  return {
    global: value.global && typeof value.global === 'object' ? value.global : {},
    groups: value.groups && typeof value.groups === 'object' ? value.groups : {},
    sudo: Array.isArray(value.sudo) ? value.sudo.map(String) : []
  }
}

class SettingsStore {
  constructor(logger) {
    this.logger = logger
    this.data = clone(DEFAULTS)
    this.writeQueue = Promise.resolve()
  }

  getGlobal(key, fallback) {
    return this.data.global[key] ?? fallback
  }

  async setGlobal(key, value) {
    this.data.global[key] = value
    await this.save()
    return value
  }

  getGroup(jid) {
    return this.data.groups[jid] || {}
  }

  async updateGroup(jid, patch) {
    this.data.groups[jid] = { ...this.getGroup(jid), ...patch }
    await this.save()
    return this.data.groups[jid]
  }

  isSudo(number) {
    return this.data.sudo.includes(String(number))
  }

  async addSudo(number) {
    const value = String(number)
    if (!this.data.sudo.includes(value)) this.data.sudo.push(value)
    await this.save()
  }

  async removeSudo(number) {
    this.data.sudo = this.data.sudo.filter(item => item !== String(number))
    await this.save()
  }
}

export class JsonStore extends SettingsStore {
  constructor(file, logger) {
    super(logger)
    this.file = file
  }

  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    try {
      this.data = normalize(JSON.parse(await fs.readFile(this.file, 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn({ err: error }, 'Fichier de réglages invalide, valeurs par défaut utilisées')
      }
      await this.save()
    }
    return this
  }

  async save() {
    const snapshot = JSON.stringify(this.data, null, 2) + '\n'
    const temp = `${this.file}.tmp`
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(temp, snapshot, { mode: 0o600 })
        await fs.rename(temp, this.file)
      })
    return this.writeQueue
  }
}

export class PostgresStore extends SettingsStore {
  constructor(pool, instanceId, logger, encryptionKey = '') {
    super(logger)
    this.pool = pool
    this.instanceId = normalizeInstanceId(instanceId)
    this.codec = createStorageCodec(encryptionKey)
  }

  async load() {
    await ensureDatabaseSchema(this.pool)
    const result = await this.pool.query(
      `SELECT value FROM ${DATABASE_TABLES.settings} WHERE instance_id = $1`,
      [this.instanceId]
    )
    if (result.rows[0]?.value) {
      try {
        this.data = normalize(JSON.parse(this.codec.decode(result.rows[0].value)))
      } catch (error) {
        throw new Error(`Réglages PostgreSQL invalides pour ${this.instanceId}: ${error.message}`)
      }
    } else {
      await this.save()
    }
    return this
  }

  async save() {
    const snapshot = this.codec.encode(JSON.stringify(this.data))
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => this.pool.query(
        `INSERT INTO ${DATABASE_TABLES.settings} (instance_id, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (instance_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [this.instanceId, snapshot]
      ))
    return this.writeQueue
  }
}
