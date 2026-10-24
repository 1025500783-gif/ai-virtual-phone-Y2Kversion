import { loadChatMessages, loadChatSessions, loadChatContacts, type ChatMessage } from "./chat-storage";
import { assertCharacterIdentityAccess } from "./identity-access";
import { assertIdentityActive, getCurrentIdentityId } from "./identity-runtime";
import { loadInteractableCharacters } from "./character-storage";
import { resolveUserIdentity } from "./settings-storage";
import { canForwardTo, captureForwardedChat, forwardedValueSize, sendForwardedChat } from "./chat-forward";
import type { ForwardedChat, ForwardedEntry } from "./chat-forward-types";

type Context = { appId?: string; sourceEngine?: string; sessionId?: string; characterId?: string; signal?: AbortSignal };
const hidden = new Set(["tool_call","tool_result","tool_notice","system_instruction","memory_write_request"]);
function visible(message: ChatMessage) {
    return !message.isRetracted && (message.role === "user" || message.role === "assistant") && !hidden.has(message.mediaType || "");
}
export async function executeChatForwardAction(name: string, args: Record<string,unknown>, context: Context) {
    const actorId=context.characterId;
    if(!actorId || !context.sessionId || !((context.appId==="chat" && context.sourceEngine==="chat") || (context.appId==="group_chat" && context.sourceEngine==="group_chat"))) throw new Error("当前场景不支持聊天记录转发");
    assertCharacterIdentityAccess(actorId);
    const identity=getCurrentIdentityId();
    const guard=()=>{assertIdentityActive();assertCharacterIdentityAccess(actorId);if(context.signal?.aborted || identity!==getCurrentIdentityId())throw new Error("转发已取消或身份已切换");};
    guard();
    const sessions=loadChatSessions();
    const target=sessions.find(session=>session.id===context.sessionId);
    if(!target || !canForwardTo(target,actorId))throw new Error("你当前不能在这个会话发送消息");
    const actor=loadInteractableCharacters().find(character=>character.id===actorId);
    if(!actor)throw new Error("角色不可访问");
    const sources=sessions.filter(session=>canForwardTo(session,actorId));
    const source=()=>{const session=sources.find(session=>session.id===args.sourceSessionId);if(!session)throw new Error("来源会话不存在或你未参与该会话");return session;};
    if(name==="查看可转发聊天记录") {
        if(!args.sourceSessionId)return {sessions:sources.slice(0,80).map(session=>({id:session.id,name:session.isGroup?session.groupName||"群聊":`${resolveUserIdentity(session.contactId,"chat")?.name||"用户"}与你的私聊`,kind:session.isGroup?"group":"private"}))};
        const session=source();
        let messages=loadChatMessages(session.id).filter(visible);
        if(args.beforeMessageId){const index=messages.findIndex(message=>message.id===args.beforeMessageId);if(index<0)throw new Error("分页消息已不存在，请重新查看");messages=messages.slice(0,index);}
        const page=messages.slice(-20);
        const characters=loadInteractableCharacters();
        return {sessionId:session.id,olderBefore:messages.length>20?page[0].id:undefined,messages:page.map(message=>({id:message.id,speaker:message.role==="user"?resolveUserIdentity(session.contactId,"chat")?.name||"用户":characters.find(character=>character.id===(message.senderCharacterId||session.contactId))?.name||"角色",time:message.createdAt,text:message.content.slice(0,800),kind:message.mediaType}))};
    }
    if(name!=="转发聊天记录")throw new Error("未知聊天记录动作");
    if (args.destination !== undefined && args.destination !== "chat" && args.destination !== "moments") throw new Error("destination须为chat或moments");
    if (args.destination === "moments" && args.mode !== "history") throw new Error("朋友圈截图只支持真实聊天记录history");
    if (args.caption !== undefined && (typeof args.caption !== "string" || args.caption.length > 2000)) throw new Error("附言须为2000字以内文本");
    let record:ForwardedChat;
    if(args.mode==="history") {
        const session=source();
        if(!Array.isArray(args.messageIds) || !args.messageIds.length || args.messageIds.length>50 || args.messageIds.some(id=>typeof id!=="string"))throw new Error("请选择1至50条真实消息ID");
        const ids=new Set(args.messageIds as string[]);
        const eligible=new Set(loadChatMessages(session.id).filter(visible).map(message=>message.id));
        if([...ids].some(id=>!eligible.has(id)))throw new Error("所选消息不存在、已撤回或不可转发");
        record=await captureForwardedChat(session,ids,{actorId,signal:context.signal});
        record.origin="history";
    } else if(args.mode==="compose") {
        // Bound generated input before copying it into a durable snapshot.
        forwardedValueSize(args,128*1024);
        if(!Array.isArray(args.entries)||!args.entries.length||args.entries.length>50)throw new Error("聊天片段须包含1至50条消息");
        const user=resolveUserIdentity(target.contactId,"chat");
        const reserved=new Set([user?.name,"用户","user","self","{{user}}"].filter(Boolean).map(name=>name!.trim().toLowerCase()));
        const now=new Date().toISOString();
        let own=false;
        const entries:ForwardedEntry[]=args.entries.map(value=>{
            if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("聊天片段格式不正确");
            const {speaker,text}=value as {speaker?:unknown;text?:unknown};
            if(typeof speaker!=="string"||!speaker.trim()||speaker.length>60||typeof text!=="string"||!text.trim()||text.length>2000)throw new Error("说话人或消息内容无效/过长");
            const name=speaker.trim();if(reserved.has(name.toLowerCase()))throw new Error("NPC片段不能代替用户编造发言");
            if(name===actor.name)own=true;
            return {speaker:name,text:text.trim(),isUser:false,createdAt:now};
        });
        if(!own)throw new Error(`聊天片段须包含你自己的发言，说话人使用${actor.name}`);
        record={version:1,title:typeof args.title==="string"&&args.title.trim()?args.title.trim().slice(0,80):`${actor.name}分享的聊天记录`,sourceKind:new Set(entries.map(entry=>entry.speaker)).size>2?"group":"private",origin:"character_composed",capturedAt:now,entries};
    } else throw new Error("mode须为history或compose");
    guard();
    if (args.destination === "moments") {
        const {createChatScreenshot,saveChatScreenshot} = await import("./chat-screenshot");
        const {hydrateMomentsStorage,addMomentPost,addPendingReaction,loadMomentsConfig} = await import("./moments-storage");
        await hydrateMomentsStorage(); guard();
        const screenshotGuard = () => { guard(); const currentSource = loadChatSessions().find(session=>session.id===args.sourceSessionId); if (!currentSource || !canForwardTo(currentSource,actorId)) throw new Error("来源会话已变化或不再可访问"); };
        const image = await createChatScreenshot(record,{kind:"character",characterId:actorId,name:actor.name},screenshotGuard);
        screenshotGuard(); const photoUrl = await saveChatScreenshot(image); screenshotGuard();
        const post = addMomentPost({authorType:"character",authorId:actorId,content:typeof args.caption === "string" ? args.caption.trim() : "",visibility:loadChatContacts().map(contact=>contact.characterId),photoUrl,forwardedChat:record,chatScreenshot:{version:1,perspective:image.perspective,width:image.width,height:image.height}});
        if (!post) throw new Error("这条朋友圈已发布，请勿重复发送");
        window.dispatchEvent(new CustomEvent("moments-updated"));
        const cfg=loadMomentsConfig();addPendingReaction({type:"npc_reaction",postId:post.id,characterId:actorId,fireAt:Date.now()+(cfg.npcReactionDelayMin+Math.random()*cfg.npcReactionDelayMin)*60000});
        return {sent:true,destination:"moments",postId:post.id,entries:record.entries.length,origin:record.origin};
    }
    const sent=sendForwardedChat(record,target.id,identity,actorId);
    return {sent:true,messageId:sent.id,entries:record.entries.length,origin:record.origin};
}
