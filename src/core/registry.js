import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export class CommandRegistry {
  constructor(logger) {
    this.logger = logger
    this.commands = new Map()
    this.aliases = new Map()
  }

  register(command, source = 'inconnu') {
    if (!command || typeof command !== 'object') throw new TypeError(`Commande invalide dans ${source}`)
    const name = String(command.name || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`Nom de commande invalide "${name}" dans ${source}`)
    if (typeof command.run !== 'function') throw new Error(`La commande ${name} ne possède pas de fonction run`)
    if (this.commands.has(name) || this.aliases.has(name)) throw new Error(`Commande dupliquée : ${name}`)

    const normalized = {
      aliases: [],
      category: 'Divers',
      description: 'Aucune description',
      usage: '',
      cooldown: 2,
      ownerOnly: false,
      groupOnly: false,
      adminOnly: false,
      botAdmin: false,
      ...command,
      name
    }
    this.commands.set(name, normalized)

    for (const rawAlias of normalized.aliases || []) {
      const alias = String(rawAlias).toLowerCase()
      if (!alias || this.commands.has(alias) || this.aliases.has(alias)) {
        throw new Error(`Alias dupliqué : ${alias} (${name})`)
      }
      this.aliases.set(alias, name)
    }
  }

  find(name = '') {
    const normalized = String(name).toLowerCase()
    return this.commands.get(this.aliases.get(normalized) || normalized)
  }

  all() {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  categories() {
    const grouped = new Map()
    for (const command of this.all()) {
      if (!grouped.has(command.category)) grouped.set(command.category, [])
      grouped.get(command.category).push(command)
    }
    return grouped
  }

  async load(directory) {
    const files = (await fs.readdir(directory)).filter(file => file.endsWith('.js')).sort()
    for (const file of files) {
      const module = await import(pathToFileURL(path.join(directory, file)).href)
      const commands = module.default || module.commands || []
      if (!Array.isArray(commands)) throw new Error(`${file} doit exporter un tableau de commandes`)
      for (const command of commands) this.register(command, file)
    }
    this.logger.info({ commands: this.commands.size, aliases: this.aliases.size }, 'Commandes chargées')
    return this
  }
}
