import test from 'node:test'
import assert from 'node:assert/strict'
import whatsappCommands from '../src/commands/whatsapp.js'

const save = whatsappCommands.find(item => item.name === 'save')
const owner = '242041029122@s.whatsapp.net'

function viewOnceQuote(participant = '') {
  return {
    participant,
    rawMessage: { viewOnceMessageV2: { message: { imageMessage: { viewOnce: true, mimetype: 'image/jpeg' } } } },
    message: { imageMessage: { viewOnce: true, mimetype: 'image/jpeg' } }
  }
}

test('la commande vv est supprimée', () => {
  assert.equal(whatsappCommands.find(item => item.name === 'vv' || item.aliases?.includes('viewonce')), undefined)
})

test('save regroupe la sauvegarde normale et les vues uniques personnelles', async () => {
  const sent = []
  const replies = []
  const ctx = {
    from: owner,
    quoted: viewOnceQuote(),
    ownerJid: () => owner,
    async downloadMedia() { return { kind: 'image', buffer: Buffer.from('image'), mime: 'image/jpeg' } },
    sock: { async sendMessage(jid, content) { sent.push({ jid, content }) } },
    async reply(text) { replies.push(text) }
  }
  await save.run(ctx)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].jid, owner)
  assert.deepEqual(sent[0].content.image, Buffer.from('image'))
  assert.match(sent[0].content.caption, /Vue unique de test/)
  assert.match(replies[0], /sauvegardé/)
})

test('save sauvegarde aussi la vue unique de l’autre numéro dans le test fermé', async () => {
  const sent = []
  const ctx = {
    from: '123@g.us',
    quoted: viewOnceQuote('242999999999@s.whatsapp.net'),
    ownerJid: () => owner,
    async downloadMedia() { return { kind: 'image', buffer: Buffer.from('second-numero'), mime: 'image/jpeg' } },
    sock: { async sendMessage(jid, content) { sent.push({ jid, content }) } },
    async reply() {}
  }
  await save.run(ctx)
  assert.equal(sent[0].jid, owner)
  assert.deepEqual(sent[0].content.image, Buffer.from('second-numero'))
  assert.match(sent[0].content.caption, /Vue unique de test/)
})
