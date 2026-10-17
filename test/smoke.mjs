// Smoke test (Node, sin DOM): el módulo debe importar y el controlador operar
// sin navegador (permiso 'unsupported', notify no lanza, prefs en memoria).
import assert from 'node:assert'
import { createNotifications, createVaultPushProvider, createShareReceipts, packPubkey, unpackPubkey, DotrinoNotifications } from '../src/index.js'

let failed = 0
// SE ESPERA A LO ASÍNCRONO. Antes no: `fn()` se llamaba y se seguía, así que una prueba
// async que fallaba acababa en un rechazo no atendido y salía con un ✓ al lado. Una suite
// que no puede fallar es peor que no tenerla.
const ok = async (name, fn) => {
  try { await fn(); console.log('  ✓', name) }
  catch (e) { failed++; console.error('  ✗', name, '\n   ', e.message) }
}

await ok('exports presentes', () => {
  assert.equal(typeof createNotifications, 'function')
  assert.equal(typeof createVaultPushProvider, 'function')
  assert.equal(typeof createShareReceipts, 'function')
  assert.equal(typeof DotrinoNotifications, 'function')
})

const ctrl = createNotifications({
  storageKey: 'smoke',
  categories: [
    { key: 'a', label: { es: 'A', en: 'A' } },
    { key: 'b', label: 'B', default: false },
  ],
})

await ok('defaults por categoría', () => {
  assert.equal(ctrl.get('a'), true)
  assert.equal(ctrl.get('b'), false)
  assert.equal(ctrl.soundEnabled, true)
})

await ok('set / shouldNotify', () => {
  ctrl.set('a', false)
  assert.equal(ctrl.get('a'), false)
  assert.equal(ctrl.shouldNotify('a'), false)
  assert.equal(ctrl.shouldNotify('b'), false)
  ctrl.set('b', true)
  assert.equal(ctrl.shouldNotify('b'), true)
})

await ok('set ignora claves desconocidas', () => {
  ctrl.set('zzz', true)
  assert.equal(ctrl.get('zzz'), undefined)
})

await ok('sin navegador: unsupported / notify null', async () => {
  assert.equal(ctrl.permission(), 'unsupported')
  assert.equal(ctrl.supported, false)
  const r = await ctrl.notify('b', { title: 'hi' })
  assert.equal(r, null)
})

await ok('subscribe se dispara en set', () => {
  let n = 0
  const off = ctrl.subscribe(() => { n++ })
  ctrl.set('a', true)
  assert.equal(n, 1)
  off()
  ctrl.set('a', false)
  assert.equal(n, 1)
})

await ok('createVaultPushProvider expone la API', () => {
  const p = createVaultPushProvider({ proxyClient: {}, identity: {}, storageKey: 'smoke' })
  for (const m of ['supported', 'isEnabled', 'busy', 'error', 'enable', 'disable', 'ensureSubscribed']) {
    assert.equal(typeof p[m], 'function', 'falta ' + m)
  }
  assert.equal(p.supported(), false) // sin navegador
})

await ok('push integrado en el controlador', () => {
  const pushed = createNotifications({
    storageKey: 'smoke2',
    categories: [{ key: 'x', label: 'X' }],
    push: createVaultPushProvider({ proxyClient: {}, identity: {}, storageKey: 'smoke2' }),
  })
  assert.ok(pushed.push)
  assert.equal(pushed.push.enabled, false)
  assert.equal(typeof pushed.push.enable, 'function')
})

// ---- acuses de apertura (createShareReceipts) ----
//
// El transporte de mentira expone `sendSealed`, no `sendByPubkey`: desde 0.4.0 el acuse
// va sellado y el camino en claro ya no existe (CONVENCIONES §4.1). El sellado de verdad,
// contra el cliente real y mirando el cable, está en `sealed.test.mjs`.
const sent = []
const fakeProxy = {
  on () { return () => {} },
  async sendSealed (pk, payload) { sent.push({ pk, payload }) },
}
const fakeId = { me: { publickey: 'PK_ME', nickname: 'yo' } }
const receipts = createShareReceipts({
  proxyClient: fakeProxy,
  identity: fakeId,
  notifications: ctrl,
})

await ok('createShareReceipts expone la API', () => {
  for (const m of ['report', 'start', 'stop']) assert.equal(typeof receipts[m], 'function', 'falta ' + m)
})

await ok('report encola un sobre __ccn con from identificado', async () => {
  sent.length = 0
  const okRep = await receipts.report({ toPubkey: 'PK_OTRO', url: 'https://x/#abc', name: 'Mi pronóstico' })
  assert.equal(okRep, true)
  assert.equal(sent.length, 1)
  const env = sent[0].payload
  assert.equal(sent[0].pk, 'PK_OTRO')
  assert.equal(env.__ccn, 1)
  assert.equal(env.kind, 'opened')
  assert.equal(env.url, 'https://x/#abc')
  assert.equal(env.name, 'Mi pronóstico')
  assert.equal(env.from.pubkey, 'PK_ME')
  assert.equal(env.from.nick, 'yo')
})

await ok('report no avisa a uno mismo', async () => {
  sent.length = 0
  const okRep = await receipts.report({ toPubkey: 'PK_ME', url: 'https://x/#self' })
  assert.equal(okRep, false)
  assert.equal(sent.length, 0)
})

await ok('start() + acuse entrante dispara onReceipt (referidos)', async () => {
  let onMessage = null
  const recvProxy = { on (ev, fn) { if (ev === 'message') onMessage = fn; return () => {} }, async sendSealed () {} }
  const got = []
  const r2 = createShareReceipts({
    proxyClient: recvProxy,
    identity: { me: { publickey: 'PK_A', nickname: 'a' } },
    notifications: ctrl,
    category: 'referrals',
    onReceipt: (env) => got.push(env),
  })
  r2.start()
  assert.equal(typeof onMessage, 'function', 'start() enganchó el handler de message')
  const env = { __ccn: 1, kind: 'referral', url: 'https://x/', name: null, from: { pubkey: 'PK_B', nick: 'b' }, ts: 123 }
  // Sin la marca del pilar no entra: sellar solo de salida no serviría de nada.
  onMessage('tok', env, { sealed: false })
  assert.equal(got.length, 0)
  assert.equal(r2.unsealedDropped, 1)

  onMessage('tok', env, { sealed: true })
  assert.equal(got.length, 1)
  assert.equal(got[0].from.pubkey, 'PK_B')
  // dedup en sesión: el mismo sobre no vuelve a disparar
  onMessage('tok', env, { sealed: true })
  assert.equal(got.length, 1)
})

await ok('packPubkey / unpackPubkey round-trip exacto', () => {
  const pk = '{"kty":"EC","crv":"P-256","x":"abc-_DEF","y":"012_xyz","ext":true}'
  const token = packPubkey(pk)
  assert.equal(typeof token, 'string')
  assert.ok(!/[+/=]/.test(token), 'token es base64url (sin + / =)')
  assert.equal(unpackPubkey(token), pk)
  assert.equal(unpackPubkey('!!!notb64!!!') === pk, false)
})

console.log(failed ? `\n${failed} fallo(s)` : '\nOK')
process.exit(failed ? 1 : 0)
