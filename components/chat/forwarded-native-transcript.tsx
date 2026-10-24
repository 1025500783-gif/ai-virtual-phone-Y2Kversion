"use client";
import {useSyncExternalStore,type CSSProperties} from "react";
import type {ForwardedChat} from "@/lib/chat-forward-types";
import {nativeMessageFromForward} from "@/lib/chat-forward-native";
import {forwardedStyle} from "@/lib/chat-forward-appearance";
import {forwardedEntryLayout} from "@/lib/chat-forward-layout";
import {canCurrentIdentityInteract} from "@/lib/identity-access";
import {formatChatUiTime,shouldShowTimestamp} from "@/lib/chat-time";
import {resolveBubbleColors} from "@/lib/chat-bubble-colors";
import {SnapshotMessageBubble} from "./message-bubble";
import {GroupSenderName} from "./group-sender-name";
import styles from "./forwarded-chat.module.css";
const subscribe=(notify:()=>void)=>{const media=window.matchMedia("(prefers-color-scheme: dark)");media.addEventListener("change",notify);return()=>media.removeEventListener("change",notify)};
const snapshot=()=>window.matchMedia("(prefers-color-scheme: dark)").matches;
export function ForwardedNativeTranscript({record,onImage}:{record:ForwardedChat;onImage:(url:string)=>void}) {
    const dark=useSyncExternalStore(subscribe,snapshot,()=>false);
    const preserveAppearance=record.theme?.dark===undefined || record.theme.dark===dark;
    const preset=record.theme?.preset || (record.entries.some(entry=>entry.appearance?.surface?.backdropFilter && entry.appearance.surface.backdropFilter!=="none")?"glass":"classic");
    const tails=new Set<number>();let lastText=-1;
    record.entries.forEach((entry,index)=>{if(!forwardedEntryLayout(record,index).consecutive){if(lastText>=0)tails.add(lastText);lastText=-1}if(!entry.kind||entry.kind==="quote")lastText=index});if(lastText>=0)tails.add(lastText);
    return <div className={styles.nativeTranscript+" chat-room-wrapper"} data-forward-native="" tabIndex={0} aria-label="聊天记录内容" data-imessage-private="" data-imessage-group={record.sourceKind==="group"||undefined} data-glass-bubbles={preset==="glass"||undefined} data-beauty-preset={preset} data-chat-dark={dark||undefined} style={{"--im26-page":preserveAppearance?record.theme?.background:undefined,"--im26-ink":preserveAppearance?record.theme?.ink:undefined} as CSSProperties}>
        <div className="page-body">{record.entries.map((entry,index)=>{
            const layout=forwardedEntryLayout(record,index),msg=nativeMessageFromForward(entry,index),kind=msg.mediaType;
            const colors=resolveBubbleColors({},dark,entry.isUser);
            const tint={ [entry.isUser?"--im26-base-blue":"--im26-base-incoming"]:colors.background,"--bubble-text-ink":colors.text,"--voice-ink":colors.voice,"--bubble-surface-color":colors.surface,"--bubble-surface-opacity":colors.opacity } as CSSProperties;
            const media=!!kind&&kind!=="audio"&&kind!=="quote";
            const stickerId=entry.isUser?record.sourceNames?.characterId:entry.speakerId;
            const stickerCharacterId=stickerId&&canCurrentIdentityInteract(stickerId)?stickerId:undefined;
            return <div key={index} className={styles.nativeRow}>
                {shouldShowTimestamp(entry.createdAt,record.entries[index-1]?.createdAt||null)&&<div className="chat-sys-msg"><time dateTime={entry.createdAt}>{formatChatUiTime(entry.createdAt)}</time></div>}
                <div className="chat-msg-wrapper" style={tint} data-role={entry.isUser?"user":"assistant"} data-consecutive={layout.consecutive||undefined} data-imessage-tail={tails.has(index)||undefined} data-group-last={layout.showAvatar||undefined}>
                    {layout.showAvatar&&<div className="chat-msg-avatar"><div className={styles.avatar}>{entry.avatar?<img src={entry.avatar} alt=""/>:entry.speaker.slice(0,1)}</div></div>}
                    <div className="chat-msg-content-wrap" data-voice-content={kind==="audio"||undefined}>
                        {layout.showName&&<GroupSenderName avatar={entry.avatar}>{entry.speaker}</GroupSenderName>}
                        <div data-forward-message={index} data-media-type={kind||"text"} className={"chat-bubble-role-"+(entry.isUser?"user":"assistant")+(media?" chat-bubble-media":"")} style={media||!preserveAppearance?undefined:forwardedStyle(entry.appearance?.bubble)}>
                            {(!kind||kind==="audio")&&<span className="imessage-bubble-surface" aria-hidden="true" style={preserveAppearance?forwardedStyle(entry.appearance?.surface):undefined}/>}
                            <SnapshotMessageBubble msg={msg} charName={entry.speaker} userName={record.sourceNames?.user} stickerCharacterId={stickerCharacterId} onImage={onImage}/>
                        </div>
                    </div>
                </div>
            </div>;
        })}</div>
    </div>;
}
