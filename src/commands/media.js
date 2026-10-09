import sharp from 'sharp'
import { mediaToMp3, trimMedia, videoToSticker } from '../services/ffmpeg.js'

export default [
  {
    name: 'sticker', aliases: ['s'], category: 'Stickers',
    description: 'Convertit une image ou une courte vidéo en sticker.', cooldown: 5,
    async run(ctx) {
      const media = await ctx.downloadMedia()
      let sticker
      if (media.kind === 'image') {
        sticker = await sharp(media.buffer, { animated: true })
          .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 82 })
          .toBuffer()
      } else if (media.kind === 'video') {
        sticker = await videoToSticker(media.buffer, media.extension)
      } else {
        throw new Error('Répondez à une image ou une vidéo')
      }
      await ctx.send({ sticker }, { quoted: ctx.msg })
    }
  },
  {
    name: 'toimg', aliases: ['photo'], category: 'Stickers',
    description: 'Convertit un sticker statique en image PNG.', cooldown: 4,
    async run(ctx) {
      const media = await ctx.downloadMedia()
      if (media.kind !== 'sticker') throw new Error('Répondez à un sticker')
      const image = await sharp(media.buffer).png().toBuffer()
      await ctx.send({ image, caption: '🖼️ Sticker converti en image' }, { quoted: ctx.msg })
    }
  },
  {
    name: 'tomp3', aliases: ['toaudio', 'audio'], category: 'Média',
    description: 'Extrait l’audio d’une vidéo ou convertit un son en MP3.', cooldown: 7,
    async run(ctx) {
      const media = await ctx.downloadMedia()
      if (!['video', 'audio', 'document'].includes(media.kind)) throw new Error('Répondez à une vidéo ou un fichier audio')
      const audio = await mediaToMp3(media.buffer, media.extension)
      await ctx.send({ audio, mimetype: 'audio/mpeg', fileName: 'audio.mp3' }, { quoted: ctx.msg })
    }
  },
  {
    name: 'trim', aliases: ['cut'], category: 'Média', usage: '<début>-<fin>',
    description: 'Découpe le média cité entre deux temps en secondes.', cooldown: 8,
    async run(ctx) {
      const match = ctx.text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
      if (!match) throw new Error('Format : .trim 5-20')
      const start = Number(match[1])
      const end = Number(match[2])
      if (end <= start || end - start > 120) throw new Error('La fin doit suivre le début; durée maximale 120 secondes')
      const media = await ctx.downloadMedia()
      if (!['video', 'audio', 'document'].includes(media.kind)) throw new Error('Répondez à un média audio ou vidéo')
      const result = await trimMedia(media.buffer, media.extension, start, end - start)
      const isAudio = media.kind === 'audio'
      await ctx.send(isAudio
        ? { audio: result, mimetype: media.mime || 'audio/mpeg' }
        : { video: result, mimetype: media.mime || 'video/mp4', caption: `✂️ ${start}s → ${end}s` }, { quoted: ctx.msg })
    }
  },
  {
    name: 'fullpp', aliases: ['mypp', 'setpp'], category: 'WhatsApp', ownerOnly: true,
    description: 'Définit l’image citée comme photo de profil.', cooldown: 5,
    async run(ctx) {
      const media = await ctx.downloadMedia()
      if (media.kind !== 'image') throw new Error('Répondez à une image')
      const image = await sharp(media.buffer).resize(720, 720, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer()
      await ctx.sock.updateProfilePicture(ctx.sock.user.id, image)
      await ctx.reply('✅ Photo de profil mise à jour.')
    }
  },
  {
    name: 'fullgpp', aliases: ['gpp'], category: 'Groupe', groupOnly: true, adminOnly: true, botAdmin: true,
    description: 'Définit l’image citée comme photo du groupe.', cooldown: 5,
    async run(ctx) {
      const media = await ctx.downloadMedia()
      if (media.kind !== 'image') throw new Error('Répondez à une image')
      const image = await sharp(media.buffer).resize(720, 720, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer()
      await ctx.sock.updateProfilePicture(ctx.from, image)
      await ctx.reply('✅ Photo du groupe mise à jour.')
    }
  }
]
