import { getCurrentIdentityId } from "./identity-runtime";
import { loadAllTracks, type MusicTrack } from "./music-storage";
import type { SharedListeningSong } from "./listening-library";

// Read-only metadata lookup, shared by album artwork and visible track thumbnails.
const covers = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>();
let catalog: { identity: string | null; promise: Promise<MusicTrack[]> } | undefined;
export async function resolveListeningSongCover(song: SharedListeningSong): Promise<string | undefined> {
    if (song.coverUrl) return song.coverUrl;
    const identity = getCurrentIdentityId();
    const key = JSON.stringify([identity, song.id]);
    const cached = covers.get(key);
    if (cached) return cached;
    const existing = pending.get(key);
    if (existing) return existing;
    const task = (async () => {
        try {
            if (!catalog || catalog.identity !== identity) {
                const entry = { identity, promise: loadAllTracks() };
                catalog = entry;
                void entry.promise.finally(() => { if (catalog === entry) catalog = undefined; }).catch(() => {});
            }
            let cover = (await catalog.promise).find(track => track.id === song.id)?.coverUrl;
            if (identity !== getCurrentIdentityId()) return;
            if (!cover && song.source === "netease") {
                const id = Number(song.id.replace(/^(netease|ncm)[_:-]/, ""));
                if (Number.isFinite(id) && id > 0) cover = (await import("./music-service").then(module => module.getNeteaseSongDetail(id)))?.coverUrl;
            }
            if (identity !== getCurrentIdentityId()) return;
            if (cover) {
                if (covers.size >= 64) covers.delete(covers.keys().next().value!);
                covers.set(key, cover);
            }
            return cover;
        } catch { return undefined; }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
}
