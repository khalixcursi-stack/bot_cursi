import { UserError } from '../core/errors.js'
import {
  MAX_GROUP_BANS,
  addGroupBan,
  formatBanNumber,
  normalizeGroupBans,
  participantBanJid,
  removeGroupBan
} from '../services/group-bans.js'
import { jidNumber, participantJids, sameUser } from '../utils/jid.js'

const MAX_KICKALL_MEMBERS = 1000
const KICKALL_BATCH_SIZE = 20

function requireTarget(ctx) {
  const target = ctx.resolveTarget(ctx.text)
  if (!target) throw new UserError('Citez, mentionnez ou indiquez un numéro international.')
  return target
}

function kickAllTargets(ctx, metadata) {
  const protectedJids = [ctx.sender, ctx.senderAlt, ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean)
  return metadata.participants.filter(participant => {
    if (participant.admin) return false
    const jids = participantJids(participant)
    if (!jids.length) return false
    if (jids.some(jid => protectedJids.some(protectedJid => sameUser(jid, protectedJid)))) return false
    if (ctx.config.ownerNumber && jids.some(jid => jidNumber(jid) === ctx.config.ownerNumber)) return false
    return true
  }).map(participantBanJid).filter(Boolean)
}

async function banTargetMember(ctx, target) {
  if (!ctx.runtime.allowGroupAutomation) {
    throw new UserError('Le bannissement persistant est bloqué. Le propriétaire doit utiliser .safety groups on CONFIRMER.')
  }
  const protectedJids = [ctx.sender, ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean)
  if (protectedJids.some(jid => sameUser(jid, target)) ||
      (ctx.config.ownerNumber && jidNumber(target) === ctx.config.ownerNumber)) {
    throw new UserError('Ce membre est protégé et ne peut pas être banni par cette commande.')
  }

  const metadata = await ctx.metadata()
  const member = metadata.participants.find(participant =>
    participantJids(participant).some(jid => sameUser(jid, target))
  )
  const memberJids = participantJids(member)
  if (memberJids.some(jid => protectedJids.some(protectedJid => sameUser(jid, protectedJid))) ||
      (ctx.config.ownerNumber && memberJids.some(jid => jidNumber(jid) === ctx.config.ownerNumber))) {
    throw new UserError('Ce membre est protégé et ne peut pas être banni par cette commande.')
  }
  if (member?.admin === 'superadmin' || member?.isSuperAdmin) {
    throw new UserError('Le propriétaire du groupe ne peut pas être banni.')
  }
  return member
}

const adminAction = (name, aliases, description, action) => ({
  name, aliases, category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
  usage: '<numéro/@mention>', description,
  async run(ctx) {
    const target = requireTarget(ctx)
    await ctx.sock.groupParticipantsUpdate(ctx.from, [target], action)
    await ctx.send({ text: `✅ Action *${name}* effectuée pour @${jidNumber(target)}.`, mentions: [target] })
  }
})

export default [
  {
    name: 'groupinfo', aliases: ['ginfo', 'info'], category: 'Groupe', groupOnly: true,
    description: 'Affiche les informations du groupe.',
    async run(ctx) {
      const metadata = await ctx.metadata()
      const admins = metadata.participants.filter(member => member.admin).length
      await ctx.reply([
        `👥 *${metadata.subject}*`,
        `ID : ${metadata.id}`,
        `Membres : ${metadata.participants.length}`,
        `Administrateurs : ${admins}`,
        `Créé le : ${metadata.creation ? new Date(metadata.creation * 1000).toLocaleDateString('fr-FR') : 'inconnu'}`,
        `Description : ${metadata.desc || 'aucune'}`
      ].join('\n'))
    }
  },
  {
    name: 'link', aliases: ['invite'], category: 'Groupe', groupOnly: true, botAdmin: true,
    description: 'Affiche le lien d’invitation du groupe.',
    async run(ctx) {
      const code = await ctx.sock.groupInviteCode(ctx.from)
      await ctx.reply(`🔗 https://chat.whatsapp.com/${code}`)
    }
  },
  {
    name: 'revoke', aliases: ['resetlink'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Réinitialise le lien d’invitation.',
    async run(ctx) {
      await ctx.sock.groupRevokeInvite(ctx.from)
      const code = await ctx.sock.groupInviteCode(ctx.from)
      await ctx.reply(`♻️ Nouveau lien :\nhttps://chat.whatsapp.com/${code}`)
    }
  },
  {
    name: 'open', aliases: ['unlock'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Autorise tous les membres à écrire.',
    async run(ctx) { await ctx.sock.groupSettingUpdate(ctx.from, 'not_announcement'); await ctx.reply('🔓 Groupe ouvert.') }
  },
  {
    name: 'close', aliases: ['lock'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Réserve les messages aux administrateurs.',
    async run(ctx) { await ctx.sock.groupSettingUpdate(ctx.from, 'announcement'); await ctx.reply('🔒 Groupe fermé.') }
  },
  {
    name: 'rename', aliases: ['gname'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true, usage: '<nom>',
    description: 'Renomme le groupe.',
    async run(ctx) {
      if (!ctx.text || ctx.text.length > 100) throw new Error('Nom requis (maximum 100 caractères)')
      await ctx.sock.groupUpdateSubject(ctx.from, ctx.text)
      await ctx.reply('✅ Groupe renommé.')
    }
  },
  {
    name: 'desc', aliases: ['description'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true, usage: '<texte>',
    description: 'Modifie la description du groupe.',
    async run(ctx) { await ctx.sock.groupUpdateDescription(ctx.from, ctx.text || ''); await ctx.reply('✅ Description mise à jour.') }
  },
  {
    name: 'tagall', aliases: ['mentionall'], category: 'Groupe', groupOnly: true, adminOnly: true, usage: '[message]',
    description: 'Mentionne tous les membres par lots.', cooldown: 10,
    async run(ctx) {
      const metadata = await ctx.metadata()
      const ids = metadata.participants.map(member => member.id).filter(Boolean)
      for (let index = 0; index < ids.length; index += 50) {
        const batch = ids.slice(index, index + 50)
        const text = [ctx.text || '📢 Annonce', '', ...batch.map(id => `• @${jidNumber(id)}`)].join('\n')
        await ctx.send({ text, mentions: batch })
      }
    }
  },
  {
    name: 'hidetag', aliases: ['tag'], category: 'Groupe', groupOnly: true, adminOnly: true, usage: '<message>',
    description: 'Mentionne discrètement tous les membres.', cooldown: 10,
    async run(ctx) {
      const metadata = await ctx.metadata()
      const mentions = metadata.participants.map(member => member.id).filter(Boolean)
      await ctx.send({ text: ctx.text || '📢 Annonce', mentions })
    }
  },
  adminAction('add', [], 'Ajoute un membre au groupe.', 'add'),
  adminAction('kick', ['remove'], 'Retire un membre du groupe.', 'remove'),
  {
    name: 'kickall', aliases: ['removeall'], category: 'Groupe', usage: 'CONFIRMER',
    description: 'Retire en une fois tous les membres ordinaires du groupe.',
    groupOnly: true, adminOnly: true, botAdmin: true, cooldown: 120,
    async run(ctx) {
      const metadata = await ctx.metadata()
      const targets = kickAllTargets(ctx, metadata)
      if (!targets.length) return ctx.reply('✅ Aucun membre ordinaire à retirer.')
      if (targets.length > MAX_KICKALL_MEMBERS) {
        throw new UserError(`Cette action est limitée à ${MAX_KICKALL_MEMBERS} membres par exécution.`)
      }
      if (ctx.text.trim().toUpperCase() !== 'CONFIRMER') {
        return ctx.reply([
          `⚠️ *Retrait collectif : ${targets.length} membre(s)*`,
          'Les administrateurs, le propriétaire du groupe, le propriétaire principal et le bot seront conservés.',
          '',
          `Pour continuer : *${ctx.runtime.prefix}kickall CONFIRMER*`
        ].join('\n'))
      }

      let removed = 0
      try {
        for (let index = 0; index < targets.length; index += KICKALL_BATCH_SIZE) {
          const batch = targets.slice(index, index + KICKALL_BATCH_SIZE)
          await ctx.sock.groupParticipantsUpdate(ctx.from, batch, 'remove')
          removed += batch.length
          if (index + KICKALL_BATCH_SIZE < targets.length) {
            await new Promise(resolve => setTimeout(resolve, 600))
          }
        }
      } catch (error) {
        throw new UserError(`Retrait collectif interrompu après ${removed}/${targets.length} membre(s). Réessaie plus tard pour les membres restants.`, { cause: error })
      }
      await ctx.reply(`✅ Retrait collectif terminé : *${removed} membre(s)* retiré(s). Les administrateurs ont été conservés.`)
    }
  },
  adminAction('promote', [], 'Nomme un membre administrateur.', 'promote'),
  adminAction('demote', [], 'Retire les droits administrateur.', 'demote'),
  {
    name: 'ban', aliases: ['blacklist'], category: 'Groupe', usage: '<numéro/@mention>',
    description: 'Retire un membre et l’empêche de revenir tant qu’il reste banni.',
    groupOnly: true, adminOnly: true, botAdmin: true, cooldown: 5,
    async run(ctx) {
      const target = requireTarget(ctx)
      const member = await banTargetMember(ctx, target)
      const settings = ctx.store.getGroup(ctx.from)
      const bans = addGroupBan(settings.bannedMembers, target)
      if (member) await ctx.sock.groupParticipantsUpdate(ctx.from, [target], 'remove')
      await ctx.store.updateGroup(ctx.from, { bannedMembers: bans })
      await ctx.send({
        text: `🚫 @${jidNumber(target)} est maintenant banni de ce groupe.${member ? '\nLe membre a été retiré immédiatement.' : '\nLe membre sera retiré automatiquement s’il rejoint le groupe.'}`,
        mentions: [target]
      })
    }
  },
  {
    name: 'unban', aliases: ['deban', 'unblacklist'], category: 'Groupe', usage: '<numéro/@mention>',
    description: 'Retire un membre de la liste de bannissement persistante.',
    groupOnly: true, adminOnly: true,
    async run(ctx) {
      const target = requireTarget(ctx)
      const settings = ctx.store.getGroup(ctx.from)
      const previous = normalizeGroupBans(settings.bannedMembers)
      const bans = removeGroupBan(previous, target)
      if (bans.length === previous.length) throw new UserError('Ce membre n’est pas dans la liste de bannissement.')
      await ctx.store.updateGroup(ctx.from, { bannedMembers: bans })
      await ctx.send({ text: `✅ @${jidNumber(target)} peut de nouveau rejoindre le groupe.`, mentions: [target] })
    }
  },
  {
    name: 'banlist', aliases: ['banned'], category: 'Groupe',
    description: 'Affiche les membres bannis de façon persistante.', groupOnly: true, adminOnly: true,
    async run(ctx) {
      const bans = normalizeGroupBans(ctx.store.getGroup(ctx.from).bannedMembers)
      if (!bans.length) return ctx.reply('✅ Aucun membre banni dans ce groupe.')
      await ctx.send({
        text: [`🚫 *Membres bannis (${bans.length}/${MAX_GROUP_BANS})*`, ...bans.map(jid => `• @${formatBanNumber(jid)}`)].join('\n'),
        mentions: bans
      })
    }
  },
  {
    name: 'automod', aliases: ['moderation'], category: 'Groupe', groupOnly: true, adminOnly: true, usage: '[on|off|status]',
    description: 'Active, désactive ou affiche clairement l’auto-modération du groupe.',
    async run(ctx) {
      const action = (ctx.args[0] || 'status').toLowerCase()
      const settings = ctx.store.getGroup(ctx.from)
      if (['status', 'etat', 'état'].includes(action)) {
        const enabled = settings.automod !== false && settings.antilink && settings.antilink !== 'off'
        return ctx.reply([
          '🛡️ *Auto-modération du groupe*',
          `État : *${enabled ? 'on' : 'off'}*`,
          `Anti-lien : *${settings.antilink || 'off'}*`,
          '',
          `Désactiver : *${ctx.runtime.prefix}automod off*`,
          `Activer/restaurer : *${ctx.runtime.prefix}automod on*`,
          '_Les quotas anti-rafale du bot restent actifs dans tous les cas._'
        ].join('\n'))
      }
      if (!['on', 'off'].includes(action)) throw new UserError(`Utilisez ${ctx.runtime.prefix}automod on, off ou status.`)

      if (action === 'off') {
        await ctx.store.updateGroup(ctx.from, { automod: false })
        return ctx.reply('✅ Auto-modération : *off*. Les règles automatiques de ce groupe sont suspendues; les quotas anti-rafale du bot restent actifs.')
      }
      if (!ctx.runtime.allowGroupAutomation) {
        throw new UserError('L’activation est bloquée par la politique globale. Le propriétaire doit utiliser .safety groups on CONFIRMER.')
      }
      const previous = settings.antilink && settings.antilink !== 'off' ? settings.antilink : 'warn'
      const needsBotAdmin = ['delete', 'kick'].includes(previous)
      const antilink = needsBotAdmin && !ctx.botAdmin ? 'warn' : previous
      await ctx.store.updateGroup(ctx.from, { automod: true, antilink })
      await ctx.reply(`🛡️ Auto-modération : *on* · anti-lien : *${antilink}*.${needsBotAdmin && !ctx.botAdmin ? '\n_Niveau warn utilisé car le bot n’est pas administrateur._' : ''}`)
    }
  },
  {
    name: 'antilink', category: 'Groupe', groupOnly: true, adminOnly: true, usage: '<off|warn|delete|kick>',
    description: 'Configure précisément la règle automatique des liens.',
    async run(ctx) {
      const action = ctx.text.toLowerCase()
      if (!['off', 'warn', 'delete', 'kick'].includes(action)) throw new UserError('Valeurs : off, warn, delete, kick.')
      if (action !== 'off' && !ctx.runtime.allowGroupAutomation) {
        throw new UserError('La modération automatique est bloquée. Le propriétaire doit utiliser .safety groups on CONFIRMER.')
      }
      if (['delete', 'kick'].includes(action) && !ctx.botAdmin) {
        throw new UserError('Le bot doit être administrateur pour supprimer un message ou retirer un membre. Utilisez warn sinon.')
      }
      await ctx.store.updateGroup(ctx.from, { antilink: action, automod: action !== 'off' })
      await ctx.reply(`🛡️ Anti-lien : *${action}* · auto-modération : *${action === 'off' ? 'off' : 'on'}*`)
    }
  },
  {
    name: 'welcome', aliases: ['bienvenue'], category: 'Groupe', groupOnly: true, adminOnly: true, usage: '<on|off> [message]',
    description: 'Configure le message de bienvenue. Variables : {user}, {group}.',
    async run(ctx) {
      const [state, ...message] = ctx.args
      if (!['on', 'off'].includes(state)) throw new Error('Utilisez on ou off')
      if (state === 'on' && !ctx.runtime.allowGroupAutomation) {
        throw new Error('Les messages automatiques de groupe sont bloqués par ALLOW_GROUP_AUTOMATION=false')
      }
      await ctx.store.updateGroup(ctx.from, { welcome: state === 'on', welcomeMessage: message.join(' ') || undefined })
      await ctx.reply(`👋 Bienvenue automatique : *${state}*`)
    }
  },
  {
    name: 'goodbye', aliases: ['aurevoir'], category: 'Groupe', groupOnly: true, adminOnly: true, usage: '<on|off> [message]',
    description: 'Configure le message de départ. Variables : {user}, {group}.',
    async run(ctx) {
      const [state, ...message] = ctx.args
      if (!['on', 'off'].includes(state)) throw new Error('Utilisez on ou off')
      if (state === 'on' && !ctx.runtime.allowGroupAutomation) {
        throw new Error('Les messages automatiques de groupe sont bloqués par ALLOW_GROUP_AUTOMATION=false')
      }
      await ctx.store.updateGroup(ctx.from, { goodbye: state === 'on', goodbyeMessage: message.join(' ') || undefined })
      await ctx.reply(`👋 Message de départ : *${state}*`)
    }
  },
  {
    name: 'disappearing', aliases: ['disap'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true, usage: '<off|24h|7d|90d>',
    description: 'Configure les messages éphémères.',
    async run(ctx) {
      const values = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 }
      if (!(ctx.text in values)) throw new Error('Valeurs : off, 24h, 7d, 90d')
      await ctx.sock.groupToggleEphemeral(ctx.from, values[ctx.text])
      await ctx.reply(`⏳ Messages éphémères : *${ctx.text}*`)
    }
  },
  {
    name: 'requests', aliases: ['req'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Liste les demandes d’adhésion en attente.',
    async run(ctx) {
      const requests = await ctx.sock.groupRequestParticipantsList(ctx.from)
      if (!requests.length) return ctx.reply('✅ Aucune demande en attente.')
      const mentions = requests.map(item => item.jid)
      await ctx.send({ text: `📥 *Demandes (${requests.length})*\n${mentions.map(jid => `• @${jidNumber(jid)}`).join('\n')}`, mentions })
    }
  },
  {
    name: 'approve', aliases: ['accept'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Accepte toutes les demandes d’adhésion.',
    async run(ctx) {
      const requests = await ctx.sock.groupRequestParticipantsList(ctx.from)
      if (!requests.length) return ctx.reply('Aucune demande en attente.')
      await ctx.sock.groupRequestParticipantsUpdate(ctx.from, requests.map(item => item.jid), 'approve')
      await ctx.reply(`✅ ${requests.length} demande(s) acceptée(s).`)
    }
  },
  {
    name: 'reject', aliases: ['rejectall'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Refuse toutes les demandes d’adhésion.',
    async run(ctx) {
      const requests = await ctx.sock.groupRequestParticipantsList(ctx.from)
      if (!requests.length) return ctx.reply('Aucune demande en attente.')
      await ctx.sock.groupRequestParticipantsUpdate(ctx.from, requests.map(item => item.jid), 'reject')
      await ctx.reply(`✅ ${requests.length} demande(s) refusée(s).`)
    }
  },
  {
    name: 'leave', aliases: ['left'], category: 'Groupe', groupOnly: true, superOwnerOnly: true,
    description: 'Fait quitter le groupe au bot.',
    async run(ctx) { await ctx.reply('👋 Au revoir.'); await ctx.sock.groupLeave(ctx.from) }
  }
]
