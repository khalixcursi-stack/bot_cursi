import test from 'node:test'
import assert from 'node:assert/strict'
import { SafetyController } from '../src/core/safety.js'

function settings(overrides = {}) {
  return {
    enabled: true,
    allowPublicMode: false,
    allowGroupAutomation: false,
    allowStatusAutomation: false,
    commandsPerUserMinute: 2,
    commandsPerChatMinute: 3,
    commandBlockSeconds: 30,
    outgoingMinIntervalMs: 0,
    outgoingChatIntervalMs: 0,
    outgoingPerMinute: 10,
    outgoingPerChatMinute: 10,
    outgoingPerDay: 2,
    maxOutgoingQueue: 5,
    statusActionsPerDay: 0,
    ...overrides
  }
}

const logger = { warn() {}, info() {} }

test('bloque les rafales de commandes par utilisateur', () => {
  const safety = new SafetyController(settings(), logger)
  assert.equal(safety.admitCommand({ sender: 'a', chat: 'x' }).allowed, true)
  assert.equal(safety.admitCommand({ sender: 'a', chat: 'x' }).allowed, true)
  const denied = safety.admitCommand({ sender: 'a', chat: 'x' })
  assert.equal(denied.allowed, false)
  assert.equal(denied.notify, true)
  assert.equal(safety.admitCommand({ sender: 'a', chat: 'x' }).notify, false)
})

test('limite le nombre quotidien de messages sortants', async () => {
  const safety = new SafetyController(settings(), logger)
  const sent = []
  const raw = async (chat, content) => { sent.push([chat, content]); return { key: { id: String(sent.length) } } }
  await safety.send(raw, 'x', { text: '1' })
  await safety.send(raw, 'x', { text: '2' })
  await assert.rejects(() => safety.send(raw, 'x', { text: '3' }), /Limite quotidienne/)
  assert.equal(sent.length, 2)
})

test('refuse puis autorise explicitement les automatisations de statut', () => {
  const safety = new SafetyController(settings({ statusActionsPerDay: 2 }), logger)
  assert.equal(safety.consumeStatusAction(), false)
  safety.setPolicy('allowStatusAutomation', true)
  assert.equal(safety.consumeStatusAction(), true)
  assert.equal(safety.snapshot().statusAutomationAllowed, true)
})
