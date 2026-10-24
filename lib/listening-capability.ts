import type { EnabledTool } from "./tool-storage";
import { formatToolsForPrompt, formatGroupToolsForPrompt } from "./tool-prompt";
import { listeningPlaylistContext, type ListeningPlaylistViewer } from "./listening-playlist-context";

export function isListeningTool(tool: EnabledTool) {
    return tool.source === "internal" && tool.sourceId.startsWith("listening_shared_");
}

// Built-in listening actions belong to the app. Omitting a preset's tools macro
// does not disable them or enable any unrelated configured/external tools.
export function selectChatRequestTools(tools: EnabledTool[], configuredToolsEnabled: boolean) {
    return configuredToolsEnabled ? tools : tools.filter(isListeningTool);
}

export function listeningCapabilityPrompt(tools: EnabledTool[], native: boolean, group = false, messages: readonly { content: unknown }[] = [], viewer?: ListeningPlaylistViewer) {
    const listening = tools.filter(isListeningTool);
    if (!listening.some(tool => tool.name === "管理一起听歌单")) return "";
    const guidance = "共享歌单、共同歌单、一起听歌单均指当前聊天的歌单。要求建歌单、改名或塞歌时，用“管理一起听歌单”实际操作，音乐分享卡不会入单。先list取得歌单ID；没有歌单时可create，目标有歧义先询问。选歌后用add_song按准确歌名和歌手查找入单；仅收藏当前播放曲目用add_current。以工具结果为准报告成功或失败，不虚构已添加的歌曲。";
    const catalogPresent = native || messages.some(message => typeof message.content === "string" && message.content.includes("<available_actions>") && message.content.includes("管理一起听歌单:"));
    return [guidance, viewer ? listeningPlaylistContext(viewer) : "", catalogPresent ? "" : (group ? formatGroupToolsForPrompt(listening) : formatToolsForPrompt(listening))].filter(Boolean).join("\n");
}
