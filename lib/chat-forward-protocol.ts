export const CHAT_FORWARD_PROTOCOL = "<chatForwarding>\n聊天记录转发是可选表达方式，按性格与话题自行决定，不必每轮使用。工具可用时：真实记录先用「查看可转发聊天记录」取得会话及消息ID，再用「转发聊天记录」mode=history选择记录，不能编造ID或读取自己未参与的会话。也可用mode=compose呈现自己与NPC的聊天片段，entries只填speaker和text，至少包含你自己的发言，不代替用户编造发言。默认发当前对话；history可设destination=moments，将真实记录截图发朋友圈，caption为可选附言。截图自动以你为右侧，原话和说话人不变，不要自行改写或颠倒消息。compose不能发布朋友圈截图；是否转发及NPC内容由你决定，只说‘转发了’不会产生卡片。原生动作按工具schema调用；私聊文字动作使用[执行动作:转发聊天记录({...})]；群聊文字动作使用[角色名执行动作:转发聊天记录({...})]，角色名须为实际执行者。\n</chatForwarding>";
export const CHAT_FORWARD_TOOL_DEFINITIONS = [
    { name: "查看可转发聊天记录", description: "不传sourceSessionId时列出你参与且可访问的真实会话；传入后读取最近20条可转发消息ID和正文摘要。beforeMessageId可读取更早一页。", parameterSchema: JSON.stringify({type:"object",properties:{sourceSessionId:{type:"string"},beforeMessageId:{type:"string"}},additionalProperties:false}) },
    { name: "转发聊天记录", description: "默认向当前对话发送卡片；history可设destination=moments发布本人视角的真实聊天长图，caption为附言。history复制真实来源的messageIds；compose按人设呈现你与NPC的片段，不能编造用户发言。完成后可正常继续说话。", parameterSchema: JSON.stringify({type:"object",properties:{destination:{type:"string",enum:["chat","moments"]},caption:{type:"string",maxLength:2000},mode:{type:"string",enum:["history","compose"]},sourceSessionId:{type:"string"},messageIds:{type:"array",items:{type:"string"},minItems:1,maxItems:50},title:{type:"string",maxLength:80},entries:{type:"array",minItems:1,maxItems:50,items:{type:"object",properties:{speaker:{type:"string",maxLength:60},text:{type:"string",maxLength:2000}},required:["speaker","text"],additionalProperties:false}}},required:["mode"],additionalProperties:false}) },
];

/** Refresh the service-owned protocol at request time without rewriting saved presets. */
export function refreshChatForwardProtocol(messages: { content: unknown }[]): void {
    for (const message of messages) if (typeof message.content === "string" && message.content.includes("<chatForwarding>"))
        message.content = message.content.replace(/<chatForwarding>[\s\S]*?<\/chatForwarding>/g, CHAT_FORWARD_PROTOCOL);
}
