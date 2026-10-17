/**
 * EL ACUSE VA SELLADO, Y SE DEMUESTRA MIRANDO EL CABLE.
 *
 * Hasta 0.3.0 el acuse salía con `sendByPubkey`, o sea en claro, y aquí mismo estaba
 * escrito que la cola del proxio era «cifrada». No lo es. El acuse lleva la URL del
 * contenido, su nombre y el apodo de quien lo abrió: material del usuario cruzando un VPS
 * alquilado (CONVENCIONES §4.1).
 *
 * Esta suite no se fía de lo que la app le pasa al cliente: levanta el cliente REAL
 * (`@dotrino/proxy-client`) contra un proxio que graba **todo lo que cruza el socket**, y
 * busca ahí dentro la URL, el nombre y el apodo. Si aparecen, falla.
 *
 * Y prueba el caso que de verdad importa aquí: **el autor está APAGADO**. Un acuse se le
 * escribe justo a quien no está —por eso existe la cola de 24 h—, así que un diseño que
 * exigiera tener al otro conectado para saber su llave habría matado la función que §4.1
 * viene a proteger.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createProxy, installWebSocket } from './_proxy.mjs'
import { fakeVault } from './_vault.mjs'
import { createShareReceipts } from '../src/index.js'

const { WebSocketProxyClient, identitySealing } = await import('@dotrino/proxy-client')

const URL_COMPARTIDA = 'https://pronostico.dotrino.com/#BLOB-DEL-PRONOSTICO'
const NOMBRE = 'Mi pronostico del mundial'

/** Una persona: su bóveda + su cliente del transporte, ya sellando. */
async function persona (proxio, nick) {
  const id = await fakeVault(nick)
  const client = new WebSocketProxyClient({
    url: 'ws://proxio-de-prueba',
    enableWebRTC: false,
    enableHeartbeat: false,
    autoReconnect: false,
    requireSealed: true,
    myEncPub: await id.getEncryptionPubkey(),
    sealing: identitySealing(id, { app: 'prueba' })
  })
  const recibidos = []
  client.on('message', (from, payload, meta) => recibidos.push({ from, payload, meta }))
  const errores = []
  client.on('error', (e) => errores.push(e))
  return { id, client, recibidos, errores, proxio }
}

async function conectar (p) {
  await p.client.connect()
  await p.client.identifyAs({ publickey: p.id.me.publickey, sign: (d) => p.id.signData(d) })
  // El anuncio de la llave sale POR DETRÁS del identify (no bloquea, a propósito): se le
  // da una vuelta al bucle para que haya llegado antes de que alguien pregunte.
  await new Promise((r) => setTimeout(r, 20))
}

/** El motor de acuses de una persona, con un controlador de notificaciones de mentira. */
function motor (p, { onReceipt } = {}) {
  const avisos = []
  const receipts = createShareReceipts({
    proxyClient: () => p.client,
    identity: () => p.id,
    notifications: { notify: (category, opts) => { avisos.push({ category, opts }); return Promise.resolve(null) } },
    lang: 'es',
    onReceipt
  })
  return { receipts, avisos }
}

// ---------------------------------------------------------------------------
// 1. EL CASO QUE IMPORTA: el autor está apagado
// ---------------------------------------------------------------------------

test('el autor APAGADO: el acuse se sella, espera en la cola y se abre al encenderse', async () => {
  const proxio = createProxy()
  installWebSocket(proxio)

  // El autor se conecta UNA vez —lo justo para anunciar su llave— y se va.
  const autor = await persona(proxio, 'alfa')
  await conectar(autor)
  autor.client.close()

  // Quien abre no se ha emparejado nunca con el autor: solo tiene su pubkey, que venía
  // en el enlace. Sella igual, porque la llave se AVERIGUA.
  const lector = await persona(proxio, 'beta')
  await conectar(lector)
  const { receipts: acusaLector } = motor(lector)
  const salio = await acusaLector.report({ toPubkey: autor.id.me.publickey, url: URL_COMPARTIDA, name: NOMBRE })
  assert.equal(salio, true, 'el acuse tiene que salir aunque el autor esté apagado')
  assert.equal(proxio.encolados(autor.id.me.publickey), 1, 'y tiene que quedarse esperando en la cola')

  // NADA EN CLARO, en ningún sentido del cable.
  const cable = proxio.texto()
  assert.ok(!cable.includes(URL_COMPARTIDA), 'la URL del contenido no puede aparecer en el cable')
  assert.ok(!cable.includes(NOMBRE), 'ni el nombre del contenido')
  assert.ok(!cable.includes('beta'), 'ni el apodo de quien abrió')
  assert.ok(!cable.includes('__ccn'), 'ni la marca del sobre de acuse')

  // El autor se enciende: la cola se drena y el sobre se abre.
  const autor2 = await persona(proxio, 'alfa')
  // Misma persona = misma bóveda (misma llave de firma y de cifrado).
  autor2.id = autor.id
  autor2.client.updateConfig({ myEncPub: await autor.id.getEncryptionPubkey(), sealing: identitySealing(autor.id, { app: 'prueba' }) })
  const { receipts: escuchaAutor, avisos } = motor(autor2)
  escuchaAutor.start()
  await conectar(autor2)
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(avisos.length, 1, 'el acuse encolado tiene que llegar y avisar')
  assert.equal(avisos[0].category, 'shareOpened')
  assert.equal(avisos[0].opts.data.url, URL_COMPARTIDA)
  assert.ok(String(avisos[0].opts.body).includes(NOMBRE))
  assert.ok(String(avisos[0].opts.body).includes('beta'), 'y decir quién abrió')
  assert.equal(escuchaAutor.unsealedDropped, 0)
})

// ---------------------------------------------------------------------------
// 2. Quien nunca anunció llave: no se manda, y se dice cuál es
// ---------------------------------------------------------------------------

test('si el autor NUNCA anunció su llave, no se manda nada — y se distingue por code', async () => {
  const proxio = createProxy()
  installWebSocket(proxio)

  const lector = await persona(proxio, 'beta')
  await conectar(lector)
  const desconocido = await fakeVault('nunca-se-conecto')
  const { receipts } = motor(lector)

  const antes = proxio.cable.length
  await assert.rejects(
    () => receipts.report({ toPubkey: desconocido.me.publickey, url: URL_COMPARTIDA, name: NOMBRE }),
    (e) => e.code === 'no-encpub')

  // Lo único que salió fue la PREGUNTA por la llave. Ni un mensaje dirigido.
  const despues = proxio.cable.slice(antes)
  assert.ok(despues.some((c) => c.frame.type === 'enc-lookup'))
  assert.ok(!despues.some((c) => c.frame.to_publickey), 'no puede salir ningún mensaje dirigido')
  assert.ok(!proxio.texto().includes(URL_COMPARTIDA))
})

test('un cliente sin sendSealed no manda el acuse en claro: se para y se dice', async () => {
  const enviados = []
  const receipts = createShareReceipts({
    proxyClient: () => ({ on: () => () => {}, sendByPubkey: (pk, p) => enviados.push({ pk, p }) }),
    identity: () => ({ me: { publickey: 'PK_B', nickname: 'beta' } }),
    notifications: { notify: () => Promise.resolve(null) }
  })
  await assert.rejects(
    () => receipts.report({ toPubkey: 'PK_A', url: URL_COMPARTIDA, name: NOMBRE }),
    (e) => e.code === 'no-sealed-transport')
  assert.equal(enviados.length, 0, 'no puede caer al camino en claro')
})

// ---------------------------------------------------------------------------
// 3. Sellar solo de salida no sirve: lo que llega en claro se descarta
// ---------------------------------------------------------------------------

test('un acuse en CLARO no entra en la app, aunque el sobre esté bien formado', async () => {
  const proxio = createProxy()
  installWebSocket(proxio)

  const autor = await persona(proxio, 'alfa')
  const { receipts, avisos } = motor(autor)
  receipts.start()
  await conectar(autor)

  // Un impostor que nunca leyó nada, mandando un acuse falso con el enlace que quiera.
  // El cliente del autor ya lo tira por `requireSealed`; el motor no lo vería igual.
  const impostor = await persona(proxio, 'mallory')
  impostor.client.requireSealed = false      // el impostor sí manda en claro
  await conectar(impostor)
  impostor.client.sendByPubkey(autor.id.me.publickey, {
    __ccn: 1, kind: 'opened', url: 'https://sitio-falso.example/#trampa', name: 'x',
    from: { pubkey: impostor.id.me.publickey, nick: 'mallory' }, ts: Date.now()
  })
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(avisos.length, 0, 'un acuse sin sellar no puede disparar una notificación')
  assert.ok(autor.errores.some((e) => e.type === 'unsealed' && e.reason === 'plaintext_rejected'))
})

test('el motor no se fía de meta.sealed ausente, ni cuando el cliente se lo entrega', async () => {
  // Aquí el "cliente" es de mentira y entrega igual: se comprueba la guarda del MOTOR,
  // la segunda mitad de «sellar solo de salida no sirve».
  let entrega = null
  const { receipts, avisos } = (() => {
    const avisos = []
    const receipts = createShareReceipts({
      proxyClient: () => ({ on: (ev, fn) => { if (ev === 'message') entrega = fn; return () => {} }, sendSealed: async () => {} }),
      identity: () => ({ me: { publickey: 'PK_A', nickname: 'alfa' } }),
      notifications: { notify: (category, opts) => { avisos.push({ category, opts }); return Promise.resolve(null) } }
    })
    return { receipts, avisos }
  })()
  receipts.start()
  const sobre = { __ccn: 1, kind: 'opened', url: URL_COMPARTIDA, name: NOMBRE, from: { pubkey: 'PK_B', nick: 'beta' }, ts: Date.now() }

  entrega('tok', sobre, { sealed: false })
  entrega('tok', sobre, {})
  entrega('tok', sobre, undefined)
  assert.equal(avisos.length, 0)
  assert.equal(receipts.unsealedDropped, 3)

  entrega('tok', sobre, { sealed: true })
  assert.equal(avisos.length, 1, 'lo sellado sí entra')
})

// ---------------------------------------------------------------------------
// 4. El throttle no puede quemar el sitio de un acuse que no salió
// ---------------------------------------------------------------------------

test('un acuse que no pudo salir no gasta la ventana anti-spam', async () => {
  const proxio = createProxy()
  installWebSocket(proxio)

  const lector = await persona(proxio, 'beta')
  await conectar(lector)
  const autor = await fakeVault('alfa')
  const { receipts } = motor(lector)

  // Primer intento: el autor no ha anunciado llave. Falla.
  await assert.rejects(() => receipts.report({ toPubkey: autor.me.publickey, url: URL_COMPARTIDA }), (e) => e.code === 'no-encpub')

  // El autor aparece y anuncia. El segundo intento tiene que poder salir: si el primero
  // hubiera marcado el throttle, aquí no saldría nada durante 24 h.
  const autorCon = await persona(proxio, 'alfa')
  autorCon.id = autor
  autorCon.client.updateConfig({ myEncPub: await autor.getEncryptionPubkey(), sealing: identitySealing(autor, { app: 'prueba' }) })
  await conectar(autorCon)

  assert.equal(await receipts.report({ toPubkey: autor.me.publickey, url: URL_COMPARTIDA }), true)
  // Y ahora sí: el tercero se lo come el throttle.
  assert.equal(await receipts.report({ toPubkey: autor.me.publickey, url: URL_COMPARTIDA }), false)
})
