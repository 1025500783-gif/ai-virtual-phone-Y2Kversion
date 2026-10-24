import { addListeningTime, sampleListeningRank, takeListeningRankFacts, finishListeningHistory } from "./listening-library";
import { loadCharacters } from "./character-storage";
import { assertIdentityActive, getCurrentIdentityId } from "./identity-runtime";
import { assertCharacterIdentityAccess, canCurrentIdentityInteract } from "./identity-access";
import { getMusicControlBridge } from "./music-control-bridge";
import { pushChatMessage, loadChatSessions, updateMessageMediaData, loadChatMessages, CHAT_REQUEST_REPLY_EVENT } from "./chat-storage";
export { CHARACTER_LISTENING_INVITE_PROTOCOL } from "./music-sharing-protocol";

export type ListeningRoom = {
    id: string; identityId: string | null; sessionId: string; characterId: string;
    status: "invited" | "joined" | "declined"; startedAt: number;
    initiator?: "user" | "character";
    invitationMessageId?: string;
    lastGlowAt?: number;
    glowEpoch?: number;
    glowBatchId?: string;
    isGroup?: boolean;
    userJoined?: boolean;
    members?: { characterId: string; status: "invited" | "joined" | "declined"; joinedAt?: number; rankStarted?: boolean }[];
    song?: { title?: string; artist?: string; coverUrl?: string };
};
// A live room belongs to this phone realm; reload/switch does not revive a stale invitation.
let room: ListeningRoom | null = null;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
let accountingTimer: ReturnType<typeof setInterval> | undefined;
let previousSample: { roomId: string; at: number; time: number; trackId: string; playing: boolean } | null = null;
function joinedIds(current: ListeningRoom) { return current.isGroup ? (current.members || []).filter(m => m.status === "joined").map(m => m.characterId) : current.status === "joined" ? [current.characterId] : []; }
export function settleListeningTime() {
    const current = getListeningRoom(), state = getMusicControlBridge()?.getState(), now = Date.now();
    if (!current || current.status !== "joined" || current.userJoined === false || state?.identityId !== current.identityId || !state.currentTrack) { previousSample = null; return; }
    const before = previousSample;
    if (before?.roomId === current.id && before.trackId === state.currentTrack.id && (before.playing || state.isPlaying)) {
        const wall = now - before.at, audio = (state.currentTime - before.time) * 1000;
        if (wall > 0 && audio > 0 && audio <= wall + 1500) addListeningTime(joinedIds(current), Math.min(wall, audio));
    }
    previousSample = { roomId: current.id, at: now, time: state.currentTime, trackId: state.currentTrack.id, playing: state.isPlaying };
}
function beginAccounting() {
    if (accountingTimer) clearInterval(accountingTimer);
    previousSample = null; settleListeningTime();
    accountingTimer = setInterval(() => { reconcileListeningMembers(); settleListeningTime(); }, 5000);
}
function stopAccounting() { if (accountingTimer) clearInterval(accountingTimer); accountingTimer = undefined; previousSample = null; }
function rankingEvent(current: ListeningRoom, id: string, phase: "start" | "end") {
    const member = current.members?.find(m => m.characterId === id);
    sampleListeningRank(current.isGroup ? current.id + ":" + (member?.joinedAt || current.startedAt) : current.id, current.sessionId, id, phase);
}
function startRanks() {
    if (!room || room.status !== "joined" || room.userJoined === false) return;
    if (room.isGroup) room = { ...room, members: room.members?.map(m => {
        if (m.status !== "joined" || m.rankStarted) return m;
        rankingEvent(room!, m.characterId, "start"); return { ...m, rankStarted: true };
    }) };
    else rankingEvent(room, room.characterId, "start");
}
function endRoom(current: ListeningRoom) {
    if (current.identityId !== getCurrentIdentityId()) { stopAccounting(); return; }
    settleListeningTime();
    for (const id of joinedIds(current)) if (!current.isGroup || current.members?.find(m => m.characterId === id)?.rankStarted) rankingEvent(current, id, "end");
    if (joinedIds(current).length) finishListeningHistory(current.id, current.sessionId, joinedIds(current));
    stopAccounting();
}
export function reconcileListeningMembers() {
    if (!getListeningRoom()?.isGroup || !room) return;
    const session = loadChatSessions().find(s => s.id === room!.sessionId);
    if (!session || session.isSpectator) { endRoom(room); room = null; emit(); return; }
    const removed = room.members?.filter(m => !session.participantIds?.includes(m.characterId) || !canCurrentIdentityInteract(m.characterId)) || [];
    const added = (session.participantIds || []).filter(id => canCurrentIdentityInteract(id) && !room!.members?.some(m => m.characterId === id));
    if (!removed.length && !added.length) return;
    for (const m of removed) if (m.rankStarted) rankingEvent(room, m.characterId, "end");
    room = { ...room, members: [...(room.members?.filter(m => !removed.includes(m)) || []), ...added.map(characterId => ({characterId,status:"invited" as const}))] }; emit();
}
export function inviteGroupListeningRoom(sessionId: string, initiatorId?: string) {
    assertIdentityActive(); const session = loadChatSessions().find(s => s.id === sessionId);
    if (!session?.isGroup || session.isSpectator) throw new Error("当前群聊不能发起一起听");
    const ids = (session.participantIds || []).filter(canCurrentIdentityInteract);
    if (!ids.length || (initiatorId && !ids.includes(initiatorId))) throw new Error("一起听发起人不在当前群聊");
    const existing = getListeningRoom();
    if (existing && existing.status !== "declined") {
        if (existing.sessionId === sessionId) return existing;
        if (existing.userJoined !== false) throw new Error("请先结束当前的一起听");
        endRoom(existing);
    }
    room = { id: createInvitationId(), identityId: getCurrentIdentityId(), sessionId, characterId: initiatorId || ids[0], isGroup: true, userJoined: !initiatorId, initiator: initiatorId ? "character" : "user", status: "invited", startedAt: Date.now(), members: ids.map(characterId => ({ characterId, status: characterId === initiatorId ? "joined" : "invited", joinedAt: characterId === initiatorId ? Date.now() : undefined })) };
    emit(); return room;
}
export function respondGroupListeningMember(roomId: string, sessionId: string, characterId: string, action: "接受" | "拒绝" | "退出", batchId?: string) {
    const current = getListeningRoom(), session = loadChatSessions().find(s => s.id === sessionId);
    if (!current?.isGroup || current.id !== roomId || current.sessionId !== sessionId || !session?.participantIds?.includes(characterId) || !canCurrentIdentityInteract(characterId)) return;
    const member = current.members?.find(m => m.characterId === characterId);
    if (!member) return;
    const status = action === "接受" ? "joined" : "declined";
    if (member.status === status) return;
    settleListeningTime();
    if (member.rankStarted && status !== "joined") rankingEvent(current, characterId, "end");
    const members = current.members!.map(m => m === member ? { characterId, status: status as "joined" | "declined", joinedAt: status === "joined" ? Date.now() : undefined } : m);
    const joined = current.userJoined && members.some(m => m.status === "joined");
    room = { ...current, members, status: joined ? "joined" : "invited", ...(status === "joined" && batchId ? {glowBatchId:batchId} : {}), ...(status === "joined" && (!batchId || current.glowBatchId !== batchId) && (!current.lastGlowAt || Date.now()-current.lastGlowAt > 3518) ? { lastGlowAt: undefined, glowEpoch: (current.glowEpoch || 0)+1, glowBatchId: batchId } : {}) };
    if (joined) { startRanks(); beginAccounting(); } else stopAccounting();
    pushChatMessage({ sessionId, role: "system", content: (loadCharacters().find(c => c.id === characterId)?.name || "群成员") + (action === "接受" ? "加入了一起听。" : action === "退出" ? "退出了一起听。" : "暂未加入一起听。") });
    emit(); window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
}

function createInvitationId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    // getRandomValues remains available on LAN HTTP; the ID is a correlation token.
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function subscribeListeningRoom(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("settings-bindings-updated", listener);
    return () => { listeners.delete(listener); window.removeEventListener("settings-bindings-updated", listener); };
}
export function getListeningRoom(): ListeningRoom | null {
    if (!room) return null;
    if (room.identityId !== getCurrentIdentityId()) { stopAccounting(); room = null; return null; }
    if (!room.isGroup && !canCurrentIdentityInteract(room.characterId)) { stopAccounting(); room = null; return null; }
    return room;
}
export function inviteListeningRoom(sessionId: string, characterId: string): ListeningRoom {
    assertIdentityActive(); assertCharacterIdentityAccess(characterId);
    const current = getListeningRoom();
    if (current && current.status !== "declined" && current.userJoined !== false && current.sessionId !== sessionId) throw new Error("请先结束当前的一起听");
    if (current) endRoom(current);
    room = { id: createInvitationId(), identityId: getCurrentIdentityId(), sessionId, characterId, status: "invited", startedAt: Date.now() };
    emit(); return room;
}
export function leaveListeningRoom(sessionId: string) {
    assertIdentityActive();
    if (getListeningRoom()?.sessionId !== sessionId) return;
    const current = room!;
    endRoom(current);
    room = current.isGroup && joinedIds(current).length ? { ...current, userJoined: false, members: current.members?.map(m => ({...m, rankStarted:false})) } : null;
    emit();
}
export function joinGroupListeningAsUser(sessionId: string) {
    assertIdentityActive(); const current = getListeningRoom();
    if (!current?.isGroup || current.sessionId !== sessionId || current.userJoined) return;
    const session = loadChatSessions().find(s => s.id === sessionId);
    if (!session || session.isSpectator) throw new Error("当前群聊不能加入");
    room = {...current,userJoined:true,status:joinedIds(current).length ? "joined" : "invited",lastGlowAt:undefined,glowEpoch:(current.glowEpoch||0)+1,members:current.members?.map(m=>m.status === "joined" ? {...m,joinedAt:Date.now(),rankStarted:false}:m)};
    if (room.status === "joined") {startRanks();beginAccounting();} emit();
}
export function recordListeningGlow(roomId: string) {
    const current = getListeningRoom();
    if (current?.id === roomId && current.status === "joined" && !current.lastGlowAt) {
        room = { ...current, lastGlowAt: Date.now() };
        emit();
    }
}
export function groupListeningRoomPrompt(sessionId: string, characterIds: string[]): string {
    reconcileListeningMembers();
    const session = loadChatSessions().find(s => s.id === sessionId);
    if (!session?.isGroup || session.isSpectator) return "";
    const ids = characterIds.filter(id => session.participantIds?.includes(id) && canCurrentIdentityInteract(id));
    const chars = loadCharacters();
    const name = (id: string) => chars.find(c => c.id === id)?.name || id;
    const facts = ids.map(id => { const text = takeListeningRankFacts(id, sessionId); return text ? `[${name(id)}个人知晓]\n${text}` : ""; }).filter(Boolean);
    const current = getListeningRoom();
    if (current?.isGroup && current.sessionId === sessionId) {
        const state = getMusicControlBridge()?.getState();
        const track = state?.identityId === current.identityId ? state.currentTrack : null;
        facts.unshift(`群聊一起听房间ID:${current.id}；用户${current.userJoined ? "已加入" : "未加入"}。成员状态：${current.members?.filter(m => ids.includes(m.characterId)).map(m => `${name(m.characterId)}:${m.status === "joined" ? "已加入" : m.status === "declined" ? "拒绝/退出" : "待回应"}`).join("、")}。${track ? `当前${state!.isPlaying ? "播放" : "暂停"}：${track.title} · ${track.artist}。` : "尚未播放歌曲。"}按意愿在自己的发言段输出[一起听:${current.id}:接受]、[一起听:${current.id}:拒绝]或[一起听:${current.id}:退出]。仅决定自己的状态；退出不解散其他人，换歌/暂停不散场。头像星球相遇亮起粉色频谱，全屏淡粉love仅在加入时出现一次，非现实变化。具体歌词以歌词卡或用户输入为准，不每轮cue音乐。`);
    }
    return facts.join("\n");
}
export function listeningRoomPrompt(characterId: string, sessionId?: string): string {
    reconcileListeningMembers();
    if (!canCurrentIdentityInteract(characterId)) return "";
    const contextSession = sessionId ? loadChatSessions().find(s=>s.id===sessionId) : null;
    if (contextSession && (contextSession.isGroup ? !contextSession.participantIds?.includes(characterId) : contextSession.contactId!==characterId)) return "";
    const current = getListeningRoom();
    const facts = sessionId ? takeListeningRankFacts(characterId, sessionId) : "";
    if (!current || current.sessionId !== sessionId || current.status === "declined" || (!current.isGroup && current.characterId !== characterId)) return facts;
    if (current.isGroup) {
        const member = current.members?.find(m => m.characterId === characterId);
        if (!member || !canCurrentIdentityInteract(characterId)) return facts;
        const chars = loadCharacters();
        const names = (current.members || []).filter(m => m.status === "joined").map(m => chars.find(c => c.id === m.characterId)?.name || m.characterId).join("、") || "暂无";
        const snapshot = getMusicControlBridge()?.getState();
        const track = snapshot?.identityId === current.identityId ? snapshot.currentTrack : null;
        const playing = track ? `当前${snapshot!.isPlaying ? "播放" : "暂停"}：${track.title} · ${track.artist}。` : "尚未播放歌曲。";
        return [facts, playing, `群聊一起听房间ID:${current.id}。用户${current.userJoined ? "已加入" : "尚未加入"}；已加入角色：${names}；你${member.status === "joined" ? "已加入" : member.status === "declined" ? "已拒绝或退出" : "正在被邀请"}。按意愿在自己的发言段输出[一起听:${current.id}:接受]、[一起听:${current.id}:拒绝]或[一起听:${current.id}:退出]，仅代表你自己；退出不结束其他人的房间。共享播放器，换歌/暂停不散场。加入时有一次淡粉love入场特效，重叠不重复。具体歌词仅以歌词卡或用户输入为准，不每轮cue音乐。`].filter(Boolean).join("\n");
    }
    if (current.status === "invited" && current.initiator === "character") return [facts, "你已向用户发出一起听邀请，正在等待用户接受或拒绝。不要代替用户接受，不重复邀请；正常继续对话。"].filter(Boolean).join("\n");
    if (current.status === "invited") return [facts, `用户邀请你一起听歌。按人设、关系与当前意愿接受或拒绝；先输出[一起听:${current.id}:接受]或[一起听:${current.id}:拒绝]，再自然回复。`].filter(Boolean).join("\n");
    const snapshot = getMusicControlBridge()?.getState();
    const track = snapshot?.identityId === current.identityId ? snapshot.currentTrack : null;
    const sharedEffect = `一起听界面以你们的头像作为两颗星球，相遇时粉色频谱亮起。加入一起听时仅出现一次约3.5秒的全屏淡粉滤镜与连笔love线条，从左侧写入、右侧退去；星球重叠不重复触发。${current.lastGlowAt ? "本次加入特效已出现。" : ""}这是双方共享的界面体验，可自然回应，不必每轮提及，不将它描述为现实环境变化。`;
    return `${facts ? facts + "\n" : ""}你正在与用户一起听歌。${track ? `当前${snapshot!.isPlaying ? "播放" : "暂停"}：${track.title} · ${track.artist}。` : "尚未播放歌曲。"}换歌、歌曲结束或暂停不结束一起听，无需重新邀请；仅任一方主动退出才结束。${sharedEffect}具体歌词仅以用户分享的歌词卡或输入文字为准。继续当前对话；想结束时自然说明并附[一起听:${current.id}:退出]。`;
}
export function applyListeningRoomReply(text: string, sessionId: string, actorId?: string, batchId?: string): string {
    const cleaned = text.replace(/\[一起听邀请(?::([^\]\n]*))?\]/g, (_, song: string | undefined) => {
        const session = loadChatSessions().find(item => item.id === sessionId);
        if (!session) return "";
        if (session.isGroup) {
            if (!actorId) return "";
            const existing = getListeningRoom();
            if (existing?.isGroup && existing.sessionId === sessionId) { respondGroupListeningMember(existing.id, sessionId, actorId, "接受", batchId); return ""; }
            if (existing && existing.status !== "declined" && existing.sessionId !== sessionId && existing.userJoined !== false) return "";
            const invitation = inviteGroupListeningRoom(sessionId, actorId);
            const [title, artist] = (song || "").split("|").map(value => value.trim());
            const state = getMusicControlBridge()?.getState();
            const track = state?.identityId === invitation.identityId ? state.currentTrack : null;
            const metadata = { title: title || track?.title, artist: artist || (!title || title === track?.title ? track?.artist : undefined) };
            if (!invitation.invitationMessageId && invitation.initiator === "character") {
                const message = pushChatMessage({ sessionId, role: "assistant", senderCharacterId: actorId, senderName: loadCharacters().find(c => c.id === actorId)?.name, content: "邀请大家一起听歌。", mediaType: "listening_invite", mediaData: { listeningInvite: { roomId: invitation.id, initiator: "character", ...metadata } } });
                room = { ...invitation, invitationMessageId: message.id, song: metadata }; emit();
            }
            return "";
        }
        if (!canCurrentIdentityInteract(session.contactId)) return "";
        const current = getListeningRoom();
        if (current && current.status !== "declined") {
            if (current.sessionId !== sessionId) {
                pushChatMessage({ sessionId, role: "system", content: "一起听邀请未创建：请先结束另一个聊天的一起听。" });
                window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
                return "";
            }
            // A repeated marker must not invalidate an unanswered character invitation.
            if (current.status === "invited" && current.initiator === "character") return "";
            // Same chat: an explicit new character invitation may replace the earlier
            // user invitation/listening session, but never grants consent on behalf of the user.
        }
        const invitation = inviteListeningRoom(sessionId, session.contactId);
        const snapshot = getMusicControlBridge()?.getState();
        const track = snapshot?.identityId === invitation.identityId ? (snapshot.currentTrack ?? snapshot.selectedTrack) : null;
        const [title, artist] = (song || "").split("|").map(value => value.trim());
        const matches = !title || (track?.title === title && (!artist || track.artist === artist));
        const metadata = { title: title || track?.title, artist: artist || (matches ? track?.artist : undefined), coverUrl: matches ? track?.coverUrl : undefined };
        const message = pushChatMessage({ sessionId, role: "assistant", content: "邀请你一起听歌。" + (metadata.title ? ` 歌曲：${metadata.title}${metadata.artist ? " · " + metadata.artist : ""}` : ""), mediaType: "listening_invite", mediaData: { listeningInvite: { roomId: invitation.id, initiator: "character", ...metadata } } });
        room = { ...invitation, initiator: "character", invitationMessageId: message.id, song: metadata };
        if (metadata.title && !metadata.coverUrl) {
            void import("./music-share-resolution").then(module => module.resolveSharedSong(metadata.title!, metadata.artist)).then(track => {
                if (!track?.coverUrl || getCurrentIdentityId() !== invitation.identityId) return;
                const saved = loadChatMessages(sessionId).find(item => item.id === message.id);
                if (!saved || saved.isRetracted || saved.mediaData?.listeningInvite?.roomId !== invitation.id) return;
                updateMessageMediaData(saved.id, { ...saved.mediaData, listeningInvite: { ...saved.mediaData.listeningInvite, coverUrl: track.coverUrl } });
                if (getListeningRoom()?.id === invitation.id) { room = { ...room!, song: { ...room!.song, coverUrl: track.coverUrl } }; emit(); }
                window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
            }).catch(() => { /* Keep the invitation usable when metadata lookup is unavailable. */ });
        }
        emit();
        window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
        return "";
    });
    return cleaned.replace(/\[一起听:(?:([\w-]+):)?(接受|拒绝|退出)\]/g, (marker, id: string | undefined, action: string, offset: number) => {
        const current = getListeningRoom();
        if (!current || current.sessionId !== sessionId || (id && current.id !== id)) return "";
        if (!id) {
            // Short decisions are only a fallback for a live user invitation, never a new invitation or exit.
            if (action === "退出" || current.initiator === "character" || current.userJoined === false
                || (!current.isGroup && current.status !== "invited")
                || (current.isGroup && !current.members?.some(m=>m.characterId===actorId && m.status==="invited"))) return "";
            const history = loadChatMessages(sessionId);
            const invite = history.filter(m=>m.role==="user" && !m.isRetracted && m.mediaData?.listeningInvite).at(-1);
            if (invite?.mediaData?.listeningInvite?.roomId !== current.id
                || history.slice(history.indexOf(invite)+1).some(m=>m.role==="assistant" && !m.isRetracted)) return "";
            const lineStart = cleaned.lastIndexOf("\n", offset-1)+1;
            const lineEnd = cleaned.indexOf("\n", offset+marker.length);
            if (cleaned.slice(lineStart,offset).trim() || cleaned.slice(offset+marker.length,lineEnd<0?undefined:lineEnd).trim()) return "";
            id = current.id;
        }
        assertIdentityActive();
        if (!current.isGroup && actorId && actorId !== current.characterId) return "";
        if (current.isGroup) { if (actorId) respondGroupListeningMember(id, sessionId, actorId, action as "接受" | "拒绝" | "退出", batchId); return ""; }
        let notice = "";
        if (action === "退出") { endRoom(current); room = null; notice = "对方结束了一起听。"; }
        else if (current.status === "invited" && current.initiator !== "character") {
            room = { ...current, status: action === "接受" ? "joined" : "declined", startedAt: Date.now() };
            if (action === "接受") { startRanks(); beginAccounting(); }
            notice = action === "接受" ? "对方加入了一起听。" : "对方拒绝了一起听邀请。";
        }
        if (notice) {
            pushChatMessage({ sessionId, role: "system", content: notice });
            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
        }
        emit(); return "";
    }).trim();
}

const resolving = new Set<string>();
export async function respondToListeningInvitation(id: string, sessionId: string, accept: boolean): Promise<void> {
    assertIdentityActive();
    const current = getListeningRoom();
    if (!current || current.id !== id || current.sessionId !== sessionId || current.status !== "invited" || current.initiator !== "character") throw new Error("这份邀请已不在等待回应");
    if (resolving.has(id)) return;
    resolving.add(id);
    try {
        if (accept && current.song?.title) {
            const bridge = getMusicControlBridge();
            if (!bridge || bridge.getState().identityId !== current.identityId) throw new Error("音乐播放器尚未准备好，请重试");
            const state = bridge.getState();
            if (state.currentTrack?.title === current.song.title && (!current.song.artist || state.currentTrack.artist === current.song.artist)) bridge.resume();
            else {
                const result = await bridge.playByQuery(current.song.title, current.song.artist);
                if (!result.ok) throw new Error(result.message || "歌曲暂时无法播放，请重试");
            }
        }
        if (getListeningRoom()?.id !== id || current.identityId !== getCurrentIdentityId()) return;
        if (current.isGroup) {
            room = { ...current, userJoined: accept, status: accept && current.members?.some(m => m.status === "joined") ? "joined" : "invited", startedAt: Date.now(), lastGlowAt: undefined, glowEpoch: (current.glowEpoch || 0)+1 };
        } else room = { ...current, status: accept ? "joined" : "declined", startedAt: Date.now() };
        if (accept && room.status === "joined") { startRanks(); beginAccounting(); }
        const message = loadChatMessages(sessionId).find(item => item.id === current.invitationMessageId);
        if (message?.mediaData?.listeningInvite) updateMessageMediaData(message.id, { ...message.mediaData, listeningInvite: { ...message.mediaData.listeningInvite, response: accept ? "accepted" : "declined" } });
        pushChatMessage({ sessionId, role: "system", content: accept ? "用户已接受一起听邀请。" : "用户暂未接受一起听邀请。" });
        emit();
        window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
        window.dispatchEvent(new CustomEvent(CHAT_REQUEST_REPLY_EVENT, { detail: { sessionId } }));
    } finally { resolving.delete(id); }
}
