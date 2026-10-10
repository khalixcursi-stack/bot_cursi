import 'dotenv/config'
import path from 'node:path'

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on', 'oui'].includes(String(value).toLowerCase())
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function list(value, fallback = '') {
  const raw = String(value ?? fallback ?? '')
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

export function cleanNumber(value = '') {
  return String(value).replace(/\D/g, '')
}

const root = process.cwd()
const mode = String(process.env.MODE || 'private').toLowerCase()
const ownerNumber = cleanNumber(process.env.OWNER_NUMBER)
const pairingNumber = cleanNumber(process.env.PAIRING_NUMBER) || ownerNumber
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URI || ''
const requestedStorage = String(process.env.STORAGE_DRIVER || 'auto').toLowerCase()
const storageDriver = requestedStorage === 'auto' ? (databaseUrl ? 'postgres' : 'local') : requestedStorage
const dataDir = path.resolve(root, process.env.DATA_DIR?.trim() || 'data')

export const config = Object.freeze({
  botName: process.env.BOT_NAME?.trim() || 'ᴄᴜʀsɪㅤ愛',
  botVersion: '0.24.0',
  ownerName: process.env.OWNER_NAME?.trim() || 'ᴄᴜʀsɪㅤ愛',
  ownerNumber,
  pairingNumber,
  linkedBotWorker: bool(process.env.LINKED_BOT_WORKER),
  maxLinkedBots: integer(process.env.MAX_LINKED_BOTS, 2, 0, 3),
  prefix: process.env.PREFIX?.trim() || '.',
  mode: ['private', 'public'].includes(mode) ? mode : 'private',
  timezone: process.env.TZ?.trim() || 'Africa/Brazzaville',
  pairingCode: bool(process.env.PAIRING_CODE, true),
  autoRead: bool(process.env.AUTO_READ),
  autoViewStatus: bool(process.env.AUTO_VIEW_STATUS),
  autoLikeStatus: bool(process.env.AUTO_LIKE_STATUS),
  statusReaction: process.env.STATUS_REACTION?.trim() || '❤️',
  antiCall: bool(process.env.ANTICALL),
  startupNotification: bool(process.env.STARTUP_NOTIFICATION),
  firstConnectionWelcome: bool(process.env.FIRST_CONNECTION_WELCOME, true),
  // Les réactions de cycle de vie sont désormais systématiques pour chaque commande reconnue.
  commandReactions: true,
  closedTestMode: bool(process.env.CLOSED_TEST_MODE),
  nsfwEnabled: bool(process.env.NSFW_ENABLED),
  autoSetProfilePicture: bool(process.env.AUTO_SET_PROFILE_PICTURE, true),
  profilePicturePath: path.resolve(root, process.env.PROFILE_PICTURE_PATH?.trim() || 'assets/profile.jpg'),
  port: integer(process.env.PORT, 3000, 1, 65535),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  authDir: path.resolve(root, process.env.AUTH_DIR?.trim() || '.auth'),
  dataDir,
  storageDriver: ['local', 'postgres'].includes(storageDriver) ? storageDriver : 'local',
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL || 'auto',
  databaseRetries: integer(process.env.DATABASE_RETRIES, 10, 1, 30),
  storageEncryptionKey: process.env.STORAGE_ENCRYPTION_KEY || '',
  botInstanceId: (process.env.BOT_INSTANCE_ID || 'default').trim(),
  maxDownloadBytes: integer(process.env.MAX_DOWNLOAD_MB, 50, 1, 200) * 1024 * 1024,
  localDownloaderEnabled: bool(process.env.LOCAL_DOWNLOADER_ENABLED, true),
  localDownloaderDir: path.join(dataDir, 'tools'),
  localDownloadTimeoutMs: integer(process.env.LOCAL_DOWNLOAD_TIMEOUT_SECONDS, 180, 30, 600) * 1000,
  allowRestart: bool(process.env.ALLOW_RESTART),
  safety: Object.freeze({
    enabled: bool(process.env.SAFETY_ENABLED, true),
    allowPublicMode: bool(process.env.ALLOW_PUBLIC_MODE),
    allowGroupAutomation: bool(process.env.ALLOW_GROUP_AUTOMATION),
    allowStatusAutomation: bool(process.env.ALLOW_STATUS_AUTOMATION),
    commandsPerUserMinute: integer(process.env.SAFETY_COMMANDS_PER_USER_MINUTE, 6, 1, 60),
    commandsPerChatMinute: integer(process.env.SAFETY_COMMANDS_PER_CHAT_MINUTE, 12, 1, 120),
    commandBlockSeconds: integer(process.env.SAFETY_COMMAND_BLOCK_SECONDS, 60, 10, 3600),
    outgoingMinIntervalMs: integer(process.env.SAFETY_OUTGOING_MIN_INTERVAL_MS, 1100, 100, 60_000),
    outgoingChatIntervalMs: integer(process.env.SAFETY_OUTGOING_CHAT_INTERVAL_MS, 1800, 100, 60_000),
    outgoingPerMinute: integer(process.env.SAFETY_OUTGOING_PER_MINUTE, 20, 1, 120),
    outgoingPerChatMinute: integer(process.env.SAFETY_OUTGOING_PER_CHAT_MINUTE, 8, 1, 60),
    outgoingPerDay: integer(process.env.SAFETY_OUTGOING_PER_DAY, 300, 10, 10_000),
    maxOutgoingQueue: integer(process.env.SAFETY_MAX_QUEUE, 50, 5, 500),
    statusActionsPerDay: integer(process.env.SAFETY_STATUS_ACTIONS_PER_DAY, 10, 0, 200)
  }),
  ai: {
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    visionModel: process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'gpt-4o-mini',
    imageModel: process.env.AI_IMAGE_MODEL || 'gpt-image-1'
  },
  cobaltApiUrl: (process.env.COBALT_API_URL || '').replace(/\/$/, ''),
  cobaltApiKey: process.env.COBALT_API_KEY || '',
  cobaltInstances: list(process.env.COBALT_INSTANCES),
  invidiousInstances: list(process.env.INVIDIOUS_INSTANCES),
  imageProviders: list(process.env.IMAGE_PROVIDERS, 'openverse,commons,bing,pixabay,pexels,unsplash,loremflickr'),
  pixabayApiKey: process.env.PIXABAY_API_KEY || '',
  pexelsApiKey: process.env.PEXELS_API_KEY || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  youtubeSearchApiUrl: (process.env.YOUTUBE_SEARCH_API_URL || '').replace(/\/$/, ''),
  youtubeSearchProvider: ['invidious', 'piped'].includes(String(process.env.YOUTUBE_SEARCH_PROVIDER || '').toLowerCase())
    ? String(process.env.YOUTUBE_SEARCH_PROVIDER).toLowerCase()
    : 'invidious'
})

export function validateConfig(value = config) {
  const warnings = []
  if (!value.ownerNumber) warnings.push('OWNER_NUMBER est vide : le code de jumelage ne pourra pas être demandé automatiquement.')
  if (value.ownerNumber && value.ownerNumber.length < 8) warnings.push('OWNER_NUMBER semble trop court. Utilisez le format international sans +.')
  if (value.prefix.length > 5) warnings.push('PREFIX est inhabituellement long.')
  if (value.mode === 'public' && !value.safety.allowPublicMode) warnings.push('MODE=public est bloqué par ALLOW_PUBLIC_MODE=false; le bot repassera en mode privé.')
  if (!value.safety.enabled) warnings.push('SAFETY_ENABLED=false : les garde-fous anti-spam sont désactivés.')
  if (value.storageDriver === 'postgres' && !value.databaseUrl) warnings.push('STORAGE_DRIVER=postgres mais DATABASE_URL/POSTGRES_URI est vide.')
  if (value.storageDriver === 'postgres' && !value.storageEncryptionKey) warnings.push('STORAGE_ENCRYPTION_KEY est vide : les données PostgreSQL ne seront pas chiffrées au niveau applicatif.')
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value.botInstanceId)) warnings.push('BOT_INSTANCE_ID sera normalisé pour PostgreSQL; utilisez seulement lettres, chiffres, _ et -.')
  if (value.youtubeSearchApiUrl && !/^https?:\/\//i.test(value.youtubeSearchApiUrl)) warnings.push('YOUTUBE_SEARCH_API_URL doit être une URL HTTP(S) complète.')
  return warnings
}
