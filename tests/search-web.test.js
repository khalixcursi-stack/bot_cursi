import test from 'node:test'
import assert from 'node:assert/strict'
import searchWeb, { decodeEntities, stripHtml } from '../src/commands/search-web.js'

const command = name => searchWeb.find(item => item.name === name || item.aliases.includes(name))

// Remplace fetch pour simuler les API distantes avec des réponses figées.
async function withFetch(routes, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async url => {
    const target = String(url)
    calls.push(target)
    const route = routes.find(([pattern]) => pattern.test(target))
    if (!route) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(route[1]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

function context(text) {
  const replies = []
  return {
    replies,
    ctx: {
      text,
      args: text.split(/\s+/).filter(Boolean),
      runtime: { prefix: '.' },
      async reply(value) { replies.push(String(value)) },
      async send() {}
    }
  }
}

test('les commandes de recherche web sont enregistrées avec leurs alias', () => {
  assert.equal(command('livre').name, 'livre')
  assert.equal(command('book').name, 'livre')
  assert.equal(command('wikipedia').name, 'wiki')
  assert.equal(command('hackernews').name, 'hn')
  assert.equal(command('so').name, 'stackoverflow')
  assert.equal(command('cours').name, 'crypto')
})

test('décode les entités HTML renvoyées par Stack Exchange', () => {
  assert.equal(decodeEntities('Can&#39;t &quot;x&quot; &amp; &#x1F600;'), 'Can’t "x" & 😀')
  assert.equal(stripHtml('Le <span class="searchmatch">Congo</span> &amp; l’Afrique'), 'Le Congo & l’Afrique')
})

test('.livre affiche trois livres avec auteur, année et lien Open Library', async () => {
  await withFetch([[/openlibrary\.org\/search\.json/, {
    docs: [
      { key: '/works/OL893414W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965 },
      { key: '/works/OL893461W', title: 'Dune Messiah', author_name: ['Frank Herbert', 'Co-auteur'] },
      { key: '/works/OL1W', title: 'Autre livre' },
      { key: '/works/OL2W', title: 'Quatrième' }
    ]
  }]], async calls => {
    const { ctx, replies } = context('Dune')
    await command('livre').run(ctx)
    assert.match(calls[0], /q=Dune/)
    assert.match(calls[0], /limit=3/)
    assert.match(replies[0], /Dune\*/)
    assert.match(replies[0], /Frank Herbert · 1965/)
    assert.match(replies[0], /https:\/\/openlibrary\.org\/works\/OL893414W/)
    assert.doesNotMatch(replies[0], /Quatrième/)
  })
})

test('.wiki récupère le meilleur article puis son résumé français', async () => {
  await withFetch([
    [/fr\.wikipedia\.org\/w\/api\.php/, { query: { search: [{ title: 'Congo (fleuve)', snippet: 'Le <span>Congo</span>' }] } }],
    [/rest_v1\/page\/summary/, {
      title: 'Congo (fleuve)',
      description: 'fleuve d’Afrique centrale',
      extract: 'Le Congo est un fleuve d’Afrique centrale.',
      content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Congo_(fleuve)' } }
    }]
  ], async calls => {
    const { ctx, replies } = context('fleuve')
    await command('wiki').run(ctx)
    assert.match(calls[1], /rest_v1\/page\/summary\/Congo_\(fleuve\)/)
    assert.match(replies[0], /\*Congo \(fleuve\)\*/)
    assert.match(replies[0], /Le Congo est un fleuve/)
    assert.match(replies[0], /https:\/\/fr\.wikipedia\.org\/wiki\/Congo_\(fleuve\)/)
  })
})

test('.hn affiche les points, commentaires et lien de l’article', async () => {
  await withFetch([[/hn\.algolia\.com/, {
    hits: [
      { title: 'Rust ergonomics', points: 506, num_comments: 288, author: 'aturon', url: 'https://blog.example/rust', objectID: '1' },
      { title: 'Sans URL', points: 3, num_comments: 0, author: 'ivank', url: null, objectID: '42' }
    ]
  }]], async () => {
    const { ctx, replies } = context('rust language')
    await command('hn').run(ctx)
    assert.match(replies[0], /▲ 506 · 💬 288 · par aturon/)
    assert.match(replies[0], /https:\/\/blog\.example\/rust/)
    assert.match(replies[0], /https:\/\/news\.ycombinator\.com\/item\?id=42/)
  })
})

test('.stackoverflow affiche les questions avec titres décodés', async () => {
  await withFetch([[/api\.stackexchange\.com/, {
    items: [{
      title: 'JavaScript Promises - reject vs. throw &quot;now&quot;',
      score: 680,
      answer_count: 9,
      is_answered: true,
      tags: ['javascript', 'promise'],
      link: 'https://stackoverflow.com/questions/33445415/x'
    }]
  }]], async calls => {
    const { ctx, replies } = context('javascript promise')
    await command('so').run(ctx)
    assert.match(calls[0], /site=stackoverflow/)
    assert.match(calls[0], /q=javascript\+promise/)
    assert.match(replies[0], /reject vs\. throw "now"/)
    assert.match(replies[0], /✅ résolue/)
    assert.match(replies[0], /https:\/\/stackoverflow\.com\/questions\/33445415/)
  })
})

test('.crypto affiche le cours en EUR et USD après recherche de l’identifiant', async () => {
  await withFetch([
    [/api\.coingecko\.com\/api\/v3\/search/, { coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' }] }],
    [/simple\/price/, { bitcoin: { usd: 82504, eur: 73634, usd_24h_change: 0.95 } }]
  ], async calls => {
    const { ctx, replies } = context('bitcoin')
    await command('crypto').run(ctx)
    assert.match(calls[1], /ids=bitcoin/)
    assert.match(replies[0], /Bitcoin \(BTC\)/)
    assert.match(replies[0], /EUR/)
    assert.match(replies[0], /USD/)
    assert.match(replies[0], /\+0\.95 % \(24 h\)/)
  })
})

test('une recherche vide demande un exemple d’utilisation', async () => {
  const { ctx } = context('   ')
  await assert.rejects(command('livre').run(ctx), error => {
    assert.equal(error.name, 'UserError')
    assert.match(error.message, /\.livre Dune/)
    return true
  })
})

test('une recherche sans résultat renvoie une erreur utilisateur claire', async () => {
  await withFetch([[/openlibrary\.org/, { docs: [] }]], async () => {
    const { ctx } = context('zzzz')
    await assert.rejects(command('livre').run(ctx), /Aucun livre trouvé/)
  })
})
