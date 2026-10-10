import { UserError, asUserError } from '../core/errors.js'
import { fetchExternalBuffer } from '../services/http.js'
import { quickReplyButton, sendInteractiveTextCard } from '../services/interactive.js'
import {
  catFact,
  countryInfo,
  cryptoPrice,
  dogImageUrl,
  nameInfo,
  normalizeWikipediaLang,
  numberFact,
  picsumUrl,
  pokemonInfo,
  pokemonTypeNameFr,
  randomQuote,
  rickMortyCharacter,
  triviaQuestion,
  wikipediaSummary,
  xkcd
} from '../services/more-apis.js'
import { truncate } from '../utils/format.js'

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 7 })

function formatPrice(value, currency) {
  return Number.isFinite(value) ? `${NUMBER.format(value)} ${currency}` : 'indisponible'
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)} %` : 'inconnu'
}

function formatCount(value) {
  return Number.isFinite(value) ? NUMBER.format(value) : 'inconnu'
}

// Télécharge une image et l’envoie TOUJOURS comme média WhatsApp : jamais de
// lien texte à la place de la photo. Si le téléchargement échoue, la commande
// propage une erreur claire (ou un repli texte pour .wiki uniquement).
async function sendImageBuffer(ctx, url, caption, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const file = await fetchExternalBuffer(url, {
    maxBytes: Math.min(ctx.config.maxDownloadBytes, maxBytes),
    timeout: 45_000
  })
  if (!file.contentType.startsWith('image/') || file.contentType === 'image/svg+xml') {
    throw new UserError('La ressource trouvée n’est pas une image exploitable.')
  }
  return ctx.send({ image: file.buffer, mimetype: file.contentType, caption })
}

const COIN_ALIASES = {
  btc: 'bitcoin', xbt: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  bnb: 'binancecoin', binance: 'binancecoin',
  doge: 'dogecoin', shib: 'shiba-inu',
  ada: 'cardano', xrp: 'ripple', avax: 'avalanche-2',
  dot: 'polkadot', matic: 'matic-network', pol: 'polygon-ecosystem-token',
  ltc: 'litecoin', trx: 'tron', link: 'chainlink', ton: 'the-open-network',
  atom: 'cosmos', xlm: 'stellar', near: 'near', algo: 'algorand',
  usdt: 'tether', usdc: 'usd-coin', dai: 'dai'
}
const COIN_LABELS = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB',
  dogecoin: 'DOGE', cardano: 'ADA', ripple: 'XRP', litecoin: 'LTC'
}

const pendingTrivia = new Map()

function shuffle(items) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

export default [
  {
    name: 'wiki', aliases: ['wikipedia', 'wp'], category: 'Recherche', usage: '[langue] <terme>',
    description: 'Résumé Wikipédia (10 langues) avec l’image de l’article envoyée directement.', cooldown: 5,
    async run(ctx) {
      const parts = String(ctx.text || '').trim().split(/\s+/).filter(Boolean)
      if (!parts.length) throw new UserError(`Indique un terme, par exemple : ${ctx.runtime.prefix}wiki Brazzaville`)
      let lang = 'fr'
      if (parts.length > 1 && normalizeWikipediaLang(parts[0])) {
        lang = normalizeWikipediaLang(parts.shift())
      }
      const query = parts.join(' ')
      const summary = await wikipediaSummary(query, lang)

      const header = [`📚 *${truncate(summary.title, 160)}*`]
      if (summary.description) header.push(`_${truncate(summary.description, 200)}_`)
      const body = truncate(summary.extract || 'Résumé indisponible.', 900)
      const caption = [header.join('\n'), body, `🔗 ${summary.url}`].join('\n\n')

      if (summary.image) {
        try {
          await sendImageBuffer(ctx, summary.image, truncate(caption, 1000))
          return
        } catch (error) {
          ctx.logger.warn({ err: error }, 'Image Wikipédia indisponible; envoi du résumé en texte')
        }
      }
      await ctx.reply(caption)
    }
  },
  {
    name: 'fact', aliases: ['catfact', 'chats'], category: 'Fun',
    description: 'Un fait insolite sur les chats.', cooldown: 3,
    async run(ctx) {
      const fact = await catFact()
      await ctx.reply(`🐱 *Le savais-tu ?*\n${fact}`)
    }
  },
  {
    name: 'dog', aliases: ['dogpic', 'chien'], category: 'Fun',
    description: 'Envoie directement une photo de chien aléatoire.', cooldown: 5,
    async run(ctx) {
      let lastError
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const url = await dogImageUrl()
          await sendImageBuffer(ctx, url, '🐶 *Photo de chien*\nSource : dog.ceo')
          return
        } catch (error) {
          lastError = error
          ctx.logger.warn({ err: error }, 'Photo de chien ignorée; nouvel essai')
        }
      }
      throw asUserError(lastError, 'Aucune photo de chien disponible pour le moment')
    }
  },
  {
    name: 'quote', aliases: ['citation'], category: 'Fun',
    description: 'Une citation aléatoire.', cooldown: 3,
    async run(ctx) {
      const { quote, author } = await randomQuote()
      await ctx.reply(`💬 *Citation*\n« ${truncate(quote, 400)} »\n— ${author}`)
    }
  },
  {
    name: 'crypto', aliases: ['btc', 'bitcoin', 'eth', 'cours', 'cryptocours'], category: 'Finance', usage: '[crypto,...]',
    description: 'Cours des cryptomonnaies en USD/EUR (défaut : BTC, ETH, SOL, BNB).', cooldown: 5,
    async run(ctx) {
      const requested = String(ctx.text || '').split(/[\s,]+/).map(value => value.trim().toLowerCase()).filter(Boolean)
      const ids = (requested.length ? requested : ['bitcoin', 'ethereum', 'solana', 'binancecoin'])
        .map(token => COIN_ALIASES[token] || token)
        .slice(0, 8)
      const prices = await cryptoPrice(ids)

      const lines = ids.map(id => {
        const data = prices[id]
        const label = COIN_LABELS[id] || id
        if (!data) return `🪙 *${label}* — cours indisponible`
        const change = Number.isFinite(data.usd_24h_change)
          ? `${data.usd_24h_change >= 0 ? '+' : ''}${data.usd_24h_change.toFixed(2)} % (24 h)`
          : 'variation indisponible'
        return [
          `🪙 *${label}*`,
          `💵 ${formatPrice(data.usd, 'USD')}`,
          `💶 ${formatPrice(data.eur, 'EUR')}`,
          `📈 ${change}`
        ].join('\n')
      })
      await ctx.reply([...lines, '', 'Source : CoinGecko'].join('\n'))
    }
  },
  {
    name: 'pokemon', aliases: ['pkmn'], category: 'Recherche', usage: '<nom ou #numéro>',
    description: 'Fiche Pokémon avec l’artwork officiel envoyé directement.', cooldown: 5,
    async run(ctx) {
      const query = String(ctx.text || '').trim()
      if (!query) throw new UserError(`Indique un Pokémon, par exemple : ${ctx.runtime.prefix}pokemon pikachu`)
      const pokemon = await pokemonInfo(query)
      const displayName = pokemon.nameFr ? `${pokemon.nameFr} (${pokemon.name})` : pokemon.name
      const caption = [
        `🐾 *${truncate(displayName, 120)}* — #${String(pokemon.id).padStart(3, '0')}`,
        pokemon.genusFr ? `🧬 ${pokemon.genusFr}` : '',
        `🧩 Type : ${pokemon.types.map(pokemonTypeNameFr).join(', ') || 'inconnu'}`,
        `📏 Taille : ${String(pokemon.height / 10).replace('.', ',')} m · ⚖️ Poids : ${String(pokemon.weight / 10).replace('.', ',')} kg`,
        `✨ Talents : ${pokemon.abilities.join(', ') || 'inconnus'}`
      ].filter(Boolean).join('\n')

      if (pokemon.image) {
        try {
          await sendImageBuffer(ctx, pokemon.image, caption)
          return
        } catch (error) {
          ctx.logger.warn({ err: error }, 'Artwork Pokémon indisponible; nouvel essai')
        }
      }
      throw new UserError('L’artwork de ce Pokémon n’a pas pu être téléchargé.')
    }
  },
  {
    name: 'country', aliases: ['pays'], category: 'Recherche', usage: '<pays>',
    description: 'Infos pays avec le drapeau envoyé directement.', cooldown: 5,
    async run(ctx) {
      const query = String(ctx.text || '').trim()
      if (!query) throw new UserError(`Indique un pays, par exemple : ${ctx.runtime.prefix}country Congo`)
      const country = await countryInfo(query)
      const caption = [
        `🌍 *${truncate(country.name, 120)}*${country.officialName && country.officialName !== country.name ? ` — ${truncate(country.officialName, 120)}` : ''}`,
        `🏛️ Capitale : ${country.capital || 'inconnue'}`,
        `👥 Population : ${formatCount(country.population)}`,
        `💱 Devise : ${country.currencies.join(', ') || 'inconnue'}`,
        `🗣️ Langue(s) : ${country.languages.join(', ') || 'inconnue(s)'}`
      ].join('\n')

      // Les drapeaux SVG ne sont pas acceptés par WhatsApp : PNG uniquement.
      if (country.flag && !/\.svg(\?|$)/i.test(country.flag)) {
        try {
          await sendImageBuffer(ctx, country.flag, caption)
          return
        } catch (error) {
          ctx.logger.warn({ err: error }, 'Drapeau indisponible; nouvel essai')
        }
      }
      await ctx.reply(caption)
    }
  },
  {
    name: 'xkcd', category: 'Fun', usage: '[numéro|random]',
    description: 'Un comic XKCD (dernier par défaut) envoyé comme image.', cooldown: 5,
    async run(ctx) {
      const comic = await xkcd(ctx.text)
      await ctx.send({
        image: comic.buffer,
        mimetype: comic.contentType,
        caption: [
          `*XKCD ${comic.num} — ${truncate(comic.title, 120)}*`,
          comic.alt ? `_${truncate(comic.alt, 300)}_` : '',
          `🔗 https://xkcd.com/${comic.num}/`
        ].filter(Boolean).join('\n')
      })
    }
  },
  {
    name: 'trivia', aliases: ['quiz'], category: 'Fun',
    description: 'Question de culture générale avec réponses numérotées cliquables.', cooldown: 2,
    async run(ctx) {
      const answer = String(ctx.text || '').trim()
      const pending = pendingTrivia.get(ctx.from)

      if (pending && /^[1-4]$/.test(answer)) {
        pendingTrivia.delete(ctx.from)
        const picked = pending.options[Number(answer) - 1]
        if (picked?.correct) {
          await ctx.reply(`✅ *Bonne réponse !* ${picked.text}\n_${pending.question}_`)
        } else {
          await ctx.reply(`❌ *Mauvaise réponse.* La bonne réponse était : *${pending.correctText}*`)
        }
        return
      }

      const data = await triviaQuestion()
      const options = shuffle([
        { text: data.correct, correct: true },
        ...data.incorrect.map(text => ({ text, correct: false }))
      ]).slice(0, 4)

      pendingTrivia.set(ctx.from, {
        question: data.question,
        options,
        correctText: data.correct
      })
      if (pendingTrivia.size > 200) {
        const oldest = pendingTrivia.keys().next().value
        pendingTrivia.delete(oldest)
      }

      const text = [
        `🎲 *Quiz — ${truncate(data.category, 80)}*${data.difficulty ? ` · ${data.difficulty}` : ''}`,
        '',
        truncate(data.question, 400),
        '',
        ...options.map((option, index) => `*${index + 1}.* ${truncate(option.text, 120)}`),
        '',
        `_(Réponds avec un bouton ou ${ctx.runtime.prefix}trivia <numéro>)_`
      ].join('\n')

      try {
        await sendInteractiveTextCard(ctx, {
          text,
          footer: 'Réponds avec les boutons ci-dessous',
          buttons: options.map((option, index) =>
            quickReplyButton(`${index + 1}. ${truncate(option.text, 20)}`, `${ctx.runtime.prefix}trivia ${index + 1}`)
          )
        })
      } catch (error) {
        ctx.logger.warn({ err: error }, 'Boutons quiz indisponibles; envoi du menu numéroté en texte')
        await ctx.reply(text)
      }
    }
  },
  {
    name: 'number', aliases: ['chiffre'], category: 'Fun', usage: '<nombre>',
    description: 'Un fait insolite sur un nombre.', cooldown: 3,
    async run(ctx) {
      const value = String(ctx.text || '').trim()
      if (!value) throw new UserError(`Indique un nombre, par exemple : ${ctx.runtime.prefix}number 42`)
      const { number, fact } = await numberFact(value)
      await ctx.reply(`🔢 *Le nombre ${number}*\n${fact}`)
    }
  },
  {
    name: 'nameguess', aliases: ['name'], category: 'Fun', usage: '<prénom>',
    description: 'Devine l’âge, le genre et la nationalité d’un prénom.', cooldown: 4,
    async run(ctx) {
      const name = String(ctx.text || '').trim()
      if (!name) throw new UserError(`Indique un prénom, par exemple : ${ctx.runtime.prefix}nameguess Marie`)
      const info = await nameInfo(name)
      const genderFr = info.gender === 'male' ? 'homme' : info.gender === 'female' ? 'femme' : 'inconnu'
      const nationalities = info.nationalities.length
        ? info.nationalities.map(item => `${item.country} (${formatPercent(item.probability)})`).join(' · ')
        : 'inconnue'
      await ctx.reply([
        `🔮 *Prédictions pour ${truncate(info.name, 60)}*`,
        `🎂 Âge estimé : ${info.age != null ? `${info.age} ans` : 'inconnu'}`,
        `⚧ Genre : ${genderFr}${info.genderProbability != null ? ` (${formatPercent(info.genderProbability)})` : ''}`,
        `🌍 Nationalité probable : ${nationalities}`
      ].join('\n'))
    }
  },
  {
    name: 'picsum', aliases: ['randompic'], category: 'Fun', usage: '[largeur] [hauteur]',
    description: 'Une photo aléatoire Picsum envoyée directement.', cooldown: 5,
    async run(ctx) {
      const [width, height] = String(ctx.text || '').split(/\s+/).map(value => Number.parseInt(value, 10))
      const url = picsumUrl(width, height)
      await sendImageBuffer(ctx, url, '📷 *Photo aléatoire*\nSource : Picsum')
    }
  },
  {
    name: 'rickmorty', aliases: ['ram'], category: 'Recherche', usage: '[id]',
    description: 'Fiche d’un personnage Rick & Morty avec sa photo envoyée directement.', cooldown: 5,
    async run(ctx) {
      const character = await rickMortyCharacter(ctx.text)
      const caption = [
        `🧪 *${truncate(character.name, 120)}*`,
        `🧟 Statut : ${character.status || 'inconnu'} · Espèce : ${character.species || 'inconnue'}`,
        `⚧ Genre : ${character.gender || 'inconnu'}`,
        `🌍 Origine : ${truncate(character.origin, 80)}`,
        `📍 Localisation : ${truncate(character.location, 80)}`,
        character.episodeCount ? `🎬 Épisodes : ${character.episodeCount}` : ''
      ].filter(Boolean).join('\n')

      if (character.image) {
        await sendImageBuffer(ctx, character.image, caption)
        return
      }
      await ctx.reply(caption)
    }
  }
]
