import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchExternalBuffer, fetchJson } from '../src/services/http.js'
import { mockHttp, mediaResponse } from './helpers/http-fixture.js'

async function server(handler) {
  const instance = http.createServer(handler)
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${instance.address().port}`,
    close: () => new Promise(resolve => instance.close(resolve))
  }
}

test('les recherches GET réessaient automatiquement après une panne temporaire', async () => {
  let attempts = 0
  const remote = await server((_req, res) => {
    attempts += 1
    res.setHeader('content-type', 'application/json')
    if (attempts < 3) return res.writeHead(503).end('{"error":"temporaire"}')
    res.end('{"ok":true}')
  })
  try {
    assert.deepEqual(await fetchJson(remote.url, { timeout: 2000 }), { ok: true })
    assert.equal(attempts, 3)
  } finally {
    await remote.close()
  }
})

test('un POST distant n’est pas répété automatiquement', async () => {
  let attempts = 0
  const remote = await server((_req, res) => {
    attempts += 1
    res.setHeader('content-type', 'application/json')
    res.writeHead(503).end('{"error":"temporaire"}')
  })
  try {
    await assert.rejects(() => fetchJson(remote.url, { method: 'POST', body: '{}', timeout: 2000 }), /HTTP 503/)
    assert.equal(attempts, 1)
  } finally {
    await remote.close()
  }
})


test('fetchExternalBuffer résout HEAD sans corps et garde les métadonnées', async t => {
  const calls = mockHttp(t, url => url.hostname === 'short.example'
    ? new Response(null, { status: 302, headers: { location: 'https://public.example/post' } })
    : new Response(null, { headers: { 'content-type': 'text/html', 'content-length': '999999999' } }))
  const file = await fetchExternalBuffer('https://short.example/abc', { method: 'HEAD', allowedHosts: ['short.example', 'public.example'], maxBytes: 1 })
  assert.equal(file.finalUrl, 'https://public.example/post')
  assert.equal(file.buffer.length, 0)
  assert.equal(file.contentType, 'text/html')
  assert.ok(calls.every(call => call.options.method === 'HEAD' && call.options.redirect === 'manual'))
})

test('fetchExternalBuffer valide le domaine et la protection SSRF à chaque redirection', async t => {
  let destination = 'https://evil.example/secret'
  const calls = mockHttp(t, () => new Response(null, { status: 302, headers: { location: destination } }))
  await assert.rejects(() => fetchExternalBuffer('https://public.example/abc', { allowedHosts: ['public.example'] }), /domaine autorisé/)
  assert.equal(calls.length, 1)
  destination = 'http://127.0.0.1/secret'
  await assert.rejects(() => fetchExternalBuffer('https://public.example/abc'), /privée/)
  assert.equal(calls.length, 2)
})

test('les buffers restent limités même sans Content-Length', async t => {
  mockHttp(t, () => mediaResponse('image/jpeg', 2000))
  await assert.rejects(() => fetchExternalBuffer('https://public.example/photo.jpg', { maxBytes: 1000 }), /limite/)
})
