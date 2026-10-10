import { UserError } from '../core/errors.js'
import {
  downloadInternetImage,
  safeAdultImageQuery,
  safeImageQuery,
  searchAdultImages,
  searchInternetImages
} from '../services/image-search.js'
import { sendMultipleImages } from '../services/send-media.js'
import { truncate } from '../utils/format.js'

const MIN_PHOTOS = 3
const TARGET_PHOTOS = 5
const MAX_CANDIDATES = 20

function imageCaption(result, query) {
  return [
    `🖼️ *${truncate(result.title || query, 180)}*`,
    `© ${result.creator} — ${result.license}`,
    `Source : ${result.sourceUrl}`
  ].join('\n')
}

export default [
  {
    name: 'images', aliases: ['imgsearch', 'picsearch'], category: 'Recherche', usage: '<recherche>',
    description: `Recherche des photos SFW pertinentes et envoie ${MIN_PHOTOS} à ${TARGET_PHOTOS} images avec leurs sources.`, cooldown: 15,
    async run(ctx) {
      const query = safeImageQuery(ctx.text)
      const results = await searchInternetImages(query, {
        includeFallback: true,
        photoOnly: true,
        limit: MAX_CANDIDATES,
        providers: ctx.config.imageProviders,
        pixabayApiKey: ctx.config.pixabayApiKey,
        pexelsApiKey: ctx.config.pexelsApiKey
      })

      const files = []
      let lastError
      for (const result of results.slice(0, MAX_CANDIDATES)) {
        if (files.length >= TARGET_PHOTOS) break
        try {
          const file = await downloadInternetImage(ctx.config, result, { photoOnly: true })
          files.push({
            buffer: file.buffer,
            mimetype: file.contentType,
            caption: imageCaption(result, query)
          })
        } catch (error) {
          lastError = error
          ctx.logger.warn({ err: error, source: result.sourceUrl }, 'Image de recherche ignorée; essai du résultat suivant')
        }
      }
      if (!files.length) {
        throw lastError || new UserError(`Aucune photo valide trouvée pour « ${query} ».`)
      }

      await sendMultipleImages(ctx, files)
      if (files.length < MIN_PHOTOS) {
        await ctx.reply(`⚠️ Seulement ${files.length} photo(s) valide(s) trouvée(s) pour « ${truncate(query, 80)} ». Réessaie avec d’autres mots-clés.`)
      }
    }
  },
  {
    name: 'nsfw', aliases: ['adult'], category: 'Recherche', usage: '18+ <recherche>',
    description: 'Recherche séparée de contenu réservé aux adultes, avec confirmation explicite.', cooldown: 20,
    async run(ctx) {
      if (!ctx.config.nsfwEnabled) {
        throw new UserError('La commande adulte est désactivée sur ce bot.')
      }
      const match = String(ctx.text || '').trim().match(/^18\+\s+(.+)$/i)
      if (!match) {
        throw new UserError(`Confirme ta majorité : ${ctx.runtime.prefix}nsfw 18+ <recherche>`)
      }
      const query = safeAdultImageQuery(match[1])
      const results = await searchAdultImages(query)
      let selected
      let file
      let lastError
      for (const result of results.slice(0, 12)) {
        try {
          file = await downloadInternetImage(ctx.config, result, { photoOnly: true })
          selected = result
          break
        } catch (error) {
          lastError = error
          ctx.logger.warn({ err: error, source: result.sourceUrl }, 'Image adulte ignorée; essai suivant')
        }
      }
      if (!selected || !file) {
        throw lastError || new UserError(`Aucun contenu adulte autorisé trouvé pour « ${query} ».`)
      }
      await ctx.send({
        image: file.buffer,
        mimetype: file.contentType,
        caption: [
          '🔞 *Contenu réservé aux adultes*',
          `*${truncate(selected.title || query, 180)}*`,
          `© ${selected.creator} — ${selected.license}`,
          `Source : ${selected.sourceUrl}`,
          'Protection active : contenus impliquant des mineurs, non consentis ou illégaux interdits.'
        ].join('\n')
      })
    }
  }
]
