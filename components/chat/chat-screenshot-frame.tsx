"use client";
import { ChevronLeft } from "lucide-react";
import type { ForwardedChat } from "@/lib/chat-forward-types";
import { forwardedStyle } from "@/lib/chat-forward-appearance";
import { forwardedEntryLayout } from "@/lib/chat-forward-layout";
import { projectChatScreenshot, screenshotTitle, type ScreenshotPerspective } from "@/lib/chat-screenshot-view";
import { shouldShowTimestamp, formatChatUiTime } from "@/lib/chat-time";
import { voiceDisplayText } from "@/lib/voice-expression";
import { VoiceReferenceGraphic } from "./voice-reference-graphic";
import { LyricShareCard } from "@/components/music/lyric-share-card";
import styles from "./forwarded-chat.module.css";

export function ChatScreenshotFrame({ record, perspective }: { record: ForwardedChat; perspective: ScreenshotPerspective }) {
    const projected = projectChatScreenshot(record, perspective);
    return <div data-chat-screenshot-frame="" className={styles.screenshot} style={{ width: record.theme?.width || 390, background: record.theme?.background || "#fff", color: record.theme?.ink || "#050505" }}>
        <header className={styles.screenshotHeader}><ChevronLeft size={24} /><strong>{screenshotTitle(record, perspective)}</strong><span /></header>
        <div className={styles.screenshotMessages}>{projected.entries.map((entry,index) => {
            const layout = forwardedEntryLayout(projected,index);
            const transcript = voiceDisplayText(entry.voice?.transcript || entry.text.replace(/^\[语音条[:：]/, "").replace(/\](?:\s*\n[\s\S]*)?$/, ""));
            const voiceRgb=entry.appearance?.voiceInk?.match(/\d+/g)?.slice(0,3).map(Number), bodyRgb=entry.appearance?.bubble.color?.match(/\d+/g)?.slice(0,3).map(Number);
            const voiceInk=voiceRgb?.every(value=>value>230) && bodyRgb?.every(value=>value<100) ? entry.appearance?.bubble.color : entry.appearance?.voiceInk;
            return <div key={index} className={styles.recordRow} data-consecutive={layout.consecutive || undefined}>
                {shouldShowTimestamp(entry.createdAt,projected.entries[index-1]?.createdAt || null) && <time className={styles.timestamp}>{formatChatUiTime(entry.createdAt)}</time>}
                <article className={styles.entry} data-user={entry.isUser} data-group={layout.groupSpeaker || undefined} data-screenshot-speaker={entry.speaker}>
                    {layout.showAvatar && <div className={styles.avatar}>{entry.avatar ? <img src={entry.avatar} alt="" /> : entry.speaker.slice(0,1)}</div>}
                    <div className={styles.body} data-kind={entry.kind}>{layout.showName && <small>{entry.speaker}</small>}
                        <div className={styles.bubble} data-forward-role={entry.isUser ? "user" : "assistant"} style={forwardedStyle(entry.appearance?.bubble)}>
                            {entry.appearance?.surface && <span aria-hidden="true" data-screenshot-surface="" className={styles.surface} style={forwardedStyle(entry.appearance.surface)} />}
                            {entry.kind === "audio" ? <div style={{color:voiceInk || (entry.isUser ? "#fff" : "#38acfc")}}><VoiceReferenceGraphic playing={false} synthesizing={false} failed={false} duration={entry.voice?.duration || Math.max(2,Math.ceil(transcript.length/4))} />{entry.appearance?.voiceTextVisible && <div className={styles.voiceTranscript}>{transcript}</div>}</div> : <>
                                {entry.music && <LyricShareCard {...entry.music} />}
                                {entry.mediaUrl && ["image","sticker","media_file"].includes(entry.kind || "") && <img className={styles.screenshotImage} src={entry.mediaUrl} alt={entry.displayText || "图片"} />}
                                {entry.nested && <div className={styles.screenshotNested}><strong>{entry.nested.title}</strong>{entry.nested.entries.slice(0,3).map((e,i)=><div key={i}>{e.speaker}：{e.displayText || e.text}</div>)}<small>聊天记录</small></div>}
                                {entry.kind === "transfer" || entry.kind === "red_packet" ? <><strong>{entry.kind === "transfer" ? "转账" : "红包"} · {entry.currency} {entry.amount ?? 0}</strong><div className={styles.text}>{entry.text}</div><small>{entry.paymentState}</small></> : !entry.music && !entry.nested && <div className={styles.text}>{entry.displayText ?? entry.text}</div>}
                            </>}
                        </div>
                    </div>
                </article>
            </div>;
        })}</div>
    </div>;
}
