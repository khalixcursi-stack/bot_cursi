import { chatCompletion, imageGeneration, visionCompletion } from '../services/ai.js'

export default [
  {
    name: 'ai', aliases: ['gpt', 'gemini', 'ask'], category: 'IA', usage: '<question>',
    description: 'Interroge un fournisseur compatible OpenAI.', cooldown: 8,
    async run(ctx) {
      if (!ctx.text) throw new Error('Posez une question')
      const answer = await chatCompletion(ctx.config, ctx.text.slice(0, 6000))
      await ctx.reply(`🧠 *${ctx.config.botName} AI*\n\n${answer.slice(0, 3900)}`)
    }
  },
  {
    name: 'vision', aliases: ['describe', 'analyze'], category: 'IA', usage: '[question]',
    description: 'Analyse l’image citée avec un modèle multimodal.', cooldown: 12,
    async run(ctx) {
      const media = await ctx.downloadMedia()
      if (media.kind !== 'image') throw new Error('Répondez à une image')
      if (media.buffer.length > 15 * 1024 * 1024) throw new Error('Image trop volumineuse')
      const answer = await visionCompletion(ctx.config, ctx.text, media.buffer, media.mime || 'image/jpeg')
      await ctx.reply(`👁️ *Analyse*\n\n${answer.slice(0, 3900)}`)
    }
  },
  {
    name: 'imagine', aliases: ['draw', 'generate'], category: 'IA', usage: '<description>',
    description: 'Génère une image via le fournisseur IA configuré.', cooldown: 20,
    async run(ctx) {
      if (!ctx.text) throw new Error('Décrivez l’image à créer')
      const buffer = await imageGeneration(ctx.config, ctx.text.slice(0, 2000))
      await ctx.send({ image: buffer, caption: `🎨 ${ctx.text.slice(0, 500)}` }, { quoted: ctx.msg })
    }
  }
]
