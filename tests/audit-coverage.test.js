import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { CommandRegistry } from '../src/core/registry.js'

const SIMULATED = `
add antilink approve automod ban banlist close demote desc disappearing goodbye groupinfo hidetag kick kickall leave link open promote reject rename requests revoke tagall unban welcome fullgpp
ai imagine vision
alive botinfo help id menu owner ping poll uptime calc flip choose love
anticall autolike autoread autoview block botsessions create join mode pair pairbot prefix private public restart safety setbio settings sudo unblock unpairbot
blocklist del delword fullpp getpp location mygroups onwa privacy removedp save whois
sticker toimg tomp3 trim
`.trim().split(/\s+/)

const LIVE = `
advice joke
bible define github images lyrics npm nsfw videos weather translate exchange
alldl dlstatus facebook fetchurl gitclone instagram play tiktok twitter ytmp4 yts
anime husbando kitsune neko waifu stickers
livre wiki hn stackoverflow crypto
`.trim().split(/\s+/)

test('le plan d’audit couvre les 115 commandes du registre', async () => {
  const registry = await new CommandRegistry({ info() {} }).load(path.resolve('src/commands'))
  const expected = registry.all().map(command => command.name).sort()
  const covered = [...new Set([...SIMULATED, ...LIVE])].sort()
  assert.equal(expected.length, 115)
  assert.deepEqual(covered, expected)
})
