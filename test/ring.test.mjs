// El trino: el archivo viaja en el paquete, se toca con el volumen pedido y un navegador que no
// deja sonar se nota (rechaza), no se calla.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const made = []
globalThis.Audio = class { constructor (src) { this.src = src; this.volume = 1; made.push(this) } play () { return this.fail ? Promise.reject(this.fail) : Promise.resolve() } }
const { RING_URL, RING_VOLUME, playRing } = await import('../src/ring.js')

test('the sound ships with the package', () => {
  const file = fileURLToPath(RING_URL)
  assert.ok(existsSync(file))
  assert.ok(statSync(file).size > 1000)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./ring'].import, './src/ring.js')
  assert.ok(pkg.files.includes('src'))
})

test('plays the ring at the volume asked, clamped', async () => {
  await playRing()
  assert.equal(made.at(-1).src, RING_URL)
  assert.equal(made.at(-1).volume, RING_VOLUME)
  await playRing({ volume: 7 })
  assert.equal(made.at(-1).volume, 1)
})

test('a browser that does not let it sound is not hidden', async () => {
  const blocked = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
  const Was = globalThis.Audio
  globalThis.Audio = class extends Was { fail = blocked }
  await assert.rejects(playRing(), { name: 'NotAllowedError' })
  globalThis.Audio = Was
})
