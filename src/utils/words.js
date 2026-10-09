function normalized(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase('fr').trim()
}

export function normalizeBlockedWord(value = '') {
  const word = normalized(value)
  if (!word || word.length > 30 || !/^[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*$/u.test(word)) return ''
  return word
}

export function wordsOf(text = '') {
  return (normalized(text).match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) || [])
    .map(normalizeBlockedWord)
    .filter(Boolean)
}

export function findBlockedWord(text, blockedWords = []) {
  const tokens = new Set(wordsOf(text))
  return blockedWords.map(normalizeBlockedWord).find(word => word && tokens.has(word)) || ''
}
