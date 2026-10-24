import type { ChatMessage } from "./chat-storage";
import type { ForwardedEntry } from "./chat-forward-types";

// Visible payload only. Wallet/source message IDs and mutation handles are never copied.
const visibleKeys = ["label","amount","currency","status","count","claimedBy","claimedAmounts","recipientName","voiceDuration","fileType","fileName","fileSize","musicTitle","musicArtist","musicCoverUrl","musicTrack","musicResolution","diceValue","diceSides","giftName","giftDescription","giftImageUrl","locationName","locationAddress","latitude","longitude","quotePreview","quoteRole","xiaohongshuAuthor","xiaohongshuTitle","xiaohongshuBody","xiaohongshuDescription","xiaohongshuNoteType","xiaohongshuTags","xiaohongshuCoverIcon","xiaohongshuTone"] as const;
export function captureNativeMessage(message: ChatMessage): NonNullable<ForwardedEntry["nativeMessage"]> {
    const data: Record<string, unknown> = {};
    for (const key of visibleKeys) { const value=(message.mediaData as Record<string, unknown> | undefined)?.[key]; if(value!==undefined)data[key]=structuredClone(value); }
    if(message.mediaData?.listeningInvite){const {roomId,...visible}=message.mediaData.listeningInvite;data.listeningInvite={...visible,roomId:"snapshot"};}
    return {content:message.content,mediaType:message.mediaType,mediaData:data};
}

export function nativeMessageFromForward(entry: ForwardedEntry,index:number): ChatMessage {
    const raw=entry.nativeMessage;
    const label=entry.voice?.transcript || entry.text.replace(/^\[(?:表情包|语音条)[:：]([\s\S]*?)\](?:\n[\s\S]*)?$/, "$1");
    const status=entry.paymentState==="已退回"?"declined":entry.paymentState==="已领取"?(entry.kind==="red_packet"?"opened":"received"):"pending";
    const mediaData={label,amount:entry.amount,currency:entry.currency,status,claimedBy:entry.claims,voiceDuration:entry.voice?.duration,...raw?.mediaData,
        ...(entry.kind==="sticker"&&entry.mediaUrl?{stickerUrl:entry.mediaUrl}:{}),
        ...(entry.nested?{forwardedChat:entry.nested}:{}),
        ...(entry.music?{musicTitle:entry.music.title,musicArtist:entry.music.artist,musicCoverUrl:entry.music.coverUrl,musicTrack:entry.music.track}:{}),
    } as ChatMessage["mediaData"];
    return {id:"forwarded-readonly-"+index,sessionId:"forwarded-readonly",role:entry.isUser?"user":"assistant",senderName:entry.speaker,senderCharacterId:entry.isUser?undefined:entry.speakerId,createdAt:entry.createdAt,status:"read",content:raw?.content ?? (entry.kind?"":entry.displayText ?? entry.text),mediaType:(raw?.mediaType || (entry.kind==="music"?"music_share":entry.kind)) as ChatMessage["mediaType"],mediaUrl:entry.mediaUrl,mediaData};
}
