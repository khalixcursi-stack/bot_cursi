import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import sharp from 'sharp'
import aiCommands from '../src/commands/ai.js'

test('simulation IA compatible OpenAI : texte, vision et image', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url.includes('/images/')) return res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
      res.end(JSON.stringify({ choices: [{ message: { content: body.includes('image_url') ? 'Image analysée' : 'Réponse simulée' } }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const config = {
    botName: 'Test',
    ai: {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test',
      model: 'texte', visionModel: 'vision', imageModel: 'image'
    }
  }
  try {
    for (const command of aiCommands) {
      const outputs = []
      const ctx = {
        text: 'question', config, msg: {},
        async downloadMedia() { return { kind: 'image', buffer: png, mime: 'image/png' } },
        async reply(value) { outputs.push({ text: value }) },
        async send(content) { outputs.push(content) }
      }
      await command.run(ctx)
      assert.ok(outputs.length, `${command.name} n’a produit aucune sortie`)
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
