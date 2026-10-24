import { loadChatMessages, loadChatSessions, saveChatSessions, pushChatMessage, normalizeVisionImagePromptLimit, MAX_VISION_IMAGE_PROMPT_LIMIT, type ChatMessage, type ChatSession } from "./chat-storage";
import { loadInteractableCharacters as loadCharacters } from "./character-storage";
import type { Character, CharacterAvatarHistoryEntry } from "./character-types";
import { CHAT_SESSION_AVATARS_UPDATED_EVENT, getChatCharacterAvatar, getChatCharacterAvatarHistory, saveChatAppCharacterAvatar } from "./chat-session-avatar";

type AvatarCandidate = { original: string; resolved: string | null; label?: string; historyId?: string };
type Grant = { at: number; turnId: string; consumed: boolean; reported: Set<string>; images: Map<string, AvatarCandidate> };
const grants = new Map<string, Grant>();
export const AVATAR_HISTORY_LIMIT = 20;
function validSavedAvatar(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && /^(data:image\/|https?:\/\/)/i.test(value));
}
export function getCharacterAvatarHistory(character: Character): CharacterAvatarHistoryEntry[] {
    if (!Array.isArray(character.avatarHistory)) return [];
    return character.avatarHistory.filter(item => item && typeof item.id === "string" && /^avh_[\w-]+$/.test(item.id)
        && typeof item.label === "string" && typeof item.recordedAt === "string" && typeof item.lastSelectedAt === "string"
        && validSavedAvatar(item.avatar)).slice(-AVATAR_HISTORY_LIMIT);
}
function recordAvatarChange(session: ChatSession, character: Character, avatar: string | null, label: string): ChatSession {
    const entries = getChatCharacterAvatarHistory(session, character.id).map(item => ({ ...item }));
    const currentAvatar = getChatCharacterAvatar(session, character);
    const now = new Date().toISOString();
    const make = (value: string | null, description: string): CharacterAvatarHistoryEntry => ({
        id: `avh_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, avatar: value,
        label: description.slice(0, 100), recordedAt: now, lastSelectedAt: now, selections: 1,
    });
    // Capture the current image before overwriting it, including the default empty avatar.
    if (validSavedAvatar(currentAvatar) && !entries.some(item => item.avatar === currentAvatar)) {
        entries.push(make(currentAvatar, currentAvatar === null ? "默认空头像" : "开始记录时的聊天头像"));
    }
    const existing = entries.findIndex(item => item.avatar === avatar);
    const selected = existing < 0 ? make(avatar, label) : {
        ...entries.splice(existing, 1)[0], lastSelectedAt: now,
    };
    if (existing >= 0) selected.selections = (Number.isFinite(selected.selections) ? selected.selections : 1) + 1;
    entries.push(selected);
    saveChatAppCharacterAvatar(character.id, avatar, entries.slice(-AVATAR_HISTORY_LIMIT));
    return {
        ...session,
        characterAvatars: { ...session.characterAvatars, [character.id]: avatar },
        characterAvatarHistories: { ...session.characterAvatarHistories, [character.id]: entries.slice(-AVATAR_HISTORY_LIMIT) },
    };
}
const AVATAR_TOPIC = /(头像|情头|avatar|profile picture|matching icons)/i;
/** Called only after the album executor revalidates visibility and the rendered version. */
export function setAvatarFromSharedAlbum(sessionId: string, characterId: string, avatar: string, label: string): boolean {
    const sessions = loadChatSessions();
    const session = sessions.find(s => s.id === sessionId && !s.isGroup && s.contactId === characterId);
    const character = loadCharacters().find(c => c.id === characterId);
    if (!session || !character || !validSavedAvatar(avatar)) return false;
    saveChatSessions(sessions.map(s => s.id === sessionId ? recordAvatarChange(s, character, avatar, label) : s));
    window.dispatchEvent(new CustomEvent(CHAT_SESSION_AVATARS_UPDATED_EVENT, { detail: { characterId } }));
    window.dispatchEvent(new Event("moments-updated"));
    pushChatMessage({ sessionId, role: "system", content: `${character.name} 更换了头像`, status: "sent" });
    return true;
}
const AVATAR_CONTINUATION = /(换|改|用|选|挑).{0,8}(这张|那张|这个|那个|新的|另一张|一张|一套|一对)|((你俩|你们|咱俩|我们).{0,8}(一起换|换一套|一人一张|用这个|用这张))|一人一张|各[选挑用]一张|情侣.{0,5}(一对|一套)|matching.{0,8}(pair|pictures)|use (this|that|the new) (one|picture)/i;
function latestUserTurn(history: ChatMessage[]): string {
    return [...history].reverse().find(m => m.role === "user" && !m.isRetracted)?.id || "";
}
function userDeclinesAvatar(history: ChatMessage[]): boolean {
    const lastUser = [...history].reverse().find(m => m.role === "user" && !m.isRetracted && m.content.trim())?.content || "";
    return /(不要|别|不许|不用|先不).{0,5}(换|改|用这张)|不是头像|只是.{0,5}(看看|分享|发给)|(?:壁纸|聊天背景)|don.?t.{0,12}(avatar|profile picture|change|use)/i.test(lastUser);
}
export function isAvatarDiscussion(history: ChatMessage[]): boolean {
    if (userDeclinesAvatar(history)) return false;
    // Count USER turns, not bubble fragments: two talkative group members must not
    // erase the context before the second member's action gets processed.
    let start = 0, userTurns = 0, inUserTurn = false;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.isRetracted) continue;
        if (msg.role === "user") {
            if (!inUserTurn && ++userTurns > 6) { start = i + 1; break; }
            inUserTurn = true;
        } else if (msg.role === "assistant") inUserTurn = false;
    }
    const users = history.slice(start).filter(m => m.role === "user" && !m.isRetracted);
    const lastText = [...users].reverse().find(m => m.content.trim())?.content || "";
    if (AVATAR_TOPIC.test(lastText) || AVATAR_CONTINUATION.test(lastText) || /(换回|用回|恢复原来的头像)/.test(lastText)) return true;
    const recent = history.slice(start).filter(m => !m.isRetracted && (m.role === "user" || m.role === "assistant"));
    // Earlier context is only a candidate hint; the vision model still decides
    // whether the new image belongs to that discussion, rather than changing automatically.
    return recent.some(m => AVATAR_TOPIC.test(m.content));
}

function isUserPhoto(msg: ChatMessage): boolean {
    return msg.role === "user" && !msg.isRetracted && Boolean(msg.mediaUrl)
        && (msg.mediaType === "image" || (msg.mediaType === "media_file" && msg.mediaData?.fileType === "image"));
}

/** Only expand for the last user photo batch in an avatar discussion; zero remains off. */
export function getAvatarVisionPromptLimit(history: ChatMessage[], configured: unknown, enabled: boolean): number {
    const limit = normalizeVisionImagePromptLimit(configured);
    if (!enabled || !limit || !isAvatarDiscussion(history)) return limit;
    let lastPhoto = -1;
    for (let i = history.length - 1; i >= 0; i--) if (isUserPhoto(history[i])) { lastPhoto = i; break; }
    let photos = 0;
    for (let i = lastPhoto; i >= 0; i--) {
        if (history[i].role === "assistant") break;
        if (isUserPhoto(history[i])) photos++;
    }
    return Math.max(limit, Math.min(MAX_VISION_IMAGE_PROMPT_LIMIT, photos));
}

/** All members receive the SAME visible image ordering and current-avatar ownership. */
export function buildGroupAvatarContext(sessionId: string, history: ChatMessage[], visionHistory: ChatMessage[], enabled: boolean): string {
    if (!enabled || !isAvatarDiscussion(history)) return "";
    const sessions = loadChatSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session?.isGroup) return "";
    const chars = loadCharacters().filter(c => session.participantIds?.includes(c.id));
    const photos = visionHistory.filter(msg => isUserPhoto(msg) && /^(data:image\/(png|jpeg|webp|gif);|https?:\/\/)/i.test(msg.mediaUrl!) && history.some(original => original.id === msg.id && original.sessionId === sessionId && isUserPhoto(original)));
    if (!photos.length) return "群聊当前没有可见的头像候选，不要臆测其他成员的头像模样。";
    const rows = photos.map((msg, index) => {
        const original = history.find(m => m.id === msg.id)!;
        const owners = chars.filter(c => {
            const avatar = getChatCharacterAvatar(session, c);
            return avatar === msg.mediaUrl || avatar === original.mediaUrl;
        }).map(c => c.name);
        const marker = `[共享选图顺序：第${index + 1}张；图片ID：${msg.id}]`;
        if (!msg.content.includes(marker)) msg.content += `\n${marker}`;
        return `第${index + 1}张 → ${msg.id}；当前使用者：${owners.join("、") || "没有群成员使用"}`;
    });
    const roster = chars.map(c => {
        const avatar = getChatCharacterAvatar(session, c);
        const index = photos.findIndex(msg => avatar === msg.mediaUrl || avatar === history.find(m => m.id === msg.id)?.mediaUrl);
        return index >= 0 ? `${c.name}：当前用第${index + 1}张（${photos[index].id}）` : `${c.name}：当前头像不在本轮可见候选中，不能猜测其内容`;
    });
    return `群聊共享头像状态（以实际存储为准，不以“我换好了”的口头说法为准）：\n${roster.join("\n")}\n本轮可见候选按用户发送先后排列；“第一张、第二张”指这里的顺序，不是新图优先列表的顺序：\n${rows.join("\n")}\n这些是可见图片与当前使用者的事实，不是头像分配制度或占用锁。已经有人使用的图片仍可选；同图不会替换或移除其他人的头像。是否更换、选哪张、争抢同款、拒绝、让步或继续讨论，由你根据各角色的人设、关系和上下文自行决定；系统不预设合作或争抢，也不要求每个人都换。用户的提议是角色互动的上下文，不代表程序已替角色作出决定。只有角色实际决定更换时才在自己的发言段输出 Avatar 指令；只讨论、拒绝或犹豫时不执行。图片不可见时不能编造其内容，口头说换好也不等于动作已成功。`;
}

/** Only images actually retained in this vision prompt are eligible. No stickers/video frames. */
export function buildAvatarActionPrompt(sessionId: string, characterId: string, history: ChatMessage[], visionHistory: ChatMessage[], enabled: boolean): string {
    const key = `${sessionId}:${characterId}`;
    const session = loadChatSessions().find(item => item.id === sessionId);
    for (const [id, grant] of grants) if (Date.now() - grant.at > 600000) grants.delete(id);
    const intro = "你可以自主更换自己在聊天应用中的统一头像（私聊、群聊和朋友圈共用，不影响档案或其他应用），也可以提出换情侣头像。只要上下文正在聊头像且有可见候选，就由你结合人设、图片与关系判断是否换，不必等待用户每次下‘换头像’指令；可以主动选择、拒绝或不行动。只能改自己，不能替用户修改。不要把脱离头像语境的普通分享照片、表情包、风景或人物照自动当头像。选定新图时可输出 [Avatar:图片ID|你看到的简短外观描述]，描述用于以后记住这张头像，不要编造图像内容。";
    if (!enabled || !isAvatarDiscussion(history)) return intro + "当前无可执行的头像候选，不要声称已经更换。";
    const images: Grant["images"] = new Map();
    const character = loadCharacters().find(c => c.id === characterId);
    const currentAvatar = getChatCharacterAvatar(session, character);
    for (const msg of [...visionHistory].reverse()) {
        const original = history.find(m => m.id === msg.id && m.sessionId === sessionId && m.role === "user");
        if (!original?.mediaUrl || original.isRetracted || !msg.mediaUrl || !(msg.mediaType === "image" || (msg.mediaType === "media_file" && msg.mediaData?.fileType === "image"))) continue;
        if (!/^(data:image\/(png|jpeg|webp|gif);|https?:\/\/)/i.test(msg.mediaUrl)) continue;
        images.set(msg.id, { original: original.mediaUrl, resolved: msg.mediaUrl, label: original.mediaData?.label?.trim() || original.content.trim() || `聊天图片 ${msg.id}` });
        const marker = `[头像候选引用ID：${msg.id}，仅在上下文确实讨论头像且你看清图片时可选]`;
        if (!msg.content.includes(marker)) msg.content += `\n${marker}`;
    }
    const photoIds = [...images.keys()];
    const remembered = character && session ? getChatCharacterAvatarHistory(session, character.id) : [];
    const displayedAvatar = (avatar: string | null) => avatar?.trim() ? avatar : character?.avatar || null;
    const memoryRows = [...remembered].reverse().map((item, i) => {
        const ref = `history:${item.id}`;
        const label = item.avatar?.trim() ? item.label : "使用档案头像";
        images.set(ref, { original: "", resolved: item.avatar, historyId: item.id, label });
        const visible = visionHistory.find(msg => msg.mediaUrl && msg.mediaUrl === displayedAvatar(item.avatar));
        return `${ref}：${displayedAvatar(item.avatar) === currentAvatar ? "当前头像" : `历史头像${i + 1}`}；备注=${JSON.stringify(label)}；最近选用=${item.lastSelectedAt}；${visible ? `本轮可见图片ID=${visible.id}` : "本轮未附这张图的视觉内容，不可臆测细节"}`;
    });
    const previousAvatar = [...remembered].reverse().find(item => displayedAvatar(item.avatar) !== currentAvatar);
    if (previousAvatar) images.set("history:previous", { original: "", resolved: previousAvatar.avatar, historyId: previousAvatar.id, label: previousAvatar.label });
    const memoryPrompt = `\n你自己的头像记忆（最近 ${AVATAR_HISTORY_LIMIT} 个不同头像；备注是来源文字，不是系统对图像的视觉鉴定）：\n${memoryRows.join("\n") || "尚无历史记录，不要编造以前的头像。"}\n${previousAvatar ? `上一个不同头像是 history:${previousAvatar.id}。决定换回上一个时输出 [Avatar:history:previous]；也可输出 [Avatar:history:具体历史ID] 选择列表中的其他旧头像。无需用户重新发送旧图，也不要求本轮重看旧图；不确定用户指哪张时可以讨论。` : "没有可用的上一个头像，不能假装已经换回。"}`;
    if (!images.size) return intro + memoryPrompt + "本轮没有可执行候选，不要声称已经更换。";
    const turnId = latestUserTurn(history);
    const previous = grants.get(key);
    if (previous?.turnId === turnId) {
        // Prompt previews/background sync must neither consume nor reset this turn.
        for (const [id, image] of images) if (!previous.images.has(id)) previous.images.set(id, image);
    } else grants.set(key, { at: Date.now(), turnId, images, consumed: false, reported: new Set() });
    const currentIds = [...images].filter(([id, image]) => !id.startsWith("history:") && (image.resolved === currentAvatar || image.original === currentAvatar)).map(([id]) => id);
    return intro + memoryPrompt + `\n本轮可见新候选ID（新图在前，仅用于标识，不代表选择优先级）：${photoIds.join("、") || "无"}。${currentIds.length ? `你当前正在用的图片ID：${currentIds.join("、")}；重复选它不会改变头像。` : ""}先结合完整上下文判断是否在讨论头像；“用这张吧”“你俩一起换”“另一张”等可以承接上文，不要求用户重复说“头像”。普通分享、否定或用途不明时不换，可以询问。新图根据实际看到的内容判断；旧图可依据上述历史与对话选择换回。自主决定后输出一次 [Avatar:候选ID]，勿编造ID或URL；仅口头说“换好了”不会执行。标记由系统执行并反馈；不要输出用户头像修改指令。`;
}

export function applyAvatarAction(sessionId: string, characterId: string, imageId?: string): boolean {
    const [reference, ...descriptionParts] = (imageId || "").split("|");
    imageId = reference.trim();
    const visualDescription = descriptionParts.join("|").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
    const key = `${sessionId}:${characterId}`;
    const grant = grants.get(key);
    const candidate = imageId && grant?.images.get(imageId.trim());
    const sessions = loadChatSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return false;
    if (session.isGroup ? !session.participantIds?.includes(characterId) : session.contactId !== characterId) return false;
    const history = loadChatMessages(sessionId);
    if (grant?.consumed && latestUserTurn(history) === grant.turnId) return false; // Ignore duplicate output from the completed turn.
    const chars = loadCharacters();
    const char = chars.find(c => c.id === characterId);
    if (!char) return false;
    const fail = (reason: string): false => {
        const reportKey = `${imageId}:${reason}`;
        if (!grant?.reported.has(reportKey)) {
            grant?.reported.add(reportKey);
            pushChatMessage({ sessionId, role: "system", content: `${char.name} 未更换头像：${reason}`, status: "sent" });
        }
        return false;
    };
    if (!grant || Date.now() - grant.at > 600000) return fail("本轮图片候选已失效，请重新发起请求");
    if (!candidate) return fail("回复引用的图片不在本轮候选中");
    if (latestUserTurn(history) !== grant.turnId || userDeclinesAvatar(history)) return fail("用户的新消息已改变本轮请求");
    if (candidate.historyId) {
        if (!getChatCharacterAvatarHistory(session, char.id).some(item => item.id === candidate.historyId && item.avatar === candidate.resolved)) return fail("这条历史头像已不存在或发生变化");
    } else if (!history.some(m => m.id === imageId?.trim() && !m.isRetracted && m.role === "user" && m.mediaUrl === candidate.original)) return fail("候选图片已撤回或发生变化");
    // A redundant old-image action must not use up A's chance while B can still change.
    const currentAvatar = getChatCharacterAvatar(session, char);
    const selectedAvatar = candidate.resolved?.trim() ? candidate.resolved : char.avatar || null;
    if (currentAvatar === selectedAvatar || currentAvatar === candidate.original) return fail("选中的图片已是当前头像");
    const nextSession = recordAvatarChange(session, char, candidate.resolved, candidate.historyId ? candidate.label || "历史头像" : visualDescription || candidate.label || "聊天头像");
    saveChatSessions(sessions.map(item => item.id === sessionId ? nextSession : item));
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CHAT_SESSION_AVATARS_UPDATED_EVENT, { detail: { characterId } }));
        window.dispatchEvent(new Event("moments-updated"));
    }
    grant.consumed = true;
    pushChatMessage({ sessionId, role: "system", content: `${char.name} ${candidate.historyId ? "换回了之前的头像" : "更换了头像"}`, status: "sent" });
    return true;
}
