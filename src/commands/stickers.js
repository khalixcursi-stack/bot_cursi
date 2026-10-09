import sharp from 'sharp'
import { downloadInternetImage, safeImageQuery, searchInternetImages } from '../services/image-search.js'
import { truncate } from '../utils/format.js'

export default [
  {
    name: 'stickers', aliases: ['stickersearch', 'searchsticker', 'stsearch'], category: 'Stickers', usage: '<recherche>',
    description: 'Recherche une image SFW en rapport avec le nom demandé et la transforme en sticker.', cooldown: 12,
    async run(ctx) {
      const query = safeImageQuery(ctx.text).slice(0, 60)
      const results = await searchInternetImages(query, { modifiable: true, preferThumbnail: true })
      const start = Math.floor(Math.random() * Math.min(results.length, 6))
      const candidates = [...results.slice(start), ...results.slice(0, start)].slice(0, 10)
      let item
      let file
      let lastError
      for (const candidate of candidates) {
        try {
          file = await downloadInternetImage(ctx.config, candidate, { maxBytes: 6 * 1024 * 1024 })
          item = candidate
          break
        } catch (error) {
          lastError = error
          ctx.logger.warn({ err: error, source: candidate.sourceUrl }, 'Image de sticker ignorée; essai suivant')
        }
      }
      if (!item || !file) throw lastError
      const sticker = await sharp(file.buffer)
        .rotate()
        .resize(512, 512, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 82 })
        .toBuffer()

      await ctx.send({ sticker }, { quoted: ctx.msg })
      await ctx.reply(`🔎 *${truncate(item.title || query, 120)}*\n© ${item.creator} — ${item.license}\n${item.sourceUrl || ''}`)
    }
  }
]
