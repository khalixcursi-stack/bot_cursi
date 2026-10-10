import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMenuButtons, buildMenuImageContent, buildMenuText, resolveMenuCategory } from '../src/commands/general.js'

function fixture() {
  const commands = [
    { name: 'ping', category: 'Général', description: 'Mesure la latence.', usage: '', ownerOnly: false, superOwnerOnly: false },
    { name: 'groupinfo', category: 'Groupe', description: 'Informations du groupe.', usage: '', ownerOnly: false, superOwnerOnly: false },
    { name: 'safety', category: 'Propriétaire', description: 'Gère la protection.', usage: '[option]', ownerOnly: false, superOwnerOnly: true }
  ]
  const registry = {
    all: () => commands,
    categories: () => new Map([
      ['Général', [commands[0]]],
      ['Groupe', [commands[1]]],
      ['Propriétaire', [commands[2]]]
    ])
  }
  return {
    config: { botName: 'ᴄᴜʀsɪㅤ愛', botVersion: '0.17.0', profilePicturePath: 'assets/profile.jpg' },
    runtime: { prefix: '.', mode: 'private' },
    registry
  }
}

test('le menu principal affiche les catégories sans développer toutes les commandes', () => {
  const context = fixture()
  const text = buildMenuText(context)
  assert.match(text, /MENU PRINCIPAL/)
  assert.match(text, /GÉNÉRAL/)
  assert.match(text, /GROUPE/)
  assert.doesNotMatch(text, /\*\.ping\*/)
  assert.match(text, /COMMANDES : \*3\*/)
})

test('un nom ou un numéro ouvre le bon sous-menu sans description', () => {
  const context = fixture()
  assert.equal(resolveMenuCategory('1', context.registry).label, 'Général')
  assert.equal(resolveMenuCategory('groupe', context.registry).label, 'Groupe')
  assert.equal(resolveMenuCategory('owner', context.registry).label, 'Propriétaire')

  const text = buildMenuText(context, 'general')
  assert.match(text, /GÉNÉRAL/)
  assert.match(text, /\*\.ping\*/)
  assert.doesNotMatch(text, /Mesure la latence/)
  assert.match(text, /Retour direct : \*\.menu\*/)
})

test('la photo et tout le menu sont réunis dans un seul bloc avec un buffer média', async () => {
  const context = fixture()
  const root = await buildMenuImageContent(context)
  const child = await buildMenuImageContent(context, 'Groupe')
  assert.ok(Buffer.isBuffer(root.image))
  assert.ok(Buffer.isBuffer(child.image))
  assert.match(root.caption, /MENU PRINCIPAL/)
  assert.match(child.caption, /GROUPE/)
  assert.match(child.caption, /\.groupinfo/)
})

test('les boutons ouvrent les sous-menus et les commandes', () => {
  const context = fixture()
  const main = buildMenuButtons(context)
  const mainParams = JSON.parse(main[0].buttonParamsJson)
  assert.equal(main[0].name, 'single_select')
  assert.equal(mainParams.sections[0].rows[0].id, '.menu general')

  const category = resolveMenuCategory('proprietaire', context.registry)
  const child = buildMenuButtons(context, category)
  const commandParams = JSON.parse(child[0].buttonParamsJson)
  assert.equal(commandParams.sections[0].rows[0].id, '.help safety')
  assert.equal(child[1].name, 'quick_reply')
  assert.equal(JSON.parse(child[1].buttonParamsJson).id, '.menu')
})
