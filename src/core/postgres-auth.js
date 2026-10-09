import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys'
import { DATABASE_TABLES, ensureDatabaseSchema, normalizeInstanceId } from '../services/database.js'
import { createStorageCodec } from '../services/storage-codec.js'

function serialize(value) {
  return JSON.stringify(value, BufferJSON.replacer)
}

function deserialize(value) {
  return JSON.parse(value, BufferJSON.reviver)
}

export async function usePostgresAuthState(pool, rawInstanceId = 'default', encryptionKey = '') {
  const instanceId = normalizeInstanceId(rawInstanceId)
  const codec = createStorageCodec(encryptionKey)
  await ensureDatabaseSchema(pool)

  const result = await pool.query(
    `SELECT value FROM ${DATABASE_TABLES.credentials} WHERE instance_id = $1`,
    [instanceId]
  )
  const creds = result.rows[0]?.value
    ? deserialize(codec.decode(result.rows[0].value))
    : initAuthCreds()
  let credentialWriteQueue = Promise.resolve()

  const saveCreds = async () => {
    const snapshot = codec.encode(serialize(creds))
    credentialWriteQueue = credentialWriteQueue
      .catch(() => {})
      .then(() => pool.query(
        `INSERT INTO ${DATABASE_TABLES.credentials} (instance_id, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (instance_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [instanceId, snapshot]
      ))
    await credentialWriteQueue
  }

  const keys = {
    get: async (category, ids) => {
      const output = {}
      for (const id of ids) output[id] = null
      if (!ids.length) return output

      const rows = await pool.query(
        `SELECT key_id, value FROM ${DATABASE_TABLES.keys}
         WHERE instance_id = $1 AND category = $2 AND key_id = ANY($3::text[])`,
        [instanceId, category, ids]
      )
      for (const row of rows.rows) {
        let value = deserialize(codec.decode(row.value))
        if (category === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value)
        }
        output[row.key_id] = value
      }
      return output
    },

    set: async data => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const [category, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries || {})) {
            if (value === null || value === undefined) {
              await client.query(
                `DELETE FROM ${DATABASE_TABLES.keys}
                 WHERE instance_id = $1 AND category = $2 AND key_id = $3`,
                [instanceId, category, id]
              )
            } else {
              await client.query(
                `INSERT INTO ${DATABASE_TABLES.keys} (instance_id, category, key_id, value, updated_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (instance_id, category, key_id)
                 DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
                [instanceId, category, id, codec.encode(serialize(value))]
              )
            }
          }
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    }
  }

  return { state: { creds, keys }, saveCreds, instanceId }
}

export async function resetPostgresAuthState(pool, rawInstanceId = 'default') {
  const instanceId = normalizeInstanceId(rawInstanceId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM ${DATABASE_TABLES.keys} WHERE instance_id = $1`, [instanceId])
    await client.query(`DELETE FROM ${DATABASE_TABLES.credentials} WHERE instance_id = $1`, [instanceId])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
