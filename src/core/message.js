import { getContentType } from '@whiskeysockets/baileys'

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage'
]

export function isViewOnceMessage(message = {}) {
  return Boolean(
    message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message ||
    message?.viewOnceMessageV2Extension?.message ||
    message?.imageMessage?.viewOnce ||
    message?.videoMessage?.viewOnce
  )
}

export function unwrapMessage(message = {}) {
  let current = message || {}
  for (let depth = 0; depth < 6; depth += 1) {
    const wrapper = WRAPPERS.find(key => current?.[key]?.message)
    if (!wrapper) break
    current = current[wrapper].message
  }
  return current
}

export function nativeFlowResponseId(paramsJson = '') {
  if (!paramsJson) return ''
  try {
    const data = JSON.parse(paramsJson)
    return String(data.id || data.selectedId || data.rowId || '')
  } catch {
    return ''
  }
}

export function extractText(message = {}) {
  const content = unwrapMessage(message)
  return String(
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    nativeFlowResponseId(content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) ||
    content.interactiveResponseMessage?.body?.text ||
    ''
  ).trim()
}

export function contextInfoOf(message = {}) {
  const content = unwrapMessage(message)
  const type = getContentType(content)
  return type ? content[type]?.contextInfo || {} : {}
}

export function quotedOf(msg) {
  const contextInfo = contextInfoOf(msg.message)
  if (!contextInfo.quotedMessage) return null
  return {
    key: {
      remoteJid: contextInfo.remoteJid || msg.key.remoteJid,
      participant: contextInfo.participant,
      id: contextInfo.stanzaId,
      fromMe: false
    },
    participant: contextInfo.participant || '',
    rawMessage: contextInfo.quotedMessage,
    message: unwrapMessage(contextInfo.quotedMessage),
    contextInfo
  }
}

export function mediaNodeOf(message = {}) {
  const content = unwrapMessage(message)
  const mapping = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['stickerMessage', 'sticker'],
    ['documentMessage', 'document']
  ]
  for (const [key, kind] of mapping) {
    if (content[key]) return { node: content[key], kind, key }
  }
  return null
}
