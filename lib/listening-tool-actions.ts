import { assertCharacterIdentityAccess } from "./identity-access";
import { loadChatSessions } from "./chat-storage";
import { getMusicControlBridge } from "./music-control-bridge";
import { getCurrentIdentityId } from "./identity-runtime";
import { ownListeningRankView, loadListeningLibrary, createListeningPlaylist, editListeningPlaylist, songForListeningLibrary } from "./listening-library";
import { settleListeningTime, getListeningRoom } from "./listen-together";
import { resolveSharedSong } from "./music-share-resolution";
export function executeListeningAction(name: string, args: Record<string, unknown>, context: { characterId?: string; sessionId?: string; appId?: string; signal?: AbortSignal }) {
    const actor = context.characterId, session = loadChatSessions().find(s => s.id === context.sessionId);
    if (!actor || !session || !["chat","group_chat"].includes(context.appId || "")) throw new Error("缺少当前聊天角色身份");
    assertCharacterIdentityAccess(actor);
    if (session.isGroup ? !session.participantIds?.includes(actor) : session.contactId !== actor) throw new Error("角色不属于当前聊天");
    if (name === "查看一起听排名") { settleListeningTime(); return ownListeningRankView(actor); }
    const action = args.action;
    if (action === "list") return loadListeningLibrary().playlists.filter(p => p.sessionId === session.id).map(p => ({id:p.id,name:p.name,songCount:p.songs.length,updatedBy:p.updatedBy,...(p.id === args.playlistId ? {songs:p.songs.slice(0,100)} : {})}));
    if (action === "create") return createListeningPlaylist(session.id, String(args.name || "我们一起听"), actor);
    const id = String(args.playlistId || "");
    if (action === "add_song") {
        if (context.signal?.aborted) throw new Error("操作已取消，未加入歌曲");
        const title = String(args.title || "").trim(), artist = String(args.artist || "").trim();
        if (!title || !artist) throw new Error("加入指定歌曲需要准确歌名title和歌手artist");
        if (!loadListeningLibrary().playlists.some(p => p.id === id && p.sessionId === session.id)) throw new Error("找不到当前聊天的歌单，请先list取得playlistId");
        const identity = getCurrentIdentityId();
        return resolveSharedSong(title, artist).then(track => {
            if (context.signal?.aborted) throw new Error("操作已取消，未加入歌曲");
            if (identity !== getCurrentIdentityId()) throw new Error("身份已切换，未加入歌曲");
            assertCharacterIdentityAccess(actor);
            const latest = loadChatSessions().find(s => s.id === session.id);
            if (!latest || (latest.isGroup ? !latest.participantIds?.includes(actor) : latest.contactId !== actor)) throw new Error("角色已不属于当前聊天，未加入歌曲");
            if (!track) throw new Error("未找到匹配的歌曲，未加入歌单");
            const playlist = editListeningPlaylist(session.id, id, actor, { add: songForListeningLibrary(track, actor) });
            return { id: playlist.id, name: playlist.name, songCount: playlist.songs.length, song: { id: track.id, title: track.title, artist: track.artist } };
        });
    }
    if (action === "rename") return editListeningPlaylist(session.id, id, actor, { name: String(args.name || "") });
    if (action === "remove") return editListeningPlaylist(session.id, id, actor, { removeId: String(args.songId || "") });
    if (action === "add_current") {
        const room = getListeningRoom(), state = getMusicControlBridge()?.getState();
        if (room?.sessionId !== session.id || room.status !== "joined" || (room.isGroup && !room.members?.some(m => m.characterId === actor && m.status === "joined"))) throw new Error("你尚未加入当前聊天的一起听");
        if (!state?.currentTrack || state.identityId !== getCurrentIdentityId()) throw new Error("当前没有可收藏的歌曲");
        return editListeningPlaylist(session.id, id, actor, { add: songForListeningLibrary(state.currentTrack, actor) });
    }
    throw new Error("不支持的一起听歌单操作");
}
