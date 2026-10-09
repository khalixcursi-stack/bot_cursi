import test from 'node:test'
import assert from 'node:assert/strict'
import { isTikTokLink, isTikTokUrl } from '../src/services/tiktok.js'

test('reconnaît uniquement les URL vidéo TikTok', () => {
  assert.equal(isTikTokUrl('https://www.tiktok.com/@blaqbonez/video/7661265253874896148'), true)
  assert.equal(isTikTokUrl('https://www.tiktok.com/@blaqbonez'), false)
  assert.equal(isTikTokLink('https://vm.tiktok.com/ABC123/'), true)
  assert.equal(isTikTokUrl('https://example.com/@blaqbonez/video/7661265253874896148'), false)
})
