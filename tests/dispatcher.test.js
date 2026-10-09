import test from 'node:test'
import assert from 'node:assert/strict'
import { Dispatcher } from '../src/core/dispatcher.js'
import { UserError } from '../src/core/errors.js'

function fixture(run) {
  const sent = []
  const command = {
    name: 'demo', aliases: [], usage: '', cooldown: 0,
    ownerOnly: false, superOwnerOnly: false, groupOnly: false, adminOnly: false, botAdmin: false,
    run
  }
  const sock = {
    user: { id: '242000000000@s.whatsapp.net' },
    async sendMessage(chat, content, options) {
      sent.push({ chat, content, options })
      return { key: { id: String(sent.length) } }
    }
  }
  const dispatcher = new Dispatcher({
    sock,
    config: { ownerNumber: '242000000000', commandReactions: true },
    runtime: { prefix: '.', mode: 'public' },
    store: { isSudo: () => false, getGroup: () => ({}) },
    registry: { find: name => name === 'demo' ? command : undefined },
    safety: { admitCommand: () => ({ allowed: true, notify: false, retryAfter: 0 }) },
    logger: { info() {}, error() {}, warn() {}, debug() {} }
  })
  const msg = {
    key: { id: 'message-1', remoteJid: '242111111111@s.whatsapp.net', fromMe: true },
    message: { conversation: '.demo' },
    pushName: 'Test'
  }
  return { dispatcher, msg, sent }
}

function reactions(sent) {
  return sent.filter(item => item.content.react).map(item => item.content.react.text)
}

test('chaque commande réussie passe de en cours à réussie', async () => {
  const { dispatcher, msg, sent } = fixture(async () => {})
  await dispatcher.handle(msg)
  assert.deepEqual(reactions(sent), ['⏳', '✅'])
})

test('une commande en erreur reçoit une réaction d’échec et un détail sûr', async () => {
  const { dispatcher, msg, sent } = fixture(async () => { throw new UserError('Configuration à compléter.') })
  await dispatcher.handle(msg)
  assert.deepEqual(reactions(sent), ['⏳', '❌'])
  const reply = sent.find(item => item.content.text)?.content.text || ''
  assert.match(reply, /Configuration à compléter/)
})
