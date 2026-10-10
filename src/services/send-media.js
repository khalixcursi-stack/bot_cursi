import { UserError } from '../core/errors.js'

// Envoi groupé d'images : chaque photo part dans WhatsApp avec sa propre
// légende (source, licence…) et une position « n/total » quand il y en a
// plusieurs. Aucun lien texte n'est envoyé à la place du média.
export async function sendMultipleImages(ctx, files_with_captions, { delayMs = 350 } = {}) {
  const items = (Array.isArray(files_with_captions) ? files_with_captions : [])
    .filter(item => item?.buffer && Buffer.isBuffer(item.buffer))
  if (!items.length) throw new UserError('Aucune image valide à envoyer.')

  const total = items.length
  const sent = []
  for (const [index, item] of items.entries()) {
    const caption = [
      String(item.caption || '').trim(),
      total > 1 ? `📷 ${index + 1}/${total}` : ''
    ].filter(Boolean).join('\n')
    await ctx.send({
      image: item.buffer,
      mimetype: item.mimetype || 'image/jpeg',
      caption
    })
    sent.push(item)
    if (index < total - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  return sent
}
