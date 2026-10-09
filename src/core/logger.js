import pino from 'pino'

export function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'nova-md' },
    redact: {
      paths: ['*.apiKey', '*.databaseUrl', '*.storageEncryptionKey', 'config.ai.apiKey', 'req.headers.authorization'],
      censor: '[SECRET]'
    }
  })
}
