const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

export function decodeHtmlEntities(value = '') {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase()
    if (!key.startsWith('#')) return ENTITIES[key] ?? match
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10)
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : match
  })
}

// Les API sociales mêlent souvent échappements JSON et entités HTML dans
// leurs URL CDN (\\u0026, \\/, &#x2F;, &amp;…). Ne jamais utiliser eval pour les décoder.
export function decodeMediaUrl(value = '') {
  let url = String(value)
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, '/')
  for (let pass = 0; pass < 2; pass += 1) url = decodeHtmlEntities(url)
  return url.trim()
}
