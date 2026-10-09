import { UserError } from '../core/errors.js'
import { jidNumber, normalizeJid, participantJids, sameUser } from '../utils/jid.js'

export const MAX_GROUP_BANS = 100

function participantCandidates(participant) {
  if (typeof participant === 'string') return [normalizeJid(participant)].filter(Boolean)
  return participantJids(participant).filter(Boolean)
}

export function normalizeGroupBans(entries = []) {
  const normalized = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const jid = normalizeJid(String(entry || ''))
    if (!jid || normalized.some(existing => sameUser(existing, jid))) continue
    normalized.push(jid)
    if (normalized.length >= MAX_GROUP_BANS) break
  }
  return normalized
}

export function findGroupBan(entries, participant) {
  const candidates = participantCandidates(participant)
  return normalizeGroupBans(entries).find(entry => candidates.some(jid => sameUser(entry, jid))) || ''
}

export function addGroupBan(entries, target) {
  const bans = normalizeGroupBans(entries)
  const jid = normalizeJid(target)
  if (!jid || bans.some(entry => sameUser(entry, jid))) return bans
  if (bans.length >= MAX_GROUP_BANS) throw new UserError(`La liste de bannissement est limitée à ${MAX_GROUP_BANS} membres.`)
  return [...bans, jid]
}

export function removeGroupBan(entries, target) {
  const jid = normalizeJid(target)
  return normalizeGroupBans(entries).filter(entry => !sameUser(entry, jid))
}

export function splitBannedParticipants(entries, participants = []) {
  const banned = []
  const allowed = []
  for (const participant of participants) {
    if (findGroupBan(entries, participant)) banned.push(participant)
    else allowed.push(participant)
  }
  return { banned, allowed }
}

export function participantBanJid(participant) {
  if (typeof participant === 'string') return normalizeJid(participant)
  return participantCandidates(participant)[0] || ''
}

export function formatBanNumber(jid) {
  return jidNumber(jid) || String(jid).split('@')[0]
}
