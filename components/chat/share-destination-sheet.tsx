"use client";
import { LyricShareCard } from "@/components/music/lyric-share-card";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getChatCharacterAvatar } from "@/lib/chat-session-avatar";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import { X, MessageCircle, Aperture, ChevronRight, Send } from "lucide-react";
import { loadChatSessions, createOrGetSession, hydrateChatStorage, loadChatContacts, pushChatMessage, type ChatSession } from "@/lib/chat-storage";
import { loadInteractableCharacters } from "@/lib/character-storage";
import { getCurrentIdentityId } from "@/lib/identity-runtime";
import { canCurrentIdentityInteract } from "@/lib/identity-access";
import { addMomentPost, hydrateMomentsStorage } from "@/lib/moments-storage";
import { saveChatScreenshot, type ChatScreenshot } from "@/lib/chat-screenshot";
import type { ForwardedChat } from "@/lib/chat-forward-types";
import { sendForwardedChat, forwardedValueSize } from "@/lib/chat-forward";
import { onUserPost } from "@/lib/moments-engine";
import { formatXiaohongshuShareForPrompt, type ChatSharePayload } from "@/lib/chat-share";
import styles from "./share-destination-sheet.module.css";

function ShareAvatarImage({ src, fallback }: { src?: string | null; fallback?: ReactNode }) {
    const [image, setImage] = useState<{ source: string; url: string } | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const direct = !!src && /^(https?:|data:|blob:|\/)/.test(src);
    const url = direct ? src : image && image.source === src ? image.url : null;
    useEffect(() => {
        let alive = true;
        if (src && !direct) void getChatImageFromIndexedDB(src).then(url => {
            if (alive) setImage(url ? { source: src, url } : null);
        }).catch(() => { if (alive) setImage(null); });
        return () => { alive = false; };
    }, [src, direct]);
    return url && failed !== url ? <img src={url} alt="" draggable={false} onError={() => setFailed(url)} /> : <>{fallback ?? <ChatFallbackAvatar />}</>;
}

function ShareDestinationAvatar({ session, characterId }: { session?: ChatSession; characterId?: string }) {
    const chars = loadInteractableCharacters();
    const character = chars.find(c => c.id === (characterId || session?.contactId));
    const members = session?.participantIds?.slice(0, 4) || [];
    const mosaic = <span className={styles.avatarGrid}>{Array.from({ length: 4 }, (_, i) => <span key={i}>
        {members[i] && <ShareAvatarImage src={getChatCharacterAvatar(session, chars.find(c => c.id === members[i]))} />}
    </span>)}</span>;
    return <span className={styles.avatar} aria-hidden="true"><ShareAvatarImage
        src={session?.isGroup ? session.groupAvatar : getChatCharacterAvatar(session, character)}
        fallback={session?.isGroup ? mosaic : undefined}
    /></span>;
}

function canShare(session: ChatSession): boolean {
    if (session.isSpectator || session.isBlacklisted) return false;
    if (!session.isGroup) return loadInteractableCharacters().some(c => c.id === session.contactId) && canCurrentIdentityInteract(session.contactId);
    if (new Date(session.groupMutes?.self || "").getTime() > Date.now()) return false;
    const allowed = new Set(loadInteractableCharacters().map(c => c.id));
    return !!session.participantIds?.length && session.participantIds.every(id => allowed.has(id) && canCurrentIdentityInteract(id));
}

type ForwardSharePayload = { type: "chat_record"; title: string; body: string; authorName: string; record: ForwardedChat; image: ChatScreenshot; identityId: string | null };

export default function ShareDestinationSheet({ payload, onClose, onView, preview }: { payload: ChatSharePayload | ForwardSharePayload; onClose: () => void; onView: (destination: string) => void; preview?: ReactNode }) {
    const identity = useRef(getCurrentIdentityId());
    const panel = useRef<HTMLDivElement>(null);
    const submitting = useRef(false);
    const live = useRef(true);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [tab, setTab] = useState<"chat" | "moments">(payload.type === "chat_record" ? "moments" : "chat");
    const [query, setQuery] = useState("");
    const [note, setNote] = useState("");
    const [target, setTarget] = useState<ChatSession | "moments" | null>(null);
    const [visibility, setVisibility] = useState<string[]>([]);
    const [showAudience, setShowAudience] = useState(false);
    const [audienceMode, setAudienceMode] = useState<"all" | "some" | "self">("all");
    const [audienceQuery, setAudienceQuery] = useState("");
    const [coverFailed, setCoverFailed] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);
    const sentDestination = useRef<string>("");
    const chars = loadInteractableCharacters();
    const contacts = loadChatContacts().filter(c => chars.some(ch => ch.id === c.characterId));
    const audienceIds = (audienceMode === "all" ? contacts.map(c => c.characterId) : audienceMode === "self" ? [] : visibility).filter(id => contacts.some(c => c.characterId === id) && canCurrentIdentityInteract(id));
    const audienceLabel = audienceMode === "all" ? "所有好友" : audienceMode === "self" ? "仅自己" : "部分好友";
    const audienceContacts = contacts.filter(c => (c.nickname || chars.find(ch => ch.id === c.characterId)?.name || "").toLowerCase().includes(audienceQuery.toLowerCase()));
    const name = (session: ChatSession) => session.isGroup ? session.groupName || "群聊" : session.alias || chars.find(c => c.id === session.contactId)?.name || "对话";
    const title = payload.title;
    const excerpt = payload.type === "music" ? payload.listeningContext?.reference?.text : payload.body;
    const subtitle = payload.type === "music" ? payload.artist : payload.authorName;

    useEffect(() => {
        let alive = true;
        Promise.all([hydrateChatStorage(), hydrateMomentsStorage()]).then(() => {
            if (!alive || identity.current !== getCurrentIdentityId()) return;
            const existing = loadChatSessions();
            const candidates: ChatSession[] = loadChatContacts().filter(c => !existing.some(s => !s.isGroup && s.contactId === c.characterId)).map(c => ({ id: "contact:" + c.characterId, contactId: c.characterId, alias: c.nickname, unreadCount: 0, updatedAt: c.addedAt, isPinned: false }));
            setSessions([...existing, ...candidates].filter(canShare));
            setVisibility(loadChatContacts().map(c => c.characterId).filter(canCurrentIdentityInteract));
            setReady(true);
        }).catch(() => { if (alive) setError("加载失败，请关闭后重试"); });
        const previous = document.activeElement as HTMLElement | null;
        panel.current?.focus();
        return () => { alive = false; live.current = false; previous?.focus?.(); };
    }, []);

    const confirm = async (destination: ChatSession | "moments" | null = target) => {
        const target = destination;
        if (submitting.current || !target || !ready) return;
        submitting.current = true; setBusy(true);
        try {
            if (identity.current !== getCurrentIdentityId()) throw new Error("身份已切换，请重新分享");
            if (payload.type === "music" && payload.listeningContext && payload.listeningContext.identityId !== identity.current) throw new Error("这条分享来自其他身份，请重新选择");
            if (payload.type === "chat_record") {
                if (payload.identityId !== identity.current) throw new Error("身份已切换，请重新选择聊天记录");
                forwardedValueSize(payload.record);
            }
            if (target === "moments") {
                const photoUrl = payload.type === "chat_record" ? await saveChatScreenshot(payload.image) : undefined;
                if (!live.current || identity.current !== getCurrentIdentityId()) throw new Error("发布已取消或身份已切换");
                const content = payload.type === "chat_record" ? note.trim() : payload.type === "music"
                    ? [note.trim(), `分享歌曲《${payload.title}》${payload.artist ? ` — ${payload.artist}` : ""}`, excerpt ? `「${excerpt}」` : ""].filter(Boolean).join("\n\n")
                    : [note.trim(), formatXiaohongshuShareForPrompt({ author: payload.authorName, title: payload.title, body: payload.body, description: payload.description })].filter(Boolean).join("\n\n");
                const post = addMomentPost({ authorType: "user", authorId: "user", content, visibility: audienceIds,
                    ...(payload.type === "chat_record" ? { forwardedChat: structuredClone(payload.record), photoUrl, chatScreenshot: { version: 1 as const, perspective: payload.image.perspective, width: payload.image.width, height: payload.image.height } } : {}),
                    ...(payload.type === "music" && excerpt ? { musicLyricShare: { title: payload.title, artist: payload.artist, coverUrl: payload.coverUrl, text: excerpt, caption: note.trim() } } : {}) });
                if (!post) throw new Error("发布未成功，请重试");
                window.dispatchEvent(new CustomEvent("moments-updated"));
                try { onUserPost(post); } catch { /* The post is saved; reaction scheduling must not cause a duplicate send. */ }
                sentDestination.current = "moments";
            } else {
                let current = loadChatSessions().find(s => s.id === target.id);
                if (!current && target.id.startsWith("contact:") && loadChatContacts().some(c => c.characterId === target.contactId) && canCurrentIdentityInteract(target.contactId)) current = createOrGetSession(target.contactId);
                if (!current || !canShare(current)) throw new Error("此对话当前不可发送，请重新选择");
                if (payload.type === "chat_record") {
                    sendForwardedChat(payload.record, current.id, identity.current);
                } else if (payload.type === "music") {
                    pushChatMessage({ sessionId: current.id, role: "user", content: note.trim(), mediaType: "music_share", listeningContext: payload.listeningContext,
                        mediaData: { musicTitle: payload.title, musicArtist: payload.artist, musicCoverUrl: payload.coverUrl, label: `${payload.title} - ${payload.artist}` } });
                } else {
                    pushChatMessage({ sessionId: current.id, role: "user", content: [note.trim(), formatXiaohongshuShareForPrompt({ author: payload.authorName, title: payload.title, body: payload.body, description: payload.description })].filter(Boolean).join("\n\n"), mediaType: "xiaohongshu_note_share",
                        mediaData: { xiaohongshuAuthor: payload.authorName, xiaohongshuTitle: payload.title, xiaohongshuBody: payload.body, xiaohongshuDescription: payload.description, xiaohongshuNoteType: payload.noteType, xiaohongshuTags: payload.tags, xiaohongshuImageAssetId: payload.imageAssetId, xiaohongshuCoverIcon: payload.coverIcon, xiaohongshuTone: payload.tone } });
                }
                window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: current.id } }));
                sentDestination.current = current.id;
            }
            setSent(true);
        } catch (e) { if (live.current) setError(e instanceof Error ? e.message : "分享失败，请重试"); submitting.current = false; }
        finally { if (live.current) setBusy(false); }
    };

    return <div className={styles.overlay} onClick={onClose}>
        <div className={styles.sheet} data-share-kind={payload.type} ref={panel} role="dialog" aria-modal="true" aria-label="分享" tabIndex={-1} onClick={e => e.stopPropagation()} onKeyDown={e => {
            if (e.key === "Escape") { e.stopPropagation(); if (showAudience) setShowAudience(false); else if (target && !sent) setTarget(null); else onClose(); }
            if (e.key === "Tab") {
                const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]');
                if (!items?.length) return;
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus(); }
            }
        }}>
            <header><h2>{showAudience ? "谁可以看" : sent ? "已分享" : target ? `分享到${target === "moments" ? "朋友圈" : `「${name(target)}」`}` : "分享"}</h2><button aria-label={showAudience ? "返回分享" : "关闭分享"} onClick={() => showAudience ? setShowAudience(false) : onClose()}><X size={20} /></button></header>
            {showAudience ? <div className={styles.audiencePage}>
                <div className={styles.audienceModes} role="group" aria-label="可见范围">{([['all','所有好友'],['some','部分好友'],['self','仅自己']] as const).map(([value,label]) => <button key={value} aria-pressed={audienceMode === value} onClick={() => setAudienceMode(value)}>{label}</button>)}</div>
                {audienceMode === "some" ? <>
                    <input className={styles.search} aria-label="搜索好友" placeholder="搜索好友" value={audienceQuery} onChange={e => setAudienceQuery(e.target.value)} />
                    <div className={styles.batch}><span>已选 {audienceIds.length} 人</span><button onClick={() => setVisibility(prev => [...new Set([...prev, ...audienceContacts.map(c => c.characterId)])])}>全选{audienceQuery ? "搜索结果" : ""}</button><button onClick={() => setVisibility(prev => prev.filter(id => !audienceContacts.some(c => c.characterId === id)))}>清除{audienceQuery ? "搜索结果" : ""}</button></div>
                    <div className={styles.audienceList}>{audienceContacts.map(c => <label key={c.characterId}><ShareDestinationAvatar characterId={c.characterId} session={sessions.find(s => !s.isGroup && s.contactId === c.characterId)} /><span>{c.nickname || chars.find(ch => ch.id === c.characterId)?.name}</span><input type="checkbox" checked={visibility.includes(c.characterId)} onChange={e => setVisibility(prev => e.target.checked ? [...new Set([...prev,c.characterId])] : prev.filter(id => id !== c.characterId))} /></label>)}{!audienceContacts.length && <p className={styles.hint}>没有匹配的好友</p>}</div>
                </> : <p className={styles.hint}>{audienceMode === "all" ? (contacts.length + " 位好友") : "仅自己"}</p>}
                <button className={styles.primary} onClick={() => setShowAudience(false)}>完成{audienceMode === "some" ? (" · " + audienceIds.length + " 人") : ""}</button>
            </div> : <>
            {preview || (payload.type === "music" && excerpt ? <LyricShareCard title={title} artist={payload.artist} coverUrl={payload.coverUrl} text={excerpt} /> : <div className={styles.preview}>{payload.type === "music" && payload.coverUrl && !coverFailed ? <img className={styles.cover} src={payload.coverUrl} alt="专辑封面" onError={() => setCoverFailed(true)} /> : <span className={styles.coverFallback}>{title.slice(0,1)}</span>}<div><strong>{title}</strong><small>{subtitle}</small>{excerpt && <p>{excerpt}</p>}</div></div>)}
            {sent ? <div className={styles.done}><button type="button" onClick={() => { if (identity.current === getCurrentIdentityId()) onView(sentDestination.current); else onClose(); }}>{payload.type === "chat_record" ? "完成" : "去看看"}</button></div> : <>
                {!target && payload.type !== "chat_record" && <div className={styles.tabs}><button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}><MessageCircle size={17} />对话</button><button aria-pressed={tab === "moments"} onClick={() => setTab("moments")}><Aperture size={17} />朋友圈</button></div>}
                {!target && tab === "chat" && <><input className={styles.search} placeholder="搜索对话" aria-label="搜索对话" value={query} onChange={e => setQuery(e.target.value)} /><div className={styles.list}>
                    {!ready ? <p>正在加载…</p> : sessions.filter(s => name(s).toLowerCase().includes(query.toLowerCase())).map(s => <button key={s.id} onClick={() => { setError(""); setTarget(s); }}><ShareDestinationAvatar session={s} /><span>{name(s)}<small>{s.isGroup ? "群聊" : "私聊"}</small></span><ChevronRight size={16} /></button>)}
                    {ready && !sessions.some(s => name(s).toLowerCase().includes(query.toLowerCase())) && <p>没有可分享的对话</p>}
                </div></>}
                {((!target && tab === "moments") || target) && <textarea aria-label="分享附言" placeholder={payload.type === "music" && excerpt ? "关于这句歌词，想说些什么（可选）…" : "说点什么（可选）…"} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />}
                {!target && tab === "moments" && <><button className={styles.audienceEntry} onClick={() => setShowAudience(true)}><span>谁可以看</span><small>{audienceLabel}{audienceMode !== "self" ? (" · " + audienceIds.length + " 人") : ""}</small><ChevronRight size={17} /></button><button className={styles.primary} disabled={!ready || busy} onClick={() => void confirm("moments")}>{busy ? "正在发布…" : "分享至朋友圈"}</button></>}
                {target && <>{target !== "moments" && <div className={styles.recipient}><ShareDestinationAvatar session={target} /><span>{name(target)}</span></div>}<div className={styles.actions}><button onClick={() => setTarget(null)}>返回</button><button className={styles.primary} onClick={() => confirm()}><Send size={16} />{target === "moments" ? "确认发布" : "确认发送"}</button></div></>}
                {error && <p className={styles.error} role="alert">{error}</p>}
            </>}
            </>}
        </div>
    </div>;
}
