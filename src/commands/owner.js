import { cleanNumber } from '../config.js'
import { resolveUserPhoneIdentity } from '../services/user-identity.js'
import { jidNumber, toUserJid } from '../utils/jid.js'

async function switchAccessMode(ctx, mode, confirmation = '') {
  if (mode === 'public') {
    if (!ctx.runtime.allowPublicMode && confirmation.toUpperCase() !== 'CONFIRMER') {
      throw new Error(`Utilise ${ctx.runtime.prefix}public CONFIRMER ou ${ctx.runtime.prefix}mode public CONFIRMER`)
    }
    ctx.runtime.allowPublicMode = true
    ctx.runtime.mode = 'public'
    ctx.safety.setPolicy('allowPublicMode', true)
    ctx.store.data.global.allowPublicMode = true
    ctx.store.data.global.mode = 'public'
    await ctx.store.save()
    return ctx.reply('🌍 Mode *public* activé. Les quotas anti-rafale restent actifs.')
  }

  ctx.runtime.mode = 'private'
  ctx.runtime.allowPublicMode = false
  ctx.safety.setPolicy('allowPublicMode', false)
  ctx.store.data.global.mode = 'private'
  ctx.store.data.global.allowPublicMode = false
  await ctx.store.save()
  return ctx.reply('🔐 Mode *private* activé. Seuls le propriétaire et les utilisateurs sudo peuvent commander le bot.')
}

function toggleCommand(name, key, label, canEnable = () => true) {
  return {
    name, category: 'Propriétaire', ownerOnly: true, usage: '<on|off>',
    description: `Active ou désactive ${label}.`,
    async run(ctx) {
      const value = ctx.text.toLowerCase()
      if (!['on', 'off'].includes(value)) throw new Error(`Utilisez ${ctx.runtime.prefix}${name} on ou off`)
      if (value === 'on' && !canEnable(ctx)) throw new Error('Cette automatisation est bloquée par la politique de sécurité du bot.')
      ctx.runtime[key] = value === 'on'
      await ctx.store.setGlobal(key, ctx.runtime[key])
      await ctx.reply(`✅ ${label} : *${value}*`)
    }
  }
}

export default [
  {
    name: 'mode', category: 'Propriétaire', superOwnerOnly: true, usage: '<private|public> [CONFIRMER]',
    description: 'Bascule le bot entre les modes privé et public.',
    async run(ctx) {
      const value = ctx.args[0]?.toLowerCase()
      if (!['private', 'public'].includes(value)) throw new Error('Valeurs acceptées : private, public')
      await switchAccessMode(ctx, value, ctx.args[1] || '')
    }
  },
  {
    name: 'public', aliases: ['modepublic'], category: 'Propriétaire', superOwnerOnly: true, usage: '[CONFIRMER]',
    description: 'Active directement le mode public avec confirmation.',
    async run(ctx) { await switchAccessMode(ctx, 'public', ctx.args[0] || '') }
  },
  {
    name: 'private', aliases: ['modeprivate'], category: 'Propriétaire', superOwnerOnly: true,
    description: 'Rétablit immédiatement le mode privé.',
    async run(ctx) { await switchAccessMode(ctx, 'private') }
  },
  {
    name: 'prefix', category: 'Propriétaire', ownerOnly: true, usage: '<nouveau préfixe>',
    description: 'Change le préfixe des commandes.',
    async run(ctx) {
      const value = ctx.text.trim()
      if (!value || /\s/.test(value) || value.length > 5) throw new Error('Préfixe invalide (1 à 5 caractères sans espace)')
      ctx.runtime.prefix = value
      await ctx.store.setGlobal('prefix', value)
      await ctx.reply(`✅ Nouveau préfixe : *${value}*`)
    }
  },
  {
    name: 'settings', aliases: ['config'], category: 'Propriétaire', ownerOnly: true,
    description: 'Affiche les réglages actifs.',
    async run(ctx) {
      await ctx.reply([
        `⚙️ *Réglages ${ctx.config.botName}*`,
        `Mode : ${ctx.runtime.mode}`,
        `Préfixe : ${ctx.runtime.prefix}`,
        `Lecture auto : ${ctx.runtime.autoRead}`,
        `Vue des statuts : ${ctx.runtime.autoViewStatus}`,
        `Réaction aux statuts : ${ctx.runtime.autoLikeStatus}`,
        `Anti-appel : ${ctx.runtime.antiCall}`,
        `Protection : ${ctx.config.safety.enabled}`,
        `Profil de test fermé : ${ctx.config.closedTestMode}`,
        `Mode public autorisé : ${ctx.runtime.allowPublicMode}`,
        `Automatisation groupes : ${ctx.runtime.allowGroupAutomation}`,
        `Automatisation statuts : ${ctx.runtime.allowStatusAutomation}`,
        `Réactions aux commandes : ${ctx.config.commandReactions}`,
        `Sudo : ${ctx.store.data.sudo.length}`,
        `Téléchargeur local : ${ctx.config.localDownloaderEnabled ? 'actif' : 'désactivé'}`,
        `Cobalt : ${ctx.config.cobaltApiUrl ? 'configuré en repli' : 'non configuré'}`,
        `Recherche YouTube : ${ctx.config.localDownloaderEnabled || ctx.config.youtubeApiKey || ctx.config.youtubeSearchApiUrl ? 'configurée' : 'non configurée'}`,
        `IA : ${ctx.config.ai.apiKey ? 'configurée' : 'non configurée'}`
      ].join('\n'))
    }
  },
  {
    name: 'safety', aliases: ['compliance', 'protection'], category: 'Propriétaire', superOwnerOnly: true,
    usage: '[public|groups|statuses] [on|off] [CONFIRMER]',
    description: 'Affiche ou configure les garde-fous d’utilisation responsable.',
    async run(ctx) {
      const target = ctx.args[0]?.toLowerCase()
      const value = ctx.args[1]?.toLowerCase()

      if (!target) {
        const state = ctx.safety.snapshot()
        return ctx.reply([
          `🛡️ *Protection ${ctx.config.botName}*`,
          `Active : ${state.enabled}`,
          `Mode public autorisé : ${state.publicModeAllowed}`,
          `Automatisation groupes : ${state.groupAutomationAllowed}`,
          `Automatisation statuts : ${state.statusAutomationAllowed}`,
          `Commandes/utilisateur/min : ${state.commandsPerUserMinute}`,
          `Commandes/chat/min : ${state.commandsPerChatMinute}`,
          `Messages/min : ${state.outgoingPerMinute}`,
          `Messages/chat/min : ${state.outgoingPerChatMinute}`,
          `Messages aujourd’hui : ${state.dailyOutgoing}/${state.outgoingPerDay}`,
          `File d’attente : ${state.queueDepth}`,
          '',
          `Activer : ${ctx.runtime.prefix}safety public on CONFIRMER`,
          `           ${ctx.runtime.prefix}safety groups on CONFIRMER`,
          `           ${ctx.runtime.prefix}safety statuses on CONFIRMER`,
          `Rétablir tout : ${ctx.runtime.prefix}safety strict CONFIRMER`,
          '',
          '_Les quotas anti-rafale restent toujours actifs._'
        ].join('\n'))
      }

      if (target === 'strict') {
        if (ctx.args[1]?.toUpperCase() !== 'CONFIRMER') throw new Error('Utilisez : .safety strict CONFIRMER')
        ctx.runtime.allowPublicMode = false
        ctx.runtime.allowGroupAutomation = false
        ctx.runtime.allowStatusAutomation = false
        ctx.runtime.mode = 'private'
        ctx.runtime.autoViewStatus = false
        ctx.runtime.autoLikeStatus = false
        Object.assign(ctx.store.data.global, {
          allowPublicMode: false,
          allowGroupAutomation: false,
          allowStatusAutomation: false,
          mode: 'private',
          autoViewStatus: false,
          autoLikeStatus: false
        })
        for (const group of Object.values(ctx.store.data.groups)) {
          group.automod = false
          group.antilink = 'off'
          group.welcome = false
          group.goodbye = false
        }
        ctx.safety.setPolicy('allowPublicMode', false)
        ctx.safety.setPolicy('allowGroupAutomation', false)
        ctx.safety.setPolicy('allowStatusAutomation', false)
        await ctx.store.save()
        return ctx.reply('🛡️ Profil strict rétabli. Toutes les automatisations optionnelles sont désactivées.')
      }

      const mapping = {
        public: ['allowPublicMode', 'mode public'],
        groups: ['allowGroupAutomation', 'automatisations de groupes'],
        group: ['allowGroupAutomation', 'automatisations de groupes'],
        statuses: ['allowStatusAutomation', 'automatisations de statuts'],
        status: ['allowStatusAutomation', 'automatisations de statuts']
      }
      const selected = mapping[target]
      if (!selected || !['on', 'off'].includes(value)) {
        throw new Error('Format : .safety public|groups|statuses on|off [CONFIRMER]')
      }
      if (value === 'on' && ctx.args[2]?.toUpperCase() !== 'CONFIRMER') {
        throw new Error('Pour activer une fonction à risque, ajoutez CONFIRMER à la fin.')
      }

      const [key, label] = selected
      const enabled = value === 'on'
      ctx.runtime[key] = enabled
      ctx.safety.setPolicy(key, enabled)
      ctx.store.data.global[key] = enabled

      if (!enabled && key === 'allowPublicMode' && ctx.runtime.mode === 'public') {
        ctx.runtime.mode = 'private'
        ctx.store.data.global.mode = 'private'
      }
      if (!enabled && key === 'allowStatusAutomation') {
        ctx.runtime.autoViewStatus = false
        ctx.runtime.autoLikeStatus = false
        ctx.store.data.global.autoViewStatus = false
        ctx.store.data.global.autoLikeStatus = false
      }
      if (!enabled && key === 'allowGroupAutomation') {
        for (const group of Object.values(ctx.store.data.groups)) {
          group.automod = false
          group.antilink = 'off'
          group.welcome = false
          group.goodbye = false
        }
      }
      await ctx.store.save()
      await ctx.reply(`${enabled ? '⚠️' : '✅'} ${label} : *${value}*${enabled ? '\n_Activez seulement les fonctions nécessaires et avec le consentement des utilisateurs._' : ''}`)
    }
  },
  {
    name: 'sudo', category: 'Propriétaire', superOwnerOnly: true, usage: '<add|del|list> [numéro/@mention]',
    description: 'Gère les utilisateurs autorisés en mode privé.',
    async run(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'list') {
        return ctx.reply(`🔐 *Sudo*\n${ctx.store.data.sudo.length ? ctx.store.data.sudo.map(n => `• +${n}`).join('\n') : 'Aucun utilisateur'}`)
      }
      if (!['add', 'del', 'remove'].includes(action)) throw new Error('Actions : add, del, list')
      const identity = await resolveUserPhoneIdentity(ctx, ctx.args.slice(1).join(' '))
      for (const obsolete of identity.obsoleteNumbers) await ctx.store.removeSudo(obsolete)
      if (action === 'add') await ctx.store.addSudo(identity.number)
      else await ctx.store.removeSudo(identity.number)
      await ctx.reply(`✅ Sudo ${action === 'add' ? 'ajouté' : 'retiré'} : +${identity.number}`)
    }
  },
  {
    name: 'block', category: 'Propriétaire', ownerOnly: true, usage: '<numéro/@mention>',
    description: 'Bloque un utilisateur WhatsApp.',
    async run(ctx) {
      const target = ctx.resolveTarget(ctx.text)
      if (!target) throw new Error('Citez, mentionnez ou indiquez un numéro')
      await ctx.sock.updateBlockStatus(target, 'block')
      await ctx.reply(`🚫 +${jidNumber(target)} bloqué.`)
    }
  },
  {
    name: 'unblock', category: 'Propriétaire', ownerOnly: true, usage: '<numéro/@mention>',
    description: 'Débloque un utilisateur WhatsApp.',
    async run(ctx) {
      const target = ctx.resolveTarget(ctx.text)
      if (!target) throw new Error('Citez, mentionnez ou indiquez un numéro')
      await ctx.sock.updateBlockStatus(target, 'unblock')
      await ctx.reply(`✅ +${jidNumber(target)} débloqué.`)
    }
  },
  {
    name: 'setbio', aliases: ['bio'], category: 'Propriétaire', ownerOnly: true, usage: '<texte>',
    description: 'Modifie la bio WhatsApp du compte.',
    async run(ctx) {
      if (!ctx.text || ctx.text.length > 139) throw new Error('Bio requise (maximum 139 caractères)')
      await ctx.sock.updateProfileStatus(ctx.text)
      await ctx.reply('✅ Bio mise à jour.')
    }
  },
  toggleCommand('autoread', 'autoRead', 'la lecture automatique'),
  toggleCommand('autoview', 'autoViewStatus', 'la vue automatique des statuts', ctx => ctx.runtime.allowStatusAutomation),
  toggleCommand('autolike', 'autoLikeStatus', 'la réaction automatique aux statuts', ctx => ctx.runtime.allowStatusAutomation),
  toggleCommand('anticall', 'antiCall', 'le rejet automatique des appels'),
  {
    name: 'join', category: 'Propriétaire', ownerOnly: true, usage: '<lien de groupe>',
    description: 'Rejoint un groupe via un lien d’invitation.', cooldown: 5,
    async run(ctx) {
      const code = ctx.text.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/)?.[1]
      if (!code) throw new Error('Lien d’invitation WhatsApp invalide')
      const jid = await ctx.sock.groupAcceptInvite(code)
      await ctx.reply(`✅ Groupe rejoint : ${jid}`)
    }
  },
  {
    name: 'create', category: 'Propriétaire', ownerOnly: true, usage: '<nom> | <numéro 1, numéro 2>',
    description: 'Crée un groupe WhatsApp.', cooldown: 10,
    async run(ctx) {
      const [subject, rawMembers = ''] = ctx.text.split('|').map(value => value.trim())
      const members = rawMembers.split(',').map(cleanNumber).filter(Boolean).map(toUserJid)
      if (!subject || !members.length) throw new Error('Format : nom | 242..., 243...')
      const result = await ctx.sock.groupCreate(subject, members)
      await ctx.reply(`✅ Groupe créé : ${result.id}`)
    }
  },
  {
    name: 'restart', category: 'Propriétaire', superOwnerOnly: true,
    description: 'Redémarre le processus si l’hébergeur le permet.',
    async run(ctx) {
      if (!ctx.config.allowRestart) throw new Error('ALLOW_RESTART doit être true')
      await ctx.reply('♻️ Redémarrage…')
      setTimeout(() => process.exit(0), 800)
    }
  }
]
