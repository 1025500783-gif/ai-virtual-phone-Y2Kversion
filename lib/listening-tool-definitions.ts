export const LISTENING_TOOL_DEFINITIONS = [
    { name: "查看一起听排名", description: "仅查看你自己与当前用户的累计一起听时长与排名；不返回其他角色信息。可自主查看，是否提起由你决定，不必每轮查询。", parameterSchema: JSON.stringify({ type:"object", properties:{}, additionalProperties:false }) },
    {
        name: "管理一起听歌单",
        description: "实际管理当前聊天的共享/共同/一起听歌单：新建、重命名、按歌名找歌入单、收藏当前歌曲或移除。发音乐分享卡不会加入歌单；不修改网易云账号歌单。",
        parameterSchema: JSON.stringify({
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "create", "rename", "add_song", "add_current", "remove"], description: "list查看歌单；create新建；rename改名；add_song搜索指定歌曲入单；add_current收藏当前播放；remove移除" },
                playlistId: { type: "string", description: "list或create返回的真实歌单ID；rename/add_song/add_current/remove必填" },
                name: { type: "string", description: "create/rename时填写歌单名称" },
                title: { type: "string", description: "add_song必填，准确歌名，保留版本信息" },
                artist: { type: "string", description: "add_song必填，实际歌手" },
                songId: { type: "string", description: "remove必填，从list指定playlistId返回的歌曲中取得" },
            },
            required: ["action"], additionalProperties: false,
        }),
        usageGuide: [
            "动作：管理一起听歌单。仅修改当前聊天歌单；音乐分享卡不入单。",
            "action=list：查看歌单ID/名称；传playlistId可查看其中歌曲。",
            "action=create：name填写新歌单名。action=rename：playlistId与name必填。",
            "action=add_song：playlistId、准确title、实际artist必填，搜索匹配后入单，无需先播放或发邀请。",
            "action=add_current：playlistId必填，仅收藏当前一起听正在播放的歌。action=remove：playlistId、songId必填。",
            "先list取得真实ID；无歌单可create，目标有歧义先询问。多首歌曲逐首调用，按返回结果确认，不编造成功。群聊按工具协议标注执行角色。",
            "示例：",
            '[执行动作:管理一起听歌单({"action":"list"})]',
            '[执行动作:管理一起听歌单({"action":"create","name":"我们的歌"})]',
            '[执行动作:管理一起听歌单({"action":"rename","playlistId":"list返回的ID","name":"新的歌单名"})]',
            '[执行动作:管理一起听歌单({"action":"add_song","playlistId":"list返回的ID","title":"准确歌名","artist":"实际歌手"})]',
        ].join("\n"),
    },
];
