import fs from 'node:fs/promises'
import path from 'node:path'
import { CommandRegistry } from '../src/core/registry.js'
import { validateConfig } from '../src/config.js'

const root = process.cwd()
const logger = { info() {} }
const registry = await new CommandRegistry(logger).load(path.join(root, 'src', 'commands'))
const files = []

async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(full)
    else if (entry.name.endsWith('.js')) files.push(full)
  }
}
await walk(path.join(root, 'src'))

const forbidden = [
  [/\beval\s*\(/, 'eval dynamique'],
  [/new\s+Function\s*\(/, 'Function dynamique'],
  [/\bexec(?:Sync)?\s*\(/, 'commande shell'],
  [/SESSION\s*=\s*['"][A-Za-z0-9+/=]{100,}/, 'session intégrée']
]
const findings = []
for (const file of files) {
  const content = await fs.readFile(file, 'utf8')
  for (const [pattern, label] of forbidden) {
    if (pattern.test(content)) findings.push(`${path.relative(root, file)} : ${label}`)
  }
}

if (findings.length) {
  console.error('Contrôle de sécurité échoué :\n' + findings.map(item => `- ${item}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`✓ ${registry.all().length} commandes valides`)
  console.log(`✓ ${files.length} fichiers JavaScript contrôlés`)
  console.log('✓ Aucun eval/exec/session intégrée détecté')
}
for (const warning of validateConfig()) console.log(`ℹ ${warning}`)
