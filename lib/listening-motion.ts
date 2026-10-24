export const LISTENING_GLOW_MS = 3518;
export const LISTENING_APPROACH_MS = 1800;

/** Resume the decoration from the real join timestamp, including after navigation. */
export function listeningEntryTiming(joined: boolean, glowAt?: number, now = Date.now()) {
    if (!joined || !glowAt) return { ready: false, animate: false, delayMs: 0 };
    const elapsed = Math.max(0, now - glowAt);
    return {
        ready: true,
        animate: elapsed < LISTENING_GLOW_MS + LISTENING_APPROACH_MS,
        delayMs: LISTENING_GLOW_MS - elapsed,
    };
}
