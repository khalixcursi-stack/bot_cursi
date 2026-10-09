import { fetchJson, fetchExternalBuffer } from './http.js'

function requireAi(config) {
  if (!config.ai.apiKey) throw new Error('L’IA n’est pas configurée. Ajoutez AI_API_KEY dans .env.')
}

function headers(config) {
  return {
    authorization: `Bearer ${config.ai.apiKey}`,
    'content-type': 'application/json'
  }
}

export async function chatCompletion(config, prompt) {
  requireAi(config)
  const data = await fetchJson(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(config),
    timeout: 60_000,
    body: JSON.stringify({
      model: config.ai.model,
      messages: [
        { role: 'system', content: `Tu es l’assistant utile et concis du bot WhatsApp ${config.botName}.` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    })
  })
  return data.choices?.[0]?.message?.content || data.output_text || 'Aucune réponse reçue.'
}

export async function visionCompletion(config, prompt, imageBuffer, mime = 'image/jpeg') {
  requireAi(config)
  const data = await fetchJson(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(config),
    timeout: 90_000,
    body: JSON.stringify({
      model: config.ai.visionModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Décris précisément cette image en français.' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBuffer.toString('base64')}` } }
        ]
      }]
    })
  })
  return data.choices?.[0]?.message?.content || data.output_text || 'Aucune analyse reçue.'
}

export async function imageGeneration(config, prompt) {
  requireAi(config)
  const data = await fetchJson(`${config.ai.baseUrl}/images/generations`, {
    method: 'POST',
    headers: headers(config),
    timeout: 120_000,
    body: JSON.stringify({ model: config.ai.imageModel, prompt, size: '1024x1024', n: 1 })
  })
  const first = data.data?.[0]
  if (first?.b64_json) return Buffer.from(first.b64_json, 'base64')
  if (first?.url) return (await fetchExternalBuffer(first.url, { maxBytes: 20 * 1024 * 1024 })).buffer
  throw new Error('Le fournisseur IA n’a renvoyé aucune image')
}
