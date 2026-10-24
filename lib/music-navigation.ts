export const MUSIC_HOME_EVENT = "music-home-requested";

// Keep a request until MusicApp mounts, or let an already-mounted instance consume it.
let homePending = false;

export function requestMusicHome(): void {
    homePending = true;
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "music" } }));
    window.dispatchEvent(new Event(MUSIC_HOME_EVENT));
}

export function consumeMusicHomeRequest(): boolean {
    if (!homePending) return false;
    homePending = false;
    return true;
}
