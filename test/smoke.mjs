// Smoke test (Node, sin DOM): el módulo debe importar y el controlador operar
// sin navegador (permiso 'unsupported', notify no lanza, prefs en memoria).
import assert from 'node:assert'
import { createNotifications, createVaultPushProvider, createShareReceipts, packPubkey, unpackPubkey, DotrinoNotifications } from '../src/index.js'

let failed = 0
const ok = (name, fn) => { try { fn(); console.log('  ✓', name) } catch (e) { failed++; console.error('  ✗', name, '\n   ', e.message) } }

ok('exports presentes', () => {
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

ok('defaults por categoría', () => {
  assert.equal(ctrl.get('a'), true)
  assert.equal(ctrl.get('b'), false)
  assert.equal(ctrl.soundEnabled, true)
})

ok('set / shouldNotify', () => {
  ctrl.set('a', false)
  assert.equal(ctrl.get('a'), false)
  assert.equal(ctrl.shouldNotify('a'), false)
  assert.equal(ctrl.shouldNotify('b'), false)
  ctrl.set('b', true)
  assert.equal(ctrl.shouldNotify('b'), true)
})

ok('set ignora claves desconocidas', () => {
  ctrl.set('zzz', true)
  assert.equal(ctrl.get('zzz'), undefined)
})

ok('sin navegador: unsupported / notify null', async () => {
  assert.equal(ctrl.permission(), 'unsupported')
  assert.equal(ctrl.supported, false)
  const r = await ctrl.notify('b', { title: 'hi' })
  assert.equal(r, null)
})

ok('subscribe se dispara en set', () => {
  let n = 0
  const off = ctrl.subscribe(() => { n++ })
  ctrl.set('a', true)
  assert.equal(n, 1)
  off()
  ctrl.set('a', false)
  assert.equal(n, 1)
})

ok('createVaultPushProvider expone la API', () => {
  const p = createVaultPushProvider({ proxyClient: {}, identity: {}, storageKey: 'smoke' })
  for (const m of ['supported', 'isEnabled', 'busy', 'error', 'enable', 'disable', 'ensureSubscribed']) {
    assert.equal(typeof p[m], 'function', 'falta ' + m)
  }
  assert.equal(p.supported(), false) // sin navegador
})

ok('push integrado en el controlador', () => {
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
const sent = []
const fakeProxy = {
  on () { return () => {} },
  sendByPubkey (pk, payload) { sent.push({ pk, payload }) },
}
const fakeId = { me: { publickey: 'PK_ME', nickname: 'yo' } }
const receipts = createShareReceipts({
  proxyClient: fakeProxy,
  identity: fakeId,
  notifications: ctrl,
})

ok('createShareReceipts expone la API', () => {
  for (const m of ['report', 'start', 'stop']) assert.equal(typeof receipts[m], 'function', 'falta ' + m)
})

ok('report encola un sobre __ccn con from identificado', async () => {
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

ok('report no avisa a uno mismo', async () => {
  sent.length = 0
  const okRep = await receipts.report({ toPubkey: 'PK_ME', url: 'https://x/#self' })
  assert.equal(okRep, false)
  assert.equal(sent.length, 0)
})

ok('start() + acuse entrante dispara onReceipt (referidos)', async () => {
  let onMessage = null
  const recvProxy = { on (ev, fn) { if (ev === 'message') onMessage = fn; return () => {} }, sendByPubkey () {} }
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
  onMessage('tok', env)
  assert.equal(got.length, 1)
  assert.equal(got[0].from.pubkey, 'PK_B')
  // dedup en sesión: el mismo sobre no vuelve a disparar
  onMessage('tok', env)
  assert.equal(got.length, 1)
})

ok('packPubkey / unpackPubkey round-trip exacto', () => {
  const pk = '{"kty":"EC","crv":"P-256","x":"abc-_DEF","y":"012_xyz","ext":true}'
  const token = packPubkey(pk)
  assert.equal(typeof token, 'string')
  assert.ok(!/[+/=]/.test(token), 'token es base64url (sin + / =)')
  assert.equal(unpackPubkey(token), pk)
  assert.equal(unpackPubkey('!!!notb64!!!') === pk, false)
})

console.log(failed ? `\n${failed} fallo(s)` : '\nOK')
process.exit(failed ? 1 : 0)
