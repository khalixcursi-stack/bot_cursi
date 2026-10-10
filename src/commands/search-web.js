import { UserError } from '../core/errors.js'
import { fetchJson } from '../services/http.js'
import { truncate } from '../utils/format.js'

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '’', '&#x27;': '’', '&apos;': '’'
}

// Stack Exchange renvoie les titres encodés en HTML (&quot;, &#39;…).
export function decodeEntities(value = '') {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, match => {
    if (HTML_ENTITIES[match]) return HTML_ENTITIES[match]
    const code = match[2] === 'x' || match[2] === 'X'
      ? Number.parseInt(match.slice(3, -1), 16)
      : match[1] === '#' ? Number.parseInt(match.slice(2, -1), 10) : NaN
    return Number.isFinite(code) ? String.fromCodePoint(code) : match
  })
}

// Wikipedia renvoie des extraits avec des balises <span class="searchmatch">.
export function stripHtml(value = '') {
  return decodeEntities(String(value).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function requireQuery(ctx, example) {
  const query = String(ctx.text || '').trim().slice(0, 180)
  if (!query) throw new UserError(`Indique une recherche, par exemple : ${ctx.runtime?.prefix || '.'}${example}`)
  return query
}

export default [
  {
    name: 'livre', aliases: ['book', 'books'], category: 'Recherche', usage: '<titre ou auteur>',
    description: 'Recherche des livres sur Open Library (trois résultats).', cooldown: 4,
    async run(ctx) {
      const query = requireQuery(ctx, 'livre Dune')
      const data = await fetchJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3&fields=key,title,author_name,first_publish_year`)
      const books = (data.docs || []).slice(0, 3)
      if (!books.length) throw new UserError(`Aucun livre trouvé pour « ${truncate(query, 80)} ».`)
      const lines = books.map((book, index) => [
        `${index + 1}. *${truncate(book.title || 'Sans titre', 160)}*`,
        `   ✍️ ${(book.author_name || ['auteur inconnu']).slice(0, 3).join(', ')}${book.first_publish_year ? ` · ${book.first_publish_year}` : ''}`,
        book.key ? `   🔗 https://openlibrary.org${book.key}` : ''
      ].filter(Boolean).join('\n'))
      await ctx.reply([`📚 *Livres — ${truncate(query, 120)}*`, ...lines].join('\n\n'))
    }
  },
  {
    name: 'hn', aliases: ['hackernews'], category: 'Recherche', usage: '<recherche>',
    description: 'Recherche des articles sur Hacker News (trois résultats).', cooldown: 4,
    async run(ctx) {
      const query = requireQuery(ctx, 'hn rust language')
      const data = await fetchJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=3`)
      const stories = (data.hits || []).slice(0, 3)
      if (!stories.length) throw new UserError(`Aucun article Hacker News pour « ${truncate(query, 80)} ».`)
      const lines = stories.map((story, index) => [
        `${index + 1}. *${truncate(story.title || 'Sans titre', 180)}*`,
        `   ▲ ${story.points ?? 0} · 💬 ${story.num_comments ?? 0} · par ${story.author || 'inconnu'}`,
        `   🔗 ${story.url || `https://news.ycombinator.com/item?id=${story.objectID}`}`
      ].join('\n'))
      await ctx.reply([`🟧 *Hacker News — ${truncate(query, 120)}*`, ...lines].join('\n\n'))
    }
  },
  {
    name: 'stackoverflow', aliases: ['so', 'stack'], category: 'Recherche', usage: '<question>',
    description: 'Recherche des questions sur Stack Overflow (trois résultats).', cooldown: 5,
    async run(ctx) {
      const query = requireQuery(ctx, 'stackoverflow javascript promise')
      const params = new URLSearchParams({
        order: 'desc', sort: 'relevance', q: query, site: 'stackoverflow', pagesize: '3'
      })
      const data = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?${params}`)
      const questions = (data.items || []).slice(0, 3)
      if (!questions.length) throw new UserError(`Aucune question Stack Overflow pour « ${truncate(query, 80)} ».`)
      const lines = questions.map((question, index) => [
        `${index + 1}. *${truncate(decodeEntities(question.title), 180)}*`,
        `   ⬆️ ${question.score ?? 0} · 💬 ${question.answer_count ?? 0} réponse(s)${question.is_answered ? ' · ✅ résolue' : ''}`,
        `   🏷️ ${(question.tags || []).slice(0, 5).join(', ') || 'sans tag'}`,
        `   🔗 ${question.link}`
      ].join('\n'))
      await ctx.reply([`💻 *Stack Overflow — ${truncate(query, 120)}*`, ...lines].join('\n\n'))
    }
  }
]
