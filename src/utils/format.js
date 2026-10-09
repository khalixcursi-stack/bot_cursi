export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [days && `${days}j`, hours && `${hours}h`, minutes && `${minutes}m`, `${rest}s`].filter(Boolean).join(' ')
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

export function truncate(value, max = 3500) {
  const text = String(value ?? '')
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function commandUsage(command, prefix) {
  return `${prefix}${command.name}${command.usage ? ` ${command.usage}` : ''}`
}

export function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)]
}
