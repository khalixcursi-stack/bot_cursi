import { cleanNumber } from '../config.js'
import { UserError } from '../core/errors.js'
import { jidNumber, participantJids, sameUser, toUserJid } from '../utils/jid.js'

function explicitNumber(argument = '') {
  const value = String(argument || '').trim()
  if (!/^[+\d\s().-]{8,}$/.test(value)) return ''
  const number = cleanNumber(value)
  return number.length >= 8 ? number : ''
}

function phoneJidFromParticipant(participant) {
  return participantJids(participant).find(jid => jid.endsWith('@s.whatsapp.net')) || ''
}

export async function resolveUserPhoneIdentity(ctx, argument = '') {
  const direct = explicitNumber(argument)
  if (direct) return { number: direct, jid: toUserJid(direct), obsoleteNumbers: [] }

  const target = ctx.resolveTarget(argument)
  if (!target) throw new UserError('Citez, mentionnez ou indiquez un numéro international.')

  let phoneJid = target.endsWith('@s.whatsapp.net') ? target : ''
  if (!phoneJid && ctx.isGroup) {
    const metadata = await ctx.metadata().catch(() => null)
    const member = metadata?.participants?.find(participant =>
      participantJids(participant).some(jid => sameUser(jid, target) || jid === target)
    )
    phoneJid = phoneJidFromParticipant(member)
  }

  if (!phoneJid && target.includes('@lid')) {
    const lookup = ctx.sock.signalRepository?.lidMapping?.getPNForLID?.(target)
    phoneJid = lookup ? (await lookup.catch(() => null) || '') : ''
  }

  const number = jidNumber(phoneJid)
  if (!number) {
    throw new UserError('Impossible de retrouver le vrai numéro derrière ce LID. Indique le numéro international directement après la commande.')
  }

  const targetNumber = jidNumber(target)
  return {
    number,
    jid: phoneJid,
    obsoleteNumbers: target.includes('@lid') && targetNumber && targetNumber !== number ? [targetNumber] : []
  }
}
