import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  configureLinkedBotManager,
  createLinkedBot,
  listLinkedBots,
  removeLinkedBot,
  stopLinkedBots
} from '../src/services/linked-bots.js'
import linkedCommands from '../src/commands/linked.js'

class FakeChild extends EventEmitter {
  constructor(code) {
    super()
    this.connected = true
    this.killed = false
    process.nextTick(() => {
      this.emit('message', { type: 'pairing-code', code })
      this.emit('message', { type: 'connected', user: 'linked@s.whatsapp.net' })
    })
  }

  send(message) {
    if (message.type === 'logout') process.nextTick(() => this.emit('exit', 0, null))
  }

  kill() {
    if (this.killed) return
    this.killed = true
    process.nextTick(() => this.emit('exit', 0, 'SIGTERM'))
  }
}

test('crée, isole, limite, liste et supprime les sessions secondaires', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-linked-test-'))
  let sequence = 0
  const forkImpl = (_module, _args, options) => {
    assert.equal(options.env.LINKED_BOT_WORKER, 'true')
    assert.equal(options.env.STORAGE_DRIVER, 'local')
    return new FakeChild(`CODE-${++sequence}`)
  }
  const config = {
    dataDir,
    ownerNumber: '242041029122',
    maxLinkedBots: 2,
    linkedBotWorker: false
  }
  try {
    await configureLinkedBotManager({
      config,
      logger: { warn() {} },
      forkImpl,
      controlNumber: '242099999999'
    })
    await assert.rejects(() => createLinkedBot('242099999999'), /numéro de contrôle/)
    const first = await createLinkedBot('242060000001')
    const second = await createLinkedBot('242060000002')
    assert.equal(first.code, 'CODE-1')
    assert.equal(second.code, 'CODE-2')
    assert.equal(listLinkedBots().length, 2)
    await assert.rejects(() => createLinkedBot('242060000003'), /Limite atteinte/)

    const settings = JSON.parse(await fs.readFile(path.join(dataDir, 'linked-bots', 'instances', first.id, 'data', 'settings.json'), 'utf8'))
    assert.deepEqual(settings.sudo, ['242041029122'])

    await removeLinkedBot(first.id)
    assert.equal(listLinkedBots().length, 1)
    assert.equal((await fs.stat(path.join(dataDir, 'linked-bots', 'instances', first.id)).catch(() => null)), null)

    const ownerSession = await createLinkedBot(config.ownerNumber)
    const ownerSettings = JSON.parse(await fs.readFile(path.join(dataDir, 'linked-bots', 'instances', ownerSession.id, 'data', 'settings.json'), 'utf8'))
    assert.deepEqual(ownerSettings.sudo, [])
    await removeLinkedBot(ownerSession.id)
  } finally {
    await stopLinkedBots()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('les commandes propriétaire envoient le code, listent puis révoquent la session', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-linked-command-'))
  const forkImpl = () => new FakeChild('1234-5678')
  const config = { dataDir, ownerNumber: '242041029122', maxLinkedBots: 2, linkedBotWorker: false }
  const outputs = []
  const sent = []
  const ctx = {
    config,
    runtime: { prefix: '.' },
    isGroup: false,
    args: ['242060000009', 'CONFIRMER'],
    sock: { async sendMessage(jid, content) { sent.push({ jid, content }) } },
    async reply(value) { outputs.push(String(value)) }
  }
  try {
    await configureLinkedBotManager({
      config,
      logger: { warn() {} },
      forkImpl,
      controlNumber: '242099999999'
    })

    ctx.args = []
    ctx.isGroup = true
    await assert.rejects(() => linkedCommands.find(command => command.name === 'pair').run(ctx), /chat privé/)
    ctx.isGroup = false
    await linkedCommands.find(command => command.name === 'pair').run(ctx)
    assert.match(outputs.at(-1), /1234-5678/)
    const ownerPair = listLinkedBots()[0]
    assert.equal(ownerPair.number, config.ownerNumber)
    await removeLinkedBot(ownerPair.id)

    ctx.args = ['242060000009', 'CONFIRMER']
    await linkedCommands.find(command => command.name === 'pairbot').run(ctx)
    assert.equal(sent[0].jid, '242060000009@s.whatsapp.net')
    assert.match(sent[0].content.text, /1234-5678/)

    ctx.args = []
    await linkedCommands.find(command => command.name === 'botsessions').run(ctx)
    assert.match(outputs.at(-1), /Sessions secondaires/)

    const id = listLinkedBots()[0].id
    ctx.args = [id, 'CONFIRMER']
    await linkedCommands.find(command => command.name === 'unpairbot').run(ctx)
    assert.equal(listLinkedBots().length, 0)
  } finally {
    await stopLinkedBots()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('un code de jumelage n’est jamais affiché dans le groupe si l’envoi cible échoue', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-linked-private-code-'))
  const config = { dataDir, ownerNumber: '242041029122', maxLinkedBots: 2, linkedBotWorker: false }
  const privateMessages = []
  const replies = []
  const ctx = {
    config,
    runtime: { prefix: '.' },
    args: ['242060000010', 'CONFIRMER'],
    ownerJid: () => '242041029122@s.whatsapp.net',
    sock: {
      async sendMessage(jid, content) {
        if (jid.startsWith('242060000010')) throw new Error('destinataire indisponible')
        privateMessages.push({ jid, content })
      }
    },
    async reply(value) { replies.push(String(value)) }
  }
  try {
    await configureLinkedBotManager({ config, logger: { warn() {} }, forkImpl: () => new FakeChild('SECRET-CODE') })
    await linkedCommands.find(command => command.name === 'pairbot').run(ctx)
    assert.equal(privateMessages[0].jid, '242041029122@s.whatsapp.net')
    assert.match(privateMessages[0].content.text, /SECRET-CODE/)
    assert.equal(replies.some(message => message.includes('SECRET-CODE')), false)
  } finally {
    const entry = listLinkedBots()[0]
    if (entry) await removeLinkedBot(entry.id)
    await stopLinkedBots()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
