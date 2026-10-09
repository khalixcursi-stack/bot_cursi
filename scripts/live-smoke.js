import fs from 'node:fs/promises'
import path from 'node:path'
import utilities from '../src/commands/utilities.js'
import general from '../src/commands/general.js'
import downloads from '../src/commands/download.js'
import anime from '../src/commands/anime.js'
import stickers from '../src/commands/stickers.js'
import searchMedia from '../src/commands/search-media.js'
import { config } from '../src/config.js'

const results = []
const logger = { warn() {}, error() {}, info() {}, debug() {} }

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
    ctx: { text, args, quoted: null, config, logger, async reply(value) { outputs.push({ text: String(value) }) }, async send(content) { outputs.push(content) } },
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
  const { ctx, outputs } = textContext('Pointe-Noire Congo')
  ctx.runtime = { prefix: '.' }
  await searchMedia.find(command => command.name === 'images').run(ctx)
  const output = outputs.find(item => item.image)
  if (!output?.image?.length) throw new Error('aucune image reçue')
  if (output.mimetype !== 'image/jpeg') throw new Error(`format photo inattendu : ${output.mimetype || 'inconnu'}`)
  if (!/Source\s*:/i.test(output.caption || '')) throw new Error('source absente de la légende')
  return `${output.image.length} octets · ${output.mimetype}`
})

await probe('Recherche adulte', 'nsfw', async () => {
  const { ctx, outputs } = textContext('18+ artistic nude')
  ctx.config = { ...config, nsfwEnabled: true }
  ctx.runtime = { prefix: '.' }
  await searchMedia.find(command => command.name === 'nsfw').run(ctx)
  const output = outputs.find(item => item.image)
  if (!output?.image?.length) throw new Error('aucune image adulte reçue')
  if (output.mimetype !== 'image/jpeg') throw new Error(`format adulte inattendu : ${output.mimetype || 'inconnu'}`)
  if (!/Source\s*:/i.test(output.caption || '')) throw new Error('source absente de la légende adulte')
  return `${output.image.length} octets · ${output.mimetype}`
})

await probe('Recherche en ligne', 'videos', async () => {
  const { ctx, outputs } = textContext('Me at the zoo jawed')
  ctx.runtime = { prefix: '.' }
  await searchMedia.find(command => command.name === 'videos').run(ctx)
  const output = outputs.find(item => item.video)
  if (!output?.video?.length) throw new Error('aucune vidéo reçue')
  if (!output.mimetype?.startsWith('video/')) throw new Error(`format vidéo inattendu : ${output.mimetype || 'inconnu'}`)
  return `${output.video.length} octets · ${output.mimetype}`
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
    if (output?.text) return `${output.text.length} caractères`
    throw new Error('aucun média ou texte reçu')
  })
}

for (const [name, text] of [['anime', 'Naruto'], ['waifu', ''], ['neko', ''], ['kitsune', ''], ['husbando', '']]) {
  await probe('Anime SFW', name, async () => {
    const { ctx, outputs } = textContext(text)
    ctx.runtime = { prefix: '.' }
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
