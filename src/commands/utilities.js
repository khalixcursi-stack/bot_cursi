import { UserError } from '../core/errors.js'
import { fetchJson } from '../services/http.js'
import { fetchLyrics, translateText } from '../services/more-apis.js'
import { extractText } from '../core/message.js'
import { truncate } from '../utils/format.js'

const WEATHER = {
  0: 'Ciel dégagé', 1: 'Globalement dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant', 51: 'Bruine légère', 53: 'Bruine', 55: 'Forte bruine',
  61: 'Pluie légère', 63: 'Pluie', 65: 'Forte pluie', 71: 'Neige légère', 73: 'Neige', 75: 'Forte neige',
  80: 'Averses légères', 81: 'Averses', 82: 'Fortes averses', 95: 'Orage', 96: 'Orage avec grêle', 99: 'Fort orage avec grêle'
}

export default [
  {
    name: 'weather', aliases: ['meteo', 'climate'], category: 'Recherche', usage: '<ville>',
    description: 'Affiche la météo actuelle avec Open-Meteo.', cooldown: 4,
    async run(ctx) {
      if (!ctx.text) throw new Error('Indiquez une ville')
      const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ctx.text)}&count=1&language=fr&format=json`)
      const place = geo.results?.[0]
      if (!place) throw new Error('Ville introuvable')
      // Construction par URLSearchParams : garantit `&current=` (et non `¤t=`)
      // quoi qu’il arrive aux entités HTML dans l’URL.
      const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
      forecastUrl.searchParams.set('latitude', place.latitude)
      forecastUrl.searchParams.set('longitude', place.longitude)
      forecastUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m')
      forecastUrl.searchParams.set('timezone', 'auto')
      const forecast = await fetchJson(forecastUrl.toString())
      const current = forecast.current
      await ctx.reply([
        `🌦️ *Météo — ${place.name}, ${place.country || ''}*`,
        `${WEATHER[current.weather_code] || 'Conditions inconnues'}`,
        `🌡️ ${current.temperature_2m} °C (ressenti ${current.apparent_temperature} °C)`,
        `💧 Humidité : ${current.relative_humidity_2m}%`,
        `💨 Vent : ${current.wind_speed_10m} km/h`
      ].join('\n'))
    }
  },
  {
    name: 'translate', aliases: ['trt', 'trad'], category: 'Outils', usage: '<langue> <texte>',
    description: 'Traduit un texte ou le message cité (plusieurs services en repli).', cooldown: 3,
    async run(ctx) {
      const [target = 'fr', ...rest] = ctx.args
      const quotedText = ctx.quoted ? extractText(ctx.quoted.message) : ''
      const text = rest.join(' ') || quotedText
      if (!text) throw new Error('Exemple : .translate en Bonjour le monde')
      const { text: translated, provider } = await translateText(text, target)
      if (!translated) throw new Error('Traduction indisponible')
      await ctx.reply(`🌍 *Traduction (${target})*\n${translated}\n\n_Service : ${provider}_`)
    }
  },
  {
    name: 'github', aliases: ['gh'], category: 'Recherche', usage: '<utilisateur>',
    description: 'Affiche un profil GitHub.', cooldown: 3,
    async run(ctx) {
      const username = ctx.text.replace(/^@/, '').trim()
      if (!username) throw new Error('Indiquez un nom GitHub')
      const user = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`)
      await ctx.reply([
        `🐙 *${user.name || user.login}* (@${user.login})`,
        user.bio || 'Aucune bio',
        `📦 Dépôts : ${user.public_repos}`,
        `👥 Abonnés : ${user.followers} · Abonnements : ${user.following}`,
        `📍 ${user.location || 'Non renseigné'}`,
        user.html_url
      ].join('\n'))
    }
  },
  {
    name: 'npm', aliases: ['package'], category: 'Recherche', usage: '<paquet>',
    description: 'Recherche un paquet npm.', cooldown: 3,
    async run(ctx) {
      const name = ctx.text.trim()
      if (!name) throw new Error('Indiquez un nom de paquet')
      const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
      await ctx.reply([
        `📦 *${data.name}@${data.version}*`,
        truncate(data.description || 'Aucune description', 500),
        `Licence : ${data.license || 'inconnue'}`,
        data.homepage || data.repository?.url || `https://www.npmjs.com/package/${encodeURIComponent(name)}`
      ].join('\n'))
    }
  },
  {
    name: 'lyrics', aliases: ['paroles'], category: 'Recherche', usage: '<artiste> | <titre>',
    description: 'Recherche les paroles d’une chanson (lrclib.net puis lyrics.ovh).', cooldown: 5,
    async run(ctx) {
      const [artist, title] = ctx.text.split('|').map(value => value.trim())
      if (!artist || !title) throw new Error('Format : artiste | titre')
      const { lyrics, provider } = await fetchLyrics(artist, title)
      await ctx.reply(`🎵 *${artist} — ${title}*\n\n${truncate(lyrics || 'Paroles introuvables', 3800)}\n\n_Service : ${provider}_`)
    }
  },
  {
    name: 'define', aliases: ['definition'], category: 'Recherche', usage: '<mot>',
    description: 'Cherche la définition d’un mot (dictionnaire anglais, puis Wiktionnaire français).', cooldown: 3,
    async run(ctx) {
      const word = ctx.text.trim()
      if (!word) throw new Error('Indiquez un mot')
      let data = null
      try {
        data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      } catch {
        // Repli Wiktionnaire français ci-dessous.
      }
      const entry = data?.[0]
      const meanings = entry?.meanings?.slice(0, 3).map(item => `• *${item.partOfSpeech}* : ${item.definitions?.[0]?.definition}`).join('\n')
      if (meanings) {
        await ctx.reply(`📖 *${entry.word}*\n${meanings}`)
        return
      }
      try {
        const summary = await fetchJson(`https://fr.wiktionary.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`)
        const extract = truncate(summary?.extract || '', 1200)
        if (extract) {
          await ctx.reply(`📖 *${summary.title || word}* — Wiktionnaire FR\n${extract}`)
          return
        }
      } catch {
        // Aucun dictionnaire disponible : message d’erreur utilisateur ci-dessous.
      }
      throw new UserError(`Définition introuvable pour « ${truncate(word, 60)} ».`)
    }
  },
  {
    name: 'exchange', aliases: ['currency', 'rate'], category: 'Finance', usage: '<montant> <DEVISE> <DEVISE>',
    description: 'Convertit un montant entre deux devises.', cooldown: 3,
    async run(ctx) {
      const [rawAmount, from, to] = ctx.args
      const amount = Number(rawAmount)
      if (!Number.isFinite(amount) || !from || !to) throw new Error('Exemple : .exchange 100 EUR XAF')
      const source = from.toUpperCase()
      const target = to.toUpperCase()
      let converted
      try {
        const data = await fetchJson(`https://api.frankfurter.app/latest?amount=${amount}&from=${encodeURIComponent(source)}&to=${encodeURIComponent(target)}`)
        converted = data.rates?.[target]
      } catch {
        // Frankfurter ne couvre pas certaines devises locales comme le XAF.
      }
      if (!Number.isFinite(converted)) {
        const fallback = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(source)}`)
        const rate = fallback.rates?.[target]
        if (Number.isFinite(rate)) converted = amount * rate
      }
      if (!Number.isFinite(converted)) throw new Error('Devises non prises en charge')
      await ctx.reply(`💱 *${amount} ${source} = ${Number(converted.toFixed(4))} ${target}*`)
    }
  },
  {
    name: 'bible', aliases: ['verse'], category: 'Recherche', usage: '<référence>',
    description: 'Recherche un passage biblique.', cooldown: 3,
    async run(ctx) {
      if (!ctx.text) throw new Error('Exemple : .bible John 3:16')
      const data = await fetchJson(`https://bible-api.com/${encodeURIComponent(ctx.text)}?translation=web`)
      await ctx.reply(`📜 *${data.reference || ctx.text}*\n${truncate(data.text?.trim() || 'Passage introuvable', 3800)}`)
    }
  }
]
