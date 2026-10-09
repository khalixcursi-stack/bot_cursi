import test from 'node:test'
import assert from 'node:assert/strict'
import { calculate } from '../src/utils/math.js'

test('respecte la priorité des opérateurs', () => {
  assert.equal(calculate('2 + 3 * 4'), 14)
  assert.equal(calculate('(2 + 3) * 4'), 20)
})

test('gère puissance, modulo et négatifs', () => {
  assert.equal(calculate('2^3'), 8)
  assert.equal(calculate('10 % 4'), 2)
  assert.equal(calculate('-5 + 2'), -3)
})

test('refuse le code et les expressions invalides', () => {
  assert.throws(() => calculate('process.exit()'))
  assert.throws(() => calculate('2 +'))
  assert.throws(() => calculate('1 / 0'))
})
