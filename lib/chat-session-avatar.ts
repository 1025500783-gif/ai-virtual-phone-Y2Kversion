import type { Character, CharacterAvatarHistoryEntry } from "./character-types";
import type { ChatSession } from "./chat-storage";
import { getChatSessionMetadata } from "./chat-storage";
import { kvGet, kvSet } from "./kv-db";

export const CHAT_SESSION_AVATARS_UPDATED_EVENT = "chat-session-avatars-updated";
const KEY = "chat-app-character-avatars-v1";
type AvatarRecord = { avatar: string | null; history: CharacterAvatarHistoryEntry[] };
let cachedRaw: string | null | undefined;
let cachedStore: Record<string, AvatarRecord> = {};
function readStore(): Record<string, AvatarRecord> {
    const raw = kvGet(KEY);
    if (raw === cachedRaw) return cachedStore;
    cachedRaw = raw;
    cachedStore = {};
    try {
        const parsed = JSON.parse(raw || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [id, value] of Object.entries(parsed)) {
                const record = value as AvatarRecord | null;
                if (record && (record.avatar === null || typeof record.avatar === "string") && Array.isArray(record.history)) cachedStore[id] = record;
            }
        }
    } catch { /* Ignore invalid saved records. */ }
    return cachedStore;
}
export function saveChatAppCharacterAvatar(characterId: string, avatar: string | null, history: CharacterAvatarHistoryEntry[]) {
    kvSet(KEY, JSON.stringify({ ...readStore(), [characterId]: { avatar, history } }));
}
function appRecord(characterId: string): AvatarRecord | undefined {
    const saved = readStore()[characterId];
    if (saved) return saved;
    // Upgrade legacy per-session avatars deterministically, using the latest
    // actual avatar selection (not the session's last chat-message timestamp).
    const candidates = getChatSessionMetadata().filter(s => Object.prototype.hasOwnProperty.call(s.characterAvatars || {}, characterId));
    const selectedAt = (s: ChatSession) => Math.max(0, ...(s.characterAvatarHistories?.[characterId] || [])
        .filter(entry => entry.avatar === s.characterAvatars?.[characterId])
        .map(entry => Date.parse(entry.lastSelectedAt) || 0));
    candidates.sort((a, b) => selectedAt(b) - selectedAt(a) || Number(!!a.isGroup) - Number(!!b.isGroup) || a.id.localeCompare(b.id));
    const source = candidates[0];
    if (!source) return;
    const record = { avatar: source.characterAvatars![characterId] ?? null, history: source.characterAvatarHistories?.[characterId] || [] };
    saveChatAppCharacterAvatar(characterId, record.avatar, record.history);
    return record;
}

export function getChatCharacterAvatar(session: Pick<ChatSession, "characterAvatars"> | null | undefined, character: Pick<Character, "id" | "avatar"> | null | undefined): string | null {
    if (!character) return null;
    const shared = appRecord(character.id);
    const avatar = shared ? shared.avatar : Object.prototype.hasOwnProperty.call(session?.characterAvatars || {}, character.id)
        ? session!.characterAvatars![character.id] ?? null
        : null;
    // A cleared chat avatar restores the profile fallback. Read the profile last.
    return avatar?.trim() ? avatar : character.avatar || null;
}

export function getChatCharacterAvatarHistory(session: Pick<ChatSession, "characterAvatarHistories"> | null | undefined, characterId: string): CharacterAvatarHistoryEntry[] {
    const shared = appRecord(characterId);
    if (shared) return shared.history;
    const value = session?.characterAvatarHistories?.[characterId];
    return Array.isArray(value) ? value : [];
}

export function withChatCharacterAvatar<T extends Pick<Character, "id" | "avatar">>(session: Pick<ChatSession, "characterAvatars"> | null | undefined, character: T): T {
    return { ...character, avatar: getChatCharacterAvatar(session, character) };
}
