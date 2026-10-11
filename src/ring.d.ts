/** URL del trino: el sonido de todos los avisos de Dotrino (el mismo que `DotrinoRing` en iOS y Android). */
export const RING_URL: string
/** Volumen por defecto del trino (0…1). */
export const RING_VOLUME: number
/** Toca el trino ahora. Rechaza si el navegador no deja sonar a la página (`NotAllowedError`). */
export function playRing(opts?: { volume?: number }): Promise<void>
