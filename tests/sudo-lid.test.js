import test from 'node:test'
import assert from 'node:assert/strict'
import ownerCommands from '../src/commands/owner.js'
import { CommandContext } from '../src/core/context.js'
import { resolveUserPhoneIdentity } from '../src/services/user-identity.js'

const lid = '13135550000@lid'
const phone = '242060000005@s.whatsapp.net'
const phoneNumber = '242060000005'

test('le contexte reconnaît un sudo par son numéro PN lorsque WhatsApp envoie un LID', () => {
  const context = new CommandContext({
    sock: { user: { id: '242099999999@s.whatsapp.net' } },
    msg: {
      key: { remoteJid: '123@g.us', participant: lid, participantAlt: phone },
      message: { conversation: '.ping' }
    },
    config: { ownerNumber: '242041029122' },
    runtime: {}, registry: {}, safety: {}, logger: {},
    store: { isSudo: number => number === phoneNumber }
  })

  assert.equal(context.sender, lid)
  assert.equal(context.senderAlt, phone)
  assert.equal(context.senderNumber, phoneNumber)
  assert.equal(context.isSudo, true)
  assert.equal(context.isPrivileged, true)
})

test('le contexte résout un expéditeur LID sans participantAlt avant le contrôle sudo', async () => {
  const context = new CommandContext({
    sock: {
      user: { id: '242099999999@s.whatsapp.net' },
      signalRepository: {
        lidMapping: { async getPNForLID(value) { return value === lid ? phone : null } }
      }
    },
    msg: {
      key: { remoteJid: '123@g.us', participant: lid },
      message: { conversation: '.ping' }
    },
    config: { ownerNumber: '242041029122' },
    runtime: {}, registry: {}, safety: {}, logger: {},
    store: { isSudo: number => number === phoneNumber }
  })

  assert.equal(context.isSudo, false)
  await context.resolveSenderAlternateIdentity()
  assert.equal(context.senderNumber, phoneNumber)
  assert.equal(context.isSudo, true)
  assert.equal(context.isPrivileged, true)
})

test('la résolution LID utilise aussi la table de correspondance Baileys', async () => {
  const identity = await resolveUserPhoneIdentity({
    isGroup: true,
    resolveTarget: () => lid,
    async metadata() { return { participants: [{ id: lid }] } },
    sock: {
      signalRepository: {
        lidMapping: { async getPNForLID(value) { return value === lid ? phone : null } }
      }
    }
  }, '@membre')

  assert.equal(identity.number, phoneNumber)
  assert.deepEqual(identity.obsoleteNumbers, ['13135550000'])
})

test('sudo add convertit une mention LID en vrai numéro et supprime l’ancienne entrée LID', async () => {
  const sudo = ownerCommands.find(command => command.name === 'sudo')
  const stored = ['13135550000']
  const outputs = []
  const context = {
    args: ['add', '@membre'],
    isGroup: true,
    sock: {},
    resolveTarget: () => lid,
    async metadata() {
      return { participants: [{ id: lid, phoneNumber: phone, admin: null }] }
    },
    store: {
      data: { sudo: stored },
      async removeSudo(number) {
        const index = stored.indexOf(number)
        if (index >= 0) stored.splice(index, 1)
      },
      async addSudo(number) { if (!stored.includes(number)) stored.push(number) }
    },
    async reply(text) { outputs.push(text) }
  }

  await sudo.run(context)
  assert.deepEqual(stored, [phoneNumber])
  assert.match(outputs[0], new RegExp(`\\+${phoneNumber}`))
})
