import test from 'node:test'
import assert from 'node:assert/strict'
import groupCommands from '../src/commands/group.js'
import { Dispatcher } from '../src/core/dispatcher.js'
import {
  MAX_GROUP_BANS,
  addGroupBan,
  findGroupBan,
  removeGroupBan,
  splitBannedParticipants
} from '../src/services/group-bans.js'

const banned = '242060000001@s.whatsapp.net'

test('la liste de bannissement ajoute, reconnaît et retire un membre', () => {
  const list = addGroupBan([], banned)
  assert.deepEqual(list, [banned])
  assert.deepEqual(addGroupBan(list, '242060000001:12@s.whatsapp.net'), list)
  assert.equal(findGroupBan(list, { id: '242060000001:8@s.whatsapp.net' }), banned)
  assert.deepEqual(removeGroupBan(list, banned), [])

  const participants = [banned, '242060000002@s.whatsapp.net']
  assert.deepEqual(splitBannedParticipants(list, participants), {
    banned: [banned],
    allowed: ['242060000002@s.whatsapp.net']
  })
})

test('la liste de bannissement conserve une limite finie', () => {
  let list = []
  for (let index = 0; index < MAX_GROUP_BANS; index += 1) {
    list = addGroupBan(list, `24207${String(index).padStart(6, '0')}@s.whatsapp.net`)
  }
  assert.equal(list.length, MAX_GROUP_BANS)
  assert.throws(() => addGroupBan(list, '242099999999@s.whatsapp.net'), /limitée/)
})

test('la commande ban retire, persiste et protège le propriétaire principal', async () => {
  const settings = {}
  const actions = []
  const ban = groupCommands.find(command => command.name === 'ban')
  const context = {
    text: '242060000001',
    from: '123@g.us',
    sender: '242041029122@s.whatsapp.net',
    config: { ownerNumber: '242041029122' },
    runtime: { allowGroupAutomation: true },
    sock: {
      user: { id: '242099999999@s.whatsapp.net' },
      async groupParticipantsUpdate(group, members, action) { actions.push({ group, members, action }) }
    },
    store: {
      getGroup: () => settings,
      async updateGroup(_group, patch) { Object.assign(settings, patch) }
    },
    resolveTarget: () => banned,
    async metadata() { return { participants: [{ id: banned, admin: null }] } },
    async send(content) { actions.push(content) }
  }
  await ban.run(context)
  assert.deepEqual(settings.bannedMembers, [banned])
  assert.deepEqual(actions[0], { group: '123@g.us', members: [banned], action: 'remove' })

  await assert.rejects(() => ban.run({
    ...context,
    sender: '242060000002@s.whatsapp.net',
    resolveTarget: () => '242041029122@s.whatsapp.net'
  }), /protégé/)
})

test('le dispatcher retire automatiquement un membre banni qui écrit dans le groupe', async () => {
  const actions = []
  const dispatcher = new Dispatcher({
    sock: {
      async groupParticipantsUpdate(group, members, action) { actions.push({ group, members, action }) }
    },
    config: { ownerNumber: '242041029122' },
    runtime: { allowGroupAutomation: true },
    store: { getGroup: () => ({ bannedMembers: [banned] }) },
    registry: {}, safety: {},
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  })
  const outputs = []
  const context = {
    isGroup: true,
    from: '123@g.us',
    sender: banned,
    senderNumber: '242060000001',
    botAdmin: false,
    async loadGroupPermissions() { this.botAdmin = true },
    async send(content) { outputs.push(content) }
  }

  assert.equal(await dispatcher.enforceGroupBan(context), true)
  assert.deepEqual(actions, [{ group: '123@g.us', members: [banned], action: 'remove' }])
  assert.match(outputs[0].text, /banni du groupe/)
})
