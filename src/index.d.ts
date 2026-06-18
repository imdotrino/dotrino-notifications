/** Texto bilingüe o plano. */
export type LocalizedText = string | { es?: string; en?: string }

export interface NotificationCategory {
  /** Clave estable de la categoría (se persiste en prefs). */
  key: string
  /** Etiqueta visible (bilingüe o plana). */
  label: LocalizedText
  /** Ayuda opcional bajo la etiqueta. */
  hint?: LocalizedText
  /** Valor por defecto (default: true = notifica). */
  default?: boolean
}

export interface NotifyOptions extends NotificationOptions {
  title?: string
  /** Handler de click (solo vía `new Notification`, no SW). */
  onClick?: (e: Event) => void
}

/** Provider de Web Push que la app inyecta (ver createVaultPushProvider). */
export interface PushProvider {
  supported?: () => boolean
  isEnabled?: () => boolean
  busy?: (() => boolean) | boolean
  error?: (() => string) | string
  enable?: () => Promise<boolean>
  disable?: () => Promise<boolean>
  ensureSubscribed?: () => Promise<void>
}

export interface NotificationsConfig {
  /** Namespace por app (scope de las preferencias). */
  storageKey: string
  categories: NotificationCategory[]
  /** Incluir preferencia/toggle de sonido (default: true). */
  sound?: boolean
  /** Web Push opcional. */
  push?: PushProvider
}

export interface NotificationsController {
  readonly storageKey: string
  readonly categories: NotificationCategory[]
  readonly hasSound: boolean
  readonly prefs: Record<string, boolean>
  readonly supported: boolean
  readonly soundEnabled: boolean
  permission(): NotificationPermission | 'unsupported'
  requestPermission(): Promise<NotificationPermission | 'unsupported'>
  shouldNotify(key?: string): boolean
  notify(key: string, opts?: NotifyOptions): Promise<Notification | null>
  get(key: string): boolean
  set(key: string, val: boolean): void
  subscribe(fn: () => void): () => void
  push: null | {
    readonly supported: boolean
    readonly enabled: boolean
    readonly busy: boolean
    readonly error: string
    enable(): Promise<boolean>
    disable(): Promise<boolean>
    ensureSubscribed(): Promise<void>
  }
}

/** Crea el controlador de notificaciones (data-agnostic, sin framework). */
export function createNotifications(config: NotificationsConfig): NotificationsController

export interface VaultPushProviderConfig {
  /** Cliente proxy del ecosistema (o getter) con enablePush/disablePush. */
  proxyClient: any | (() => any)
  /** Instancia Identity del vault (o getter, puede ser async). */
  identity: any | (() => any | Promise<any>)
  /** Namespace del flag local (por app). */
  storageKey?: string
}

/** Provider de Web Push concreto (todos los miembros son funciones llamables). */
export interface VaultPushProvider {
  supported(): boolean
  isEnabled(): boolean
  busy(): boolean
  error(): string
  enable(): Promise<boolean>
  disable(): Promise<boolean>
  ensureSubscribed(): Promise<void>
}

/** Provider de Web Push ligado al vault + proxy del ecosistema. */
export function createVaultPushProvider(cfg: VaultPushProviderConfig): VaultPushProvider

/** Sobre estándar de un acuse de apertura (lo que viaja por el proxy). */
export interface ShareReceiptEnvelope {
  /** marca + versión del sobre (= 1). */
  __ccn: number
  /** tipo de acuse ('opened' por defecto, extensible). */
  kind: string
  /** enlace compartido (vuelve al autor para re-ver el contenido). */
  url: string
  /** nombre/título del contenido, si la app lo pasó. */
  name?: string | null
  /** identidad del que abrió (siempre identificado por decisión del ecosistema). */
  from: { pubkey: string | null; nick: string | null }
  /** instante del acuse (ms epoch). */
  ts: number
}

export interface ShareReceiptsConfig {
  /** Cliente proxy del ecosistema (o getter): on('message',…) + sendByPubkey. */
  proxyClient: any | (() => any)
  /** Instancia Identity del vault (o getter, puede ser async). */
  identity: any | (() => any | Promise<any>)
  /** Controlador de createNotifications(...) (para notify/prefs). */
  notifications: NotificationsController
  /** Categoría de prefs a respetar/disparar (default 'shareOpened'). */
  category?: string
  /** Override del contenido: recibe el sobre, devuelve NotifyOptions o null. */
  render?: (env: ShareReceiptEnvelope) => (NotifyOptions | null)
  /** Idioma del render por defecto ('es'|'en'|'auto', default 'auto'). */
  lang?: string
  /** Ventana anti-spam por contenido en ms (default 24h). */
  throttleMs?: number
  /** Override del click (default: navegar a url). */
  onOpen?: (url: string, env: ShareReceiptEnvelope) => void
  /** Hook por acuse fresco entrante (además de notificar): para acumular (referidos, etc.). */
  onReceipt?: (env: ShareReceiptEnvelope) => void
}

export interface ShareReceipts {
  /** Lado del que ABRE: avisa al autor que abriste su contenido. */
  report(opts: { toPubkey: string; url: string; kind?: string; name?: string }): Promise<boolean>
  /** Lado AUTOR: empieza a escuchar acuses entrantes (idempotente). */
  start(): void
  /** Deja de escuchar. */
  stop(): void
  readonly category: string
  readonly RECEIPT_TAG: string
  readonly RECEIPT_VERSION: number
}

/** Motor común de acuses de apertura de contenido compartido. */
export function createShareReceipts(cfg: ShareReceiptsConfig): ShareReceipts

/** Empaqueta una pubkey (JWK string del vault) para un enlace de invitación/acuse (base64url exacto). */
export function packPubkey(pubkey: string): string
/** Desempaqueta la pubkey de un token de enlace. Devuelve null si es inválido. */
export function unpackPubkey(token: string): string | null

export class DotrinoNotifications extends HTMLElement {
  controller: NotificationsController | null
}

export default DotrinoNotifications

declare global {
  interface HTMLElementTagNameMap {
    'dotrino-notifications': DotrinoNotifications
  }
}
