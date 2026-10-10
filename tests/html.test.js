import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeHtmlEntities, decodeMediaUrl } from '../src/utils/html.js'

test('décode les URL CDN mêlant échappements JSON et entités HTML', () => {
  assert.equal(decodeMediaUrl('https:&#x2F;&#x2F;cdn.example\\/a.mp4?x=1\\u0026y=2&amp;z=3'), 'https://cdn.example/a.mp4?x=1&y=2&z=3')
  assert.equal(decodeMediaUrl('https://cdn.example/image.jpg?a=1&amp;amp;b=2'), 'https://cdn.example/image.jpg?a=1&b=2')
})

test('les entités invalides ou hors Unicode ne provoquent pas de RangeError', () => {
  assert.equal(decodeHtmlEntities('A &amp; B &#39; &#x1F600;'), "A & B ' 😀")
  assert.equal(decodeHtmlEntities('&#x110000; &#xD800; &unknown;'), '&#x110000; &#xD800; &unknown;')
})
