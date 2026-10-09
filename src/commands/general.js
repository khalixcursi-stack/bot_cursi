import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { calculate } from '../utils/math.js'
import { commandUsage, formatBytes, formatDuration, randomItem } from '../utils/format.js'
import { fetchJson } from '../services/http.js'
import { quickReplyButton, sendInteractiveImageCard, singleSelectButton } from '../services/interactive.js'

const startup = Date.now()
const FALLBACK_JOKES = [
  'Pourquoi les développeurs confondent Halloween et Noël ? Parce que OCT 31 = DEC 25.',
  'Un bug entre dans un bar… le développeur répond : « Chez moi, ça fonctionne. »',
  'Quel est le comble pour un ordinateur ? Avoir un coup de foudre.'
]
const FALLBACK_ADVICE = [
  'Commence petit, vérifie le résultat, puis améliore progressivement.',
  'Sauvegarde toujours ce que tu ne veux pas perdre.',
  'Quand un problème semble compliqué, sépare-le en étapes simples.'
]

const MENU_CATEGORIES = [
  { key: 'general', label: 'Général', icon: '📌', aliases: ['general', 'generale', 'gen'] },
  { key: 'groupe', label: 'Groupe', icon: '👥', aliases: ['groupe', 'group', 'gp'] },
  { key: 'whatsapp', label: 'WhatsApp', icon: '💬', aliases: ['whatsapp', 'wa'] },
  { key: 'media', label: 'Média', icon: '🎨', aliases: ['media', 'medias'] },
  { key: 'stickers', label: 'Stickers', icon: '🏷️', aliases: ['stickers', 'sticker', 'stiker'] },
  { key: 'telechargement', label: 'Téléchargement', icon: '📥', aliases: ['telechargement', 'download', 'downloads', 'dl'] },
  { key: 'recherche', label: 'Recherche', icon: '🔎', aliases: ['recherche', 'search'] },
  { key: 'ia', label: 'IA', icon: '🧠', aliases: ['ia', 'ai'] },
  { key: 'anime', label: 'Anime', icon: '🌸', aliases: ['anime', 'waifu'] },
  { key: 'outils', label: 'Outils', icon: '🛠️', aliases: ['outils', 'outil', 'tools'] },
  { key: 'finance', label: 'Finance', icon: '💱', aliases: ['finance'] },
  { key: 'fun', label: 'Fun', icon: '🎲', aliases: ['fun', 'jeux'] },
  { key: 'proprietaire', label: 'Propriétaire', icon: '🔐', aliases: ['proprietaire', 'owner', 'admin'] }
]

function normalizeMenuKey(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function getMenuCategories(registry) {
  const grouped = registry.categories()
  return MENU_CATEGORIES
    .map(category => ({ ...category, commands: grouped.get(category.label) || [] }))
    .filter(category => category.commands.length)
}

export function resolveMenuCategory(selection, registry) {
  const input = normalizeMenuKey(String(selection || '').split(/\s+/)[0])
  if (!input) return null
  const categories = getMenuCategories(registry)
  const number = Number.parseInt(input, 10)
  if (Number.isInteger(number) && number >= 1 && number <= categories.length) return categories[number - 1]
  return categories.find(category => category.aliases.includes(input) || normalizeMenuKey(category.label) === input) || null
}

function buildMainMenuText({ config, runtime, registry }) {
  const categories = getMenuCategories(registry)
  const memory = process.memoryUsage()
  const lines = [
    `╭─❖ *${config.botName}*`,
    `│ PRÉFIXE : *${runtime.prefix}*`,
    `│ UPTIME : *${formatDuration(process.uptime())}*`,
    `│ MODE : *${runtime.mode.toUpperCase()}*`,
    `│ RAM : *${formatBytes(memory.rss)}*`,
    `│ COMMANDES : *${registry.all().length}*`,
    `╰ VERSION : *${config.botVersion}*`,
    '',
    `★ *BIENVENUE SUR ${config.botName}* ★`,
    '',
    '*MENU PRINCIPAL*'
  ]
  categories.forEach((category, index) => {
    lines.push(`${index + 1}. ${category.icon} *${category.label.toUpperCase()}*`)
  })
  lines.push('', '👇 *Appuie sur le bouton pour choisir un sous-menu.*')
  return lines.join('\n')
}

function buildCategoryMenuText({ config, runtime }, category) {
  const lines = [
    `╭─${category.icon} *${category.label.toUpperCase()}*`,
    `│ BOT : *${config.botName}*`,
    `╰ COMMANDES : *${category.commands.length}*`,
    ''
  ]
  for (const command of category.commands) {
    const lock = command.ownerOnly || command.superOwnerOnly ? '🔐' : '•'
    lines.push(`${lock} *${runtime.prefix}${command.name}*${command.usage ? ` ${command.usage}` : ''}`)
  }
  lines.push('', '👇 *Choisis une commande avec le bouton ci-dessous.*')
  lines.push(`↩️ Retour direct : *${runtime.prefix}menu*`)
  return lines.join('\n')
}

export function buildMenuText(context, selection = '') {
  if (!selection) return buildMainMenuText(context)
  const category = resolveMenuCategory(selection, context.registry)
  return category ? buildCategoryMenuText(context, category) : buildMainMenuText(context)
}

export function buildMenuImageContent(context, selection = '') {
  return {
    image: { url: context.config.profilePicturePath },
    caption: buildMenuText(context, selection)
  }
}

export function buildMenuButtons(context, category = null) {
  if (!category) {
    const rows = getMenuCategories(context.registry).map(item => ({
      id: `${context.runtime.prefix}menu ${item.key}`,
      title: `${item.icon} ${item.label}`
    }))
    return [singleSelectButton('📂 Choisir un sous-menu', rows, 'Catégories')]
  }

  const rows = category.commands.map(command => ({
    id: command.usage
      ? `${context.runtime.prefix}help ${command.name}`
      : `${context.runtime.prefix}${command.name}`,
    title: `${command.ownerOnly || command.superOwnerOnly ? '🔐' : '•'} ${context.runtime.prefix}${command.name}`
  }))
  return [
    singleSelectButton('⚡ Choisir une commande', rows, category.label),
    quickReplyButton('↩️ Menu principal', `${context.runtime.prefix}menu`)
  ]
}

export default [
  {
    name: 'menu', aliases: ['list', 'commands'], category: 'Général', usage: '[catégorie|numéro]',
    description: 'Affiche le menu principal ou un sous-menu par catégorie.',
    async run(ctx) {
      const category = ctx.text ? resolveMenuCategory(ctx.text, ctx.registry) : null
      if (ctx.text && !category) {
        return ctx.reply(`❓ Catégorie inconnue. Utilise *${ctx.runtime.prefix}menu* puis choisis un numéro ou un nom.`)
      }
      const selection = category?.label || ''
      const text = buildMenuText(ctx, selection)
      try {
        await sendInteractiveImageCard(ctx, {
          text,
          footer: `${ctx.config.botName} • Menu interactif`,
          buttons: buildMenuButtons(ctx, category)
        })
      } catch (error) {
        ctx.logger.warn({ err: error }, 'Menu interactif indisponible; envoi du bloc image + texte')
        await ctx.send(buildMenuImageContent(ctx, selection), { quoted: ctx.msg })
      }
    }
  },
  {
    name: 'help', aliases: ['aide', 'guide'], category: 'Général', usage: '<commande>',
    description: 'Affiche l’aide détaillée d’une commande.',
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`Exemple : ${ctx.runtime.prefix}help sticker`)
      const command = ctx.registry.find(ctx.text.trim().split(/\s+/)[0])
      if (!command) return ctx.reply('❓ Commande inconnue.')
      await ctx.reply([
        `*${ctx.runtime.prefix}${command.name}*`,
        command.description,
        `Catégorie : ${command.category}`,
        `Utilisation : ${commandUsage(command, ctx.runtime.prefix)}`,
        `Alias : ${command.aliases.length ? command.aliases.join(', ') : 'aucun'}`,
        command.superOwnerOnly ? 'Accès : propriétaire principal' : command.ownerOnly ? 'Accès : propriétaire/sudo' : 'Accès : standard'
      ].join('\n'))
    }
  },
  {
    name: 'ping', aliases: ['latency', 'speed'], category: 'Général',
    description: 'Mesure le temps de réponse du bot.', cooldown: 1,
    async run(ctx) {
      const start = performance.now()
      const sent = await ctx.reply('🏓 Pong…')
      const latency = Math.round(performance.now() - start)
      await ctx.sock.sendMessage(ctx.from, { text: `🏓 *Pong !* ${latency} ms`, edit: sent.key }).catch(() => {})
    }
  },
  {
    name: 'alive', aliases: ['online'], category: 'Général',
    description: 'Vérifie que le bot fonctionne.',
    async run(ctx) {
      await ctx.reply(`✅ *${ctx.config.botName} est opérationnel*\n⏱️ ${formatDuration((Date.now() - startup) / 1000)}\n🔐 Mode ${ctx.runtime.mode}`)
    }
  },
  {
    name: 'uptime', aliases: ['runtime'], category: 'Général',
    description: 'Affiche la durée de fonctionnement.',
    async run(ctx) { await ctx.reply(`⏱️ Uptime : *${formatDuration(process.uptime())}*`) }
  },
  {
    name: 'owner', aliases: ['proprio'], category: 'Général',
    description: 'Envoie le contact du propriétaire.',
    async run(ctx) {
      if (!ctx.config.ownerNumber) return ctx.reply('Le numéro du propriétaire n’est pas configuré.')
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${ctx.config.ownerName}\nTEL;type=CELL;type=VOICE;waid=${ctx.config.ownerNumber}:+${ctx.config.ownerNumber}\nEND:VCARD`
      await ctx.send({ contacts: { displayName: ctx.config.ownerName, contacts: [{ vcard }] } })
    }
  },
  {
    name: 'botinfo', aliases: ['about'], category: 'Général',
    description: 'Affiche les informations techniques du bot.',
    async run(ctx) {
      const memory = process.memoryUsage()
      await ctx.reply([
        `🤖 *${ctx.config.botName}* v${ctx.config.botVersion}`,
        `Node.js : ${process.version}`,
        `Système : ${os.platform()} ${os.arch()}`,
        `Mémoire : ${formatBytes(memory.rss)}`,
        `Uptime : ${formatDuration(process.uptime())}`,
        `Commandes : ${ctx.registry.all().length}`,
        'Architecture indépendante, sans accès développeur caché.'
      ].join('\n'))
    }
  },
  {
    name: 'id', aliases: ['jid'], category: 'Général',
    description: 'Affiche les identifiants du chat et de l’expéditeur.',
    async run(ctx) { await ctx.reply(`Chat : ${ctx.from}\nExpéditeur : ${ctx.sender}`) }
  },
  {
    name: 'poll', aliases: ['sondage'], category: 'Général', usage: '<question> | <choix 1> | <choix 2>',
    description: 'Crée un sondage WhatsApp.',
    async run(ctx) {
      const [question, ...values] = ctx.text.split('|').map(item => item.trim()).filter(Boolean)
      if (!question || values.length < 2) throw new Error('Indiquez une question et au moins deux choix séparés par |')
      if (values.length > 12) throw new Error('Maximum 12 choix')
      await ctx.send({ poll: { name: question, values, selectableCount: 1 } })
    }
  },
  {
    name: 'calc', aliases: ['math'], category: 'Outils', usage: '<expression>',
    description: 'Calcule une expression sans exécuter de code.',
    async run(ctx) {
      if (!ctx.text) throw new Error('Indiquez une expression, par exemple (12+4)*3')
      await ctx.reply(`🧮 ${ctx.text} = *${calculate(ctx.text)}*`)
    }
  },
  {
    name: 'flip', aliases: ['coin'], category: 'Fun',
    description: 'Lance une pièce.',
    async run(ctx) { await ctx.reply(Math.random() < 0.5 ? '🪙 *Pile*' : '🪙 *Face*') }
  },
  {
    name: 'choose', aliases: ['choix'], category: 'Fun', usage: '<option 1> | <option 2>',
    description: 'Choisit une option au hasard.',
    async run(ctx) {
      const choices = ctx.text.split('|').map(item => item.trim()).filter(Boolean)
      if (choices.length < 2) throw new Error('Donnez au moins deux choix séparés par |')
      await ctx.reply(`🎯 Je choisis : *${randomItem(choices)}*`)
    }
  },
  {
    name: 'love', aliases: ['lovetest'], category: 'Fun', usage: '<nom 1> | <nom 2>',
    description: 'Calcule une compatibilité ludique.',
    async run(ctx) {
      const names = ctx.text.split('|').map(item => item.trim()).filter(Boolean)
      if (names.length !== 2) throw new Error('Donnez deux noms séparés par |')
      const score = [...names.sort().join(':').toLowerCase()].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 101, 7)
      await ctx.reply(`💞 *${names[0]}* + *${names[1]}* = *${score}%*\n_(Simple jeu, évidemment.)_`)
    }
  },
  {
    name: 'joke', aliases: ['blague'], category: 'Fun',
    description: 'Envoie une blague aléatoire.', cooldown: 4,
    async run(ctx) {
      const data = await fetchJson('https://v2.jokeapi.dev/joke/Any?safe-mode&type=single').catch(() => null)
      await ctx.reply(`😄 ${data?.joke || randomItem(FALLBACK_JOKES)}`)
    }
  },
  {
    name: 'advice', aliases: ['conseil'], category: 'Fun',
    description: 'Envoie un conseil aléatoire.', cooldown: 4,
    async run(ctx) {
      const data = await fetchJson('https://api.adviceslip.com/advice', { timeout: 7000, retries: 2 }).catch(() => null)
      await ctx.reply(`💡 ${data?.slip?.advice || randomItem(FALLBACK_ADVICE)}`)
    }
  }
]
