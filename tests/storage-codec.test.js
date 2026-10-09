import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createStorageCodec } from '../src/services/storage-codec.js'

test('chiffre et déchiffre les valeurs PostgreSQL', () => {
  const key = crypto.randomBytes(32).toString('base64')
  const codec = createStorageCodec(key)
  const source = '{"secret":"valeur"}'
  const encrypted = codec.encode(source)
  assert.notEqual(encrypted, source)
  assert.match(encrypted, /^nova:v1:/)
  assert.equal(codec.decode(encrypted), source)
})

test('accepte les anciennes valeurs non chiffrées', () => {
  const codec = createStorageCodec(crypto.randomBytes(32).toString('base64'))
  assert.equal(codec.decode('{"legacy":true}'), '{"legacy":true}')
})

test('refuse une clé de longueur incorrecte', () => {
  assert.throws(() => createStorageCodec(Buffer.from('trop-court').toString('base64')))
})
