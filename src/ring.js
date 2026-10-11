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

/** How loud the trino plays by default, over the volume the person set (0…1). */
export const RING_VOLUME = 0.6

/**
 * Plays the trino now. Rejects when the browser does not let the page sound (`NotAllowedError`:
 * nobody has touched the page yet) — the caller decides what to do with that; it is not hidden here.
 * @param {{ volume?: number }} [opts]
 * @returns {Promise<void>}
 */
export function playRing ({ volume = RING_VOLUME } = {}) {
  const a = new Audio(RING_URL)
  a.volume = Math.min(1, Math.max(0, volume))
  return a.play()
}
