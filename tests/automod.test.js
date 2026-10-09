import test from 'node:test'
import assert from 'node:assert/strict'
import groupCommands from '../src/commands/group.js'
import { Dispatcher } from '../src/core/dispatcher.js'

const automod = groupCommands.find(command => command.name === 'automod')

function context({ settings = { antilink: 'delete', automod: true }, allowed = true, action = 'status' } = {}) {
  const replies = []
  return {
    from: '123@g.us',
    args: [action],
    text: action,
    runtime: { prefix: '.', allowGroupAutomation: allowed },
    store: {
      getGroup: () => settings,
      async updateGroup(_jid, patch) { Object.assign(settings, patch); return settings }
    },
    async reply(text) { replies.push(text) },
    replies,
    settings
  }
}

test('automod off suspend la modération sans effacer la règle enregistrée', async () => {
  const ctx = context({ action: 'off' })
  await automod.run(ctx)
  assert.equal(ctx.settings.automod, false)
  assert.equal(ctx.settings.antilink, 'delete')
  assert.match(ctx.replies[0], /quotas anti-rafale.*restent actifs/)
})

test('automod on restaure la règle et respecte la politique globale', async () => {
  const blocked = context({ settings: { antilink: 'warn', automod: false }, allowed: false, action: 'on' })
  await assert.rejects(() => automod.run(blocked), /\.safety groups on CONFIRMER/)

  const enabled = context({ settings: { antilink: 'off', automod: false }, allowed: true, action: 'on' })
  await automod.run(enabled)
  assert.equal(enabled.settings.automod, true)
  assert.equal(enabled.settings.antilink, 'warn')
})

test('le dispatcher ignore les liens lorsque automod est désactivé', async () => {
  const dispatcher = new Dispatcher({
    sock: {},
    config: {},
    runtime: {},
    store: { getGroup: () => ({ automod: false, antilink: 'kick' }) },
    registry: {}, safety: {}, logger: {}
  })
  let permissionsLoaded = false
  const handled = await dispatcher.enforceAntiLink({
    isGroup: true,
    body: 'https://example.com',
    from: '123@g.us',
    async loadGroupPermissions() { permissionsLoaded = true }
  })
  assert.equal(handled, false)
  assert.equal(permissionsLoaded, false)
})
