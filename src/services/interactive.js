import fs from 'node:fs/promises'
import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto
} from '@whiskeysockets/baileys'

function interactiveNodes(isGroup) {
  const nodes = [{
    tag: 'biz',
    attrs: {},
    content: [{
      tag: 'interactive',
      attrs: { type: 'native_flow', v: '1' },
      content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
    }]
  }]
  if (!isGroup) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } })
  return nodes
}

export function singleSelectButton(title, rows, sectionTitle = '') {
  const normalized = rows.map(row => ({
    id: String(row.id),
    title: String(row.title).slice(0, 24),
    ...(row.header ? { header: String(row.header).slice(0, 24) } : {})
  }))
  const sections = []
  for (let index = 0; index < normalized.length; index += 10) {
    const page = Math.floor(index / 10) + 1
    sections.push({
      ...(sectionTitle ? { title: sections.length ? `${sectionTitle} ${page}` : sectionTitle } : {}),
      rows: normalized.slice(index, index + 10)
    })
  }
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({ title, sections })
  }
}

export function quickReplyButton(text, id) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: text, id })
  }
}

export async function sendInteractiveImageCard(ctx, { text, footer = '', buttons = [] }) {
  if (!ctx.sock?.waUploadToServer || !ctx.sock?.relayMessage) {
    throw new Error('Les fonctions interactives ne sont pas disponibles sur cette connexion.')
  }
  const source = await fs.readFile(ctx.config.profilePicturePath)
  const { imageMessage } = await prepareWAMessageMedia(
    { image: source },
    { upload: ctx.sock.waUploadToServer, logger: ctx.logger }
  )

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      hasMediaAttachment: true,
      imageMessage
    }),
    body: proto.Message.InteractiveMessage.Body.create({ text }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons })
  })
  const generated = generateWAMessageFromContent(ctx.from, { interactiveMessage }, {
    userJid: ctx.sock.user?.id,
    quoted: ctx.msg
  })
  const relayOptions = {
    messageId: generated.key.id,
    additionalNodes: interactiveNodes(ctx.isGroup)
  }

  // relayMessage n’est pas enveloppé par protectSocket : on le fait passer explicitement
  // dans la même file anti-rafale que sendMessage.
  await ctx.safety.send(
    ctx.sock.relayMessage.bind(ctx.sock),
    ctx.from,
    generated.message,
    relayOptions
  )
  return generated
}
