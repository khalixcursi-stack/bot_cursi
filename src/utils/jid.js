import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { cleanNumber } from '../config.js'

export function normalizeJid(jid = '') {
  if (!jid) return ''
  try {
    return jid.endsWith('@g.us') || jid === 'status@broadcast' ? jid : jidNormalizedUser(jid)
  } catch {
    return String(jid).replace(/:\d+@/, '@')
  }
}

export function jidNumber(jid = '') {
  return cleanNumber(String(jid).split('@')[0].split(':')[0])
}

export function toUserJid(number = '') {
  const cleaned = cleanNumber(number)
  return cleaned ? `${cleaned}@s.whatsapp.net` : ''
}

export function sameUser(a = '', b = '') {
  if (!a || !b) return false
  if (normalizeJid(a) === normalizeJid(b)) return true
  const aNumber = jidNumber(a)
  const bNumber = jidNumber(b)
  return Boolean(aNumber && bNumber && aNumber === bNumber)
}

export function participantJids(participant = {}) {
  return [participant.id, participant.jid, participant.phoneNumber, participant.lid]
    .filter(Boolean)
    .map(normalizeJid)
}
