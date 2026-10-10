import dns from 'node:dns/promises'

// Aucun DNS ni appel réseau réel : les URL restent publiques pour exercer
// les protections SSRF de fetchExternalBuffer et leurs redirections.
export function mockHttp(t, handler) {
  const calls = []
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }])
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(String(input))
    calls.push({ target: url.toString(), url, options })
    return await handler(url, options) || new Response('not found', { status: 404 })
  })
  return calls
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

export function mediaResponse(contentType = 'image/jpeg', size = 2048) {
  return new Response(Buffer.alloc(size, 1), { headers: { 'content-type': contentType } })
}
