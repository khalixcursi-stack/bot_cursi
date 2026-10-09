import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import mediaCommands from '../src/commands/media.js'

async function syntheticVideo() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cursi-media-test-'))
  const file = path.join(directory, 'input.mp4')
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file
    ], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}`)))
  })
  const buffer = await fs.readFile(file)
  await fs.rm(directory, { recursive: true, force: true })
  return buffer
}

test('simulation média : conversion sticker, image, MP3, découpage et photos de profil', async () => {
  const video = await syntheticVideo()
  const image = await sharp({ create: { width: 300, height: 200, channels: 4, background: '#8844ffff' } }).png().toBuffer()
  const webp = await sharp(image).webp().toBuffer()
  const cases = [
    ['sticker', { kind: 'image', buffer: image, extension: 'png', mime: 'image/png' }, ''],
    ['sticker', { kind: 'video', buffer: video, extension: 'mp4', mime: 'video/mp4' }, ''],
    ['toimg', { kind: 'sticker', buffer: webp, extension: 'webp', mime: 'image/webp' }, ''],
    ['tomp3', { kind: 'video', buffer: video, extension: 'mp4', mime: 'video/mp4' }, ''],
    ['trim', { kind: 'video', buffer: video, extension: 'mp4', mime: 'video/mp4' }, '0-1'],
    ['fullpp', { kind: 'image', buffer: image, extension: 'png', mime: 'image/png' }, ''],
    ['fullgpp', { kind: 'image', buffer: image, extension: 'png', mime: 'image/png' }, '']
  ]
  const covered = new Set()
  for (const [name, media, text] of cases) {
    const outputs = []
    const ctx = {
      text, from: '123@g.us', msg: {},
      sock: { user: { id: 'bot@s.whatsapp.net' }, async updateProfilePicture() { outputs.push({ updated: true }) } },
      async downloadMedia() { return media },
      async send(content) { outputs.push(content) },
      async reply(value) { outputs.push({ text: value }) }
    }
    await mediaCommands.find(command => command.name === name).run(ctx)
    covered.add(name)
    assert.ok(outputs.length, `${name} n’a produit aucune sortie`)
  }
  assert.deepEqual([...covered].sort(), mediaCommands.map(command => command.name).sort())
})
