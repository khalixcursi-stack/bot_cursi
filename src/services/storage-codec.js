import crypto from 'node:crypto'

const PREFIX = 'nova:v1:'

export function createStorageCodec(base64Key = '') {
  if (!base64Key) {
    return {
      encrypted: false,
      encode: value => String(value),
      decode: value => String(value)
    }
  }

  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== 32) {
    throw new Error('STORAGE_ENCRYPTION_KEY doit être une clé base64 de 32 octets. Consultez NORTHFLANK.md.')
  }

  return {
    encrypted: true,
    encode(value) {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
    },
    decode(value) {
      const text = String(value)
      if (!text.startsWith(PREFIX)) return text
      const [iv64, tag64, encrypted64] = text.slice(PREFIX.length).split(':')
      if (!iv64 || !tag64 || !encrypted64) throw new Error('Donnée chiffrée invalide')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv64, 'base64'))
      decipher.setAuthTag(Buffer.from(tag64, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted64, 'base64')),
        decipher.final()
      ]).toString('utf8')
    }
  }
}
