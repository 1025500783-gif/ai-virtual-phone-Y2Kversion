import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { assertIdentityActive } from "./identity-runtime";
import type { MusicTrack } from "./music-storage";

const KEY = "listening-library-v1";
registerKvMigration(KEY);
export const LISTENING_LIBRARY_EVENT = "listening-library-updated";
export type SharedListeningSong = { id: string; title: string; artist: string; source: "local" | "netease"; coverUrl?: string; addedBy: string; addedAt: number };
export type SharedListeningPlaylist = { id: string; sessionId: string; name: string; songs: SharedListeningSong[]; updatedBy: string; updatedAt: number };
type RankFact = { eventId: string; sessionId: string; characterId: string; text: string; at: number };
export type ListeningLibrary = { version: 1; totals: Record<string, number>; playlists: SharedListeningPlaylist[]; sampled: string[]; facts: RankFact[]; history: { roomId: string; sessionId: string; characterIds: string[]; endedAt: number }[] };
export function loadListeningLibrary(): ListeningLibrary {
    try { const raw = JSON.parse(kvGet(KEY) || "null"); if (raw?.version === 1) return raw; } catch { /* Empty local library. */ }
    return { version: 1, totals: {}, playlists: [], sampled: [], facts: [], history: [] };
}
function save(data: ListeningLibrary) { assertIdentityActive(); kvSet(KEY, JSON.stringify(data)); if (typeof window !== "undefined") window.dispatchEvent(new Event(LISTENING_LIBRARY_EVENT)); }
export function listeningRanking() {
    const data = loadListeningLibrary();
    return Object.entries(data.totals).filter(([, ms]) => ms > 0).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([characterId, milliseconds], i, all) => ({ characterId, milliseconds, rank: all.findIndex(([,ms]) => ms === milliseconds)+1 }));
}
export function ownListeningRank(characterId: string) {
    const own = listeningRanking().find(row => row.characterId === characterId);
    return { rank: own?.rank ?? null, milliseconds: own?.milliseconds ?? 0 };
}
export function ownListeningRankView(characterId: string) {
    const own = ownListeningRank(characterId);
    return own;
}
export function addListeningTime(characterIds: string[], milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    const data = loadListeningLibrary();
    for (const id of new Set(characterIds)) data.totals[id] = (data.totals[id] || 0) + milliseconds;
    save(data);
}
export function sampleListeningRank(roomId: string, sessionId: string, characterId: string, phase: "start" | "end", random = Math.random) {
    const data = loadListeningLibrary(), eventId = `${roomId}:${characterId}:${phase}`;
    if (data.sampled.includes(eventId)) return;
    data.sampled = [...data.sampled, eventId].slice(-2000);
    if (random() < (phase === "start" ? .1 : .25)) {
        const own = ownListeningRankView(characterId);
        data.facts.push({ eventId, sessionId, characterId, at: Date.now(), text: `你在一起听${phase === "start" ? "开始" : "结束"}时看了自己的榜单：${own.rank === null ? "尚未上榜" : `第${own.rank}名`}，累计${Math.floor(own.milliseconds / 60000)}分钟。仅你知道此信息，是否提起由你决定。` });
        data.facts = data.facts.slice(-100);
    }
    save(data);
}
export function takeListeningRankFacts(characterId: string, sessionId: string) {
    const data = loadListeningLibrary();
    const facts = data.facts.filter(f => f.characterId === characterId && f.sessionId === sessionId && Date.now()-f.at < 86400000);
    if (!facts.length) return "";
    data.facts = data.facts.filter(f => !facts.includes(f)); save(data);
    return facts.map(f => f.text).join("\n");
}
export function finishListeningHistory(roomId: string, sessionId: string, characterIds: string[]) {
    const data = loadListeningLibrary();
    if (!data.history.some(h => h.roomId === roomId)) data.history.push({ roomId, sessionId, characterIds, endedAt: Date.now() });
    data.history = data.history.slice(-200); save(data);
}
export function createListeningPlaylist(sessionId: string, name: string, actorId: string) {
    const data = loadListeningLibrary();
    if (data.playlists.filter(p => p.sessionId === sessionId).length >= 50) throw new Error("这个聊天已有50张一起听歌单");
    const playlist: SharedListeningPlaylist = { id: `together_${Date.now()}_${Math.random().toString(36).slice(2,9)}`, sessionId, name: name.trim().slice(0,60) || "我们一起听", songs: [], updatedBy: actorId, updatedAt: Date.now() };
    data.playlists.push(playlist); save(data); return playlist;
}
export function editListeningPlaylist(sessionId: string, playlistId: string, actorId: string, edit: { name?: string; add?: SharedListeningSong; removeId?: string }) {
    const data = loadListeningLibrary(), playlist = data.playlists.find(p => p.id === playlistId && p.sessionId === sessionId);
    if (!playlist) throw new Error("找不到这个聊天的一起听歌单");
    if (edit.name !== undefined) { if (!edit.name.trim()) throw new Error("歌单名称不能为空"); playlist.name = edit.name.trim().slice(0,60); }
    if (edit.removeId) playlist.songs = playlist.songs.filter(song => song.id !== edit.removeId);
    if (edit.add && !playlist.songs.some(song => song.id === edit.add!.id)) { if (playlist.songs.length >= 500) throw new Error("歌单最多500首歌"); playlist.songs.push(edit.add); }
    playlist.updatedBy = actorId; playlist.updatedAt = Date.now(); save(data); return playlist;
}
export function songForListeningLibrary(track: MusicTrack, actorId: string): SharedListeningSong {
    // Keep metadata and durable IDs only; never cache signed playback URLs or cookies.
    return { coverUrl: track.coverUrl?.startsWith("blob:") ? undefined : track.coverUrl, id: track.id, title: track.title, artist: track.artist, source: /^(netease|ncm)[_:-]/.test(track.id) ? "netease" : "local", addedBy: actorId, addedAt: Date.now() };
}
export function deleteListeningPlaylist(sessionId: string, playlistId: string) {
    const data = loadListeningLibrary();
    if (!data.playlists.some(p => p.id === playlistId && p.sessionId === sessionId)) throw new Error("找不到这个聊天的一起听歌单");
    data.playlists = data.playlists.filter(p => p.id !== playlistId || p.sessionId !== sessionId);
    save(data);
}
