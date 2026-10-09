const OPERATORS = {
  '+': { precedence: 1, assoc: 'L', args: 2, fn: (a, b) => a + b },
  '-': { precedence: 1, assoc: 'L', args: 2, fn: (a, b) => a - b },
  '*': { precedence: 2, assoc: 'L', args: 2, fn: (a, b) => a * b },
  '/': { precedence: 2, assoc: 'L', args: 2, fn: (a, b) => a / b },
  '%': { precedence: 2, assoc: 'L', args: 2, fn: (a, b) => a % b },
  '^': { precedence: 3, assoc: 'R', args: 2, fn: (a, b) => a ** b },
  'u-': { precedence: 4, assoc: 'R', args: 1, fn: a => -a }
}

function tokenize(expression) {
  const compact = String(expression).replace(/\s+/g, '').replace(/,/g, '.')
  if (!compact || compact.length > 200) throw new Error('Expression vide ou trop longue')
  const tokens = compact.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%^]/g)
  if (!tokens || tokens.join('') !== compact) throw new Error('Caractère non autorisé')
  return tokens
}

export function calculate(expression) {
  const output = []
  const stack = []
  let previous = 'start'

  for (const token of tokenize(expression)) {
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      output.push(Number(token))
      previous = 'number'
      continue
    }
    if (token === '(') {
      stack.push(token)
      previous = 'left'
      continue
    }
    if (token === ')') {
      while (stack.length && stack.at(-1) !== '(') output.push(stack.pop())
      if (stack.pop() !== '(') throw new Error('Parenthèses incorrectes')
      previous = 'right'
      continue
    }

    const key = token === '-' && ['start', 'operator', 'left'].includes(previous) ? 'u-' : token
    const operator = OPERATORS[key]
    if (!operator) throw new Error('Opérateur inconnu')
    while (stack.length && OPERATORS[stack.at(-1)]) {
      const top = OPERATORS[stack.at(-1)]
      const shouldPop = operator.assoc === 'L'
        ? operator.precedence <= top.precedence
        : operator.precedence < top.precedence
      if (!shouldPop) break
      output.push(stack.pop())
    }
    stack.push(key)
    previous = 'operator'
  }

  while (stack.length) {
    const token = stack.pop()
    if (token === '(') throw new Error('Parenthèses incorrectes')
    output.push(token)
  }

  const values = []
  for (const token of output) {
    if (typeof token === 'number') {
      values.push(token)
      continue
    }
    const operator = OPERATORS[token]
    if (values.length < operator.args) throw new Error('Expression invalide')
    const args = values.splice(-operator.args)
    const result = operator.fn(...args)
    if (!Number.isFinite(result)) throw new Error('Résultat non fini')
    values.push(result)
  }
  if (values.length !== 1) throw new Error('Expression invalide')
  return values[0]
}
