import type { ChatMessage, ChatSession } from "./chat-storage";
import { applyListeningRoomReply, getListeningRoom, type ListeningRoom } from "./listen-together";
import { getMusicControlBridge } from "./music-control-bridge";
import { getCurrentIdentityId } from "./identity-runtime";
import { stripXmlTagBlocks } from "./stream-preview";

/** Only an explicit, still-pending user invitation gets the fast text-only turn. */
export function pendingListeningInvite(session: ChatSession, history: ChatMessage[]): ListeningRoom | null {
    const current = getListeningRoom();
    const invitationMessage = history.filter(message => message.role === "user" && !message.isRetracted && message.mediaData?.listeningInvite).at(-1);
    if (!current || current.identityId !== getCurrentIdentityId() || current.sessionId !== session.id
        || current.initiator === "character" || current.userJoined === false || current.status === "declined"
        || invitationMessage?.mediaData?.listeningInvite?.roomId !== current.id
        || history.slice(history.indexOf(invitationMessage) + 1).some(message => message.role === "assistant" && !message.isRetracted)) return null;
    if (Boolean(session.isGroup) !== Boolean(current.isGroup)) return null;
    return current.isGroup
        ? current.members?.some(member => member.status === "invited") ? current : null
        : current.status === "invited" && current.characterId === session.contactId ? current : null;
}

export function listeningInviteFirstInstruction(current: ListeningRoom): string {
    const snapshot = getMusicControlBridge()?.getState();
    const track = snapshot?.identityId === current.identityId ? snapshot.currentTrack ?? snapshot.selectedTrack : null;
    const compact = (value?: string) => value?.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
    const song = track || current.song;
    const metadata = song ? JSON.stringify({
        title: compact(song.title), artist: compact(song.artist),
        album: track ? compact(track.album) : undefined,
        durationSeconds: track && Number.isFinite(track.duration) && track.duration > 0 ? track.duration : undefined,
        playing: track ? snapshot?.isPlaying : undefined,
    }) : "暂无曲目";
    const decision = `[一起听:${current.id}:接受]或[一起听:${current.id}:拒绝]`;
    return `用户发出一起听邀请。依据人设、关系和当前对话自主接受或拒绝。${current.isGroup
        ? `保持[角色名]:格式；每位回应成员在自己的发言段开头先输出${decision}，仅决定自己。`
        : `本轮正文先输出${decision}，再自然回复。`}
先给出决定，不在标记前输出分析、内心或状态栏；本轮不调用工具、不搜索歌曲或歌词。歌曲信息是背景，无需强行点评，不虚构未知信息或歌词。
播放器曲目信息：${metadata}`;
}

/** Execute only a complete leading consent marker, never examples inside prose/thought. */
export function createListeningInviteStreamObserver(
    invitation: ListeningRoom,
    options: { signal?: AbortSignal; names?: Map<string, string>; thinkingTags?: string[]; startedAt?: number } = {},
) {
    let text = "";
    const decided = new Set<string>();
    const startedAt = options.startedAt ?? Date.now();
    const timing = (phase: string) => console.info("[ListeningInvite]", { phase, elapsedMs: Date.now() - startedAt, sessionId: invitation.sessionId });
    timing("prompt-ready");
    const active = () => {
        const current = getListeningRoom();
        return !options.signal?.aborted && current?.id === invitation.id
            && current.identityId === invitation.identityId && getCurrentIdentityId() === invitation.identityId
            && current.sessionId === invitation.sessionId && current.initiator !== "character" && current.userJoined !== false;
    };
    const apply = (body: string, actorId: string) => {
        if (decided.has(actorId)) return;
        const match = body.trimStart().match(/^\[一起听:(?:([\w-]+):)?(接受|拒绝)\]/);
        if (!match || (match[1] && match[1] !== invitation.id) || !active()) return;
        const current = getListeningRoom()!;
        const pending = current.isGroup ? current.members?.some(member => member.characterId === actorId && member.status === "invited") : current.status === "invited";
        if (!pending) return;
        decided.add(actorId);
        applyListeningRoomReply(`[一起听:${invitation.id}:${match[2]}]`, invitation.sessionId, actorId, `invite-${invitation.id}`);
        timing(match[2] === "接受" ? "joined" : "declined");
    };
    return {
        active,
        push(delta: string) {
            if (!active()) return;
            if (!text && delta) timing("first-content");
            text += delta;
            const visible = stripXmlTagBlocks(text, ["think", "thinking", "analysis", ...(options.thinkingTags || [])]);
            if (!invitation.isGroup) { apply(visible, invitation.characterId); return; }
            // Every speaker prefix closes the preceding segment, including unknown names.
            const sections = visible.split(/^\[([^\]\n]{1,32})\]:[ \t]*/m);
            for (let i = 1; i + 1 < sections.length; i += 2) {
                const actorId = options.names?.get(sections[i].trim());
                if (actorId) apply(sections[i + 1], actorId);
            }
        },
    };
}
