import { CommandContext } from './context.js'
import { commandUsage } from '../utils/format.js'
import { findGroupBan } from '../services/group-bans.js'
import { findBlockedWord } from '../utils/words.js'

const LINK_PATTERN = /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/[a-z0-9]+/i

export class Dispatcher {
  constructor({ sock, config, runtime, store, registry, safety, logger }) {
    this.sock = sock
    this.config = config
    this.runtime = runtime
    this.store = store
    this.registry = registry
    this.safety = safety
    this.logger = logger
    this.cooldowns = new Map()
  }

  async enforceGroupBan(context) {
    if (!context.isGroup || !this.runtime.allowGroupAutomation) return false
    const settings = this.store.getGroup(context.from)
    const matched = findGroupBan(settings.bannedMembers, {
      id: context.sender,
      phoneNumber: context.senderAlt
    })
    if (!matched || context.isOwner ||
        (this.config.ownerNumber && context.senderNumber === this.config.ownerNumber)) return false

    await context.loadGroupPermissions()
    if (!context.botAdmin) return false
    await this.sock.groupParticipantsUpdate(context.from, [context.sender], 'remove')
    await context.send({
      text: `🚫 @${context.senderNumber} a été retiré : ce membre est banni du groupe.`,
      mentions: [context.sender]
    })
    this.logger.info({ chat: context.from, member: context.senderNumber }, 'Membre banni retiré automatiquement')
    return true
  }

  async enforceBlockedWords(context) {
    if (!context.isGroup) return false
    const settings = this.store.getGroup(context.from)
    const blocked = Array.isArray(settings.blockedWords) ? settings.blockedWords : []
    const matched = findBlockedWord(context.body, blocked)
    if (!matched) return false

    await context.loadGroupPermissions()
    if (context.isPrivileged || context.senderAdmin || !context.botAdmin) return false
    await this.sock.sendMessage(context.from, { delete: context.msg.key })
    this.logger.info({ chat: context.from, word: matched }, 'Message supprimé par le filtre de mots')
    return true
  }

  async enforceAntiLink(context) {
    if (!context.isGroup || !LINK_PATTERN.test(context.body)) return false
    const settings = this.store.getGroup(context.from)
    const action = settings.antilink
    if (settings.automod === false || !action || action === 'off') return false

    await context.loadGroupPermissions()
    if (context.isPrivileged || context.senderAdmin) return false
    if (!context.botAdmin && action !== 'warn') return false

    if (['delete', 'kick'].includes(action)) {
      await this.sock.sendMessage(context.from, { delete: context.msg.key }).catch(() => {})
    }
    if (action === 'kick') {
      await this.sock.groupParticipantsUpdate(context.from, [context.sender], 'remove')
      await context.send({ text: `🚫 @${context.senderNumber} a été retiré pour publication d’un lien.`, mentions: [context.sender] })
    } else {
      await context.send({ text: `⚠️ @${context.senderNumber}, les liens ne sont pas autorisés ici.`, mentions: [context.sender] })
    }
    return true
  }

  cooldownKey(context, command) {
    return `${context.senderNumber || context.sender}:${command.name}`
  }

  async react(context, emoji) {
    if (!this.config.commandReactions) return
    await context.react(emoji).catch(error => {
      this.logger.debug?.({ err: error, command: context.commandName }, 'Réaction de commande impossible')
    })
  }

  async reject(context, message) {
    await this.react(context, '❌')
    return context.reply(message)
  }

  async handle(msg) {
    if (!msg?.message || !msg.key?.remoteJid || msg.key.remoteJid === 'status@broadcast') return
    const context = new CommandContext({
      sock: this.sock,
      msg,
      config: this.config,
      runtime: this.runtime,
      store: this.store,
      registry: this.registry,
      safety: this.safety,
      logger: this.logger
    })
    if (!context.body) return
    await context.resolveSenderAlternateIdentity().catch(error => {
      this.logger.debug?.({ err: error, sender: context.sender }, 'Résolution LID de l’expéditeur impossible')
    })

    try {
      if (await this.enforceGroupBan(context)) return
      if (await this.enforceBlockedWords(context)) return
      if (await this.enforceAntiLink(context)) return
    } catch (error) {
      this.logger.warn({ err: error, chat: context.from }, 'Échec d’un filtre de groupe')
    }

    const prefix = this.runtime.prefix
    if (!context.body.startsWith(prefix)) return
    const commandLine = context.body.slice(prefix.length).trim()
    if (!commandLine) return
    const [rawName, ...args] = commandLine.split(/\s+/)
    const command = this.registry.find(rawName)
    if (!command) return

    context.commandName = command.name
    context.args = args
    context.text = args.join(' ')

    if (this.runtime.mode === 'private' && !context.isPrivileged) return

    const admission = this.safety.admitCommand({ sender: context.sender, chat: context.from })
    if (!admission.allowed) {
      if (admission.notify) {
        await context.reply(`🛡️ Trop de commandes rapprochées. Protection activée pendant ${admission.retryAfter} seconde(s).`).catch(() => {})
      }
      return
    }

    await this.react(context, '⏳')

    if (command.superOwnerOnly && !context.isOwner) return this.reject(context, '🔐 Cette commande est réservée au propriétaire principal.')
    if (command.ownerOnly && !context.isPrivileged) return this.reject(context, '🔐 Cette commande est réservée au propriétaire.')
    if (command.groupOnly && !context.isGroup) return this.reject(context, '👥 Cette commande fonctionne uniquement dans un groupe.')

    if (command.adminOnly || command.botAdmin) {
      if (!context.isGroup) return this.reject(context, '👥 Cette commande fonctionne uniquement dans un groupe.')
      try {
        await context.loadGroupPermissions()
      } catch {
        return this.reject(context, '❌ Impossible de vérifier les administrateurs du groupe.')
      }
      if (command.adminOnly && !context.senderAdmin && !context.isPrivileged) {
        return this.reject(context, '🛡️ Cette commande est réservée aux administrateurs du groupe.')
      }
      if (command.botAdmin && !context.botAdmin) {
        return this.reject(context, '🤖 Je dois être administrateur du groupe pour effectuer cette action.')
      }
    }

    const now = Date.now()
    const key = this.cooldownKey(context, command)
    const remaining = (this.cooldowns.get(key) || 0) - now
    if (!context.isPrivileged && remaining > 0) {
      return this.reject(context, `⏳ Réessaie dans ${Math.ceil(remaining / 1000)} seconde(s).`)
    }
    this.cooldowns.set(key, now + Math.max(0, command.cooldown) * 1000)

    try {
      await command.run(context)
      await this.react(context, '✅')
      this.logger.info({ command: command.name, sender: context.senderNumber, group: context.isGroup }, 'Commande exécutée')
    } catch (error) {
      this.logger.error({ err: error, command: command.name, sender: context.senderNumber }, 'Erreur de commande')
      await this.react(context, '❌')
      const visible = error?.userFacing || context.isPrivileged
      const detail = visible ? `\n_${String(error.message || error).replace(/\s+/g, ' ').slice(0, 500)}_` : ''
      await context.reply(`❌ La commande a échoué.${detail}\n\nUtilisation : ${commandUsage(command, prefix)}`).catch(() => {})
    }
  }
}
