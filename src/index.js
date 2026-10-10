import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import express from 'express'
import qrcode from 'qrcode-terminal'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import { config, validateConfig } from './config.js'
import { createLogger } from './core/logger.js'
import { JsonStore, PostgresStore } from './core/store.js'
import { usePostgresAuthState } from './core/postgres-auth.js'
import { CommandRegistry } from './core/registry.js'
import { Dispatcher } from './core/dispatcher.js'
import { SafetyController } from './core/safety.js'
import { buildMenuButtons, buildMenuImageContent, buildMenuText } from './commands/general.js'
import { createDatabasePool } from './services/database.js'
import { sendInteractiveImageCard } from './services/interactive.js'
import {
  configureLinkedBotManager,
  restoreLinkedBots,
  setLinkedBotControlNumber,
  stopLinkedBots
} from './services/linked-bots.js'
import { participantBanJid, splitBannedParticipants } from './services/group-bans.js'
import { jidNumber, normalizeJid, toUserJid } from './utils/jid.js'

const logger = createLogger(config.logLevel)
const databasePool = config.storageDriver === 'postgres'
  ? await createDatabasePool(config, logger)
  : null
const store = await (databasePool
  ? new PostgresStore(databasePool, config.botInstanceId, logger, config.storageEncryptionKey)
  : new JsonStore(path.join(config.dataDir, 'settings.json'), logger)
).load()
const registry = await new CommandRegistry(logger).load(path.join(process.cwd(), 'src', 'commands'))
const runtime = {
  mode: store.getGlobal('mode', config.mode),
  prefix: store.getGlobal('prefix', config.prefix),
  autoRead: store.getGlobal('autoRead', config.autoRead),
  autoViewStatus: store.getGlobal('autoViewStatus', config.autoViewStatus),
  autoLikeStatus: store.getGlobal('autoLikeStatus', config.autoLikeStatus),
  antiCall: store.getGlobal('antiCall', config.antiCall),
  allowPublicMode: store.getGlobal('allowPublicMode', config.safety.allowPublicMode),
  allowGroupAutomation: store.getGlobal('allowGroupAutomation', config.safety.allowGroupAutomation),
  allowStatusAutomation: store.getGlobal('allowStatusAutomation', config.safety.allowStatusAutomation)
}
if (config.closedTestMode) {
  runtime.allowPublicMode = true
  runtime.allowGroupAutomation = true
  runtime.allowStatusAutomation = true
  Object.assign(store.data.global, {
    allowPublicMode: true,
    allowGroupAutomation: true,
    allowStatusAutomation: true
  })
  await store.save()
  logger.warn('Profil de test fermé actif : les fonctions optionnelles peuvent être activées; les quotas anti-rafale restent appliqués.')
}
if (!runtime.allowPublicMode && runtime.mode === 'public') {
  runtime.mode = 'private'
  await store.setGlobal('mode', 'private')
  logger.warn('Mode public désactivé par la politique de sécurité; retour au mode privé')
}
if (!runtime.allowStatusAutomation && (runtime.autoViewStatus || runtime.autoLikeStatus)) {
  runtime.autoViewStatus = false
  runtime.autoLikeStatus = false
  store.data.global.autoViewStatus = false
  store.data.global.autoLikeStatus = false
  await store.save()
  logger.warn('Automatisations de statut désactivées par la politique de sécurité')
}
if (!runtime.allowGroupAutomation) {
  let changed = false
  for (const group of Object.values(store.data.groups)) {
    if (group.automod !== false) { group.automod = false; changed = true }
    if (group.antilink && group.antilink !== 'off') { group.antilink = 'off'; changed = true }
    if (group.welcome) { group.welcome = false; changed = true }
    if (group.goodbye) { group.goodbye = false; changed = true }
  }
  if (changed) await store.save()
}
const safety = new SafetyController({
  ...config.safety,
  allowPublicMode: runtime.allowPublicMode,
  allowGroupAutomation: runtime.allowGroupAutomation,
  allowStatusAutomation: runtime.allowStatusAutomation
}, logger)

for (const warning of validateConfig()) logger.warn(warning)
if (!databasePool) await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 })
logger.info({ storage: config.storageDriver, instance: config.botInstanceId }, 'Stockage du bot initialisé')

let socket = null
let connected = false
let reconnectTimer = null
let shuttingDown = false
const messageCache = new Map()
const groupCache = new Map()

function cacheMessage(msg) {
  if (!msg?.key?.id || !msg.message) return
  messageCache.set(msg.key.id, { message: msg.message, timestamp: Date.now() })
  if (messageCache.size > 1500) {
    const oldest = [...messageCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp).slice(0, 300)
    for (const [id] of oldest) messageCache.delete(id)
  }
}

function disconnectCode(error) {
  return error?.output?.statusCode || error?.data?.statusCode || error?.statusCode || 0
}

function scheduleReconnect(delay = 5000) {
  if (shuttingDown || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startSocket().catch(error => {
      logger.error({ err: error }, 'Échec du redémarrage de la connexion')
      scheduleReconnect(10_000)
    })
  }, delay)
}

async function handleStatus(msg, sock) {
  if (!msg?.message) return
  if (runtime.autoViewStatus && safety.consumeStatusAction()) {
    await sock.readMessages([msg.key]).catch(error => logger.debug({ err: error }, 'Lecture de statut impossible'))
  }
  if (runtime.autoLikeStatus && msg.key.participant && safety.consumeStatusAction()) {
    await sock.sendMessage('status@broadcast', {
      react: { text: config.statusReaction, key: msg.key }
    }, { statusJidList: [msg.key.participant] }).catch(error => logger.debug({ err: error }, 'Réaction au statut impossible'))
  }
}

async function handleParticipants(update, sock) {
  if (!['add', 'remove'].includes(update.action)) return
  const settings = store.getGroup(update.id)
  let participants = update.participants || []

  if (update.action === 'add' && runtime.allowGroupAutomation) {
    const { banned, allowed } = splitBannedParticipants(settings.bannedMembers, participants)
    participants = allowed
    const bannedJids = banned.map(participantBanJid).filter(Boolean)
    if (bannedJids.length) {
      try {
        await sock.groupParticipantsUpdate(update.id, bannedJids, 'remove')
        await sock.sendMessage(update.id, {
          text: `🚫 ${bannedJids.map(jid => `@${jidNumber(jid)}`).join(', ')} ${bannedJids.length > 1 ? 'ont été retirés' : 'a été retiré'} : bannissement persistant.`,
          mentions: bannedJids
        })
        logger.info({ group: update.id, members: bannedJids.map(jidNumber) }, 'Membres bannis retirés après leur arrivée')
      } catch (error) {
        logger.warn({ err: error, group: update.id }, 'Retrait automatique de membres bannis impossible')
      }
    }
  }

  const enabled = update.action === 'add' ? settings.welcome : settings.goodbye
  if (!enabled || !participants.length) return

  const metadata = await sock.groupMetadata(update.id).catch(() => null)
  const groupName = metadata?.subject || 'le groupe'
  const configured = update.action === 'add' ? settings.welcomeMessage : settings.goodbyeMessage
  const fallback = update.action === 'add'
    ? '👋 Bienvenue {user} dans *{group}* !'
    : '👋 Au revoir {user}.'

  for (const participant of participants) {
    const jid = participantBanJid(participant)
    if (!jid) continue
    const text = (configured || fallback)
      .replaceAll('{user}', `@${jidNumber(jid)}`)
      .replaceAll('{group}', groupName)
    await sock.sendMessage(update.id, { text, mentions: [jid] }).catch(error => {
      logger.warn({ err: error, group: update.id }, 'Message d’accueil/de départ impossible')
    })
  }
}

let profilePictureChecked = false
let lastStartupNotificationAt = 0

async function applyConfiguredProfilePicture(sock) {
  if (!config.autoSetProfilePicture || profilePictureChecked) return
  try {
    const source = await fs.readFile(config.profilePicturePath)
    const hash = crypto.createHash('sha256').update(source).digest('hex')
    if (store.getGlobal('profilePictureHash', '') === hash) {
      profilePictureChecked = true
      return
    }
    const { default: sharp } = await import('sharp')
    const image = await sharp(source)
      .rotate()
      .resize(640, 640, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
    await sock.updateProfilePicture(normalizeJid(sock.user?.id || ''), image)
    await store.setGlobal('profilePictureHash', hash)
    profilePictureChecked = true
    logger.info({ file: path.basename(config.profilePicturePath) }, 'Photo de profil du bot mise à jour')
  } catch (error) {
    if (error.code === 'ENOENT') {
      profilePictureChecked = true
      logger.info({ file: config.profilePicturePath }, 'Photo de profil en attente : fichier non fourni')
    } else {
      logger.warn({ err: error }, 'Impossible de mettre à jour la photo de profil')
    }
  }
}

async function sendFirstConnectionWelcome(sock) {
  if (!config.firstConnectionWelcome) return
  const accountId = normalizeJid(sock.user?.id || '')
  if (!accountId || store.getGlobal('firstWelcomeSentFor', '') === accountId) return

  const recipient = toUserJid(config.ownerNumber) || accountId
  await sock.sendMessage(recipient, {
    text: [
      '🎉 *Félicitations !*',
      '',
      `Vous êtes connecté avec succès à *${config.botName}*.`,
      'La liaison WhatsApp par QR/code de jumelage est terminée.',
      `✅ Session sécurisée dans ${config.storageDriver === 'postgres' ? 'PostgreSQL' : 'le stockage local'}.`,
      `✅ Mode actuel : *${runtime.mode}*.`,
      '',
      `📋 La commande *${runtime.prefix}menu* est lancée automatiquement ci-dessous.`
    ].join('\n')
  })
  const menuContext = {
    sock,
    safety,
    from: recipient,
    isGroup: false,
    msg: undefined,
    config,
    runtime,
    registry,
    logger
  }
  await sendInteractiveImageCard(menuContext, {
    text: buildMenuText(menuContext),
    footer: `${config.botName} • Menu interactif`,
    buttons: buildMenuButtons(menuContext)
  }).catch(async error => {
    logger.warn({ err: error }, 'Menu interactif de première connexion non envoyé')
    await sock.sendMessage(recipient, await buildMenuImageContent(menuContext))
  })
  await store.setGlobal('firstWelcomeSentFor', accountId)
  logger.info({ recipient }, 'Accueil et menu de première connexion envoyés')
}

async function startSocket() {
  const { state, saveCreds } = databasePool
    ? await usePostgresAuthState(databasePool, config.botInstanceId, config.storageEncryptionKey)
    : await useMultiFileAuthState(config.authDir)
  const { version, isLatest } = await fetchLatestBaileysVersion()
  logger.info({ version: version.join('.'), isLatest }, 'Version WhatsApp Web sélectionnée')

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: Browsers.ubuntu(config.botName),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    enableAutoSessionRecreation: true,
    enableRecentMessageCache: true,
    getMessage: async key => messageCache.get(key.id)?.message,
    cachedGroupMetadata: async jid => groupCache.get(jid)
  })
  safety.protectSocket(sock)
  socket = sock
  const dispatcher = new Dispatcher({ sock, config, runtime, store, registry, safety, logger })

  sock.ev.on('creds.update', saveCreds)

  if (!state.creds.registered && config.pairingCode && config.pairingNumber) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.pairingNumber)
        if (config.linkedBotWorker && process.send) {
          process.send({ type: 'pairing-code', code, id: process.env.LINKED_BOT_ID || '' })
        } else {
          console.log('\n╔══════════════════════════╗')
          console.log(`  CODE DE JUMELAGE : ${code}`)
          console.log('╚══════════════════════════╝\n')
          logger.info('Saisissez ce code dans WhatsApp > Appareils connectés > Connecter avec un numéro')
        }
      } catch (error) {
        logger.error({ err: error }, 'Impossible de générer le code de jumelage')
        if (config.linkedBotWorker && process.send) process.send({ type: 'pairing-error', error: error.message })
      }
    }, 1500)
  }

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update

    if (qr && !state.creds.registered && (!config.pairingCode || !config.pairingNumber)) {
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      connected = true
      if (!config.linkedBotWorker) setLinkedBotControlNumber(jidNumber(sock.user?.id || ''))
      if (config.linkedBotWorker && process.send) {
        process.send({ type: 'connected', id: process.env.LINKED_BOT_ID || '', user: sock.user?.id || '' })
      }
      groupCache.clear()
      logger.info({ user: sock.user?.id, commands: registry.all().length, mode: runtime.mode }, `${config.botName} connecté`)
      await applyConfiguredProfilePicture(sock)
      await sendFirstConnectionWelcome(sock).catch(error => {
        logger.warn({ err: error }, 'Accueil de première connexion non envoyé')
      })
      const owner = toUserJid(config.ownerNumber)
      const notificationDue = Date.now() - lastStartupNotificationAt > 6 * 60 * 60 * 1000
      if (config.startupNotification && owner && notificationDue) {
        await sock.sendMessage(owner, {
          text: [
            `✅ *${config.botName} est connecté*`,
            `Version : ${config.botVersion}`,
            `Commandes : ${registry.all().length}`,
            `Mode : ${runtime.mode}`,
            `Préfixe : ${runtime.prefix}`
          ].join('\n')
        }).then(() => { lastStartupNotificationAt = Date.now() })
          .catch(error => logger.debug({ err: error }, 'Notification de démarrage non envoyée'))
      }
    }

    if (connection === 'close') {
      connected = false
      const code = disconnectCode(lastDisconnect?.error)
      logger.warn({ code, error: lastDisconnect?.error?.message }, 'Connexion WhatsApp fermée')
      if (code === DisconnectReason.loggedOut) {
        if (config.linkedBotWorker && process.send) process.send({ type: 'logged-out', id: process.env.LINKED_BOT_ID || '' })
        const resetHint = databasePool
          ? 'Exécutez CONFIRM_RESET=yes npm run session:reset puis redémarrez le service.'
          : `Supprimez ${config.authDir} puis reconnectez le compte.`
        logger.error(`Session déconnectée. ${resetHint}`)
      } else {
        scheduleReconnect(code === DisconnectReason.restartRequired ? 1000 : 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      cacheMessage(msg)
      try {
        if (msg.key?.remoteJid === 'status@broadcast') await handleStatus(msg, sock)
        else {
          if (runtime.autoRead && !msg.key?.fromMe) await sock.readMessages([msg.key]).catch(() => {})
          await dispatcher.handle(msg)
        }
      } catch (error) {
        logger.error({ err: error, messageId: msg.key?.id }, 'Erreur de traitement du message')
      }
    }
  })

  sock.ev.on('groups.update', updates => {
    for (const update of updates) {
      if (update.id) groupCache.delete(update.id)
    }
  })

  sock.ev.on('group-participants.update', update => {
    groupCache.delete(update.id)
    handleParticipants(update, sock).catch(error => logger.error({ err: error }, 'Erreur participants'))
  })

  sock.ev.on('call', async calls => {
    if (!runtime.antiCall) return
    for (const call of calls) {
      if (call.status !== 'offer') continue
      await sock.rejectCall(call.id, call.from).catch(error => logger.warn({ err: error }, 'Appel non rejeté'))
    }
  })

  return sock
}

const app = express()
app.disable('x-powered-by')
app.get('/', (_req, res) => res.json({
  name: config.botName,
  version: config.botVersion,
  status: connected ? 'connected' : 'starting',
  storage: config.storageDriver,
  commands: registry.all().length,
  uptime: Math.floor(process.uptime())
}))
// Liveness : reste à 200 pendant le jumelage pour éviter une boucle de redémarrage Northflank.
app.get('/health', (_req, res) => res.status(200).json({
  ok: true,
  whatsapp: connected ? 'connected' : 'disconnected',
  storage: config.storageDriver
}))
// Readiness stricte, utile pour le diagnostic mais pas comme liveness probe pendant le jumelage.
app.get('/ready', (_req, res) => res.status(connected ? 200 : 503).json({ ok: connected }))
const server = config.linkedBotWorker
  ? null
  : app.listen(config.port, '0.0.0.0', () => logger.info({ port: config.port }, 'Serveur de santé démarré'))

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'Arrêt propre')
  if (reconnectTimer) clearTimeout(reconnectTimer)
  server?.close()
  if (!config.linkedBotWorker) await stopLinkedBots().catch(() => {})
  await socket?.end?.(new Error(`Arrêt ${signal}`)).catch(() => {})
  await databasePool?.end().catch(() => {})
  process.exit(0)
}

if (config.linkedBotWorker) {
  process.on('message', message => {
    if (message?.type !== 'logout') return
    socket?.logout?.()
      .catch(error => logger.warn({ err: error }, 'Déconnexion de la session liée impossible'))
      .finally(() => shutdown('PARENT_LOGOUT'))
  })
  process.on('disconnect', () => shutdown('PARENT_DISCONNECT'))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', error => logger.error({ err: error }, 'Promesse non gérée'))
process.on('uncaughtException', error => logger.fatal({ err: error }, 'Exception non gérée'))

await startSocket()
if (!config.linkedBotWorker) {
  await configureLinkedBotManager({
    config,
    logger,
    controlNumber: jidNumber(socket?.user?.id || '')
  })
  await restoreLinkedBots()
}
