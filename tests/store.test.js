import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/core/store.js'

const logger = { warn() {} }

test('persiste les réglages et la liste sudo', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-store-'))
  const file = path.join(directory, 'settings.json')
  try {
    const store = await new JsonStore(file, logger).load()
    await store.setGlobal('mode', 'public')
    await store.updateGroup('123@g.us', {
      welcome: true,
      blockedWords: ['test'],
      bannedMembers: ['242060000001@s.whatsapp.net']
    })
    await store.addSudo('242000000000')

    const loaded = await new JsonStore(file, logger).load()
    assert.equal(loaded.getGlobal('mode'), 'public')
    assert.equal(loaded.getGroup('123@g.us').welcome, true)
    assert.deepEqual(loaded.getGroup('123@g.us').blockedWords, ['test'])
    assert.deepEqual(loaded.getGroup('123@g.us').bannedMembers, ['242060000001@s.whatsapp.net'])
    assert.equal(loaded.isSudo('242000000000'), true)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
