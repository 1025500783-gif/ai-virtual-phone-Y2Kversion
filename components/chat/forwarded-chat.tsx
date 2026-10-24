"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChatScreenshotImage } from "./chat-screenshot-image";
import ShareDestinationSheet from "./share-destination-sheet";
import { ChevronRight, X, Send, Aperture } from "lucide-react";
import type { ForwardedChat } from "@/lib/chat-forward-types";
import { createChatScreenshot, type ChatScreenshot } from "@/lib/chat-screenshot";
import { ForwardedNativeTranscript } from "./forwarded-native-transcript";
import { canForwardTo, captureForwardedChat, sendForwardedChat } from "@/lib/chat-forward";
import { loadChatSessions, type ChatSession } from "@/lib/chat-storage";
import { loadInteractableCharacters } from "@/lib/character-storage";
import { getCurrentIdentityId } from "@/lib/identity-runtime";
import styles from "./forwarded-chat.module.css";

function ForwardOverlay({ title, onClose, children, transcript = false }: { title: string; onClose: () => void; children: ReactNode; transcript?: boolean }) {
    const anchor = useRef<HTMLSpanElement>(null);
    const [host, setHost] = useState<Element | null>(null);
    const panel = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        setHost(anchor.current?.closest(".chat-room-wrapper") || document.querySelector('[data-ui="phone-screen"]') || document.body);
    }, []);
    useEffect(() => {
        if (!host) return;
        const previous = document.activeElement as HTMLElement | null;
        panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
        return () => previous?.focus();
    }, [host]);
    return <><span ref={anchor} hidden />{host && createPortal(<div className={`${styles.overlay} ${transcript ? styles.transcriptOverlay : ""}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={`${styles.panel} ${transcript ? styles.transcriptPanel : ""}`} onKeyDown={e => {
            if (e.key === "Escape") { e.stopPropagation(); onClose(); }
            if (e.key !== "Tab") return;
            const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href],audio[controls],video[controls],[tabindex]:not([tabindex="-1"])') || [])].filter(node => !node.closest('[inert]') && node.getClientRects().length);
            const first = nodes[0], last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
            <header><strong>{title}</strong><button type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>
            {children}
        </div>
    </div>, host)}</>;
}

export function ForwardedChatCard({ record, onMusicPlay }: { record: ForwardedChat; onMusicPlay?: (title: string, artist?: string, track?: import("@/lib/music-storage").MusicTrack) => void }) {
    const [open, setOpen] = useState(false);
    const [image, setImage] = useState<string | null>(null);
    return <>
        <button type="button" className={styles.card} onClick={() => setOpen(true)}>
            <strong>{record.title}</strong>
            {record.entries.slice(0, 3).map((e, i) => <span key={i}>{e.speaker}：{e.kind ? `[${e.kind === "transfer" ? `转账 ${e.currency} ${e.amount ?? 0}` : e.kind === "red_packet" ? `红包 ${e.currency} ${e.amount ?? 0}` : e.kind === "image" ? "图片" : e.kind === "audio" ? "语音" : "分享内容"}]` : e.text}</span>)}
            <footer>聊天记录 · {record.entries.length}条<ChevronRight size={15} /></footer>
        </button>
        {open && <ForwardOverlay transcript title={record.title} onClose={() => { setOpen(false); setImage(null); }}>
            <ForwardedNativeTranscript record={record} onImage={setImage}/>
            {image && <div className={styles.lightbox}><button type="button" aria-label="关闭图片" onClick={() => setImage(null)}><X /></button><img loading="lazy" decoding="async" src={image} alt="转发图片" /></div>}
        </ForwardOverlay>}
    </>;
}

export function ForwardChatSheet({ source, selectedIds, onClose, onSent }: { source: ChatSession; selectedIds: Set<string>; onClose: () => void; onSent: () => void }) {
    const identity = useRef(getCurrentIdentityId());
    const [momentDraft, setMomentDraft] = useState<{ record: ForwardedChat; image: ChatScreenshot } | null>(null);
    const [query, setQuery] = useState("");
    const [target, setTarget] = useState("");
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [error, setError] = useState("");
    const chars = loadInteractableCharacters();
    const name = (s: ChatSession) => s.isGroup ? s.groupName || "群聊" : s.alias || chars.find(c => c.id === s.contactId)?.name || "对话";
    const sessions = loadChatSessions().filter(s => s.id !== source.id && canForwardTo(s) && name(s).toLowerCase().includes(query.toLowerCase()));
    const submit = async () => {
        if (lock.current || !target) return;
        lock.current = true; setBusy(true); setError("");
        try {
            if (getCurrentIdentityId() !== identity.current) throw new Error("身份已切换，请重新选择。");
            const record = await captureForwardedChat(source, selectedIds);
            sendForwardedChat(record, target, identity.current); onSent();
        } catch (e) { setError(e instanceof Error ? e.message : "转发失败"); }
        finally { lock.current = false; setBusy(false); }
    };
    const shareMoment = async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError("");
        try {
            if (getCurrentIdentityId() !== identity.current) throw new Error("身份已切换，请重新选择。");
            const record = await captureForwardedChat(source, selectedIds);
            if (getCurrentIdentityId() !== identity.current) throw new Error("身份已切换，请重新选择。");
            const image = await createChatScreenshot(record, { kind: "user" }, () => { if (getCurrentIdentityId() !== identity.current) throw new Error("身份已切换，请重新选择。"); });
            setMomentDraft({ record, image });
        } catch (e) { setError(e instanceof Error ? e.message : "准备转发失败"); }
        finally { lock.current = false; setBusy(false); }
    };
    if (momentDraft) return <ShareDestinationSheet payload={{ type: "chat_record", title: momentDraft.record.title, body: "", authorName: "聊天截图", record: momentDraft.record, image: momentDraft.image, identityId: identity.current }} preview={<ChatScreenshotImage url={momentDraft.image.dataUrl} />} onClose={() => setMomentDraft(null)} onView={onSent} />;
    return <ForwardOverlay title="合并转发" onClose={() => { if (!busy) onClose(); }}>
        <button type="button" className={`${styles.send} ${styles.momentDestination}`} disabled={busy} onClick={() => void shareMoment()}><Aperture size={18} />{busy ? "正在生成截图…" : "发到朋友圈"}</button>
        <input className={styles.search} aria-label="搜索对话" placeholder="搜索对话" value={query} onChange={e => setQuery(e.target.value)} />
        <div className={styles.targets}>{sessions.map(s => <button key={s.id} type="button" aria-pressed={target === s.id} onClick={() => setTarget(s.id)}>{name(s)}<span>{target === s.id ? "✓" : ""}</span></button>)}{!sessions.length && <p>暂无可发送的对话</p>}</div>
        {error && <p role="alert">{error}</p>}
        <button type="button" className={styles.send} disabled={!target || busy} onClick={() => void submit()}><Send size={17} />{busy ? "正在转发…" : `发送 ${selectedIds.size} 条记录`}</button>
    </ForwardOverlay>;
}
