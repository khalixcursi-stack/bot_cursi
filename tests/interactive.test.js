import test from 'node:test'
import assert from 'node:assert/strict'
import { sendInteractiveImageCard, singleSelectButton } from '../src/services/interactive.js'

const logger = {
  debug() {}, info() {}, warn() {}, error() {}, trace() {},
  child() { return this }
}

test('construit une carte WhatsApp interactive avec photo, texte et bouton', async () => {
  let relayed
  const sock = {
    user: { id: '242000000000:1@s.whatsapp.net' },
    async waUploadToServer() {
      return { mediaUrl: 'https://mmg.whatsapp.net/fake', directPath: '/fake/path' }
    },
    async relayMessage(jid, message, options) { relayed = { jid, message, options } }
  }
  const ctx = {
    sock,
    safety: { send: (raw, chat, content, options) => raw(chat, content, options) },
    from: '123@g.us',
    isGroup: true,
    msg: { key: { id: 'quoted', remoteJid: '123@g.us' }, message: { conversation: '.menu' } },
    config: { profilePicturePath: 'assets/profile.jpg' },
    logger
  }
  await sendInteractiveImageCard(ctx, {
    text: 'Menu dans un bloc',
    footer: 'ᴄᴜʀsɪㅤ愛',
    buttons: [singleSelectButton('Choisir', [{ id: '.menu anime', title: 'Anime' }])]
  })

  const interactive = relayed.message.interactiveMessage
  assert.equal(relayed.jid, '123@g.us')
  assert.equal(interactive.body.text, 'Menu dans un bloc')
  assert.ok(interactive.header.imageMessage)
  assert.equal(interactive.nativeFlowMessage.buttons[0].name, 'single_select')
  assert.deepEqual(relayed.options.additionalNodes.map(node => node.tag), ['biz'])
})
