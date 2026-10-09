import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer, fetchJson } from '../services/http.js'

const TARGET_IMAGES = 3

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJsonWithRetry(url, options = {}, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, { timeout: 25_000, ...options })
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 700)
    }
  }
  throw lastError
}

async function downloadAnimeImage(ctx, url) {
  const file = await fetchExternalBuffer(url, {
    maxBytes: Math.min(ctx.config.maxDownloadBytes, 15 * 1024 * 1024),
    timeout: 50_000
  })
  if (!file.contentType.startsWith('image/')) throw new Error('La ressource reçue n’est pas une image')
  return file
}

export async function sendDanbooruFallback(ctx, tag, label, emoji, sentUrls = new Set(), startingAt = 0) {
  let sent = startingAt
  try {
    const params = new URLSearchParams({ tags: `${tag} rating:general`, limit: '12', random: 'true' })
    const posts = await fetchJsonWithRetry(`https://danbooru.donmai.us/posts.json?${params}`, {}, 2)
    for (const post of Array.isArray(posts) ? posts : []) {
      if (sent >= TARGET_IMAGES) break
      const url = post.large_file_url || post.file_url
      if (!url || post.rating !== 'g' || sentUrls.has(url)) continue
      sentUrls.add(url)
      try {
        const file = await downloadAnimeImage(ctx, url)
        const artist = post.tag_string_artist?.split(/\s+/)[0]
        const source = post.source || `https://danbooru.donmai.us/posts/${post.id}`
        const position = sent + 1
        await ctx.send({
          image: file.buffer,
          mimetype: file.contentType,
          caption: `${emoji} *${label} ${position}/${TARGET_IMAGES}*${artist ? `\n🎨 Artiste : ${artist}` : ''}\n🔗 Source : ${source}`
        })
        sent += 1
      } catch (error) {
        ctx.logger.warn({ err: error, post: post.id }, 'Image Anime de repli ignorée')
      }
    }
  } catch (error) {
    ctx.logger.warn({ err: error, tag }, 'Source Anime de repli indisponible')
  }
  return sent
}

async function sendAnimeGallery(ctx, endpoint, label, emoji, fallbackTag) {
  const sentUrls = new Set()
  let sent = 0
  let lastError

  // Plusieurs candidats et nouvelles tentatives évitent qu’une seule image expirée
  // rende toute la commande inutilisable.
  for (let batch = 0; batch < 3 && sent < TARGET_IMAGES; batch += 1) {
    try {
      const data = await fetchJsonWithRetry(`https://nekos.best/api/v2/${endpoint}?amount=6`, {}, 2)
      const results = Array.isArray(data.results) ? data.results : []
      for (const item of results) {
        if (sent >= TARGET_IMAGES || !item.url || sentUrls.has(item.url)) continue
        sentUrls.add(item.url)
        try {
          const file = await downloadAnimeImage(ctx, item.url)
          const artist = item.artist_name ? `\n🎨 Artiste : ${item.artist_name}` : ''
          const source = item.source_url ? `\n🔗 Source : ${item.source_url}` : ''
          const position = sent + 1
          await ctx.send({
            image: file.buffer,
            mimetype: file.contentType,
            caption: `${emoji} *${label} ${position}/${TARGET_IMAGES}*${artist}${source}`
          })
          sent += 1
        } catch (error) {
          lastError = error
          ctx.logger.warn({ err: error, endpoint }, 'Image Anime ignorée; essai du candidat suivant')
        }
      }
    } catch (error) {
      lastError = error
      ctx.logger.warn({ err: error, endpoint, batch }, 'Recherche Anime temporairement indisponible')
    }
  }

  if (sent < TARGET_IMAGES) {
    sent = await sendDanbooruFallback(ctx, fallbackTag, label, emoji, sentUrls, sent)
  }
  if (!sent) throw asUserError(lastError, `Aucune image ${label} n’a pu être récupérée sur Internet`)
  if (sent < TARGET_IMAGES) {
    await ctx.reply(`⚠️ Le service Anime n’a fourni que ${sent}/${TARGET_IMAGES} image(s) valide(s). Réessaie dans un instant.`)
  }
}

const ANILIST_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: ANIME, isAdult: false, sort: SCORE_DESC) {
        title { romaji english native }
        coverImage { extraLarge large }
        format
        seasonYear
        averageScore
        siteUrl
      }
    }
  }
`

async function searchAniList(query) {
  const data = await fetchJsonWithRetry('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query.slice(0, 100) } })
  }, 3)
  return (data.data?.Page?.media || []).map(item => ({
    title: item.title?.english || item.title?.romaji || item.title?.native || 'Anime',
    image: item.coverImage?.extraLarge || item.coverImage?.large,
    type: item.format || 'Anime',
    year: item.seasonYear || '',
    score: item.averageScore ? `${item.averageScore}/100` : '',
    url: item.siteUrl
  })).filter(item => item.image)
}

async function searchJikan(query) {
  const params = new URLSearchParams({ q: query.slice(0, 100), sfw: 'true', limit: '8', order_by: 'score', sort: 'desc' })
  const data = await fetchJsonWithRetry(`https://api.jikan.moe/v4/anime?${params}`, {}, 2)
  return (data.data || []).map(item => ({
    title: item.title_english || item.title || 'Anime',
    image: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url,
    type: item.type || 'Anime',
    year: item.year || item.aired?.prop?.from?.year || '',
    score: item.score || '',
    url: item.url
  })).filter(item => item.image)
}

async function searchAnimeTitles(ctx, query) {
  let candidates = []
  let searchError
  try {
    candidates = await searchAniList(query)
  } catch (error) {
    searchError = error
    ctx.logger.warn({ err: error }, 'AniList indisponible; repli vers Jikan')
  }
  if (!candidates.length) {
    try {
      candidates = await searchJikan(query)
    } catch (error) {
      searchError = error
    }
  }
  if (!candidates.length && searchError) {
    throw asUserError(searchError, 'La recherche de titres Anime est momentanément indisponible')
  }
  if (!candidates.length) throw new UserError(`Aucun Anime trouvé pour « ${query} ».`)

  let sent = 0
  let lastError
  for (const item of candidates) {
    if (sent >= TARGET_IMAGES) break
    try {
      const file = await downloadAnimeImage(ctx, item.image)
      const position = sent + 1
      await ctx.send({
        image: file.buffer,
        mimetype: file.contentType,
        caption: [
          `🎬 *${item.title}* · ${position}/${TARGET_IMAGES}`,
          `${item.type}${item.year ? ` · ${item.year}` : ''}${item.score ? ` · ⭐ ${item.score}` : ''}`,
          item.url ? `🔗 ${item.url}` : ''
        ].filter(Boolean).join('\n')
      })
      sent += 1
    } catch (error) {
      lastError = error
      ctx.logger.warn({ err: error, title: item.title }, 'Affiche Anime ignorée; essai du résultat suivant')
    }
  }
  if (!sent) throw asUserError(lastError, `Les affiches trouvées pour « ${query} » n’ont pas pu être téléchargées`)
  if (sent < TARGET_IMAGES) await ctx.reply(`⚠️ Seulement ${sent}/${TARGET_IMAGES} affiche(s) valide(s) trouvée(s).`)
}

function animeCommand(name, aliases, endpoint, label, emoji, fallbackTag) {
  return {
    name,
    aliases,
    category: 'Anime',
    description: `Cherche sur Internet et envoie trois images ${label} SFW.`,
    cooldown: 15,
    async run(ctx) {
      await sendAnimeGallery(ctx, endpoint, label, emoji, fallbackTag)
    }
  }
}

export default [
  {
    name: 'anime', aliases: ['animesearch', 'animefind'], category: 'Anime', usage: '<titre>',
    description: 'Recherche un Anime sur Internet et envoie trois affiches SFW correspondantes.', cooldown: 15,
    async run(ctx) {
      if (!ctx.text) throw new UserError(`Indique un titre, par exemple : ${ctx.runtime.prefix}anime Naruto`)
      await searchAnimeTitles(ctx, ctx.text.trim())
    }
  },
  animeCommand('waifu', ['animepic'], 'waifu', 'waifu', '🌸', '1girl'),
  animeCommand('neko', ['catgirl'], 'neko', 'neko', '🐾', 'cat_ears'),
  animeCommand('kitsune', ['foxgirl'], 'kitsune', 'kitsune', '🦊', 'fox_ears'),
  animeCommand('husbando', ['animeboy'], 'husbando', 'husbando', '⚔️', '1boy')
]
