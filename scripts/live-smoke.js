import fs from 'node:fs/promises'
import path from 'node:path'
import utilities from '../src/commands/utilities.js'
import general from '../src/commands/general.js'
import downloads from '../src/commands/download.js'
import anime from '../src/commands/anime.js'
import stickers from '../src/commands/stickers.js'
import extra from '../src/commands/extra.js'
import searchMedia from '../src/commands/search-media.js'
import searchWeb from '../src/commands/search-web.js'
import { fetchExternalBuffer } from '../src/services/http.js'
import { config } from '../src/config.js'

const results = []
const logger = { warn() {}, error() {}, info() {}, debug() {} }
// Petit MP4 public utilisé pour valider l’envoi média même quand YouTube bloque.
const TEST_VIDEO_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'

async function probe(section, name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    results.push({ section, name, status: 'OK', duration: Date.now() - started, detail: String(detail || '') })
    console.log(`✓ ${section} · ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    results.push({ section, name, status: 'ÉCHEC', duration: Date.now() - started, detail: String(error.message || error).slice(0, 300) })
    console.error(`✗ ${section} · ${name} — ${error.message || error}`)
  }
}

function textContext(text, args = text.split(/\s+/).filter(Boolean)) {
  const outputs = []
  return {
    ctx: {
      text, args, quoted: null, config, logger,
      runtime: { prefix: '.' },
      async reply(value) { outputs.push({ text: String(value) }) },
      async send(content) { outputs.push(content) }
    },
    outputs
  }
}

const utilityCases = [
  ['weather', 'Pointe-Noire', ['Pointe-Noire']],
  ['translate', 'en Bonjour le monde', ['en', 'Bonjour', 'le', 'monde']],
  ['github', 'octocat', ['octocat']],
  ['npm', 'express', ['express']],
  ['lyrics', 'Coldplay | Yellow', ['Coldplay', '|', 'Yellow']],
  ['define', 'test', ['test']],
  ['exchange', '100 EUR XAF', ['100', 'EUR', 'XAF']],
  ['bible', 'John 3:16', ['John', '3:16']]
]
for (const [name, text, args] of utilityCases) {
  await probe('Recherche en ligne', name, async () => {
    const { ctx, outputs } = textContext(text, args)
    await utilities.find(command => command.name === name).run(ctx)
    if (!outputs[0]?.text) throw new Error('aucune réponse textuelle')
    return `${outputs[0].text.length} caractères`
  })
}
for (const name of ['joke', 'advice']) {
  await probe('Recherche en ligne', name, async () => {
    const { ctx, outputs } = textContext('')
    await general.find(command => command.name === name).run(ctx)
    if (!outputs[0]?.text) throw new Error('aucune réponse')
    return `${outputs[0].text.length} caractères`
  })
}

await probe('Recherche en ligne', 'images', async () => {
  const { ctx, outputs } = textContext('montagne')
  await searchMedia.find(command => command.name === 'images').run(ctx)
  const images = outputs.filter(item => item.image)
  if (images.length < 3 || images.length > 5) throw new Error(`${images.length} images reçues (3 à 5 attendues)`)
  for (const image of images) {
    if (!image.mimetype?.startsWith('image/')) throw new Error(`format photo inattendu : ${image.mimetype || 'inconnu'}`)
    if (!/Source\s*:/i.test(image.caption || '')) throw new Error('source absente de la légende')
  }
  return `${images.length} photos envoyées avec sources`
})

await probe('Recherche adulte', 'nsfw', async () => {
  const { ctx, outputs } = textContext('18+ artistic nude')
  ctx.config = { ...config, nsfwEnabled: true }
  await searchMedia.find(command => command.name === 'nsfw').run(ctx)
  const output = outputs.find(item => item.image)
  if (!output?.image?.length) throw new Error('aucune image adulte reçue')
  if (output.mimetype !== 'image/jpeg') throw new Error(`format adulte inattendu : ${output.mimetype || 'inconnu'}`)
  if (!/Source\s*:/i.test(output.caption || '')) throw new Error('source absente de la légende adulte')
  return `${output.image.length} octets · ${output.mimetype}`
})

await probe('Recherche en ligne', 'videos', async () => {
  const { ctx, outputs } = textContext('Me at the zoo jawed')
  await downloads.find(command => command.name === 'videos').run(ctx)
  const output = outputs.find(item => item.video)
  if (!output?.video?.length) throw new Error('aucune vidéo reçue')
  if (!output.mimetype?.startsWith('video/')) throw new Error(`format vidéo inattendu : ${output.mimetype || 'inconnu'}`)
  if (!/Autres résultats/i.test(output.caption || '')) throw new Error('alternatives numérotées absentes')
  return `${output.video.length} octets · ${output.mimetype} · alternatives proposées`
})

await probe('Téléchargement', 'vidéo de test (MP4 public)', async () => {
  const file = await fetchExternalBuffer(TEST_VIDEO_URL, { maxBytes: 8 * 1024 * 1024, timeout: 60_000 })
  if (!file.contentType.startsWith('video/')) throw new Error(`type inattendu : ${file.contentType}`)
  return `repli vidéo valide · ${file.buffer.length} octets · ${file.contentType}`
})

const downloadCases = [
  ['yts', 'Me at the zoo jawed'],
  ['play', 'Me at the zoo jawed'],
  ['ytmp4', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
  ['tiktok', 'https://www.tiktok.com/@blaqbonez/video/7661265253874896148'],
  ['instagram', 'https://www.instagram.com/reel/Chunk8-jurw/'],
  ['facebook', 'https://www.facebook.com/cnn/videos/10155529876156509/'],
  ['twitter', 'https://x.com/Kyangs_Thang/status/2071270994363486287'],
  ['alldl', 'https://www.tiktok.com/@blaqbonez/video/7661265253874896148'],
  ['fetchurl', 'https://raw.githubusercontent.com/github/explore/main/topics/nodejs/nodejs.png'],
  ['gitclone', 'https://github.com/octocat/Hello-World'],
  ['dlstatus', '']
]
for (const [name, text] of downloadCases) {
  await probe('Téléchargement', name, async () => {
    const { ctx, outputs } = textContext(text)
    await downloads.find(command => command.name === name).run(ctx)
    const output = outputs[0]
    const media = output?.audio || output?.video || output?.image || output?.document
    if (name === 'gitclone' && media?.subarray(0, 2).toString() !== 'PK') throw new Error('archive ZIP invalide')
    if (media) return `${media.length} octets · ${output.mimetype || 'média'}`
    if (output?.text) {
      if (name === 'dlstatus' && !/Téléchargements fonctionnels/i.test(output.text)) {
        throw new Error('état fonctionnel absent du rapport')
      }
      return `${output.text.length} caractères`
    }
    throw new Error('aucun média ou texte reçu')
  })
}

for (const [name, text] of [['anime', 'Naruto'], ['waifu', ''], ['neko', ''], ['kitsune', ''], ['husbando', '']]) {
  await probe('Anime SFW', name, async () => {
    const { ctx, outputs } = textContext(text)
    await anime.find(command => command.name === name).run(ctx)
    const count = outputs.filter(output => output.image).length
    if (count !== 3) throw new Error(`${count}/3 images reçues`)
    return '3/3 images'
  })
}

await probe('Recherche en ligne', 'stickers', async () => {
  const { ctx, outputs } = textContext('Naruto')
  ctx.msg = {}
  await stickers.find(command => command.name === 'stickers').run(ctx)
  const sticker = outputs.find(output => output.sticker)?.sticker
  if (!sticker?.length) throw new Error('aucun sticker reçu')
  return `${sticker.length} octets`
})

for (const [name, text] of [['livre', 'Dune'], ['hn', 'rust language'], ['so', 'javascript promise']]) {
  await probe('Recherche en ligne', name, async () => {
    const { ctx, outputs } = textContext(text)
    await searchWeb.find(command => command.name === name || command.aliases.includes(name)).run(ctx)
    const output = outputs[0]?.text
    if (!output) throw new Error('aucune réponse textuelle')
    return `${output.length} caractères`
  })
}

// Nouvelles commandes API : chaque commande image doit renvoyer un média.
const extraMediaCases = [
  ['wiki', 'Brazzaville'],
  ['pokemon', 'pikachu'],
  ['country', 'France'],
  ['xkcd', 'random'],
  ['dog', ''],
  ['picsum', ''],
  ['rickmorty', '']
]
for (const [name, text] of extraMediaCases) {
  await probe('Commandes API', name, async () => {
    const { ctx, outputs } = textContext(text)
    await extra.find(command => command.name === name).run(ctx)
    const output = outputs.find(item => item.image)
    if (!output?.image?.length) {
      // .wiki et .country peuvent basculer en texte si l’image distante casse,
      // mais jamais renvoyer un simple lien : le texte doit rester un résumé.
      const fallback = outputs[0]?.text
      if ((name === 'wiki' || name === 'country') && fallback && fallback.length > 80) {
        return `${fallback.length} caractères (texte, image indisponible)`
      }
      throw new Error('aucune image reçue')
    }
    return `${output.image.length} octets · ${output.mimetype || 'image'}`
  })
}

const extraTextCases = [
  ['crypto', ''],
  ['fact', ''],
  ['quote', ''],
  ['trivia', ''],
  ['number', '42'],
  ['nameguess', 'Marie']
]
for (const [name, text] of extraTextCases) {
  await probe('Commandes API', name, async () => {
    const { ctx, outputs } = textContext(text)
    await extra.find(command => command.name === name).run(ctx)
    const output = outputs[0]?.text
    if (!output) throw new Error('aucune réponse textuelle')
    return `${output.length} caractères`
  })
}

const ok = results.filter(result => result.status === 'OK').length
const report = [
  '# Rapport de test global en direct',
  '',
  `- Date : ${new Date().toISOString()}`,
  `- Version : ${config.botVersion}`,
  `- Plateforme : ${process.platform}-${process.arch}`,
  `- Résultat : **${ok}/${results.length} tests en direct réussis**`,
  '',
  '| Domaine | Commande | État | Durée | Résultat |',
  '|---|---|---:|---:|---|',
  ...results.map(result => `| ${result.section} | \`.${result.name}\` | ${result.status} | ${result.duration} ms | ${result.detail.replaceAll('|', '\\|')} |`),
  '',
  'Les commandes WhatsApp, de groupe, propriétaire, médias et IA sont testées séparément avec des sockets et services simulés par `npm test`.',
  ''
].join('\n')
await fs.mkdir(path.resolve('reports'), { recursive: true })
await fs.writeFile(path.resolve('reports/live-smoke.md'), report)
if (ok !== results.length) process.exitCode = 1
