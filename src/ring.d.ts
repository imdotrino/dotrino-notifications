/** URL del trino: el sonido de todos los avisos de Dotrino (el mismo que `DotrinoRing` en iOS y Android). */
export const RING_URL: string
/** Volumen por defecto del trino (0…1). */
export const RING_VOLUME: number
/** Toca el trino ahora. Rechaza si el navegador no deja sonar a la página (`NotAllowedError`). */
export function playRing(opts?: { volume?: number }): Promise<void>
/** URL del trino de TERMINADO: otro trino, para «lo que pediste ya acabó» (el mismo que `DotrinoRing.playDone`). */
export const DONE_URL: string
/** Toca el trino de terminado ahora. Rechaza igual que `playRing`. */
export function playDone(opts?: { volume?: number }): Promise<void>
