import { kvGet, kvRemove, kvSet, registerDynamicPrefix } from "./kv-db";

export const CHAT_RETRY_VERSIONS_PREFIX = "ai_phone_chat_retry_versions:";
registerDynamicPrefix(CHAT_RETRY_VERSIONS_PREFIX);

/** Clearing/deleting a conversation must not leave hidden retry drafts behind. */
export function clearChatRetryVersions(sessionId: string, kind?: "online" | "offline"): void {
    const key = CHAT_RETRY_VERSIONS_PREFIX + sessionId;
    if (!kind) { kvRemove(key); return; }
    const raw = kvGet(key);
    if (!raw) return;
    try {
        const all: unknown = JSON.parse(raw);
        if (!Array.isArray(all)) { kvRemove(key); return; }
        const retained = all.filter(series => kind === "offline" ? series.kind !== "offline" : series.kind === "offline");
        if (retained.length) kvSet(key, JSON.stringify(retained)); else kvRemove(key);
    } catch { kvRemove(key); }
}
