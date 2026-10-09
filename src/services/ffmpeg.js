import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

async function runFfmpeg(inputBuffer, inputExtension, outputExtension, args) {
  if (!ffmpegPath) throw new Error('FFmpeg est indisponible sur cet hébergement')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-md-'))
  const input = path.join(directory, `input.${inputExtension}`)
  const output = path.join(directory, `output.${outputExtension}`)
  await fs.writeFile(input, inputBuffer)

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...args, output], {
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
      child.stderr.on('data', chunk => { stderr += chunk.toString() })
      child.on('error', reject)
      child.on('close', code => {
        clearTimeout(timer)
        code === 0 ? resolve() : reject(new Error(`Conversion impossible : ${stderr.slice(-500) || `code ${code}`}`))
      })
    })
    return await fs.readFile(output)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

export function videoToSticker(buffer, extension = 'mp4') {
  return runFfmpeg(buffer, extension, 'webp', [
    '-t', '8', '-an', '-vf',
    'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
    '-loop', '0', '-vsync', '0'
  ])
}

export function mediaToMp3(buffer, extension = 'mp4') {
  return runFfmpeg(buffer, extension, 'mp3', ['-vn', '-codec:a', 'libmp3lame', '-q:a', '3'])
}

export function trimMedia(buffer, extension, start, duration, outputExtension = extension) {
  return runFfmpeg(buffer, extension, outputExtension, ['-ss', String(start), '-t', String(duration), '-c', 'copy'])
}
