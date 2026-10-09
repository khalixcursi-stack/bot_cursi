import test from 'node:test'
import assert from 'node:assert/strict'
import { extractText, isViewOnceMessage, mediaNodeOf, unwrapMessage } from '../src/core/message.js'

test('extrait le texte des formats usuels', () => {
  assert.equal(extractText({ conversation: '.ping' }), '.ping')
  assert.equal(extractText({ extendedTextMessage: { text: '.menu' } }), '.menu')
  assert.equal(extractText({ imageMessage: { caption: '.sticker' } }), '.sticker')
})

test('extrait la commande choisie dans un bouton interactif', () => {
  const message = {
    interactiveResponseMessage: {
      nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: '.menu anime' }) }
    }
  }
  assert.equal(extractText(message), '.menu anime')
  assert.equal(extractText({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{invalide' }, body: { text: '.menu' } } }), '.menu')
})

test('détecte et déplie une vue unique', () => {
  const wrapped = { viewOnceMessageV2: { message: { imageMessage: { viewOnce: true, mimetype: 'image/jpeg' } } } }
  assert.equal(isViewOnceMessage(wrapped), true)
  assert.deepEqual(unwrapMessage(wrapped), { imageMessage: { viewOnce: true, mimetype: 'image/jpeg' } })
  assert.equal(isViewOnceMessage({ imageMessage: { mimetype: 'image/jpeg' } }), false)
})

test('déplie les messages éphémères', () => {
  const wrapped = { ephemeralMessage: { message: { conversation: 'bonjour' } } }
  assert.deepEqual(unwrapMessage(wrapped), { conversation: 'bonjour' })
  assert.equal(extractText(wrapped), 'bonjour')
})

test('détecte un média', () => {
  const media = mediaNodeOf({ imageMessage: { mimetype: 'image/jpeg' } })
  assert.equal(media.kind, 'image')
  assert.equal(media.node.mimetype, 'image/jpeg')
})
