// EL TRINO: el sonido de TODOS los avisos de Dotrino, uno solo para todo el ecosistema (dueño,
// 2026-09-30). En iOS y Android lo da `DotrinoRing` de dotrino-native; este es el mismo, para la
// web. El sonido es el original (`sound/trinos/trino-01a.wav` en la raíz del ecosistema),
// convertido solo de formato:
//
//     ffmpeg -i trino-01a.wav -c:a libmp3lame -q:a 4 src/ring.mp3
//
// MP3 y no Ogg porque lo abren todos los navegadores (Safari no siempre abre Vorbis).
//
// Va como asset y no embebido: lo que llega al bundle es una URL. Vite lo copia a `dist/` y por
// CDN `import.meta.url` ya es la URL del paquete. Este módulo no importa nada más, así que quien
// solo quiere el trino no se trae el panel de notificaciones: `@dotrino/notifications/ring`.
export const RING_URL = new URL('./ring.mp3', import.meta.url).href

// EL TRINO DE TERMINADO: OTRO trino, para «lo que pediste ya acabó» (una consola de Dotrino Terminal
// que terminó), distinto del de aviso para que se distingan de oído (dueño, 2026-10-14). Es
// `sound/trinos/trino-02b.wav` de la raíz del ecosistema, convertido igual que el de aviso:
//
//     ffmpeg -i trino-02b-<nivel>.wav -c:a libmp3lame -q:a 4 src/done-<nivel>.mp3
//
// Tres versiones (dueño, 2026-10-17), las mismas de la app de escritorio del terminal: `high` es el
// original, y `standard` y `low` van 4,5 y 12,5 dB por debajo (`sound/trinos/trino-02b-<nivel>.wav`).
// Dotrino Terminal toca la `low`: junto a una terminal el original sonaba muy fuerte. Cada URL va
// escrita entera para que Vite vea los tres archivos.
// El mismo en iOS y Android (`DotrinoRing.playDone`) y en la app de escritorio del terminal.
export const DONE_URLS = Object.freeze({
  low: new URL('./done-low.mp3', import.meta.url).href,
  standard: new URL('./done-standard.mp3', import.meta.url).href,
  high: new URL('./done-high.mp3', import.meta.url).href,
})
export const DONE_URL = DONE_URLS.high

/** How loud the trino plays by default, over the volume the person set (0…1). */
export const RING_VOLUME = 0.6

/**
 * Plays the trino now. Rejects when the browser does not let the page sound (`NotAllowedError`:
 * nobody has touched the page yet) — the caller decides what to do with that; it is not hidden here.
 * @param {{ volume?: number }} [opts]
 * @returns {Promise<void>}
 */
export function playRing ({ volume = RING_VOLUME } = {}) {
  return play(RING_URL, volume)
}

/**
 * Plays the "done" trino now: what you asked for has finished. Rejects like `playRing`, and throws
 * on a level that does not exist.
 * @param {{ volume?: number, level?: 'low' | 'standard' | 'high' }} [opts]
 * @returns {Promise<void>}
 */
export function playDone ({ volume = RING_VOLUME, level = 'high' } = {}) {
  const url = DONE_URLS[level]
  if (!url) return Promise.reject(Object.assign(new Error(`ring: unknown level ${level}`), { code: 'unknown-level' }))
  return play(url, volume)
}

function play (url, volume) {
  const a = new Audio(url)
  a.volume = Math.min(1, Math.max(0, volume))
  return a.play()
}
