import test from 'node:test'
import assert from 'node:assert/strict'
import groupCommands from '../src/commands/group.js'

const admin = '242060000001@s.whatsapp.net'
const bot = '242060000002@s.whatsapp.net'
const owner = '242041029122@s.whatsapp.net'
const groupOwner = '242060000003@s.whatsapp.net'
const memberOne = '242060000004@s.whatsapp.net'
const memberTwo = '242060000005@s.whatsapp.net'

test('kickall demande confirmation et retire uniquement les membres ordinaires', async () => {
  const command = groupCommands.find(item => item.name === 'kickall')
  const outputs = []
  const actions = []
  const context = {
    text: '',
    from: '123@g.us',
    sender: admin,
    senderAlt: '',
    runtime: { prefix: '.' },
    config: { ownerNumber: '242041029122' },
    sock: {
      user: { id: bot },
      async groupParticipantsUpdate(group, members, action) { actions.push({ group, members, action }) }
    },
    async metadata() {
      return {
        participants: [
          { id: groupOwner, admin: 'superadmin' },
          { id: admin, admin: 'admin' },
          { id: bot, admin: null },
          { id: owner, admin: null },
          { id: memberOne, admin: null },
          { id: memberTwo, admin: null }
        ]
      }
    },
    async reply(text) { outputs.push(text) }
  }

  await command.run(context)
  assert.equal(actions.length, 0)
  assert.match(outputs[0], /2 membre\(s\)/)
  assert.match(outputs[0], /.kickall CONFIRMER/)

  context.text = 'CONFIRMER'
  await command.run(context)
  assert.deepEqual(actions, [{
    group: '123@g.us',
    members: [memberOne, memberTwo],
    action: 'remove'
  }])
  assert.match(outputs.at(-1), /2 membre\(s\).*retiré/s)
})
