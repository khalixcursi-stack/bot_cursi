import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { newDb } from 'pg-mem'
import { usePostgresAuthState } from '../src/core/postgres-auth.js'
import { PostgresStore } from '../src/core/store.js'

function memoryPool() {
  const database = newDb({ noAstCoverageCheck: true })
  const adapter = database.adapters.createPg()
  return new adapter.Pool()
}

const logger = { warn() {}, error() {} }

test('persiste les identifiants et clés Baileys dans PostgreSQL', async () => {
  const pool = memoryPool()
  const encryptionKey = crypto.randomBytes(32).toString('base64')
  try {
    const first = await usePostgresAuthState(pool, 'principal', encryptionKey)
    first.state.creds.registered = true
    await first.state.keys.set({ session: { alice: { key: Buffer.from('secret') } } })
    await first.saveCreds()

    const second = await usePostgresAuthState(pool, 'principal', encryptionKey)
    assert.equal(second.state.creds.registered, true)
    const keys = await second.state.keys.get('session', ['alice', 'missing'])
    assert.deepEqual(keys.alice.key, Buffer.from('secret'))
    assert.equal(keys.missing, null)

    await second.state.keys.set({ session: { alice: null } })
    assert.equal((await second.state.keys.get('session', ['alice'])).alice, null)
  } finally {
    await pool.end()
  }
})

test('persiste les réglages du bot dans PostgreSQL', async () => {
  const pool = memoryPool()
  const encryptionKey = crypto.randomBytes(32).toString('base64')
  try {
    const first = await new PostgresStore(pool, 'principal', logger, encryptionKey).load()
    await first.setGlobal('mode', 'public')
    await first.updateGroup('123@g.us', {
      welcome: true,
      blockedWords: ['test'],
      bannedMembers: ['242060000001@s.whatsapp.net']
    })
    await first.addSudo('242000000000')

    const second = await new PostgresStore(pool, 'principal', logger, encryptionKey).load()
    assert.equal(second.getGlobal('mode'), 'public')
    assert.equal(second.getGroup('123@g.us').welcome, true)
    assert.deepEqual(second.getGroup('123@g.us').blockedWords, ['test'])
    assert.deepEqual(second.getGroup('123@g.us').bannedMembers, ['242060000001@s.whatsapp.net'])
    assert.equal(second.isSudo('242000000000'), true)
  } finally {
    await pool.end()
  }
})
