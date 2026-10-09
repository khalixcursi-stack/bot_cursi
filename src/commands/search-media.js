import { UserError } from '../core/errors.js'
import { downloadWithFallback } from './download.js'
import {
  downloadInternetImage,
  safeAdultImageQuery,
  safeImageQuery,
  searchAdultImages,
  searchInternetImages
} from '../services/image-search.js'
import { searchYouTube } from '../services/youtube.js'
import { truncate } from '../utils/format.js'

export default [
  {
    name: 'videos', aliases: ['videosearch', 'findvideo'], category: 'Recherche', usage: '<recherche>',
    description: 'Recherche une vidéo sur Internet et envoie directement le meilleur résultat.', cooldown: 20,
    async run(ctx) {
      const query = String(ctx.text || '').trim().slice(0, 180)
      if (!query) throw new UserError(`Indique une recherche, par exemple : ${ctx.runtime.prefix}videos documentaire Congo`)
      const [video] = await searchYouTube(ctx.config, query)
      if (!video) throw new UserError(`Aucune vidéo trouvée pour « ${query} ».`)
      const file = await downloadWithFallback(ctx, video.url, 'video', { youtube: true })
      const mime = file.contentType?.startsWith('video/') ? file.contentType : 'video/mp4'
      await ctx.send({
        video: file.buffer,
        mimetype: mime,
        fileName: file.filename,
        caption: [
          `🎬 *${truncate(video.title, 180)}*`,
          video.author ? `👤 ${video.author}` : '',
          `🔎 Recherche : ${truncate(query, 120)}`,
          `🔗 ${video.url}`
        ].filter(Boolean).join('\n')
      })
    }
  },
  {
    name: 'images', aliases: ['imgsearch', 'picsearch'], category: 'Recherche', usage: '<recherche>',
    description: 'Recherche une photo SFW sur Internet et l’envoie avec sa source.', cooldown: 10,
    async run(ctx) {
      const query = safeImageQuery(ctx.text)
      const results = await searchInternetImages(query, { includeFallback: true, photoOnly: true })
      const candidates = [
        ...results.filter(item => item.provider === 'Openverse').slice(0, 6),
        ...results.filter(item => item.provider === 'Wikimedia Commons').slice(0, 6)
      ]
      let selected
      let file
      let lastError
      for (const result of candidates) {
        try {
          file = await downloadInternetImage(ctx.config, result, { photoOnly: true })
          selected = result
          break
        } catch (error) {
          lastError = error
          ctx.logger.warn({ err: error, source: result.sourceUrl }, 'Image de recherche ignorée; essai du résultat suivant')
        }
      }
      if (!selected || !file) throw lastError || new UserError(`Aucune photo valide trouvée pour « ${query} ».`)
      await ctx.send({
        image: file.buffer,
        mimetype: file.contentType,
        caption: [
          `🖼️ *${truncate(selected.title || query, 180)}*`,
          `© ${selected.creator} — ${selected.license}`,
          `Source : ${selected.sourceUrl}`
        ].join('\n')
      })
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
