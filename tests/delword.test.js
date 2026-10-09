import test from 'node:test'
import assert from 'node:assert/strict'
import whatsappCommands from '../src/commands/whatsapp.js'
import { Dispatcher } from '../src/core/dispatcher.js'
import { findBlockedWord, normalizeBlockedWord, wordsOf } from '../src/utils/words.js'

const command = whatsappCommands.find(item => item.name === 'delword')

test('la correspondance utilise un mot entier, Unicode et sans tenir compte de la casse', () => {
  assert.equal(normalizeBlockedWord(' ÉCOLE '), 'école')
  assert.deepEqual(wordsOf('Test, école et l’essai.'), ['test', 'école', 'et', 'l’essai'])
  assert.equal(findBlockedWord('Ceci est un TEST.', ['test']), 'test')
  assert.equal(findBlockedWord('Ceci est un testament.', ['test']), '')
})

test('delword ajoute, liste puis retire un mot du groupe', async () => {
  const settings = {}
  const replies = []
  const ctx = {
    from: '123@g.us', runtime: { prefix: '.' }, args: ['add', 'Test'],
    store: {
      getGroup: () => settings,
      async updateGroup(_jid, patch) { Object.assign(settings, patch) }
    },
    async reply(value) { replies.push(String(value)) }
  }
  await command.run(ctx)
  assert.deepEqual(settings.blockedWords, ['test'])
  ctx.args = ['list']
  await command.run(ctx)
  assert.match(replies.at(-1), /test/)
  ctx.args = ['remove', 'test']
  await command.run(ctx)
  assert.deepEqual(settings.blockedWords, [])
})

test('le dispatcher supprime un message correspondant mais exempte les administrateurs', async () => {
  const sent = []
  const dispatcher = new Dispatcher({
    sock: { async sendMessage(jid, content) { sent.push({ jid, content }) } },
    config: {}, runtime: {},
    store: { getGroup: () => ({ blockedWords: ['test'] }) },
    registry: {}, safety: {}, logger: { info() {}, warn() {} }
  })
  const context = {
    isGroup: true, from: '123@g.us', body: 'Un TEST ici', isPrivileged: false,
    senderAdmin: false, botAdmin: false, msg: { key: { id: 'message' } },
    async loadGroupPermissions() { this.botAdmin = true }
  }
  assert.equal(await dispatcher.enforceBlockedWords(context), true)
  assert.equal(sent[0].content.delete.id, 'message')

  context.senderAdmin = true
  assert.equal(await dispatcher.enforceBlockedWords(context), false)
  assert.equal(sent.length, 1)
})
