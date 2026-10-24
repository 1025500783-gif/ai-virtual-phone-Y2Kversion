import { loadChatMessages, loadChatSessions, pushChatMessage, type ChatSession } from "./chat-storage";
import { loadInteractableCharacters } from "./character-storage";
import { resolveUserIdentity } from "./settings-storage";
import { getChatCharacterAvatar } from "./chat-session-avatar";
import { getCurrentIdentityId } from "./identity-runtime";
import { canCurrentIdentityInteract } from "./identity-access";
import { formatRichMediaForHistory } from "./llm-prompt-assembler";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { isMediaStoreRef, loadMediaBlob } from "./media-cache-storage";
import { captureNativeMessage } from "./chat-forward-native";
import { captureForwardedAppearance, captureForwardedDisplayText, captureForwardedTheme, captureForwardedStickerUrl } from "./chat-forward-appearance";
import type { ForwardedChat } from "./chat-forward-types";

const FORWARD_LIMIT = 24 * 1024 * 1024;
/** Bound size/depth before allocating a clone or a serialized copy. */
export function forwardedValueSize(value: unknown, limit = FORWARD_LIMIT, depth = 0): number {
    if (depth > 16) throw new Error("嵌套转发层数过多，请选择原始记录。");
    let size = 2;
    if (typeof value === "string") {
        for (let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i);
            size += c < 32 ? 6 : c === 34 || c === 92 ? 2 : c < 128 ? 1 : c < 2048 ? 2 : 3;
            if (size > limit) throw new Error("所选媒体过大，请分批转发。");
        }
    } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            size += key.length * 3 + 4 + forwardedValueSize(item, limit - size, depth + 1);
            if (size > limit) throw new Error("所选媒体过大，请分批转发。");
        }
    } else size += 16;
    if (size > limit) throw new Error("所选媒体过大，请分批转发。");
    return size;
}

export function canForwardTo(session: ChatSession, actorId?: string): boolean {
    if (session.isBlacklisted || session.isSpectator || new Date(session.groupMutes?.[actorId || "self"] || "").getTime() > Date.now()) return false;
    const ids = session.isGroup ? session.participantIds || [] : [session.contactId];
    return (!actorId || ids.includes(actorId)) && ids.length > 0 && ids.every(id => canCurrentIdentityInteract(id) && loadInteractableCharacters().some(c => c.id === id));
}

async function durableUrl(url: string | null | undefined, budget: number): Promise<string | undefined> {
    const limit = Math.min(12 * 1024 * 1024, budget);
    if (!url) return undefined;
    let blob: Blob | undefined;
    if (isMediaStoreRef(url)) blob = (await loadMediaBlob(url))?.blob;
    else if (/^blob:/.test(url)) {
        const response = await fetch(url);
        const binaryLimit = Math.min(12 * 1024 * 1024, Math.floor((limit - 128) * 3 / 4));
        const declared = Number(response.headers.get("content-length"));
        if (binaryLimit <= 0 || declared > binaryLimit) throw new Error("所选媒体过大，请分批转发。");
        if (!response.body) {
            if (!declared) throw new Error("无法确认媒体大小，请重新导入后转发。");
            blob = await response.blob();
        } else {
            const reader = response.body.getReader(), chunks: BlobPart[] = [];
            let bytes = 0;
            try { while (true) { const {value,done} = await reader.read(); if(done)break; bytes += value.byteLength;
                if(bytes > binaryLimit) { await reader.cancel(); throw new Error("所选媒体过大，请分批转发。"); }
                chunks.push(new Uint8Array(value));
            } } finally { reader.releaseLock(); }
            blob = new Blob(chunks, {type:response.headers.get("content-type") || "application/octet-stream"});
        }
    }
    else if (!/^(https?:|data:|\/)/.test(url)) {
        const data = await getChatImageFromIndexedDB(url);
        if (!data) throw new Error("记录中的媒体已无法读取，请重新选择。");
        forwardedValueSize(data, limit);
        return data;
    } else { forwardedValueSize(url, limit); return url; }
    if (!blob) throw new Error("记录中的媒体已无法读取，请重新选择。");
    if (blob.size > 12 * 1024 * 1024) throw new Error("单个媒体超过12MB，请减少或调整所选内容。");
    if (Math.ceil(blob.size / 3) * 4 + 128 > limit) throw new Error("所选媒体过大，请分批转发。");
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob!);
    });
}

export async function captureForwardedChat(source: ChatSession, ids: Set<string>, options?: { actorId?: string; signal?: AbortSignal }): Promise<ForwardedChat> {
    if (!ids.size || ids.size > 50) throw new Error("请选择1至50条聊天消息。");
    if (options?.signal?.aborted) throw new Error("转发已取消。");
    const identity = getCurrentIdentityId();
    const currentSource = loadChatSessions().find(s => s.id === source.id);
    if (!currentSource || currentSource.contactId !== source.contactId || currentSource.isGroup !== source.isGroup || !canForwardTo(currentSource, options?.actorId)) throw new Error("来源会话已变化或不可访问。");
    const chars = loadInteractableCharacters();
    const self = resolveUserIdentity(source.contactId, "chat");
    const candidates = loadChatMessages(source.id).filter(m => ids.has(m.id) && !m.isRetracted && (m.role === "user" || m.role === "assistant"));
    if (!candidates.length || candidates.length > 50) throw new Error("请选择1至50条聊天消息。");
    forwardedValueSize(candidates);
    const selected = structuredClone(candidates);
    if (!selected.length || selected.length > 50) throw new Error("请选择1至50条聊天消息。");
    const appearances = new Map(selected.map(message => [message.id, captureForwardedAppearance(message.id)]));
    const sourceName = source.isGroup ? source.groupName || "群聊" : chars.find(c => c.id === source.contactId)?.name || "已删除角色";
    const record: ForwardedChat = { version: 1, title: source.isGroup ? `${sourceName}的聊天记录` : `${self?.name || "用户"}和${sourceName}的聊天记录`, sourceKind: source.isGroup ? "group" : "private", capturedAt: new Date().toISOString(), entries: [] };
    record.sourceNames = { user: self?.name || "用户", character: sourceName, characterId: source.contactId, ...(source.isGroup ? { group: source.groupName || "群聊" } : {}) };
    record.theme = captureForwardedTheme(selected[0].id);
    let remaining = FORWARD_LIMIT - forwardedValueSize(record);
    for (const m of selected) {
        if (getCurrentIdentityId() !== identity || options?.signal?.aborted) throw new Error("身份已切换或转发已取消。");
        let mediaBudget = remaining;
        const copyUrl = async (url?: string | null) => {
            const value = await durableUrl(url, mediaBudget);
            if (getCurrentIdentityId() !== identity || options?.signal?.aborted) throw new Error("身份已切换或转发已取消。");
            if (value) mediaBudget -= forwardedValueSize(value, mediaBudget);
            return value;
        };
        if (["tool_call", "tool_result", "tool_notice", "system_instruction", "memory_write_request"].includes(m.mediaType || "")) continue;
        const char = chars.find(c => c.id === (m.senderCharacterId || source.contactId));
        const d = m.mediaData;
        const payment = m.mediaType === "transfer" || m.mediaType === "red_packet";
        const state = { pending: "待领取", opened: "已领取", received: "已领取", declined: "已退回", paid: "已支付", canceled: "已取消" };
        record.entries.push({ speakerId: m.role === "user" ? "user" : m.senderCharacterId || (source.isGroup ? m.senderName : undefined) || source.contactId, speaker: m.role === "user" ? self?.name || "用户" : char?.name || "已删除角色", isUser: m.role === "user", createdAt: m.createdAt,
            avatar: await copyUrl(m.role === "assistant" ? getChatCharacterAvatar(source, char) : self?.avatarUrl).catch(() => undefined),
            text: payment ? d?.label || m.content || (m.mediaType === "red_packet" ? "恭喜发财" : "转账") : m.mediaType === "forwarded_chat" ? "[合并聊天记录]" : m.mediaType ? formatRichMediaForHistory(m, self?.name || "用户", char?.name || "角色", source.isGroup) + (m.content.trim() ? `\n${m.content}` : "") : m.content,
            nativeMessage: captureNativeMessage(m),
            appearance: appearances.get(m.id),
            displayText: captureForwardedDisplayText(m.id) ?? m.content,
            ...(m.mediaType === "audio" ? { voice: { transcript: d?.label || m.content, duration: d?.voiceDuration } } : {}),
            kind: m.mediaType === "media_file" ? d?.fileType || "file" : m.mediaType, mediaUrl: ["image", "audio", "video", "sticker", "media_file"].includes(m.mediaType || "") ? await copyUrl(m.mediaUrl || d?.stickerUrl || (m.mediaType === "sticker" ? captureForwardedStickerUrl(m.id) : undefined)) : undefined,
            ...(m.mediaType === "forwarded_chat" && d?.forwardedChat ? { nested: structuredClone(d.forwardedChat) } : {}),
            ...(m.mediaType === "music_share" || m.mediaType === "music" ? { music: { title: d?.musicTrack?.title || d?.musicTitle || "音乐", artist: d?.musicTrack?.artist || d?.musicArtist || "", text: m.listeningContext?.reference?.text || "", coverUrl: await copyUrl(d?.musicCoverUrl || d?.musicTrack?.coverUrl).catch(() => undefined), track: d?.musicTrack ? structuredClone(d.musicTrack) : undefined } } : {}),
            ...(payment ? { amount: d?.amount, currency: d?.currency || "CNY", paymentState: d?.status ? state[d.status] : "待领取", claims: [...(d?.claimedBy || [])] } : {}),
        });
        remaining -= forwardedValueSize(record.entries[record.entries.length - 1], remaining);
    }
    const latestSource = loadChatSessions().find(item => item.id === source.id);
    if (getCurrentIdentityId() !== identity || options?.signal?.aborted || !latestSource || !canForwardTo(latestSource, options?.actorId)) throw new Error("来源会话、身份或权限已变化，请重新选择。");
    const currentMessages = new Set(loadChatMessages(source.id).filter(message=>!message.isRetracted).map(message=>message.id));
    if (selected.some(message=>!currentMessages.has(message.id))) throw new Error("来源消息已删除或撤回，请重新选择。");
    if (!record.entries.length) throw new Error("所选内容没有可转发的消息。");
    return record;
}

export function sendForwardedChat(record: ForwardedChat, targetId: string, identity: string | null, actorId?: string) {
    forwardedValueSize(record);
    if (getCurrentIdentityId() !== identity) throw new Error("身份已切换，请重新选择。");
    const target = loadChatSessions().find(s => s.id === targetId);
    if (!target || !canForwardTo(target, actorId)) throw new Error("当前无法向该会话发送。");
    const sent = pushChatMessage({ sessionId: target.id, role: actorId ? "assistant" : "user", ...(actorId ? { senderCharacterId: actorId, senderName: loadInteractableCharacters().find(c=>c.id===actorId)?.name } : {}), content: "", mediaType: "forwarded_chat", mediaData: { forwardedChat: structuredClone(record) } });
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: target.id } }));
    return sent;
}
