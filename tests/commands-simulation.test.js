import test from 'node:test'
import assert from 'node:assert/strict'
import generalCommands from '../src/commands/general.js'
import groupCommands from '../src/commands/group.js'
import ownerCommands from '../src/commands/owner.js'
import whatsappCommands from '../src/commands/whatsapp.js'

const target = '242060000000@s.whatsapp.net'

function fixture({ text = '', args = [], quoted = null, groupSettings = {} } = {}) {
  const outputs = []
  const actions = []
  const group = { ...groupSettings }
  const store = {
    data: { global: {}, groups: { '123@g.us': group }, sudo: [] },
    getGroup: () => group,
    async updateGroup(_jid, patch) { Object.assign(group, patch); actions.push(['updateGroup', patch]) },
    async setGlobal(key, value) { this.data.global[key] = value; actions.push(['setGlobal', key, value]) },
    async save() { actions.push(['save']) },
    async addSudo(number) { this.data.sudo.push(number) },
    async removeSudo(number) { this.data.sudo = this.data.sudo.filter(item => item !== number) }
  }
  const sock = {
    user: { id: '242041029122@s.whatsapp.net' },
    async sendMessage(_jid, content) { outputs.push(content); return { key: { id: 'sent' } } },
    async groupMetadata() { return metadata },
    async groupInviteCode() { return 'InviteCode123' },
    async groupRevokeInvite() { actions.push(['revoke']) },
    async groupSettingUpdate(_jid, value) { actions.push(['groupSetting', value]) },
    async groupUpdateSubject(_jid, value) { actions.push(['subject', value]) },
    async groupUpdateDescription(_jid, value) { actions.push(['description', value]) },
    async groupParticipantsUpdate(_jid, members, action) { actions.push(['participants', members, action]) },
    async groupToggleEphemeral(_jid, seconds) { actions.push(['ephemeral', seconds]) },
    async groupRequestParticipantsList() { return [{ jid: target }] },
    async groupRequestParticipantsUpdate(_jid, members, action) { actions.push(['requests', members, action]) },
    async groupLeave() { actions.push(['leave']) },
    async updateBlockStatus(jid, action) { actions.push(['block', jid, action]) },
    async updateProfileStatus(value) { actions.push(['bio', value]) },
    async groupAcceptInvite() { return 'accepted@g.us' },
    async groupCreate() { return { id: 'created@g.us' } },
    async profilePictureUrl() { return 'https://example.com/avatar.jpg' },
    async fetchStatus() { return [{ status: { status: 'Bio test' } }] },
    async onWhatsApp() { return [{ exists: true }] },
    async fetchPrivacySettings() { return { readreceipts: 'all' } },
    async fetchBlocklist() { return [target] },
    async groupFetchAllParticipating() { return { one: { subject: 'Groupe test', participants: [{}, {}] } } },
    async removeProfilePicture() { actions.push(['removeProfilePicture']) },
    async updateProfilePicture() { actions.push(['updateProfilePicture']) }
  }
  const metadata = {
    id: '123@g.us', subject: 'Groupe test', creation: 1700000000, desc: 'Description',
    participants: [
      { id: target, admin: 'admin' },
      { id: '242070000000@s.whatsapp.net', admin: null }
    ]
  }
  const registryCommands = [...generalCommands, ...groupCommands, ...ownerCommands, ...whatsappCommands]
  const registry = {
    all: () => registryCommands,
    find: name => registryCommands.find(command => command.name === name || command.aliases?.includes(name)),
    categories: () => new Map([
      ['Général', generalCommands], ['Groupe', groupCommands], ['Propriétaire', ownerCommands], ['WhatsApp', whatsappCommands]
    ])
  }
  const runtime = {
    prefix: '.', mode: 'private', autoRead: false, autoViewStatus: false, autoLikeStatus: false, antiCall: false,
    allowPublicMode: true, allowGroupAutomation: true, allowStatusAutomation: true
  }
  const safety = {
    setPolicy(name, value) { actions.push(['policy', name, value]) },
    snapshot() {
      return {
        enabled: true, publicModeAllowed: true, groupAutomationAllowed: true, statusAutomationAllowed: true,
        commandsPerUserMinute: 20, commandsPerChatMinute: 40, outgoingPerMinute: 60,
        outgoingPerChatMinute: 30, dailyOutgoing: 1, outgoingPerDay: 2000, queueDepth: 0
      }
    }
  }
  return {
    text, args, quoted, outputs, actions, sock, store, runtime, safety, registry, metadata,
    config: {
      botName: 'ᴄᴜʀsɪㅤ愛', botVersion: 'test', ownerName: 'Propriétaire', ownerNumber: '242041029122',
      profilePicturePath: 'assets/profile.jpg', commandReactions: true, closedTestMode: true,
      localDownloaderEnabled: true, cobaltApiUrl: '', youtubeApiKey: '', youtubeSearchApiUrl: '',
      ai: { apiKey: '' }, safety: { enabled: true }, allowRestart: false
    },
    from: '123@g.us', sender: '242041029122@s.whatsapp.net', senderNumber: '242041029122', isGroup: true, isOwner: true, isPrivileged: true,
    msg: { key: { id: 'incoming', remoteJid: '123@g.us' }, message: { conversation: '.test' } },
    async send(content) { outputs.push(content); return { key: { id: String(outputs.length) } } },
    async reply(value) { outputs.push({ text: String(value) }); return { key: { id: String(outputs.length) } } },
    async metadata() { return metadata },
    resolveTarget() { return target },
    targetNumber() { return '242060000000' },
    ownerJid() { return '242041029122@s.whatsapp.net' },
    quotedKey() { return { id: 'quoted', remoteJid: '123@g.us', fromMe: true } },
    async downloadMedia() { return { kind: 'image', buffer: Buffer.from('image'), mime: 'image/jpeg', extension: 'jpg', node: {} } },
    logger: { warn() {}, error() {}, info() {}, debug() {} }
  }
}

const groupCases = {
  groupinfo: {}, link: {}, revoke: {}, open: {}, close: {}, rename: { text: 'Nouveau nom', args: ['Nouveau', 'nom'] },
  desc: { text: 'Nouvelle description', args: ['Nouvelle', 'description'] }, tagall: { text: 'Annonce' }, hidetag: { text: 'Annonce' },
  add: { text: '242060000000' }, kick: { text: '242060000000' }, kickall: { text: 'CONFIRMER', args: ['CONFIRMER'] },
  promote: { text: '242060000000' }, demote: { text: '242060000000' },
  ban: { text: '242060000000' }, unban: { text: '242060000000', groupSettings: { bannedMembers: [target] } }, banlist: {},
  automod: { text: 'status', args: ['status'] }, antilink: { text: 'warn', args: ['warn'] },
  welcome: { text: 'on Bienvenue', args: ['on', 'Bienvenue'] }, goodbye: { text: 'on Au revoir', args: ['on', 'Au', 'revoir'] },
  disappearing: { text: '24h', args: ['24h'] }, requests: {}, approve: {}, reject: {}, leave: {}
}

test('simulation WhatsApp : toutes les commandes de groupe répondent sans réseau réel', async () => {
  assert.deepEqual(groupCommands.map(command => command.name).sort(), Object.keys(groupCases).sort())
  for (const command of groupCommands) {
    const ctx = fixture(groupCases[command.name])
    await command.run(ctx)
    assert.ok(ctx.outputs.length || ctx.actions.length, `${command.name} n’a produit aucune action`)
  }
})

const ownerCases = {
  mode: { text: 'private', args: ['private'] }, public: { args: [] }, private: {}, prefix: { text: '!' }, settings: {}, safety: {},
  sudo: { text: 'list', args: ['list'] }, block: { text: '242060000000' }, unblock: { text: '242060000000' },
  setbio: { text: 'Bio de test' }, autoread: { text: 'on' }, autoview: { text: 'on' }, autolike: { text: 'on' }, anticall: { text: 'on' },
  join: { text: 'https://chat.whatsapp.com/InviteCode123' }, create: { text: 'Groupe | 242060000000' }
}

test('simulation WhatsApp : commandes propriétaire et interrupteurs', async () => {
  for (const command of ownerCommands) {
    if (command.name === 'restart') {
      await assert.rejects(() => command.run(fixture()), /ALLOW_RESTART/)
      continue
    }
    const input = ownerCases[command.name]
    assert.ok(input !== undefined, `fixture manquante pour ${command.name}`)
    const ctx = fixture(input)
    await command.run(ctx)
    assert.ok(ctx.outputs.length || ctx.actions.length, `${command.name} n’a produit aucune action`)
  }
})

test('simulation WhatsApp : commandes générales locales', async () => {
  const cases = {
    menu: {}, help: { text: 'ping', args: ['ping'] }, ping: {}, alive: {}, uptime: {}, owner: {}, botinfo: {}, id: {},
    poll: { text: 'Question ? | Oui | Non' }, calc: { text: '(2+3)*4' }, flip: {}, choose: { text: 'A | B' }, love: { text: 'Alice | Bob' }
  }
  for (const command of generalCommands.filter(item => !['joke', 'advice'].includes(item.name))) {
    const input = cases[command.name]
    assert.ok(input !== undefined, `fixture manquante pour ${command.name}`)
    const ctx = fixture(input)
    await command.run(ctx)
    assert.ok(ctx.outputs.length || ctx.actions.length, `${command.name} n’a produit aucune sortie`)
  }
})

test('simulation WhatsApp : commandes de profil et sauvegarde', async () => {
  const cases = {
    getpp: {}, whois: {}, onwa: { text: '242060000000' }, privacy: {}, blocklist: {}, mygroups: {}, del: {},
    save: { quoted: { rawMessage: {}, message: { imageMessage: { mimetype: 'image/jpeg' } } } },
    delword: { args: ['list'] }, removedp: {},
    location: { quoted: { rawMessage: {}, message: { locationMessage: { degreesLatitude: -4.8, degreesLongitude: 11.9 } } } }
  }
  for (const command of whatsappCommands) {
    const input = cases[command.name]
    assert.ok(input !== undefined, `fixture manquante pour ${command.name}`)
    const ctx = fixture(input)
    await command.run(ctx)
    assert.ok(ctx.outputs.length || ctx.actions.length, `${command.name} n’a produit aucune action`)
  }
})
