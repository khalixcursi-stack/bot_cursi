import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { extractText, contextInfoOf, quotedOf, mediaNodeOf } from './message.js'
import { jidNumber, normalizeJid, participantJids, sameUser, toUserJid } from '../utils/jid.js'

function extensionFromMime(mime = '', kind = 'document') {
  const subtype = mime.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg')
  if (subtype) return subtype.replace('x-', '')
  return { image: 'jpg', video: 'mp4', audio: 'ogg', sticker: 'webp', document: 'bin' }[kind] || 'bin'
}

export class CommandContext {
  constructor({ sock, msg, config, runtime, store, registry, safety, logger }) {
    this.sock = sock
    this.msg = msg
    this.config = config
    this.runtime = runtime
    this.store = store
    this.registry = registry
    this.safety = safety
    this.logger = logger

    this.from = msg.key.remoteJid || ''
    this.isGroup = this.from.endsWith('@g.us')
    this.sender = normalizeJid(msg.key.participant || msg.key.remoteJid || '')
    this.senderAlt = normalizeJid(msg.key.participantAlt || msg.key.remoteJidAlt || '')
    const senderJidsByPriority = [this.sender, this.senderAlt]
      .filter(Boolean)
      .sort((a, b) => Number(b.endsWith('@s.whatsapp.net')) - Number(a.endsWith('@s.whatsapp.net')))
    const senderNumbers = senderJidsByPriority.map(jidNumber).filter(Boolean)
    this.senderNumber = senderNumbers[0] || ''
    this.body = extractText(msg.message)
    this.contextInfo = contextInfoOf(msg.message)
    this.quoted = quotedOf(msg)
    this.pushName = msg.pushName || 'Utilisateur'
    this.commandName = ''
    this.args = []
    this.text = ''
    this._metadata = null
    this.senderAdmin = false
    this.botAdmin = false

    const botJids = [sock.user?.id, sock.user?.lid].filter(Boolean)
    const senderJids = [this.sender, this.senderAlt].filter(Boolean)
    this.isOwner = Boolean(msg.key.fromMe) ||
      (config.ownerNumber && senderNumbers.includes(config.ownerNumber)) ||
      botJids.some(jid => senderJids.some(senderJid => sameUser(jid, senderJid)))
    this.isSudo = senderNumbers.some(number => store.isSudo(number))
    this.isPrivileged = this.isOwner || this.isSudo
  }

  async resolveSenderAlternateIdentity() {
    if (this.senderAlt || !this.sender.includes('@lid')) return this.senderAlt
    const lookup = this.sock.signalRepository?.lidMapping?.getPNForLID?.(this.sender)
    if (!lookup) return ''
    const phoneJid = normalizeJid(await lookup.catch(() => null) || '')
    if (!phoneJid) return ''

    this.senderAlt = phoneJid
    const phoneNumber = jidNumber(phoneJid)
    if (phoneNumber) {
      this.senderNumber = phoneNumber
      if (this.config.ownerNumber && phoneNumber === this.config.ownerNumber) this.isOwner = true
      if (this.store.isSudo(phoneNumber)) this.isSudo = true
      this.isPrivileged = this.isOwner || this.isSudo
    }
    return phoneJid
  }

  async send(content, options = {}) {
    return this.sock.sendMessage(this.from, content, options)
  }

  async reply(text, options = {}) {
    return this.sock.sendMessage(this.from, { text: String(text), ...options }, { quoted: this.msg })
  }

  async react(emoji) {
    return this.sock.sendMessage(this.from, { react: { text: emoji, key: this.msg.key } })
  }

  async metadata() {
    if (!this.isGroup) return null
    if (!this._metadata) this._metadata = await this.sock.groupMetadata(this.from)
    return this._metadata
  }

  async loadGroupPermissions() {
    const metadata = await this.metadata()
    const sender = metadata.participants.find(participant =>
      participantJids(participant).some(jid => sameUser(jid, this.sender))
    )
    const botJids = [this.sock.user?.id, this.sock.user?.lid].filter(Boolean)
    const bot = metadata.participants.find(participant =>
      participantJids(participant).some(jid => botJids.some(botJid => sameUser(jid, botJid)))
    )
    this.senderAdmin = Boolean(sender?.admin)
    this.botAdmin = Boolean(bot?.admin)
    return { metadata, sender, bot }
  }

  resolveTarget(argument = '') {
    const mentioned = this.contextInfo.mentionedJid?.[0]
    if (mentioned) return normalizeJid(mentioned)
    if (this.quoted?.participant) return normalizeJid(this.quoted.participant)
    const jid = toUserJid(argument)
    return jid || ''
  }

  targetNumber(argument = '') {
    return jidNumber(this.resolveTarget(argument))
  }

  async downloadMedia({ quoted = true } = {}) {
    const source = quoted && this.quoted ? this.quoted.message : this.msg.message
    const media = mediaNodeOf(source)
    if (!media) throw new Error('Répondez à une image, vidéo, note vocale, sticker ou document.')
    const stream = await downloadContentFromMessage(media.node, media.kind)
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    if (!buffer.length) throw new Error('Le média est vide ou a expiré.')
    return {
      buffer,
      kind: media.kind,
      mime: media.node.mimetype || '',
      extension: extensionFromMime(media.node.mimetype, media.kind),
      node: media.node
    }
  }

  ownerJid() {
    return toUserJid(this.config.ownerNumber) || normalizeJid(this.sock.user?.id || '')
  }

  quotedKey() {
    if (!this.quoted?.key?.id) return null
    const botJids = [this.sock.user?.id, this.sock.user?.lid].filter(Boolean)
    return {
      ...this.quoted.key,
      remoteJid: this.from,
      fromMe: botJids.some(jid => sameUser(jid, this.quoted.participant))
    }
  }
}
