import { UserError } from '../core/errors.js'
import { fetchExternalBuffer } from '../services/http.js'
import { extractText, isViewOnceMessage } from '../core/message.js'
import { jidNumber } from '../utils/jid.js'
import { truncate } from '../utils/format.js'
import { normalizeBlockedWord } from '../utils/words.js'

export default [
  {
    name: 'getpp', aliases: ['pp'], category: 'WhatsApp', usage: '[@mention/numéro]',
    description: 'Affiche la photo de profil d’un utilisateur.',
    async run(ctx) {
      const target = ctx.resolveTarget(ctx.text) || ctx.sender
      const url = await ctx.sock.profilePictureUrl(target, 'image')
      const file = await fetchExternalBuffer(url, { maxBytes: Math.min(ctx.config.maxDownloadBytes || 10 * 1024 * 1024, 10 * 1024 * 1024) })
      if (!file.buffer.length || !file.contentType.startsWith('image/') || file.contentType === 'image/svg+xml') {
        throw new UserError('La photo de profil n’est pas une image exploitable.')
      }
      await ctx.send({ image: file.buffer, mimetype: file.contentType, caption: `🖼️ Photo de @${jidNumber(target)}`, mentions: [target] })
    }
  },
  {
    name: 'whois', aliases: ['userinfo'], category: 'WhatsApp', usage: '[@mention/numéro]',
    description: 'Affiche les informations disponibles sur un utilisateur.',
    async run(ctx) {
      const target = ctx.resolveTarget(ctx.text) || ctx.sender
      const statuses = await ctx.sock.fetchStatus(target).catch(() => null)
      const bio = statuses?.[0]?.status?.status || 'indisponible'
      await ctx.send({
        text: [`👤 *@${jidNumber(target)}*`, `JID : ${target}`, `Bio : ${bio}`].join('\n'),
        mentions: [target]
      })
    }
  },
  {
    name: 'onwa', aliases: ['checkno'], category: 'WhatsApp', usage: '<numéro>',
    description: 'Vérifie si un numéro est enregistré sur WhatsApp.',
    async run(ctx) {
      const target = ctx.resolveTarget(ctx.text)
      if (!target) throw new Error('Indiquez un numéro international')
      const result = await ctx.sock.onWhatsApp(jidNumber(target))
      await ctx.reply(result?.[0]?.exists ? `✅ +${jidNumber(target)} est sur WhatsApp.` : `❌ +${jidNumber(target)} est introuvable.`)
    }
  },
  {
    name: 'privacy', category: 'WhatsApp', ownerOnly: true,
    description: 'Affiche les réglages de confidentialité du compte.',
    async run(ctx) {
      const data = await ctx.sock.fetchPrivacySettings(true)
      await ctx.reply(`🔐 *Confidentialité*\n\n${truncate(JSON.stringify(data, null, 2), 3800)}`)
    }
  },
  {
    name: 'blocklist', aliases: ['blocked'], category: 'WhatsApp', ownerOnly: true,
    description: 'Liste les utilisateurs bloqués.',
    async run(ctx) {
      const blocked = await ctx.sock.fetchBlocklist()
      if (!blocked.length) return ctx.reply('✅ Aucun utilisateur bloqué.')
      await ctx.send({ text: `🚫 *Bloqués (${blocked.length})*\n${blocked.map(jid => `• @${jidNumber(jid)}`).join('\n')}`, mentions: blocked })
    }
  },
  {
    name: 'mygroups', aliases: ['groups'], category: 'WhatsApp', ownerOnly: true,
    description: 'Liste les groupes auxquels le compte participe.',
    async run(ctx) {
      const groups = Object.values(await ctx.sock.groupFetchAllParticipating())
      const text = groups.map((group, index) => `${index + 1}. ${group.subject} (${group.participants.length})`).join('\n')
      await ctx.reply(`👥 *Mes groupes (${groups.length})*\n${truncate(text, 3700)}`)
    }
  },
  {
    name: 'del', aliases: ['delete'], category: 'WhatsApp', ownerOnly: true,
    description: 'Supprime le message cité lorsque WhatsApp l’autorise.',
    async run(ctx) {
      const key = ctx.quotedKey()
      if (!key) throw new Error('Répondez au message à supprimer')
      await ctx.sock.sendMessage(ctx.from, { delete: key })
    }
  },
  {
    name: 'save', category: 'WhatsApp', ownerOnly: true,
    description: 'Sauvegarde le texte ou média cité dans le chat personnel du propriétaire, y compris une vue unique en environnement de test autorisé.',
    async run(ctx) {
      if (!ctx.quoted) throw new UserError('Réponds au texte ou média à sauvegarder.')
      const owner = ctx.ownerJid()
      const viewOnce = isViewOnceMessage(ctx.quoted.rawMessage)
      const text = extractText(ctx.quoted.message)
      if (text) {
        await ctx.sock.sendMessage(owner, { text: `💾 Message sauvegardé depuis ${ctx.from}\n\n${text}` })
      } else {
        const media = await ctx.downloadMedia()
        const label = viewOnce ? 'Vue unique de test sauvegardée' : 'Sauvegardé'
        const map = {
          image: { image: media.buffer, caption: `💾 ${label} depuis ${ctx.from}` },
          video: { video: media.buffer, caption: `💾 ${label} depuis ${ctx.from}` },
          audio: { audio: media.buffer, mimetype: media.mime || 'audio/ogg' },
          sticker: { sticker: media.buffer },
          document: { document: media.buffer, mimetype: media.mime || 'application/octet-stream', fileName: media.node?.fileName || `fichier.${media.extension || 'bin'}` }
        }
        await ctx.sock.sendMessage(owner, map[media.kind])
      }
      await ctx.reply('✅ Message sauvegardé.')
    }
  },
  {
    name: 'delword', aliases: ['worddelete', 'filterword'], category: 'WhatsApp',
    groupOnly: true, adminOnly: true, botAdmin: true,
    usage: '<add|remove|list|clear> [mot] [CONFIRMER]',
    description: 'Gère les mots entiers dont les nouveaux messages seront supprimés automatiquement.',
    async run(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.store.getGroup(ctx.from)
      const current = Array.isArray(settings.blockedWords)
        ? [...new Set(settings.blockedWords.map(normalizeBlockedWord).filter(Boolean))]
        : []
      if (action === 'list') {
        return ctx.reply(current.length
          ? `🧹 *Mots supprimés automatiquement (${current.length})*\n${current.map(word => `• ${word}`).join('\n')}`
          : '🧹 Aucun mot configuré dans ce groupe.')
      }
      if (action === 'clear') {
        if (ctx.args[1]?.toUpperCase() !== 'CONFIRMER') {
          throw new UserError(`Utilise ${ctx.runtime.prefix}delword clear CONFIRMER`)
        }
        await ctx.store.updateGroup(ctx.from, { blockedWords: [] })
        return ctx.reply('✅ Liste des mots supprimés automatiquement vidée.')
      }
      if (!['add', 'remove', 'del'].includes(action)) {
        throw new UserError(`Utilise ${ctx.runtime.prefix}delword add <mot>, remove <mot>, list ou clear CONFIRMER.`)
      }
      const word = normalizeBlockedWord(ctx.args[1])
      if (!word) throw new UserError('Indique un seul mot valide de 1 à 30 caractères, sans espace.')
      if (action === 'add') {
        if (current.includes(word)) throw new UserError(`Le mot « ${word} » est déjà configuré.`)
        if (current.length >= 50) throw new UserError('Maximum 50 mots par groupe.')
        current.push(word)
        await ctx.store.updateGroup(ctx.from, { blockedWords: current })
        return ctx.reply(`✅ Les nouveaux messages contenant le mot entier « *${word}* » seront supprimés.`)
      }
      const next = current.filter(item => item !== word)
      if (next.length === current.length) throw new UserError(`Le mot « ${word} » n’est pas dans la liste.`)
      await ctx.store.updateGroup(ctx.from, { blockedWords: next })
      await ctx.reply(`✅ Mot « *${word}* » retiré du filtre.`)
    }
  },
  {
    name: 'removedp', category: 'WhatsApp', superOwnerOnly: true,
    description: 'Supprime la photo de profil du compte.',
    async run(ctx) { await ctx.sock.removeProfilePicture(ctx.sock.user.id); await ctx.reply('✅ Photo de profil supprimée.') }
  },
  {
    name: 'location', aliases: ['loc'], category: 'WhatsApp',
    description: 'Transforme la localisation citée en lien Google Maps.',
    async run(ctx) {
      const location = ctx.quoted?.message?.locationMessage || ctx.quoted?.message?.liveLocationMessage
      if (!location) throw new Error('Répondez à une localisation')
      const { degreesLatitude: lat, degreesLongitude: lon } = location
      await ctx.reply(`📍 https://www.google.com/maps?q=${lat},${lon}`)
    }
  }
]
