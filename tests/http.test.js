import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchJson } from '../src/services/http.js'

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
