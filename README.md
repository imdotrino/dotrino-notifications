# @dotrino/notifications

Notificaciones compartidas del ecosistema **Dotrino**. Unifica lo que cada
app reimplementaba por separado (messenger, eco, chess, pronóstico, gymbro):

1. **`createNotifications(config)`** — controlador *data-agnostic* y sin framework:
   permiso del navegador + **preferencias por categoría con scope por app** +
   disparo (`notify`) respetando permiso y prefs. Web Push opcional.
2. **`<dotrino-notifications>`** — Web Component (panel de ajustes): activar
   permiso, togglear cada categoría, sonido y push. Shadow DOM, bilingüe es/en,
   temable por CSS vars (`--ccn-*`). **Sin JS de terceros ni cookies.**
3. **`createVaultPushProvider(...)`** — Web Push (app cerrada) ligado al transporte
   del ecosistema (`dotrino-proxy-client`) y firmado por el vault de identidad.
4. **`createShareReceipts(...)`** — **acuses de apertura** de contenido compartido:
   el autor recibe una notificación (con el mismo enlace) cuando un tercero abre lo
   que compartió. Mismo transporte (proxy) e identidad (vault); contenido por la
   cola cifrada, no por el push.

El ecosistema es mixto Vue/vanilla → la UI va como **custom element** (mismo patrón
que `dotrino-support` / `dotrino-profile` / `dotrino-nav`).

## Instalar

```bash
npm i @dotrino/notifications
```

## Uso (controlador + disparo)

```js
import { createNotifications } from '@dotrino/notifications'

const notifications = createNotifications({
  storageKey: 'eco',                      // scope: namespacea las prefs por app
  categories: [
    { key: 'replies', label: { es: 'Respuestas', en: 'Replies' }, hint: { es: 'Cuando responden a tu eco.', en: 'When someone replies.' } },
    { key: 'reposts', label: { es: 'Reposts', en: 'Reposts' }, default: true },
  ],
  sound: true,                            // incluye toggle de sonido (default true)
})

// Disparar (no hace nada si falta permiso o la categoría está apagada):
await notifications.notify('replies', {
  title: 'Nueva respuesta',
  body: '@ada respondió tu eco',
  icon: '/icon-192.png',
  tag: 'eco-reply',
  onClick: () => location.assign('/#replies'),
})
```

`notify` usa el Service Worker (`registration.showNotification`) cuando hay uno
activo (mejor en móvil/PWA) y si no `new Notification`. El **sonido** lo controla
la preferencia `sound` (vía el flag `silent` del SO).

## Panel de ajustes (Web Component)

```js
import '@dotrino/notifications'   // registra el custom element
```

```html
<dotrino-notifications modal lang="es"></dotrino-notifications>
```

```js
// tras montar, asigná el controlador (propiedad JS, no atributo):
document.querySelector('dotrino-notifications').controller = notifications
```

En Vue 3, configurá `isCustomElement: (tag) => tag.startsWith('dotrino-')` en
`compilerOptions` del plugin de Vue, y enlazá el controlador con un `ref`:

```html
<dotrino-notifications :ref="el => el && (el.controller = notifications)" modal />
```

### Atributos

| Atributo  | Descripción |
|-----------|-------------|
| `modal`   | envuelve en backdrop (click fuera = cerrar, emite `cc-notif-close`) |
| `heading` | título del panel (override) |
| `lang`    | `es` \| `en` \| `auto` (default `auto`) |

### Propiedad JS

- `.controller` — el objeto devuelto por `createNotifications(...)`.

### Eventos (bubbles, composed)

- `cc-notif-change` — `detail { key, value }` (toggle de categoría/sonido).
- `cc-notif-permission` — `detail { permission }` (tras pedir permiso).
- `cc-notif-push` — `detail { enabled }` (toggle de push).
- `cc-notif-close` — cerrar (X o backdrop en modo `modal`).

## Web Push (app cerrada)

```js
import { createNotifications, createVaultPushProvider } from '@dotrino/notifications'
import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { Identity } from '@dotrino/identity'

const notifications = createNotifications({
  storageKey: 'messenger',
  categories: [ /* … */ ],
  push: createVaultPushProvider({
    proxyClient: () => getWebSocketProxyClient(),
    identity: () => Identity.connect(),     // instancia o getter (async ok)
    storageKey: 'messenger',
  }),
})

// Re-registra la subscription tras cada identify (los endpoints rotan):
await notifications.push.ensureSubscribed()
```

El "timbre" **no transporta contenido**: el Service Worker despierta y la app
reconecta e `identify()` drena la cola cifrada del proxy. La subscription se liga
a la **misma pubkey del vault** usada en `identify`, con un sobre firmado por el vault.

## Acuses de apertura (`createShareReceipts`)

Avisa al **autor** cuando un tercero **abre** un contenido que compartió, con el
**mismo enlace** de vuelta (para re-ver el contenido desde la notificación). Solo
funciona si el enlace permite recuperar la **pubkey del autor** (p. ej. el blob
firmado del pronosticador): así el que abre puede enrutar el acuse por
`sendByPubkey` (cola offline 24h del proxy).

```js
import { createNotifications, createShareReceipts } from '@dotrino/notifications'
import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { Identity } from '@dotrino/identity'

const notifications = createNotifications({
  storageKey: 'mundial',
  categories: [
    { key: 'shareOpened', label: { es: 'Aperturas de lo que compartí', en: 'Opens of what I shared' } },
  ],
})

const receipts = createShareReceipts({
  proxyClient: () => getWebSocketProxyClient(),
  identity: () => Identity.connect(),
  notifications,                  // dispara notify('shareOpened', …) con data.url
  // render(env) → { title, body, ... } | null  (opcional: personaliza el contenido)
})

// Lado AUTOR (escuchar acuses entrantes mientras la app está abierta):
receipts.start()

// Lado del que ABRE (al importar contenido AJENO firmado):
await receipts.report({ toPubkey: parsed.publickey, url: sharedUrl, name: parsed.name })
```

- **Acumular (referidos)**: pasá `onReceipt(env)` para que tu app sume por acuse
  fresco (además de la notificación). Para enlaces de invitación con tu pubkey
  embebida usá `packPubkey(pubkey)` → token base64url para `#i=<token>`, y
  `unpackPubkey(token)` del lado que abre (matchea byte a byte el ruteo del proxy).
- **Identidad del que abre**: el sobre incluye **siempre** `from { pubkey, nick }`.
- **Anti-spam**: `report` aplica throttle por `(toPubkey|url)` (default 24h).
- **Propio**: `report` es no-op si el contenido es tuyo (`toPubkey === tu pubkey`).
- **Contenido por defecto** (mismo en toda app, es/en): *"Abrieron tu contenido"* +
  *«name» · nick*. Pásalo a medida con `render(env)`.
- **Offline**: el contenido viaja por la **cola del proxy** (no por el push). El
  push solo "timbra"; al reabrir la app, `identify()` drena la cola y aparece la
  notificación con el enlace. El click usa `data.url` — tu SW
  (`dotrino-push-sw.js`) ya navega a `event.notification.data.url`.

> Apps de **partida en vivo** (chess/cuarenta comparten `#table=<token>` sin pubkey
> del autor) no usan este acuse: el anfitrión ya ve el "join" por el canal. Pueden
> enrutar ese evento por el mismo `createNotifications` para una UX uniforme.

## Tema (CSS custom properties)

```css
dotrino-notifications {
  --ccn-bg: #12161d;
  --ccn-accent: #2dd4bf;
  --ccn-radius: 14px;
}
```

`--ccn-bg`, `--ccn-bg-2..4`, `--ccn-border`, `--ccn-text`, `--ccn-muted`,
`--ccn-accent`, `--ccn-accent-text`, `--ccn-danger`, `--ccn-gold`, `--ccn-radius`,
`--ccn-font`.

## Licencia

MIT
