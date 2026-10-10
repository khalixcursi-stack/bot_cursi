import test from 'node:test'
import assert from 'node:assert/strict'
import {
  relevanceScore,
  safeAdultImageQuery,
  safeImageQuery,
  searchInternetImages,
  tokenizeSearchText
} from '../src/services/image-search.js'

test('la recherche d’images normalise une requête SFW et bloque les termes explicites', () => {
  assert.equal(safeImageQuery('  Pointe-Noire Congo  '), 'Pointe-Noire Congo')
  assert.throws(() => safeImageQuery(''), /recherche d’image/)
  assert.throws(() => safeImageQuery('contenu hentai'), /pas autorisée/)
  assert.throws(() => safeImageQuery('photo érotique'), /pas autorisée/)
})

test('la recherche adulte accepte une demande légale et bloque les catégories interdites', () => {
  assert.equal(safeAdultImageQuery('  artistic nude  '), 'artistic nude')
  assert.throws(() => safeAdultImageQuery(''), /réservée aux adultes/)
  assert.throws(() => safeAdultImageQuery('underage content'), /protections du bot/)
  assert.throws(() => safeAdultImageQuery('forced scene'), /protections du bot/)
  assert.throws(() => safeAdultImageQuery('zoophilie'), /protections du bot/)
})

test('relevanceScore mesure le recouvrement des mots-clés de la requête', () => {
  assert.deepEqual(tokenizeSearchText('photo de Chat Noir'), ['chat', 'noir'])
  assert.equal(relevanceScore('chat noir', 'Un chat noir endormi', []), 1)
  assert.equal(relevanceScore('chat noir', 'black cat sleeping', []), 0)
  assert.equal(relevanceScore('chat noir', 'chat sur un canapé', ['mobilier']), 0.5)
  assert.equal(relevanceScore('voiture', 'Voitures de course', []), 1)
  assert.equal(relevanceScore('montagne', 'paysage de plage', []), 0)
  assert.equal(relevanceScore('', 'un titre', []), 0)
})

test('searchInternetImages filtre les faux positifs et trie par pertinence', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('openverse.org')) {
      return new Response(JSON.stringify({
        results: [
          {
            title: 'Random sculpture', url: 'https://img.example/sculpture.jpg',
            foreign_landing_url: 'https://example/sculpture', license: 'cc0', filetype: 'jpg',
            tags: [{ name: 'art' }]
          },
          {
            title: 'Chat noir sur un muret', url: 'https://img.example/chat.jpg',
            foreign_landing_url: 'https://example/chat', license: 'cc0', filetype: 'jpg',
            tags: [{ name: 'chat' }, { name: 'noir' }]
          },
          {
            title: 'Black cat on a wall', url: 'https://img.example/blackcat.jpg',
            foreign_landing_url: 'https://example/blackcat', license: 'cc0', filetype: 'jpg',
            tags: [{ name: 'black cat' }]
          }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('translate.googleapis.com')) {
      return new Response(JSON.stringify([[['black cat', 'black cat', null, null]]]), {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const results = await searchInternetImages('chat noir', { providers: ['openverse'] })
    const titles = results.map(item => item.title)
    assert.ok(titles.includes('Chat noir sur un muret'))
    assert.ok(titles.includes('Black cat on a wall'))
    assert.ok(!titles.includes('Random sculpture'), 'les résultats hors sujet doivent être écartés')
    assert.ok(results[0].relevance >= results.at(-1).relevance, 'les résultats doivent être triés par pertinence')
  } finally {
    globalThis.fetch = original
  }
})

test('searchInternetImages refuse une recherche sans aucun résultat pertinent', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('openverse.org')) {
      return new Response(JSON.stringify({
        results: [{ title: 'Paysage de plage', url: 'https://img.example/mer.jpg', license: 'cc0', filetype: 'jpg' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await assert.rejects(
      () => searchInternetImages('montagne', { providers: ['openverse'] }),
      /Aucune image pertinente/
    )
  } finally {
    globalThis.fetch = original
  }
})
