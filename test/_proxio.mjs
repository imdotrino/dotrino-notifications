/**
 * UN PROXIO DE MENTIRA, PERO DEL TAMAÑO DE LA VERDAD.
 *
 * Para demostrar que el acuse no viaja en claro no basta con mirar lo que la app le pasa
 * al cliente: hay que mirar **lo que cruza el socket**. Así que aquí hay un servidor con
 * lo justo del protocolo real (`websocket-proxy` ≥ 1.1.0) y un `WebSocket` falso que lo
 * conecta con el cliente de verdad (`@dotrino/proxy-client`):
 *
 *   · `connected` con `caps:['encpub']`, que es lo que hace al proxio capaz de servir
 *     llaves de cifrado;
 *   · `identify` → ata la pubkey a esta conexión y **drena su cola**;
 *   · `encpub` / `enc-lookup` → el buzón de anuncios firmados;
 *   · `to_publickey` → entrega si está conectado, y si no **ENCOLA** (la cola de 24 h,
 *     que es justo el caso del acuse: se le escribe a alguien apagado).
 *
 * Todo lo que entra y sale queda grabado en `proxio.cable`, tal cual, para poder afirmar
 * con el texto delante que ahí no está ni la URL, ni el nombre, ni el apodo.
 */

const memoria = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
    setItem: (k, v) => memoria.set(k, String(v)),
    removeItem: (k) => memoria.delete(k),
    clear: () => memoria.clear()
  }
})

export function crearProxio () {
  const conexiones = new Map()          // token -> socket
  const porPubkey = new Map()           // publickey -> Set<token>
  const cola = new Map()                // publickey -> [mensajes]
  const anuncios = new Map()            // publickey -> statement
  /** TODO lo que cruza el cable, en orden: { dir:'sube'|'baja', token, frame }. */
  const cable = []
  let n = 0

  const api = {
    cable,
    /** Todo el cable como UN texto: lo que vería quien opera el proxio. */
    texto: () => cable.map((c) => JSON.stringify(c.frame)).join('\n'),
    encolados: (pubkey) => (cola.get(pubkey) || []).length,
    conectar (socket) {
      const token = 'T' + (++n)
      socket.token = token
      conexiones.set(token, socket)
      api._baja(socket, { type: 'connected', token, instance: token, node: 'test', peers: [], protocol: 2, caps: ['channels', 'pubkey-routing', 'offline-queue', 'encpub'] })
    },
    desconectar (socket) {
      conexiones.delete(socket.token)
      for (const set of porPubkey.values()) set.delete(socket.token)
    },
    _baja (socket, frame) {
      cable.push({ dir: 'baja', token: socket.token, frame })
      socket._recibe(frame)
    },
    sube (socket, frame) {
      cable.push({ dir: 'sube', token: socket.token, frame })
      const { id, type } = frame

      if (type === 'identify') {
        const pk = frame.data?.publickey
        socket.publickey = pk
        if (!porPubkey.has(pk)) porPubkey.set(pk, new Set())
        porPubkey.get(pk).add(socket.token)
        api._baja(socket, { type: 'identified', id, publickey: pk })
        // Drenar la cola: es lo que hace que un mensaje a alguien APAGADO llegue.
        const pendientes = cola.get(pk) || []
        cola.set(pk, [])
        for (const m of pendientes) {
          api._baja(socket, { type: 'message', from: null, from_publickey: m.from, message: m.message, queued: true })
        }
        return
      }

      if (type === 'encpub') {
        // El proxio es un BUZÓN: se queda el sobre entero, sin abrirlo ni firmar nada.
        anuncios.set(frame.data?.publickey, { data: frame.data, signature: frame.signature })
        api._baja(socket, { type: 'encpub-announced', id, publickey: frame.data?.publickey, stored: true })
        return
      }

      if (type === 'enc-lookup') {
        const keys = []
        const missing = []
        for (const pk of frame.publickeys || []) {
          const st = anuncios.get(pk)
          if (st) keys.push(st); else missing.push(pk)
        }
        api._baja(socket, { type: 'enc-lookup', id, keys, missing })
        return
      }

      if (frame.to_publickey) {
        for (const pk of frame.to_publickey) {
          const tokens = [...(porPubkey.get(pk) || [])]
          if (tokens.length) {
            for (const t of tokens) {
              const dest = conexiones.get(t)
              if (dest) api._baja(dest, { type: 'message', from: socket.token, from_publickey: socket.publickey, message: frame.message })
            }
          } else if (!frame.ephemeral) {
            if (!cola.has(pk)) cola.set(pk, [])
            cola.get(pk).push({ from: socket.publickey, message: frame.message })
          }
        }
        api._baja(socket, { type: 'message_sent', id, sent: frame.to_publickey })
        return
      }

      if (frame.to) {
        for (const t of frame.to) {
          const dest = conexiones.get(t)
          if (dest) api._baja(dest, { type: 'message', from: socket.token, from_publickey: socket.publickey, message: frame.message })
        }
        api._baja(socket, { type: 'message_sent', id, sent: frame.to })
        return
      }

      if (type === 'ping') { api._baja(socket, { type: 'pong', id }); return }
    }
  }
  return api
}

/** El `WebSocket` que el cliente de verdad usará, enchufado al proxio de arriba. */
export function instalarWebSocket (proxio) {
  class SocketDePrueba {
    static OPEN = 1
    static CLOSED = 3
    constructor (url) {
      this.url = url
      this.readyState = SocketDePrueba.OPEN
      this._oyentes = new Map()
      queueMicrotask(() => { this._disparar('open', {}); proxio.conectar(this) })
    }
    addEventListener (ev, fn) {
      if (!this._oyentes.has(ev)) this._oyentes.set(ev, new Set())
      this._oyentes.get(ev).add(fn)
    }
    removeEventListener (ev, fn) { this._oyentes.get(ev)?.delete(fn) }
    send (texto) { proxio.sube(this, JSON.parse(texto)) }
    close () {
      this.readyState = SocketDePrueba.CLOSED
      proxio.desconectar(this)
      this._disparar('close', { code: 1000 })
    }
    _recibe (frame) { this._disparar('message', { data: JSON.stringify(frame) }) }
    _disparar (ev, detalle) { for (const fn of this._oyentes.get(ev) || []) fn(detalle) }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: SocketDePrueba })
  return SocketDePrueba
}
