import test from 'node:test'
import assert from 'node:assert/strict'
import searchMedia from '../src/commands/search-media.js'
import extra from '../src/commands/extra.js'
import { config } from '../src/config.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])

async function withFetch(routes, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    calls.push({ target, options })
    const route = routes.find(([pattern]) => pattern.test(target))
    if (!route) return new Response('not found', { status: 404 })
    const [, payload, init = {}] = route
    if (payload instanceof Uint8Array) {
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': init.contentType || 'image/jpeg' }
      })
    }
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

function fixture(text = '') {
  const outputs = []
  return {
    outputs,
    ctx: {
      text,
      args: text.split(/\s+/).filter(Boolean),
      quoted: null,
      from: '242060000000@s.whatsapp.net',
      config: { ...config, imageProviders: ['openverse'], nsfwEnabled: false },
      runtime: { prefix: '.' },
      logger: { warn() {}, error() {}, info() {}, debug() {} },
      async reply(value) { outputs.push({ text: String(value) }); return { key: { id: '1' } } },
      async send(content) { outputs.push(content); return { key: { id: String(outputs.length) } } }
    }
  }
}

function openverseResult(title, tags, id) {
  return {
    title,
    url: `https://upload.wikimedia.org/${id}.jpg`,
    foreign_landing_url: `https://example.org/${id}`,
    license: 'cc0',
    filetype: 'jpg',
    creator: 'Testeur',
    tags: tags.map(name => ({ name }))
  }
}

test('.images envoie 3 photos téléchargées avec leurs sources, jamais un lien', async () => {
  await withFetch([
    [/api\.openverse\.org/, {
      results: [
        openverseResult('Montagne enneigée', ['montagne', 'neige'], 'm1'),
        openverseResult('Sommet de montagne', ['montagne', 'sommet'], 'm2'),
        openverseResult('Vallée de montagne', ['montagne'], 'm3'),
        openverseResult('Voiture rouge', ['voiture'], 'm4')
      ]
    }],
    [/translate\.googleapis\.com/, [[['mountain', 'mountain', null, null]]]],
    [/upload\.wikimedia\.org\/m[123]\.jpg/, JPEG],
    [/upload\.wikimedia\.org\/m4\.jpg/, JPEG]
  ], async () => {
    const { ctx, outputs } = fixture('montagne')
    await searchMedia.find(command => command.name === 'images').run(ctx)
    const images = outputs.filter(item => item.image)
    assert.equal(images.length, 3, 'exactement 3 photos pertinentes')
    for (const image of images) {
      assert.ok(Buffer.isBuffer(image.image), 'le média doit être un buffer')
      assert.equal(image.mimetype, 'image/jpeg')
      assert.match(image.caption, /Source : /)
    }
    const captions = images.map(image => image.caption).join('\n')
    assert.ok(!captions.includes('Voiture rouge'), 'l’image hors sujet doit être filtrée')
    for (const output of outputs) {
      if (output.text) assert.ok(output.text.length > 20, 'aucun simple lien texte ne doit remplacer une image')
    }
  })
})

test('.images propose les images de repli étiquetées quand la recherche est pauvre', async () => {
  await withFetch([
    [/api\.openverse\.org/, { results: [openverseResult('Montagne', ['montagne'], 'm1')] }],
    [/translate\.googleapis\.com/, [[['mountain', 'mountain', null, null]]]],
    [/upload\.wikimedia\.org\/m1\.jpg/, JPEG],
    [/source\.unsplash\.com/, JPEG, { contentType: 'image/jpeg' }],
    [/loremflickr\.com/, JPEG]
  ], async () => {
    const { ctx, outputs } = fixture('montagne')
    ctx.config.imageProviders = ['openverse', 'unsplash', 'loremflickr']
    // On force la présence des candidats thématiques via includeFallback (déjà actif pour .images).
    await searchMedia.find(command => command.name === 'images').run(ctx)
    const images = outputs.filter(item => item.image)
    assert.ok(images.length >= 1)
    assert.ok(images.length <= 5)
  })
})

test('.dog télécharge et envoie la photo de chien directement', async () => {
  await withFetch([
    [/dog\.ceo\/api\/breeds\/image\/random/, { message: 'https://images.dog.ceo/breeds/test.jpg', status: 'success' }],
    [/images\.dog\.ceo\/breeds\/test\.jpg/, JPEG]
  ], async () => {
    const { ctx, outputs } = fixture('')
    await extra.find(command => command.name === 'dog').run(ctx)
    const image = outputs.find(item => item.image)
    assert.ok(Buffer.isBuffer(image?.image), 'la photo doit être envoyée comme média')
    assert.ok(!outputs.some(item => typeof item.text === 'string' && /^https?:\/\/\S+$/.test(item.text.trim())), 'jamais un lien seul')
  })
})

test('.wiki envoie résumé + image en un seul média légendé', async () => {
  await withFetch([
    [/fr\.wikipedia\.org\/w\/api\.php/, { query: { search: [{ title: 'Brazzaville' }] } }],
    [/fr\.wikipedia\.org\/api\/rest_v1\/page\/summary/, {
      title: 'Brazzaville',
      extract: 'Brazzaville est la capitale de la République du Congo.',
      description: 'capitale du Congo',
      thumbnail: { source: 'https://upload.wikimedia.org/brazzaville.jpg' },
      content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Brazzaville' } }
    }],
    [/upload\.wikimedia\.org\/brazzaville\.jpg/, JPEG]
  ], async () => {
    const { ctx, outputs } = fixture('Brazzaville')
    await extra.find(command => command.name === 'wiki').run(ctx)
    const image = outputs.find(item => item.image)
    assert.ok(Buffer.isBuffer(image?.image), 'l’image doit être jointe')
    assert.match(image.caption, /Brazzaville/)
    assert.match(image.caption, /capitale/)
  })
})

test('.crypto affiche les cours par défaut BTC/ETH/SOL/BNB', async () => {
  await withFetch([
    [/simple\/price/, {
      bitcoin: { usd: 82000, eur: 73000, usd_24h_change: 1.2 },
      ethereum: { usd: 3200, eur: 2850, usd_24h_change: -0.5 },
      solana: { usd: 150, eur: 134, usd_24h_change: 3.4 },
      binancecoin: { usd: 600, eur: 535, usd_24h_change: 0.1 }
    }]
  ], async calls => {
    const { ctx, outputs } = fixture('')
    await extra.find(command => command.name === 'crypto').run(ctx)
    const text = outputs[0].text
    assert.match(text, /BTC/)
    assert.match(text, /ETH/)
    assert.match(text, /SOL/)
    assert.match(text, /BNB/)
    assert.match(text, /\+1\.20 % \(24 h\)/)
    assert.match(calls[0].target, /ids=bitcoin%2Cethereum%2Csolana%2Cbinancecoin/)
  })
})

test('.trivia propose des réponses numérotées puis valide la réponse', async () => {
  const triviaRoutes = [
    [/the-trivia-api\.com|opentdb\.com/, {
      results: [{
        question: 'Quelle est la capitale de la France ?',
        correct_answer: 'Paris',
        incorrect_answers: ['Lyon', 'Marseille', 'Nice'],
        category: 'Geography',
        difficulty: 'easy'
      }]
    }]
  ]

  await withFetch(triviaRoutes, async () => {
    const { ctx, outputs } = fixture('')
    const command = extra.find(item => item.name === 'trivia')
    await command.run(ctx)
    const text = outputs[0].text || ''
    assert.match(text, /\*1\.\* /)
    assert.match(text, /\*4\.\* /)
    assert.match(text, /capitale de la France/)
  })

  // La question mémorisée dans le module doit être validée par .trivia <numéro>.
  await withFetch(triviaRoutes, async () => {
    const first = fixture('')
    const command = extra.find(item => item.name === 'trivia')
    await command.run(first.ctx)
    const questionText = first.outputs[0].text || ''
    const correctLine = questionText.split('\n').find(line => /^\*\d\.\*/.test(line) && /Paris/.test(line))
    const index = correctLine ? correctLine.match(/^\*(\d)\.\*/)?.[1] : null
    assert.ok(index, 'la réponse Paris doit figurer dans les options numérotées')
    const second = fixture(index)
    await command.run(second.ctx)
    assert.match(second.outputs[0].text, /Bonne réponse|Mauvaise réponse/)
  })
})

test('.pokemon envoie la fiche avec l’artwork officiel', async () => {
  await withFetch([
    [/pokeapi\.co\/api\/v2\/pokemon\/pikachu$/, {
      id: 25, name: 'pikachu', height: 4, weight: 60,
      types: [{ type: { name: 'electric' } }],
      abilities: [{ ability: { name: 'static' } }],
      sprites: { other: { 'official-artwork': { front_default: 'https://upload.wikimedia.org/pikachu.png' } } }
    }],
    [/pokeapi\.co\/api\/v2\/pokemon-species\/25/, {
      names: [{ language: { name: 'fr' }, name: 'Pikachu' }],
      genera: [{ language: { name: 'fr' }, genus: 'Souris Pokémon' }]
    }],
    [/upload\.wikimedia\.org\/pikachu\.png/, JPEG, { contentType: 'image/png' }]
  ], async () => {
    const { ctx, outputs } = fixture('pikachu')
    await extra.find(command => command.name === 'pokemon').run(ctx)
    const image = outputs.find(item => item.image)
    assert.ok(Buffer.isBuffer(image?.image))
    assert.match(image.caption, /Pikachu/)
    assert.match(image.caption, /Électrique/)
    assert.match(image.caption, /0,4 m/)
  })
})
