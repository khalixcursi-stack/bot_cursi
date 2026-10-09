import test from 'node:test'
import assert from 'node:assert/strict'
import { safeAdultImageQuery, safeImageQuery } from '../src/services/image-search.js'

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
