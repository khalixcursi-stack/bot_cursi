import pg from 'pg'

const { Pool } = pg

export const DATABASE_TABLES = Object.freeze({
  credentials: 'nova_md_auth_credentials',
  keys: 'nova_md_auth_keys',
  settings: 'nova_md_settings'
})

export function normalizeInstanceId(value = 'default') {
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  return normalized.slice(0, 64) || 'default'
}

function sslOptions(mode, connectionString) {
  const value = String(mode || 'auto').toLowerCase()
  if (['false', 'off', 'disable', 'disabled', '0'].includes(value)) return false
  if (['true', 'on', 'require', 'required', '1'].includes(value)) return { rejectUnauthorized: false }
  if (/sslmode=(?:require|verify-ca|verify-full)/i.test(connectionString)) return { rejectUnauthorized: false }
  return undefined
}

export async function ensureDatabaseSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${DATABASE_TABLES.credentials} (
      instance_id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ${DATABASE_TABLES.keys} (
      instance_id TEXT NOT NULL,
      category TEXT NOT NULL,
      key_id TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (instance_id, category, key_id)
    );

    CREATE TABLE IF NOT EXISTS ${DATABASE_TABLES.settings} (
      instance_id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
}

export async function createDatabasePool(config, logger) {
  if (!config.databaseUrl) throw new Error('STORAGE_DRIVER=postgres nécessite DATABASE_URL ou POSTGRES_URI')

  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: sslOptions(config.databaseSsl, config.databaseUrl),
    max: 4,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    application_name: `${config.botName}-${config.botInstanceId}`.slice(0, 63)
  })

  pool.on('error', error => logger.error({ err: error }, 'Erreur PostgreSQL en arrière-plan'))

  let lastError
  for (let attempt = 1; attempt <= config.databaseRetries; attempt += 1) {
    try {
      await pool.query('SELECT 1')
      await ensureDatabaseSchema(pool)
      logger.info({ driver: 'postgres', instance: config.botInstanceId }, 'Stockage PostgreSQL connecté')
      return pool
    } catch (error) {
      lastError = error
      logger.warn({ attempt, maxAttempts: config.databaseRetries, error: error.message }, 'PostgreSQL indisponible, nouvelle tentative')
      if (attempt < config.databaseRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(15_000, attempt * 2_000)))
      }
    }
  }

  await pool.end().catch(() => {})
  throw new Error(`Connexion PostgreSQL impossible après ${config.databaseRetries} tentative(s): ${lastError?.message}`)
}
