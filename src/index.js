/**
 * @dotrino/notifications
 *
 * Notificaciones compartidas del ecosistema Dotrino. Unifica lo que cada app
 * reimplementaba por separado (messenger, eco, chess, pronóstico, gymbro):
 *
 *   1) createNotifications(config)  — controlador data-agnostic, framework-free:
 *        permiso del navegador + preferencias por categoría (con SCOPE POR APP vía
 *        storageKey) + disparo (notify) respetando permiso/prefs. Opcionalmente
 *        cablea Web Push (app cerrada) a través de un provider.
 *
 *   2) <dotrino-notifications> — Web Component (panel de ajustes): activa el
 *        permiso, togglea cada categoría, el sonido y el push. Shadow DOM,
 *        bilingüe es/en, temable por CSS vars (--ccn-*). Sin JS de terceros ni cookies.
 *
 *   3) createVaultPushProvider({ proxyClient, identity, storageKey }) — helper que
 *        liga el Web Push al transporte del ecosistema (proxy-client) firmado por
 *        el vault de identidad. Misma lógica que tenían messenger y pronóstico.
 *
 * El ecosistema es mixto Vue/vanilla → la UI reutilizable va como custom element
 * (mismo patrón que dotrino-support / dotrino-profile / dotrino-nav).
 */

/* ============================================================================
 * 1) Controlador  ──  createNotifications(config)
 * ==========================================================================*/

const LS_PREFIX = 'cc-notif:'

const isBrowser = typeof window !== 'undefined'
function _supported () {
  return isBrowser && typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

/**
 * @param {object} config
 * @param {string} config.storageKey   namespace por app (scope). Ej: 'eco', 'messenger'.
 * @param {Array}  config.categories   [{ key, label, hint?, default? }] (label/hint:
 *                                      string o { es, en }).
 * @param {boolean} [config.sound=true] incluir preferencia/toggle de sonido.
 * @param {object} [config.push]       provider de Web Push (ver createVaultPushProvider).
 */
export function createNotifications (config = {}) {
  const storageKey = config.storageKey || 'default'
  const categories = Array.isArray(config.categories) ? config.categories : []
  const hasSound = config.sound !== false
  const push = config.push || null

  const LS_KEY = LS_PREFIX + storageKey

  // ----- preferencias (localStorage, por dispositivo) -----
  const defaults = {}
  for (const c of categories) defaults[c.key] = c.default !== false
  if (hasSound) defaults.sound = true

  function _load () {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') } }
    catch { return { ...defaults } }
  }
  const prefs = _load()
  function _save () { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)) } catch (_) {} }

  // ----- suscriptores (re-render del Web Component, etc.) -----
  const subs = new Set()
  function _emit () { for (const fn of subs) { try { fn() } catch (_) {} } }

  // ----- permiso -----
  function permission () {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission
  }
  async function requestPermission () {
    if (typeof Notification === 'undefined') return 'unsupported'
    let p = Notification.permission
    if (p === 'default') { try { p = await Notification.requestPermission() } catch (_) {} }
    _emit()
    return p
  }

  // ----- disparo -----
  function shouldNotify (key) {
    if (key == null) return true
    return prefs[key] !== false
  }

  /**
   * Lanza una notificación si: hay soporte, permiso 'granted' y la categoría está
   * activa. Usa el Service Worker (registration.showNotification) cuando está
   * disponible (mejor en móvil/PWA), si no `new Notification`. El sonido lo
   * controla la preferencia `sound` (silent del SO).
   * @returns {Promise<Notification|null>}
   */
  async function notify (key, opts = {}) {
    if (!_supported() || permission() !== 'granted') return null
    if (!shouldNotify(key)) return null
    const { title = '', onClick, silent, ...rest } = opts
    const beSilent = silent != null ? !!silent : !(hasSound && prefs.sound !== false)
    const noteOpts = { silent: beSilent, ...rest }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(title, noteOpts)
        return null
      }
    } catch (_) { /* cae a new Notification */ }
    try {
      const n = new Notification(title, noteOpts)
      if (typeof onClick === 'function') {
        n.onclick = (e) => { try { window.focus() } catch (_) {} ; onClick(e) }
      }
      return n
    } catch (_) { return null }
  }

  // ----- API de prefs -----
  function get (key) { return prefs[key] }
  function set (key, val) {
    if (!(key in defaults)) return
    prefs[key] = !!val
    _save()
    _emit()
  }

  const ctrl = {
    storageKey,
    categories,
    hasSound,
    prefs,
    get supported () { return _supported() },
    permission,
    requestPermission,
    shouldNotify,
    notify,
    get,
    set,
    get soundEnabled () { return hasSound && prefs.sound !== false },
    subscribe (fn) { subs.add(fn); return () => subs.delete(fn) },
    _emit,
    push: null,
  }

  // ----- Web Push opcional -----
  if (push) {
    ctrl.push = {
      get supported () { return typeof push.supported === 'function' ? !!push.supported() : _supported() },
      get enabled () { return typeof push.isEnabled === 'function' ? !!push.isEnabled() : false },
      get busy () { return typeof push.busy === 'function' ? !!push.busy() : !!push.busy },
      get error () { return typeof push.error === 'function' ? (push.error() || '') : (push.error || '') },
      async enable () { const r = push.enable ? await push.enable() : false; _emit(); return r },
      async disable () { const r = push.disable ? await push.disable() : false; _emit(); return r },
      async ensureSubscribed () { if (push.ensureSubscribed) await push.ensureSubscribed(); _emit() },
    }
  }

  return ctrl
}

/* ============================================================================
 * 2) Helper de Web Push ligado al vault + proxy (transporte del ecosistema)
 * ==========================================================================*/

/**
 * Provider de Web Push para createNotifications({ push }). Replica la lógica que
 * tenían messenger/pronóstico: opt-in del usuario a recibir un "timbre" con la
 * app cerrada; la subscription se liga a la MISMA pubkey del vault usada en
 * identify, con un sobre firmado por el vault. El SW de la PWA muestra el aviso.
 *
 * @param {object} cfg
 * @param {object|function} cfg.proxyClient  cliente proxy (o getter) con enablePush/disablePush.
 * @param {object|function} cfg.identity     instancia Identity (o getter async) del vault.
 * @param {string} cfg.storageKey            namespace del flag local (por app).
 */
export function createVaultPushProvider ({ proxyClient, identity, storageKey = 'default' } = {}) {
  const LS_KEY = 'cc-push:' + storageKey
  const getProxy = typeof proxyClient === 'function' ? proxyClient : () => proxyClient
  const getId = typeof identity === 'function' ? identity : () => identity

  let _enabled = isBrowser && localStorage.getItem(LS_KEY) === '1'
  let _busy = false
  let _error = ''

  function supported () {
    return isBrowser && typeof Notification !== 'undefined' &&
      'serviceWorker' in navigator && 'PushManager' in window
  }

  async function _vault () {
    const id = await getId()
    const publicKey = id && id.me && id.me.publickey
    if (!id || !publicKey) throw new Error('Vault de identidad no disponible')
    return { publicKey, sign: (d) => id.signData(d) }
  }

  async function enable () {
    _error = ''
    if (!supported()) { _error = 'Tu navegador no soporta notificaciones push'; return false }
    _busy = true
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { _error = 'Permiso de notificaciones denegado'; return false }
      const { publicKey, sign } = await _vault()
      await getProxy().enablePush({ publicKey, sign })
      _enabled = true
      try { localStorage.setItem(LS_KEY, '1') } catch (_) {}
      return true
    } catch (e) { _error = (e && e.message) || String(e); return false }
    finally { _busy = false }
  }

  async function disable () {
    _error = ''
    _busy = true
    try {
      let publicKey, sign
      try { ({ publicKey, sign } = await _vault()) } catch (_) { /* igual cancelamos local */ }
      await getProxy().disablePush({ publicKey, sign })
      _enabled = false
      try { localStorage.removeItem(LS_KEY) } catch (_) {}
      return true
    } catch (e) { _error = (e && e.message) || String(e); return false }
    finally { _busy = false }
  }

  // Re-registra la subscription tras cada identify (los endpoints rotan).
  // Silencioso: si el usuario no optó o el permiso no está, no hace nada.
  async function ensureSubscribed () {
    if (!_enabled || !supported() || Notification.permission !== 'granted') return
    try {
      const { publicKey, sign } = await _vault()
      await getProxy().enablePush({ publicKey, sign })
    } catch (e) { console.warn('[cc-notif] ensureSubscribed falló:', (e && e.message) || e) }
  }

  return {
    supported,
    isEnabled: () => _enabled,
    busy: () => _busy,
    error: () => _error,
    enable,
    disable,
    ensureSubscribed,
  }
}

/* ============================================================================
 * 3) Acuses de apertura  ──  createShareReceipts(...)
 *
 * Mecanismo COMÚN para que el autor de un contenido compartido reciba un aviso
 * cuando un tercero abre el enlace, con el MISMO enlace de vuelta (para re-ver
 * el contenido desde la notificación). Reutilizable por cualquier app del
 * ecosistema.
 *
 *   - Lado del que ABRE:   report({ toPubkey, url, kind, name })  → manda un
 *       sobre firmable por la cola offline del proxy (sendByPubkey, 24h). No
 *       avisa si el contenido es propio (toPubkey === mi pubkey) y aplica
 *       throttle por (toPubkey|url) para no spamear al reabrir.
 *   - Lado AUTOR:          start()  → escucha mensajes del proxy, filtra los
 *       sobres de acuse (__ccn) y dispara una notificación local con el enlace
 *       (data.url). El CONTENIDO por defecto es el mismo en toda app; la app
 *       puede inyectar render(env) para personalizarlo.
 *
 * El transporte y la identidad NO se reimplementan: se inyectan los mismos
 * `proxyClient` (dotrino-proxy-client) e `identity` (vault) que usa el
 * resto del ecosistema. El contenido viaja por la cola CIFRADA del proxy, no
 * por el push (el push solo "timbra" sin contenido — política del ecosistema).
 * ==========================================================================*/

const RECEIPT_TAG = '__ccn'        // marca del sobre (envelope) de acuse
const RECEIPT_VERSION = 1
const LS_THROTTLE = 'cc-receipt:'  // namespace del anti-spam por contenido

const RECEIPT_I18N = {
  es: {
    openedTitle: 'Abrieron tu contenido',
    openedBodyNamed: (name, nick) => nick ? `Abrieron «${name}» · ${nick}` : `Abrieron «${name}»`,
    openedBodyAnon: (nick) => nick ? `${nick} abrió lo que compartiste` : 'Alguien abrió lo que compartiste',
  },
  en: {
    openedTitle: 'Your content was opened',
    openedBodyNamed: (name, nick) => nick ? `“${name}” opened · ${nick}` : `“${name}” opened`,
    openedBodyAnon: (nick) => nick ? `${nick} opened what you shared` : 'Someone opened what you shared',
  },
}

function _receiptLang (lang) {
  const a = (lang || 'auto').toLowerCase()
  if (a === 'es' || a === 'en') return a
  const nav = (isBrowser && navigator.language || 'es').slice(0, 2)
  return nav === 'en' ? 'en' : 'es'
}

/**
 * Crea el motor de acuses de apertura (data-agnostic, sin framework).
 *
 * @param {object} cfg
 * @param {object|function} cfg.proxyClient  cliente proxy del ecosistema (o getter).
 *        Debe exponer `on('message', (from, payload) => …)` y `sendByPubkey(pk, payload)`.
 * @param {object|function} cfg.identity     instancia Identity del vault (o getter async).
 * @param {object} cfg.notifications         controlador de createNotifications(...) (para notify/prefs).
 * @param {string} [cfg.category='shareOpened']  categoría de prefs a respetar/disparar.
 * @param {(env:object)=>(object|null)} [cfg.render]  override del contenido: recibe el sobre
 *        y devuelve { title, body, ...NotifyOptions } o null para ignorar. Si no se pasa,
 *        usa el render por defecto (mismo contenido en toda app), bilingüe es/en.
 * @param {string} [cfg.lang='auto']         idioma del render por defecto.
 * @param {number} [cfg.throttleMs=86400000] ventana anti-spam por contenido (default 24h).
 * @param {(url:string,env:object)=>void} [cfg.onOpen]  override del click (default: navegar a url).
 */
export function createShareReceipts (cfg = {}) {
  const getProxy = typeof cfg.proxyClient === 'function' ? cfg.proxyClient : () => cfg.proxyClient
  const getId = typeof cfg.identity === 'function' ? cfg.identity : () => cfg.identity
  const notifications = cfg.notifications || null
  const category = cfg.category || 'shareOpened'
  const render = typeof cfg.render === 'function' ? cfg.render : null
  const lang = cfg.lang || 'auto'
  const throttleMs = cfg.throttleMs != null ? cfg.throttleMs : 24 * 60 * 60 * 1000
  const onReceipt = typeof cfg.onReceipt === 'function' ? cfg.onReceipt : null
  const onOpen = typeof cfg.onOpen === 'function'
    ? cfg.onOpen
    : (url) => { try { if (isBrowser && url) location.assign(url) } catch (_) {} }

  let _off = null
  const _seen = new Set()   // dedup de acuses entrantes (from|url|ts)

  async function _myPubkey () {
    try {
      const id = await getId()
      return (id && id.me && id.me.publickey) || null
    } catch (_) { return null }
  }

  // ---- anti-spam: 1 acuse por (toPubkey|url) por ventana (localStorage) ----
  function _throttled (toPubkey, url) {
    if (!isBrowser || throttleMs <= 0) return false
    try {
      const k = LS_THROTTLE + _hash(toPubkey + '|' + url)
      const last = Number(localStorage.getItem(k) || 0)
      const now = Date.now()
      if (now - last < throttleMs) return true
      localStorage.setItem(k, String(now))
      return false
    } catch (_) { return false }
  }

  // Hash corto y estable (djb2) para no guardar la URL completa en la clave.
  function _hash (s) {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return (h >>> 0).toString(36)
  }

  /**
   * Lado del que ABRE: avisa al autor (toPubkey) que abriste su contenido.
   * No-op si es contenido propio o si el throttle lo bloquea. Devuelve true si
   * se encoló el acuse.
   * @returns {Promise<boolean>}
   */
  async function report ({ toPubkey, url, kind = 'opened', name } = {}) {
    if (!toPubkey || !url) return false
    const mine = await _myPubkey()
    if (mine && mine === toPubkey) return false           // no avisarme a mí mismo
    if (_throttled(toPubkey, url)) return false
    // Decisión del ecosistema: identificar SIEMPRE al que abre.
    let from = { pubkey: mine || null, nick: null }
    try {
      const id = await getId()
      from = { pubkey: (id && id.me && id.me.publickey) || mine || null, nick: (id && id.me && id.me.nickname) || null }
    } catch (_) {}
    const env = { [RECEIPT_TAG]: RECEIPT_VERSION, kind, url, name: name || null, from, ts: Date.now() }
    try {
      const proxy = getProxy()
      if (typeof proxy.ensureConnected === 'function') { try { await proxy.ensureConnected() } catch (_) {} }
      proxy.sendByPubkey(toPubkey, env)
      return true
    } catch (e) {
      console.warn('[cc-notif] report (acuse) falló:', (e && e.message) || e)
      return false
    }
  }

  // Construye {title, body, ...} por defecto a partir del sobre (mismo contenido
  // en toda app). La app puede sobreescribirlo con cfg.render.
  function _defaultRender (env) {
    const t = RECEIPT_I18N[_receiptLang(lang)]
    const nick = env.from && env.from.nick
    const title = t.openedTitle
    const body = env.name ? t.openedBodyNamed(env.name, nick) : t.openedBodyAnon(nick)
    return { title, body }
  }

  function _handle (env) {
    if (!env || env[RECEIPT_TAG] !== RECEIPT_VERSION || !env.url) return
    const key = `${(env.from && env.from.pubkey) || ''}|${env.url}|${env.ts || ''}`
    if (_seen.has(key)) return
    _seen.add(key)
    // Hook para que la app ACUMULE (p. ej. referidos) además de notificar. Se
    // llama una vez por acuse fresco; la app hace su propio dedup durable.
    if (onReceipt) { try { onReceipt(env) } catch (_) {} }
    const rendered = render ? render(env) : _defaultRender(env)
    if (!rendered) return
    const { title, body, ...rest } = rendered
    if (!notifications || typeof notifications.notify !== 'function') return
    notifications.notify(category, {
      title: title || '',
      body: body || '',
      tag: rest.tag || ('cc-receipt:' + _hash(env.url)),
      data: { url: env.url, ...(rest.data || {}) },
      onClick: () => onOpen(env.url, env),
      ...rest,
    })
  }

  /** Lado AUTOR: empieza a escuchar acuses entrantes (idempotente). */
  function start () {
    if (_off) return
    const proxy = getProxy()
    if (!proxy || typeof proxy.on !== 'function') return
    _off = proxy.on('message', (_from, payload) => {
      const env = (typeof payload === 'object' && payload) ? payload : _tryParse(payload)
      _handle(env)
    })
  }

  function _tryParse (s) {
    if (typeof s !== 'string') return null
    try { return JSON.parse(s) } catch (_) { return null }
  }

  function stop () { if (_off) { try { _off() } catch (_) {} _off = null } }

  return { report, start, stop, category, RECEIPT_TAG, RECEIPT_VERSION }
}

/* ----------------------------------------------------------------------------
 * Pubkey ↔ token compacto para enlaces de invitación/acuse.
 *
 * El acuse se enruta por la MISMA pubkey (JWK string) que el destinatario usó en
 * `identify`. Para meterla en un enlace compartible (`#i=<token>`) la empaquetamos
 * como base64url del string EXACTO (no comprimimos el punto P-256: así el ruteo
 * por `sendByPubkey` matchea byte a byte sin reconstruir el JWK). Quien abre el
 * enlace desempaqueta la pubkey del autor y le manda el acuse.
 * --------------------------------------------------------------------------*/

function _b64urlEncode (str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode (s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Empaqueta una pubkey (JWK string del vault) para un enlace: base64url exacto. */
export function packPubkey (pubkey) { return _b64urlEncode(String(pubkey)); }
/** Desempaqueta la pubkey de un token de enlace. Devuelve null si es inválido. */
export function unpackPubkey (token) { try { return _b64urlDecode(String(token)); } catch (_) { return null; } }

/* ============================================================================
 * 4) Web Component  ──  <dotrino-notifications>  (panel de ajustes)
 * ==========================================================================*/

const I18N = {
  es: {
    heading: 'Notificaciones',
    intro: 'Elige qué quieres que te avise esta app.',
    enable: 'Activar notificaciones',
    enableHint: 'Permite que el navegador te muestre avisos.',
    denied: 'Permiso bloqueado en el navegador. Actívalo en los ajustes del sitio.',
    unsupported: 'Tu navegador no soporta notificaciones.',
    sound: 'Sonido',
    soundHint: 'Suena al notificar.',
    push: 'Aviso con la app cerrada',
    pushHint: 'Recibe un timbre aunque no tengas la pestaña abierta.',
    pushDenied: '(Permiso bloqueado en el navegador.)',
  },
  en: {
    heading: 'Notifications',
    intro: 'Choose what this app may alert you about.',
    enable: 'Enable notifications',
    enableHint: 'Let the browser show you alerts.',
    denied: 'Permission blocked in the browser. Enable it in the site settings.',
    unsupported: 'Your browser does not support notifications.',
    sound: 'Sound',
    soundHint: 'Play a sound when notifying.',
    push: 'Alerts when the app is closed',
    pushHint: 'Get pinged even without the tab open.',
    pushDenied: '(Permission blocked in the browser.)',
  },
}

const STYLE = `
  :host {
    --_bg: var(--ccn-bg, #12161d);
    --_bg-2: var(--ccn-bg-2, #171c24);
    --_bg-3: var(--ccn-bg-3, #1f2630);
    --_bg-4: var(--ccn-bg-4, #2a3550);
    --_border: var(--ccn-border, rgba(255,255,255,0.16));
    --_text: var(--ccn-text, #e9eef3);
    --_muted: var(--ccn-muted, #94a1b0);
    --_accent: var(--ccn-accent, #2dd4bf);
    --_accent-text: var(--ccn-accent-text, #042038);
    --_danger: var(--ccn-danger, #ef6b6b);
    --_radius: var(--ccn-radius, 14px);
    --_font: var(--ccn-font, system-ui, sans-serif);
    display: block; color: var(--_text); font-family: var(--_font);
  }
  :host([modal]) .wrap {
    position: fixed; inset: 0; z-index: 2147483000;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  .card {
    background: var(--_bg); border: 1px solid var(--_border);
    border-radius: var(--_radius); width: 100%; max-width: 460px;
    display: flex; flex-direction: column; overflow: hidden;
  }
  :host(:not([modal])) .card { border: 0; border-radius: 0; background: transparent; }
  .head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--_border);
  }
  :host(:not([modal])) .head { padding: 0 0 12px; }
  .title { font-weight: 700; font-size: 17px; margin: 0; }
  .x { background: transparent; border: 0; font-size: 22px; cursor: pointer; color: var(--_muted); width: 32px; height: 32px; border-radius: 8px; line-height: 1; }
  .x:hover { background: var(--_bg-3); color: var(--_text); }
  .body { padding: 16px 20px; display: flex; flex-direction: column; }
  :host(:not([modal])) .body { padding: 0; }
  .intro { margin: 0 0 12px; font-size: 13px; color: var(--_muted); }

  .cta {
    display: flex; flex-direction: column; gap: 4px;
    background: var(--_bg-2); border: 1px solid var(--_border);
    border-radius: 10px; padding: 14px; margin-bottom: 12px;
  }
  .cta .btn {
    align-self: flex-start; margin-top: 8px; font: inherit; font-weight: 700;
    background: var(--_accent); color: var(--_accent-text); border: 0;
    border-radius: 10px; padding: 9px 16px; cursor: pointer;
  }
  .cta .btn:hover { filter: brightness(1.05); }
  .cta-label { font-weight: 600; font-size: 14px; }
  .cta-hint { font-size: 12px; color: var(--_muted); }
  .note { font-size: 12.5px; color: var(--_muted); }
  .note.warn { color: var(--ccn-gold, #ffd166); }

  .opt {
    display: flex; align-items: center; gap: 14px;
    padding: 12px 0; border-top: 1px solid var(--_border);
  }
  .opt:first-of-type { border-top: 0; }
  .opt.push { margin-top: 4px; border-top: 1px solid var(--_border); }
  .opt-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .opt-label { font-size: 14px; font-weight: 600; }
  .opt-hint { font-size: 12px; color: var(--_muted); line-height: 1.4; }
  .error { margin: 10px 0 0; font-size: 13px; color: var(--_danger); }

  .switch {
    flex-shrink: 0; width: 46px; height: 26px; border-radius: 999px; border: 0;
    background: var(--_bg-4); position: relative; cursor: pointer;
    transition: background 160ms ease-out; padding: 0;
  }
  .switch.on { background: var(--_accent); }
  .switch[disabled] { opacity: .5; cursor: not-allowed; }
  .knob {
    position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
    border-radius: 50%; background: #fff; transition: transform 160ms ease-out;
  }
  .switch.on .knob { transform: translateX(20px); }
`

function _txt (v, lang) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return v[lang] || v.es || v.en || ''
}

// Fallback fuera del navegador (SSR / tests Node): permite importar el módulo
// sin DOM. El custom element solo se registra en navegador (ver más abajo).
const _HTMLElement = (typeof HTMLElement !== 'undefined') ? HTMLElement : class {}

class DotrinoNotifications extends _HTMLElement {
  static get observedAttributes () { return ['modal', 'heading', 'lang'] }

  constructor () {
    super()
    this.attachShadow({ mode: 'open' })
    this._ctrl = null
    this._unsub = null
    this._onClick = this._onClick.bind(this)
  }

  set controller (c) {
    if (this._unsub) { this._unsub(); this._unsub = null }
    this._ctrl = c || null
    if (this._ctrl && typeof this._ctrl.subscribe === 'function') {
      this._unsub = this._ctrl.subscribe(() => this._render())
    }
    this._render()
  }
  get controller () { return this._ctrl }

  connectedCallback () { this._render() }
  disconnectedCallback () { if (this._unsub) { this._unsub(); this._unsub = null } }
  attributeChangedCallback () { this._render() }

  _lang () {
    const a = (this.getAttribute('lang') || 'auto').toLowerCase()
    if (a === 'es' || a === 'en') return a
    const nav = (isBrowser && navigator.language || 'es').slice(0, 2)
    return nav === 'en' ? 'en' : 'es'
  }

  _esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ))
  }

  _emit (type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
  }

  async _onClick (e) {
    const c = this._ctrl
    if (!c) return
    const t = e.target.closest('button[data-act]')
    if (!t) {
      // Click en el backdrop (solo modal): cerrar si fue directo sobre .wrap.
      if (this.hasAttribute('modal') && e.target === e.currentTarget) this._emit('cc-notif-close', {})
      return
    }
    const act = t.getAttribute('data-act')
    if (act === 'close') { this._emit('cc-notif-close', {}) }
    else if (act === 'enable') {
      const p = await c.requestPermission()
      this._emit('cc-notif-permission', { permission: p })
    }
    else if (act === 'toggle') {
      const key = t.getAttribute('data-key')
      const val = !c.get(key)
      c.set(key, val)
      this._emit('cc-notif-change', { key, value: val })
    }
    else if (act === 'push') {
      if (!c.push) return
      const turnOn = !c.push.enabled
      if (turnOn) await c.push.enable(); else await c.push.disable()
      this._emit('cc-notif-push', { enabled: c.push.enabled })
    }
  }

  _switch (on, { key, act, disabled } = {}) {
    const attrs = `data-act="${act}"${key ? ` data-key="${this._esc(key)}"` : ''}${disabled ? ' disabled' : ''}`
    return `<button type="button" class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" ${attrs}><span class="knob"></span></button>`
  }

  _render () {
    const sr = this.shadowRoot
    const c = this._ctrl
    const lang = this._lang()
    const t = I18N[lang]
    const isModal = this.hasAttribute('modal')
    const heading = this.getAttribute('heading') || t.heading

    if (!c) { sr.innerHTML = `<style>${STYLE}</style><div class="wrap"><div class="card"></div></div>`; return }

    const perm = c.permission()
    const supported = c.supported

    let inner = ''
    if (!supported || perm === 'unsupported') {
      inner += `<p class="note warn">${this._esc(t.unsupported)}</p>`
    } else if (perm === 'denied') {
      inner += `<p class="note warn">${this._esc(t.denied)}</p>`
    } else if (perm === 'default') {
      inner += `<div class="cta">
        <span class="cta-label">${this._esc(t.enable)}</span>
        <span class="cta-hint">${this._esc(t.enableHint)}</span>
        <button type="button" class="btn" data-act="enable">${this._esc(t.enable)}</button>
      </div>`
    }

    // Categorías (se guardan aunque el permiso no esté concedido).
    for (const cat of c.categories) {
      inner += `<div class="opt">
        <div class="opt-text">
          <span class="opt-label">${this._esc(_txt(cat.label, lang))}</span>
          ${cat.hint ? `<span class="opt-hint">${this._esc(_txt(cat.hint, lang))}</span>` : ''}
        </div>
        ${this._switch(c.get(cat.key) !== false, { key: cat.key, act: 'toggle' })}
      </div>`
    }

    // Sonido
    if (c.hasSound) {
      inner += `<div class="opt">
        <div class="opt-text">
          <span class="opt-label">${this._esc(t.sound)}</span>
          <span class="opt-hint">${this._esc(t.soundHint)}</span>
        </div>
        ${this._switch(c.soundEnabled, { key: 'sound', act: 'toggle' })}
      </div>`
    }

    // Push (app cerrada)
    if (c.push && c.push.supported) {
      const pDenied = perm === 'denied'
      inner += `<div class="opt push">
        <div class="opt-text">
          <span class="opt-label">${this._esc(t.push)}</span>
          <span class="opt-hint">${this._esc(t.pushHint)}${pDenied ? ' ' + this._esc(t.pushDenied) : ''}</span>
        </div>
        ${this._switch(c.push.enabled, { act: 'push', disabled: c.push.busy || pDenied })}
      </div>`
      if (c.push.error) inner += `<p class="error">${this._esc(c.push.error)}</p>`
    }

    sr.innerHTML = `<style>${STYLE}</style>
      <div class="wrap">
        <div class="card" data-card>
          <div class="head">
            <h2 class="title">${this._esc(heading)}</h2>
            ${isModal ? '<button type="button" class="x" data-act="close" aria-label="×">×</button>' : ''}
          </div>
          <div class="body">
            <p class="intro">${this._esc(t.intro)}</p>
            ${inner}
          </div>
        </div>
      </div>`

    // Un solo listener en .wrap: los botones se resuelven por data-act; el click
    // directo en el backdrop (e.target === .wrap) cierra (solo en modal).
    sr.querySelector('.wrap').addEventListener('click', this._onClick)
  }
}

if (isBrowser && !customElements.get('dotrino-notifications')) {
  customElements.define('dotrino-notifications', DotrinoNotifications)
}

export { DotrinoNotifications }
export default DotrinoNotifications
