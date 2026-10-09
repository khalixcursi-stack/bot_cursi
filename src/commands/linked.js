import { UserError } from '../core/errors.js'
import { createLinkedBot, listLinkedBots, removeLinkedBot } from '../services/linked-bots.js'
import { cleanNumber } from '../config.js'
import { toUserJid } from '../utils/jid.js'

function mask(number = '') {
  const value = String(number)
  return value.length > 6 ? `${value.slice(0, 3)}••••${value.slice(-3)}` : value
}

function pairingMessage(session) {
  return [
    '🔗 *Code de connexion WhatsApp*',
    '',
    `Code à usage unique : *${session.code}*`,
    '',
    'Sur le téléphone du compte à connecter :',
    '1. ouvre *WhatsApp → Appareils connectés*;',
    '2. choisis *Connecter un appareil*;',
    '3. choisis *Connecter avec un numéro de téléphone*;',
    '4. saisis le code ci-dessus.',
    '',
    `Identifiant de session : ${session.id}`,
    '_Le code expire rapidement. Ne le partage pas._'
  ].join('\n')
}

export default [
  {
    name: 'pair', aliases: ['connectbot'], category: 'Propriétaire', superOwnerOnly: true,
    usage: '[numéro international]',
    description: 'Génère depuis le bot de contrôle un code de connexion WhatsApp privé.', cooldown: 30,
    async run(ctx) {
      if (ctx.config.linkedBotWorker) throw new UserError('Une session secondaire ne peut pas créer d’autres sessions.')
      if (ctx.isGroup) throw new UserError('Utilise cette commande uniquement dans le chat privé du bot de contrôle.')
      const supplied = String(ctx.args[0] || '').trim()
      const number = supplied ? cleanNumber(supplied) : cleanNumber(ctx.config.ownerNumber)
      if (!number) throw new UserError(`Utilise ${ctx.runtime.prefix}pair ou ${ctx.runtime.prefix}pair 242…`)

      await ctx.reply(`⏳ Génération du code pour le +${mask(number)}…`)
      const session = await createLinkedBot(number)
      try {
        await ctx.reply(pairingMessage(session))
      } catch (error) {
        await removeLinkedBot(session.id).catch(() => {})
        throw new UserError('Le code a été généré mais son envoi privé a échoué; la session temporaire a été supprimée.', { cause: error })
      }
    }
  },
  {
    name: 'pairbot', aliases: ['linkbot', 'addbot'], category: 'Propriétaire', superOwnerOnly: true,
    usage: '<numéro international> CONFIRMER',
    description: 'Crée une session isolée du bot pour un autre numéro autorisé.', cooldown: 30,
    async run(ctx) {
      if (ctx.config.linkedBotWorker) throw new UserError('Cette commande fonctionne uniquement depuis le bot principal.')
      const number = cleanNumber(ctx.args[0])
      if (!number) throw new UserError(`Utilise ${ctx.runtime.prefix}pairbot 242… CONFIRMER`)
      if (ctx.args[1]?.toUpperCase() !== 'CONFIRMER') {
        throw new UserError(`Confirme avec ${ctx.runtime.prefix}pairbot ${number} CONFIRMER`)
      }
      await ctx.reply('⏳ Création de la session isolée et génération du code…')
      const session = await createLinkedBot(number)
      const message = pairingMessage(session)
      const recipient = toUserJid(number)
      try {
        await ctx.sock.sendMessage(recipient, { text: message })
        await ctx.reply(`✅ Code envoyé en privé au +${number}. Session : *${session.id}*`)
      } catch {
        const owner = ctx.ownerJid()
        try {
          await ctx.sock.sendMessage(owner, { text: `${message}\n\n⚠️ L’envoi au nouveau numéro a échoué; transmets-lui ce code en privé.` })
          await ctx.reply('⚠️ Envoi direct impossible : le code a été envoyé dans le chat privé du propriétaire principal.')
        } catch {
          throw new UserError('Le code a été créé mais ne peut pas être envoyé en privé. Supprime la session avec .unpairbot puis réessaie.')
        }
      }
    }
  },
  {
    name: 'botsessions', aliases: ['linkedbots', 'botlist'], category: 'Propriétaire', superOwnerOnly: true,
    description: 'Liste les sessions WhatsApp secondaires isolées.',
    async run(ctx) {
      if (ctx.config.linkedBotWorker) throw new UserError('Cette commande fonctionne uniquement depuis le bot principal.')
      const entries = listLinkedBots()
      if (!entries.length) return ctx.reply('🤖 Aucune session secondaire.')
      await ctx.reply([
        `🤖 *Sessions secondaires (${entries.length}/${ctx.config.maxLinkedBots})*`,
        ...entries.map(entry => `• *${entry.id}* · +${mask(entry.number)} · ${entry.status}`)
      ].join('\n'))
    }
  },
  {
    name: 'unpairbot', aliases: ['removebot', 'delbot'], category: 'Propriétaire', superOwnerOnly: true,
    usage: '<identifiant ou numéro> CONFIRMER',
    description: 'Déconnecte et supprime une session secondaire.', cooldown: 10,
    async run(ctx) {
      if (ctx.config.linkedBotWorker) throw new UserError('Cette commande fonctionne uniquement depuis le bot principal.')
      const identifier = ctx.args[0]
      if (!identifier || ctx.args[1]?.toUpperCase() !== 'CONFIRMER') {
        throw new UserError(`Utilise ${ctx.runtime.prefix}unpairbot <identifiant|numéro> CONFIRMER`)
      }
      const removed = await removeLinkedBot(identifier)
      await ctx.reply(`✅ Session *${removed.id}* déconnectée et supprimée.`)
    }
  }
]
