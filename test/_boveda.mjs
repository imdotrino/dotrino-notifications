/**
 * UNA BÓVEDA DE PRUEBA con la forma de la de verdad.
 *
 * No es cripto nueva: es exactamente lo que hace el núcleo de `@dotrino/identity` —ECDSA
 * P-256 para firmar y ECDH P-256 + AES-GCM para cifrar—, en veinte líneas y sin iframe,
 * para que el test pueda tener DOS personas en el mismo proceso. Lo que se prueba de
 * verdad (el sellado, el anuncio de la llave, la cola) es el código real.
 */
const subtle = globalThis.crypto.subtle
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' }
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
const b64 = (b) => Buffer.from(b).toString('base64')
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

const canon = (v) => (v === null || typeof v !== 'object')
  ? JSON.stringify(v)
  : Array.isArray(v)
    ? '[' + v.map(canon).join(',') + ']'
    : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'

export async function boveda (nickname) {
  const firma = await subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const cifrado = await subtle.generateKey(ECDH, true, ['deriveBits'])
  const jf = await subtle.exportKey('jwk', firma.publicKey)
  const jc = await subtle.exportKey('jwk', cifrado.publicKey)
  const publickey = JSON.stringify({ kty: jf.kty, crv: jf.crv, x: jf.x, y: jf.y })
  const encPub = JSON.stringify({ kty: jc.kty, crv: jc.crv, x: jc.x, y: jc.y })

  const compartida = async (peerJwkStr) => {
    const pub = await subtle.importKey('jwk', JSON.parse(peerJwkStr), ECDH, false, [])
    const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, cifrado.privateKey, 256)
    return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
  const idDeLlave = async (s) => b64(await subtle.digest('SHA-256', new TextEncoder().encode(s))).slice(0, 16)

  return {
    me: { publickey, nickname },
    async signData (data) {
      const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, firma.privateKey,
        new TextEncoder().encode(canon(data)))
      return { signature: b64(new Uint8Array(sig)), publickey }
    },
    async getEncryptionPubkey () { return encPub },
    async encrypt (recipients, plaintext) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
      const wrap = {}
      let ct = ''
      for (const r of recipients || []) {
        if (!r?.encryptionPubkey) continue
        let key
        try { key = await compartida(r.encryptionPubkey) } catch (_) { continue }
        const c = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
        ct = b64(new Uint8Array(c))
        wrap[await idDeLlave(r.encryptionPubkey)] = { iv: b64(iv), ct }
      }
      return { v: 2, iv: b64(iv), ct: '', wrap }
    },
    async decrypt (remitente, _token, sobre) {
      const key = await compartida(remitente)
      const mio = sobre?.wrap?.[await idDeLlave(encPub)]
      if (!mio) throw new Error('this device is not among the message recipients')
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(mio.iv) }, key, unb64(mio.ct))
      return { plaintext: new TextDecoder().decode(pt) }
    }
  }
}
