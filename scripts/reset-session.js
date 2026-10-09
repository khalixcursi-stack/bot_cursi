import { config } from '../src/config.js'
import { createLogger } from '../src/core/logger.js'
import { createDatabasePool } from '../src/services/database.js'
import { resetPostgresAuthState } from '../src/core/postgres-auth.js'

if (process.env.CONFIRM_RESET !== 'yes') {
  console.error('Opération annulée. Relancez avec CONFIRM_RESET=yes pour confirmer.')
  process.exit(1)
}
if (!config.databaseUrl) {
  console.error('DATABASE_URL ou POSTGRES_URI est requis pour réinitialiser une session PostgreSQL.')
  process.exit(1)
}

const logger = createLogger(config.logLevel)
const pool = await createDatabasePool(config, logger)
try {
  await resetPostgresAuthState(pool, config.botInstanceId)
  console.log(`Session PostgreSQL "${config.botInstanceId}" supprimée. Le prochain lancement demandera un nouveau jumelage.`)
} finally {
  await pool.end()
}
