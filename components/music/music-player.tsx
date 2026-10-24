// components/music/music-player.tsx — Full-screen immersive music player
// Apple Music-inspired cover layout and synchronized lyrics.
// A vinyl mode is kept as a switchable style for nostalgia.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Heart, MessageCircle, X, Send } from "lucide-react";
import { requestMusicHome } from "@/lib/music-navigation";
import privateStyles from "./music-private.module.css";
import { useMusicPlayer, type PlayMode } from "@/lib/music-context";
import { createMusicListeningContext, parseTimedLyrics, lyricTimestamp, type MusicListeningContext, type TimedLyric } from "@/lib/music-listening";
import { getMusicControlBridge } from "@/lib/music-control-bridge";
import { getCurrentIdentityId } from "@/lib/identity-runtime";
import { activeLyricIndex, lyricRange } from "@/lib/lyric-selection";
import { LyricShareCard } from "./lyric-share-card";
import { kvGet, kvSet } from "@/lib/kv-db";
import { extractCoverPalette, DEFAULT_COVER_PALETTE, type CoverPalette } from "@/lib/cover-color";
import {
    getUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, getNeteasePlayInfo,
    isNeteaseConfigured, recordTrackPlaylist, removeTrackPlaylistRecord, getTrackPlaylistId,
    getSongCommentPage, getNeteaseSongDetail,
    type NeteasePlaylist,
} from "@/lib/music-service";
import { loadListeningLibrary, editListeningPlaylist, songForListeningLibrary, LISTENING_LIBRARY_EVENT } from "@/lib/listening-library";
import { getListeningRoom } from "@/lib/listen-together";
import { ListeningPlayerPresence, useListeningPresence } from "./listening-presence";
import MusicCommentsPage from "./music-comments";
import MusicArtistPage from "./music-artist";
import { loadMusicBg, playerBgStyle, MUSIC_BG_EVENT, type MusicBgConfig } from "@/lib/music-bg";

const PLAY_MODE_ICONS: Record<PlayMode, { svg: string; label: string }> = {
    sequence: {
        svg: `<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
        label: "顺序播放",
    },
    shuffle: {
        svg: `<path d="M18 4l3 3-3 3M18 14l3 3-3 3M3 7h3a5 5 0 0 1 5 5 5 5 0 0 0 5 5h5M21 7h-5a5 5 0 0 0-3.16 1.13M3 17h3a5 5 0 0 0 3.16-1.13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
        label: "随机播放",
    },
    "repeat-one": {
        svg: `<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">1</text>`,
        label: "单曲循环",
    },
};

function formatCount(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value >= 100000000) return `${Math.round(value / 10000000) / 10}亿`;
    if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
    return String(value);
}

type PlayerStyle = "modern" | "vinyl";
type BodyView = "cover" | "lyrics";

function TrackMarquee({ text }: { text: string }) {
    const viewport = useRef<HTMLSpanElement>(null);
    const content = useRef<HTMLSpanElement>(null);
    const [overflow, setOverflow] = useState(0);
    useEffect(() => {
        const measure = () => setOverflow(Math.max(0, (content.current?.scrollWidth ?? 0) - (viewport.current?.clientWidth ?? 0)));
        const observer = new ResizeObserver(measure);
        if (viewport.current) observer.observe(viewport.current);
        if (content.current) observer.observe(content.current);
        measure();
        return () => observer.disconnect();
    }, [text]);
    return <span ref={viewport} className={privateStyles.marquee} title={text}>
        <span ref={content} key={text} className={overflow > 1 ? privateStyles.marqueeMoving : undefined}
            style={{ "--track-overflow": `${-overflow}px`, "--track-duration": `${Math.max(6, overflow / 24 + 3)}s` } as React.CSSProperties}>{text}</span>
    </span>;
}

export default function MusicPlayer() {
    const player = useMusicPlayer();
    const [view, setView] = useState<BodyView>("cover");
    const [playerStyle, setPlayerStyle] = useState<PlayerStyle>(() =>
        (typeof window !== "undefined" && kvGet("music-player-style") === "vinyl") ? "vinyl" : "modern");
    const [showQueue, setShowQueue] = useState(false);
    const [showComments, setShowComments] = useState(false);
    const [artistView, setArtistView] = useState<{ id: number; name: string } | null>(null);
    const [palette, setPalette] = useState<CoverPalette>(DEFAULT_COVER_PALETTE);
    const [bgCfg, setBgCfg] = useState<MusicBgConfig>(() => loadMusicBg());
    const [commentTotal, setCommentTotal] = useState(0);

    useEffect(() => {
        const handleBgChange = () => setBgCfg(loadMusicBg());
        window.addEventListener(MUSIC_BG_EVENT, handleBgChange);
        return () => window.removeEventListener(MUSIC_BG_EVENT, handleBgChange);
    }, []);

    // kv cache hydrates asynchronously from IndexedDB — the initial read above
    // may run before it's ready, silently dropping the saved vinyl preference
    // and custom background. Re-read a few times until hydration has settled.
    useEffect(() => {
        const timers = [300, 1200, 3000].map(ms => setTimeout(() => {
            const stored = kvGet("music-player-style");
            if (stored === "vinyl" || stored === "modern") {
                setPlayerStyle(prev => (prev === stored ? prev : stored));
            }
            setBgCfg(prev => {
                const fresh = loadMusicBg();
                return JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh;
            });
        }, ms));
        return () => timers.forEach(clearTimeout);
    }, []);
    const [musicToast, setMusicToast] = useState<string | null>(null);
    const [pendingPlayTrackId, setPendingPlayTrackId] = useState<string | null>(null);
    const musicToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const musicLoadingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentTime = player.currentTime;
    const progress = player.duration > 0 ? currentTime / player.duration : 0;

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "0:00";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const clearMusicToast = useCallback(() => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setMusicToast(null);
        setPendingPlayTrackId(null);
    }, []);

    const showMusicToast = useCallback((text: string, duration = 2000) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setPendingPlayTrackId(null);
        setMusicToast(text);
        if (duration > 0) {
            musicToastTimerRef.current = setTimeout(() => {
                setMusicToast(null);
                musicToastTimerRef.current = null;
            }, duration);
        }
    }, []);

    const beginMusicLoadingToast = useCallback((trackId: string) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        setPendingPlayTrackId(trackId);
        setMusicToast("加载音乐中...");
        musicLoadingFallbackRef.current = setTimeout(() => {
            setMusicToast(null);
            setPendingPlayTrackId(null);
            musicLoadingFallbackRef.current = null;
        }, 8000);
    }, []);

    useEffect(() => {
        if (!pendingPlayTrackId || player.currentTrack?.id !== pendingPlayTrackId) return;
        clearMusicToast();
    }, [clearMusicToast, pendingPlayTrackId, player.currentTrack?.id]);

    useEffect(() => () => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
    }, []);

    // ── Ambient palette from cover art ──
    const coverUrl = player.currentTrack?.coverUrl;
    useEffect(() => {
        let cancelled = false;
        extractCoverPalette(coverUrl).then(p => { if (!cancelled) setPalette(p); });
        return () => { cancelled = true; };
    }, [coverUrl]);

    // ── Comment count for current track ──
    const isNeteaseTrack = player.currentTrack?.id?.startsWith("netease_") ?? false;
    const neteaseId = isNeteaseTrack ? parseInt(player.currentTrack!.id.replace("netease_", ""), 10) : 0;

    useEffect(() => {
        setCommentTotal(0);
        setShowComments(false);
        setArtistView(null);
        if (!neteaseId || !isNeteaseConfigured()) return;
        let cancelled = false;
        getSongCommentPage(neteaseId, 0, 1).then(page => {
            if (!cancelled) setCommentTotal(page.total);
        });
        return () => { cancelled = true; };
    }, [neteaseId]);

    const cyclePlayMode = useCallback(() => {
        const modes: PlayMode[] = ["sequence", "shuffle", "repeat-one"];
        const idx = modes.indexOf(player.playMode);
        player.setPlayMode(modes[(idx + 1) % modes.length]);
    }, [player]);

    const togglePlayerStyle = useCallback(() => {
        setPlayerStyle(prev => {
            const next: PlayerStyle = prev === "modern" ? "vinyl" : "modern";
            try { kvSet("music-player-style", next); } catch { /* ignore */ }
            showMusicToast(next === "vinyl" ? "已切换为黑胶唱片样式" : "已切换为现代封面样式");
            return next;
        });
    }, [showMusicToast]);

    // ── Parse LRC lyrics ──
    const parsedLyrics = useMemo(() => parseTimedLyrics(player.currentTrack?.lyrics || ""), [player.currentTrack?.lyrics]);
    const [selectedLyric, setSelectedLyric] = useState<MusicListeningContext | null>(null);
    const [pressingLyric, setPressingLyric] = useState<number | null>(null);
    const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
    const [selection, setSelection] = useState<[number, number] | null>(null);
    const [dragSelecting, setDragSelecting] = useState(false);
    const selectionRef = useRef<[number, number] | null>(null);
    const manualScrollUntil = useRef(0);
    const scrollFrame = useRef(0);
    const lyricsContainerRef = useRef<HTMLDivElement>(null);
    const lyricPress = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; consumed: boolean; selecting?: boolean; lastY?: number; pointerType?: string }>({ x: 0, y: 0, consumed: false });
    const cancelLyricPress = useCallback(() => {
        clearTimeout(lyricPress.current.timer);
        lyricPress.current.timer = undefined;
        setPressingLyric(null);
    }, []);
    useEffect(() => () => cancelLyricPress(), [cancelLyricPress]);
    useEffect(() => { cancelLyricPress(); }, [view, player.currentTrack?.id, cancelLyricPress]);

    useEffect(() => { setSelectedLyric(null); setSelection(null); selectionRef.current = null; setDragSelecting(false); lyricPress.current.selecting = false; }, [player.currentTrack?.id, view]);

    useEffect(() => {
        if (view !== "lyrics") return;
        let frame = 0;
        let lastIndex = -2;
        const tick = () => {
            const state = getMusicControlBridge()?.getState();
            const time = state && state.currentTrack?.id === player.currentTrack?.id ? state.currentTime : player.currentTime;
            const next = activeLyricIndex(parsedLyrics, time);
            if (lastIndex !== next) { lastIndex = next; setActiveLyricIdx(next); }
            if (player.isPlaying) frame = requestAnimationFrame(tick);
        };
        tick();
        return () => cancelAnimationFrame(frame);
    }, [view, player.currentTrack?.id, player.currentTime, player.isPlaying, parsedLyrics]);

    // Auto-scroll lyrics
    useEffect(() => {
        cancelAnimationFrame(scrollFrame.current);
        const container = lyricsContainerRef.current;
        if (selectedLyric || dragSelecting || lyricPress.current.timer || Date.now() < manualScrollUntil.current || view !== "lyrics" || activeLyricIdx < 0 || !container) return;
        const el = container.children[activeLyricIdx] as HTMLElement;
        if (!el) return;
        const start = container.scrollTop;
        const top = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, start + el.getBoundingClientRect().top - container.getBoundingClientRect().top - (container.clientHeight - el.clientHeight) / 2));
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { container.scrollTop = top; return; }
        const started = performance.now();
        const move = (now: number) => {
            const progress = Math.min(1, (now - started) / 180);
            container.scrollTop = start + (top - start) * (1 - Math.pow(1 - progress, 3));
            if (progress < 1) scrollFrame.current = requestAnimationFrame(move);
        };
        scrollFrame.current = requestAnimationFrame(move);
        return () => cancelAnimationFrame(scrollFrame.current);
    }, [activeLyricIdx, view, selectedLyric, dragSelecting]);

    const handleLyricClick = useCallback((_idx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (lyricPress.current.consumed) { lyricPress.current.consumed = false; return; }
        setSelectedLyric(null);
        setView("cover");
    }, []);

    const selectLyric = (line: TimedLyric) => {
        const index = parsedLyrics.indexOf(line);
        selectionRef.current = [index, index];
        setSelection([index, index]);
        const snapshot = getMusicControlBridge()?.getState();
        const context = createMusicListeningContext(snapshot && snapshot.currentTrack?.id === player.currentTrack?.id ? snapshot : player, getCurrentIdentityId(), new Date().toISOString(), line);
        setSelectedLyric(context || null);
    };
    const finishLyricRange = () => {
        const range = selectionRef.current;
        if (!range) return;
        const lines = lyricRange(parsedLyrics, ...range);
        if (!lines.length) return;
        const snapshot = getMusicControlBridge()?.getState();
        const context = createMusicListeningContext(snapshot && snapshot.currentTrack?.id === player.currentTrack?.id ? snapshot : player, getCurrentIdentityId(), new Date().toISOString(), lines[0]);
        if (context) setSelectedLyric({ ...context, selectedLines: lines, reference: { time: lines[0].time, text: lines.map(line => line.text).join("\n") } });
    };
    const sendSelectedLyric = () => {
        if (!selectedLyric || selectedLyric.identityId !== getCurrentIdentityId()) return;
        window.dispatchEvent(new CustomEvent("open-mini-chat", { detail: { share: {
            type: "music", title: selectedLyric.title, artist: selectedLyric.artist,
            lyricMode: "share", listeningContext: selectedLyric, coverUrl: player.currentTrack?.coverUrl,
        } } }));
        setSelectedLyric(null);
        setSelection(null);
        selectionRef.current = null;
    };

    const [liked, setLiked] = useState(false);
    const listening = useListeningPresence();
    const [playlistSource, setPlaylistSource] = useState<"shared" | "cloud">("shared");
    const [, refreshLibrary] = useState(0);
    useEffect(()=>{const update=()=>refreshLibrary(n=>n+1);window.addEventListener(LISTENING_LIBRARY_EVENT,update);return()=>window.removeEventListener(LISTENING_LIBRARY_EVENT,update);},[]);
    const sharedRoom = listening.room;
    const sharedPlaylists = sharedRoom ? loadListeningLibrary().playlists.filter(p=>p.sessionId===sharedRoom.sessionId) : [];
    const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [loadingPlaylists, setLoadingPlaylists] = useState(false);
    const [addResult, setAddResult] = useState<{ ok: boolean; message: string } | null>(null);

    // Sync liked state with current track
    useEffect(() => {
        setLiked(player.currentTrack?.liked ?? false);
    }, [player.currentTrack?.id, player.currentTrack?.liked]);

    // Clear add result after 2s
    useEffect(() => {
        if (!addResult) return;
        const t = setTimeout(() => setAddResult(null), 2000);
        return () => clearTimeout(t);
    }, [addResult]);

    useEffect(() => {
        if (!showPlaylistPicker || playlistSource !== "cloud") return;
        let cancelled=false; setPlaylists([]);
        if (!isNeteaseTrack || !isNeteaseConfigured()) {setLoadingPlaylists(false);return;}
        setLoadingPlaylists(true);
        getUserPlaylists().then(items=>{if(!cancelled)setPlaylists(items);}).catch(()=>{if(!cancelled)setAddResult({ok:false,message:"云音乐歌单加载失败"});}).finally(()=>{if(!cancelled)setLoadingPlaylists(false);});
        return()=>{cancelled=true;};
    },[showPlaylistPicker,playlistSource,isNeteaseTrack]);
    const openPlaylistPicker = useCallback(() => {
        setPlaylistSource(getListeningRoom() ? "shared" : "cloud");
        setShowPlaylistPicker(true);
    }, []);
    const handleLike = openPlaylistPicker;
    const saveSharedSong = (playlistId: string) => {
        try {
            const room=getListeningRoom();
            if(!room || room.id!==sharedRoom?.id || room.identityId!==getCurrentIdentityId())throw new Error("一起听会话已变化，请重新选择");
            const list=loadListeningLibrary().playlists.find(p=>p.id===playlistId && p.sessionId===room.sessionId);
            if(!list || !player.currentTrack)throw new Error("歌单或歌曲已不可用");
            editListeningPlaylist(room.sessionId,list.id,"self",{add:songForListeningLibrary(player.currentTrack,"self")});
            setLiked(true);setShowPlaylistPicker(false);setAddResult({ok:true,message:"已收藏到"+list.name});
        }catch(e){setAddResult({ok:false,message:e instanceof Error?e.message:"收藏失败"});}
    };

    const handleAddToPlaylist = useCallback(async (playlist: NeteasePlaylist) => {
        if (!neteaseId) return;
        const result = await addTracksToPlaylist(playlist.id, [neteaseId]);
        if (result.ok) {
            recordTrackPlaylist(neteaseId, playlist.id);
            setLiked(true);
        }
        setAddResult(result);
        setShowPlaylistPicker(false);
    }, [neteaseId]);

    const openShareViaChat = useCallback(() => {
        if (!player.currentTrack) return;
        window.dispatchEvent(new CustomEvent("open-mini-chat", {
            detail: { share: { type: "music", title: player.currentTrack.title, artist: player.currentTrack.artist, coverUrl: player.currentTrack.coverUrl } },
        }));
    }, [player.currentTrack]);

    const openMiniChat = useCallback(() => {
        window.dispatchEvent(new CustomEvent("open-mini-chat"));
    }, []);

    const openArtistPage = useCallback(async () => {
        if (!player.currentTrack) return;
        if (!isNeteaseTrack || !isNeteaseConfigured()) {
            showMusicToast("本地歌曲暂无歌手主页");
            return;
        }
        const detail = await getNeteaseSongDetail(neteaseId);
        const first = detail?.artistList?.[0];
        if (!first) {
            showMusicToast("没有找到歌手信息");
            return;
        }
        setArtistView(first);
    }, [player.currentTrack, isNeteaseTrack, neteaseId, showMusicToast]);

    const track = player.currentTrack;

    const getAdjacentTrack = (direction: "prev" | "next") => {
        if (player.queue.length === 0 || !player.currentTrack) return null;
        const idx = player.queue.findIndex(t => t.id === player.currentTrack!.id);
        if (idx < 0) return null;
        if (player.playMode === "shuffle") {
            return player.queue[Math.floor(Math.random() * player.queue.length)] ?? null;
        }
        const offset = direction === "next" ? 1 : -1;
        const nextIdx = (idx + offset + player.queue.length) % player.queue.length;
        return player.queue[nextIdx] ?? null;
    };

    const handleSwitchToTrack = useCallback(async (target: typeof player.currentTrack) => {
        if (!target) return;
        if (target.id.startsWith("netease_")) {
            beginMusicLoadingToast(target.id);
            const nid = parseInt(target.id.replace("netease_", ""), 10);
            const info = await getNeteasePlayInfo(nid);
            if (!info.url) {
                showMusicToast(info.reason || "加载失败，请稍后重试", 2600);
                return;
            }
            player.playUrl(info.url, target);
            if (info.trial) showMusicToast("VIP 歌曲，当前播放 30 秒试听", 2600);
            return;
        }
        player.playTrack(target);
    }, [beginMusicLoadingToast, player, showMusicToast]);

    const handlePrev = useCallback(() => {
        const target = getAdjacentTrack("prev");
        if (target?.id.startsWith("netease_")) {
            void handleSwitchToTrack(target);
            return;
        }
        player.prev();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleSwitchToTrack, player]);

    const handleNext = useCallback(() => {
        const target = getAdjacentTrack("next");
        if (target?.id.startsWith("netease_")) {
            void handleSwitchToTrack(target);
            return;
        }
        player.next();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleSwitchToTrack, player]);

    if (!track) return null;

    const hasLyrics = parsedLyrics.length > 0;
    const modeInfo = PLAY_MODE_ICONS[player.playMode];
    const customBg = playerBgStyle(bgCfg);
    const ambientVars = {
        "--mp-c1": palette[0],
        "--mp-c2": palette[1],
        "--mp-c3": palette[2],
        ...(customBg || {}),
    } as React.CSSProperties;

    return (
        <div className={`music-player mp-lumen mp-apple ${privateStyles.player}`} style={ambientVars} data-view={view}>
            {musicToast && (
                <div className="music-toast-overlay">
                    <div className="music-toast-chip">
                        {musicToast === "加载音乐中..." ? (
                            <span className="ui-loading-toast-content">
                                <span className="ui-loading-spinner" />
                                <span>{musicToast}</span>
                            </span>
                        ) : musicToast}
                    </div>
                </div>
            )}

            {!customBg && track.coverUrl && <div className="mp-album-wash" aria-hidden="true"><img key={track.coverUrl} src={track.coverUrl} alt="" /></div>}

            {/* Ambient flowing background tinted by cover colors (hidden on custom bg) */}
            <div className="mp-ambient" aria-hidden="true">
                {!customBg && (
                    <>
                        <i className="mp-blob mp-blob-1" />
                        <i className="mp-blob mp-blob-2" />
                        <i className="mp-blob mp-blob-3" />
                    </>
                )}
                <span className="mp-grain" />
                <span className="mp-vignette" />
            </div>

            <div className="mp-top">
                <button className="mp-dismiss" onClick={player.closeFullPlayer} aria-label="返回上一页" title="返回上一页"><ChevronLeft size={25} strokeWidth={1.8} aria-hidden="true" /></button>

            </div>

            <ListeningPlayerPresence />
            {/* Body — cover / vinyl / glow lyrics */}
            <div className="mp-body">
                {view === "lyrics" ? (
                    <div className="mp-lyrics-wrap" onClick={e => handleLyricClick(-1, e)} onKeyDown={e => {
                        if (e.key === "Escape" && selectedLyric) { e.stopPropagation(); setSelectedLyric(null); setSelection(null); selectionRef.current = null; }
                    }}>
                        {hasLyrics ? (
                            <div className="mp-lyrics" ref={lyricsContainerRef} onWheel={() => { manualScrollUntil.current = Date.now() + 1800; cancelAnimationFrame(scrollFrame.current); }}>
                                {parsedLyrics.map((line, i) => {
                                    const dist = Math.abs(i - activeLyricIdx);
                                    return (
                                        <div
                                            key={i}
                                            className="mp-lyric-line"
                                            data-lyric-index={i}
                                            data-selected={selection && i >= Math.min(...selection) && i <= Math.max(...selection) ? "" : undefined}
                                            {...(i === activeLyricIdx ? { "data-active": "" } : dist === 1 ? { "data-near": "" } : {})}
                                        >
                                            <button type="button" className="mp-lyric-seek"
                                                data-holding={pressingLyric === i ? "" : undefined}
                                                onClick={e => handleLyricClick(i, e)}
                                                aria-label={line.text + "；轻点返回封面，长按或右键分享歌词"}
                                                aria-keyshortcuts="Shift+F10"
                                                aria-pressed={!!(selection && i >= Math.min(...selection) && i <= Math.max(...selection)) || selectedLyric?.reference?.time === line.time}
                                                onPointerDown={e => {
                                                    cancelLyricPress();
                                                    lyricPress.current = { x: e.clientX, y: e.clientY, consumed: false, pointerType: e.pointerType };
                                                    if (e.button !== 0 || !line.text.trim()) return;
                                                    e.currentTarget.setPointerCapture(e.pointerId);
                                                    cancelAnimationFrame(scrollFrame.current);
                                                    setSelectedLyric(null);
                                                    selectionRef.current = null;
                                                    setSelection(null);
                                                    setPressingLyric(i);
                                                    lyricPress.current.timer = setTimeout(() => {
                                                        lyricPress.current.timer = undefined;
                                                        lyricPress.current.consumed = true;
                                                        lyricPress.current.selecting = true;
                                                        selectionRef.current = [i, i];
                                                        setSelection([i, i]);
                                                        setDragSelecting(true);
                                                        setPressingLyric(null);
                                                    }, 500);
                                                }}
                                                onPointerMove={e => {
                                                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                                                    const press = lyricPress.current;
                                                    const container = lyricsContainerRef.current;
                                                    if (!container) return;
                                                    if (press.selecting && selectionRef.current) {
                                                        const bounds = container.getBoundingClientRect();
                                                        if (e.clientY < bounds.top + 36) container.scrollTop -= 12;
                                                        if (e.clientY > bounds.bottom - 36) container.scrollTop += 12;
                                                        const rows = Array.from(container.children) as HTMLElement[];
                                                        let nearest = selectionRef.current[1], distance = Infinity;
                                                        rows.forEach((row, index) => {
                                                            const rect = row.getBoundingClientRect();
                                                            const delta = Math.abs(e.clientY - (rect.top + rect.bottom) / 2);
                                                            if (delta < distance) { nearest = index; distance = delta; }
                                                        });
                                                        selectionRef.current = [selectionRef.current[0], nearest];
                                                        setSelection([...selectionRef.current]);
                                                    } else if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10 || press.consumed) {
                                                        cancelLyricPress(); press.consumed = true;
                                                        container.scrollTop += (press.lastY ?? press.y) - e.clientY;
                                                        manualScrollUntil.current = Date.now() + 1800;
                                                    }
                                                    press.lastY = e.clientY;
                                                }}
                                                onPointerUp={() => { if (lyricPress.current.selecting) finishLyricRange(); lyricPress.current.selecting = false; setDragSelecting(false); cancelLyricPress(); }}
                                                onPointerCancel={() => { cancelLyricPress(); lyricPress.current.consumed = true; lyricPress.current.selecting = false; setDragSelecting(false); setSelection(null); selectionRef.current = null; }}
                                                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (lyricPress.current.selecting || lyricPress.current.pointerType === "touch" || lyricPress.current.pointerType === "pen") return; cancelLyricPress(); lyricPress.current.consumed = true; if (line.text.trim()) selectLyric(line); }}
                                                onKeyDown={e => {
                                                    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
                                                        e.preventDefault(); e.stopPropagation(); if (line.text.trim()) selectLyric(line);
                                                    }
                                                }}
                                            >{line.text || " "}</button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="mp-lyrics mp-lyrics-empty">
                                <div className="mp-lyric-line" data-active="">暂无歌词</div>
                            </div>
                        )}
                        {!dragSelecting && selectedLyric?.reference && <div className="mp-lyric-actions" onClick={e => e.stopPropagation()} role="group" aria-label="歌词分享">
                            <div className="mp-lyric-sheet-heading"><span>歌词片段 · {lyricTimestamp(selectedLyric.reference.time)}</span><button type="button" className="mp-icon-button" aria-label="关闭歌词分享" onClick={() => { setSelectedLyric(null); setSelection(null); selectionRef.current = null; }}><X size={18} /></button></div>
                            <LyricShareCard title={track.title} artist={track.artist || "未知歌手"} coverUrl={track.coverUrl} text={selectedLyric.reference.text} />
                            <div className="mp-lyric-action-buttons">
                                <button type="button" onClick={sendSelectedLyric}><Send size={18} strokeWidth={1.7} /><span>分享歌词</span></button>
                            </div>
                        </div>}

                    </div>
                ) : playerStyle === "vinyl" ? (
                    <div className="music-player-vinyl-area" onClick={() => setView("lyrics")}>
                        <div className="music-player-vinyl-glow" />
                        <div className="music-player-vinyl" {...(player.isPlaying ? { "data-spinning": "" } : {})}>
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-1" />
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-2" />
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-3" />
                            <div className="music-player-vinyl-center">
                                {track.coverUrl ? (
                                    <img src={track.coverUrl} alt="" className="music-player-vinyl-cover" />
                                ) : (
                                    <div className="music-player-vinyl-cover-placeholder">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                        </svg>
                                    </div>
                                )}
                            </div>
                            <div className="music-player-vinyl-dot" />
                        </div>
                        <div className="music-player-tonearm" {...(player.isPlaying ? { "data-playing": "" } : {})}>
                            <div className="music-player-tonearm-pivot" />
                            <div className="music-player-tonearm-arm" />
                            <div className="music-player-tonearm-joint" />
                            <div className="music-player-tonearm-head" />
                        </div>
                    </div>
                ) : (
                    <div className="mp-cover-area" role="button" tabIndex={0} aria-label="查看歌词" onClick={() => setView("lyrics")} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView("lyrics"); } }}>
                        <div className="mp-cover" {...(player.isPlaying ? {} : { "data-paused": "" })}>
                            {track.coverUrl ? (
                                <img src={track.coverUrl} alt="" />
                            ) : (
                                <div className="mp-cover-placeholder">
                                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                    </svg>
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </div>

            <div className="mp-track-row">
                <div className="mp-titles">
                    <div className="mp-song"><TrackMarquee text={track.title} /></div>
                    <button className="mp-artist" onClick={openArtistPage}>
                        <TrackMarquee text={track.artist || "未知歌手"} />
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 5 7 7-7 7" /></svg>
                    </button>
                </div>

                <div className="mp-track-actions">
                <button className="mp-icon-button" aria-label={"歌曲评论" + (commentTotal ? "，" + formatCount(commentTotal) + "条" : "")} onClick={() => { if (!isNeteaseTrack) { showMusicToast("本地歌曲暂无评论区"); return; } setShowComments(true); }}><MessageCircle size={20} strokeWidth={1.7} /></button>
                    <button className="mp-icon-button" aria-label="收藏到歌单" aria-pressed={liked} onClick={handleLike}><Heart size={22} fill={liked ? "currentColor" : "none"} strokeWidth={1.7} /></button>
                    <button className="mp-icon-button" onClick={cyclePlayMode} aria-label={modeInfo.label} title={modeInfo.label}>
                        <svg width="22" height="22" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: modeInfo.svg }} />
                    </button>
                </div>

            </div>
            <div className="mp-progress-area">
                <input className="mp-range mp-seek" type="range" min="0" max={player.duration || 1} step="0.1"
                    value={Math.min(currentTime, player.duration || 1)} disabled={!player.duration}
                    aria-label="播放进度" aria-valuetext={formatTime(currentTime) + " / " + formatTime(player.duration)}
                    style={{ "--mp-fill": Math.max(0, Math.min(100, progress * 100)) + "%" } as React.CSSProperties}
                    onChange={e => player.seek(Number(e.target.value))} />
                <div className="mp-times"><span>{formatTime(currentTime)}</span><span>−{formatTime(Math.max(0, player.duration - currentTime))}</span></div>
            </div>

            {/* Controls */}
            <div className="mp-controls">

                <button className="music-player-ctrl-btn mp-ctrl" onClick={handlePrev} aria-label="上一首">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 5v14L1 12zm11 0v14l-10-7z" />
                    </svg>
                </button>
                <button className="music-player-ctrl-btn mp-ctrl-play" onClick={player.togglePlay} aria-label={player.isPlaying ? "暂停" : "播放"}>
                    {player.isPlaying ? (
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
                        </svg>
                    ) : (
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    )}
                </button>
                <button className="music-player-ctrl-btn mp-ctrl" onClick={handleNext} aria-label="下一首">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2 5v14l10-7zm11 0v14l10-7z" />
                    </svg>
                </button>

            </div>

            <div className="mp-volume">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9h4l5-4v14l-5-4H3z" /></svg>
                <input className="mp-range" type="range" min="0" max="1" step="0.01" value={player.volume}
                    aria-label="音量" aria-valuetext={Math.round(player.volume * 100) + "%"}
                    style={{ "--mp-fill": player.volume * 100 + "%" } as React.CSSProperties}
                    onChange={e => player.setVolume(Number(e.target.value))} />
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path fill="currentColor" stroke="none" d="M2 9h4l5-4v14l-5-4H2z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg>
            </div>
            <div className="mp-footer">
                <button className="music-player-ctrl-btn mp-ctrl-side" aria-label="返回音乐首页" title="返回音乐首页" onClick={() => { player.closeFullPlayer(); requestMusicHome(); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                        <path fill="currentColor" fillRule="evenodd" d="M26 10H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V12a2 2 0 0 0-2-2ZM20.8 12.6l-7.4 1.5a.8.8 0 0 0-.6.8v7.2l-1.3.3c-1.4.3-2.1 1-1.9 2 .2 1 1.3 1.4 2.6 1.1 1.5-.3 2.2-1.1 2.2-2.4v-6.4l6-1.2v5.1l-1.3.3c-1.4.3-2.1 1-1.9 2 .2 1 1.3 1.4 2.6 1.1 1.5-.3 2.2-1.1 2.2-2.4v-8.3c0-.6-.4-.8-1.2-.7Z" />
                        <path fill="currentColor" d="M6 6h20v2H6zm2-4h16v2H8z" />
                    </svg>
                </button>
                <button className="music-player-ctrl-btn mp-ctrl-side mp-share-button" aria-label="分享到聊天" title="分享到聊天" onClick={openShareViaChat}><svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5.5 20a11 11 0 1 1 17 0M8.2 17.6a7.5 7.5 0 1 1 11.6 0M10.8 15.2a4 4 0 1 1 6.4 0" /><path d="m14 15 7.5 10H6.5z" fill="currentColor" stroke="none" /></svg></button>
                <button
                    className="music-player-ctrl-btn mp-ctrl-side"
                    onClick={() => setShowQueue(true)}
                    disabled={player.queue.length === 0}
                    title="播放列表"
                >
                    <svg aria-hidden="true" width="28" height="28" viewBox="1 0 22 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                </button>

            </div>

            {/* Queue drawer */}
            {showQueue && (
                <div className="music-queue-overlay" onClick={() => setShowQueue(false)}>
                    <div className="music-queue-drawer" onClick={e => e.stopPropagation()}>
                        <div className="music-queue-header">
                            <span>播放列表</span>
                            <span className="music-queue-count">{player.queue.length}首</span>
                            <button className="music-playlist-picker-close" onClick={() => setShowQueue(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="music-queue-list">
                            {player.queue.map((t, idx) => {
                                const isCurrent = t.id === track.id;
                                return (
                                    <div
                                        key={t.id}
                                        className="music-queue-item"
                                        role="button"
                                        tabIndex={0}
                                        {...(isCurrent ? { "data-current": "" } : {})}
                                        onClick={() => { void handleSwitchToTrack(t); }}
                                    >
                                        <span className="music-queue-item-idx">{idx + 1}</span>
                                        <div className="music-queue-item-info">
                                            <div className="music-queue-item-title">{t.title}</div>
                                            <div className="music-queue-item-artist">{t.artist}</div>
                                        </div>
                                        {isCurrent && player.isPlaying && (
                                            <div className="music-wave music-queue-wave">{[0, 1, 2].map(i => <span key={i} className="music-wave-bar" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
                                        )}
                                        {!isCurrent && (
                                            <button
                                                className="music-queue-item-del"
                                                onClick={e => { e.stopPropagation(); player.removeFromQueue(t.id); }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Playlist picker overlay */}
            {showPlaylistPicker && (
                <div className="music-playlist-picker-overlay" onClick={() => setShowPlaylistPicker(false)}>
                    <div className="music-playlist-picker" onClick={e => e.stopPropagation()}>
                        <div className="music-playlist-picker-header">
                            <span>收藏到歌单</span><div className={privateStyles.playlistSource} role="group" aria-label="歌单来源"><button aria-pressed={playlistSource==="shared"} onClick={()=>setPlaylistSource("shared")}>一起听</button><button aria-pressed={playlistSource==="cloud"} onClick={()=>setPlaylistSource("cloud")}>云音乐</button></div>
                            <button className="music-playlist-picker-close" onClick={() => setShowPlaylistPicker(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="music-playlist-picker-list">
                            {playlistSource === "shared" ? <>
                                <div className={privateStyles.pickerCaption}>{sharedRoom ? listening.name + " · 共同歌单" : "先选择一起听的对象"}</div>
                                {sharedPlaylists.map(pl=><button key={pl.id} className="music-playlist-picker-item" onClick={()=>saveSharedSong(pl.id)}><span className={privateStyles.sharedCover}>♫</span><span className="music-playlist-picker-info"><span className="music-playlist-picker-name">{pl.name}</span><small className="music-playlist-picker-count">{pl.songs.length} 首</small></span></button>)}
                                {sharedRoom && !sharedPlaylists.length && <div className="music-playlist-picker-loading">在一起听页面创建一张共同歌单吧</div>}
                            </> : !isNeteaseTrack ? <div className="music-playlist-picker-loading">本地歌曲可收藏到一起听歌单</div> : !isNeteaseConfigured() ? <div className="music-playlist-picker-loading">请先在设置中连接云音乐账号</div> : loadingPlaylists ? (
                                <div className="music-playlist-picker-loading">加载歌单...</div>
                            ) : playlists.length === 0 ? (
                                <div className="music-playlist-picker-loading">没有找到歌单</div>
                            ) : playlists.map(pl => (
                                <button key={pl.id} className="music-playlist-picker-item" onClick={() => handleAddToPlaylist(pl)}>
                                    <img src={pl.coverUrl} alt="" className="music-playlist-picker-cover" />
                                    <div className="music-playlist-picker-info">
                                        <div className="music-playlist-picker-name">{pl.name}</div>
                                        <div className="music-playlist-picker-count">{pl.trackCount}首</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Comments overlay */}
            {showComments && neteaseId > 0 && (
                <MusicCommentsPage
                    songId={neteaseId}
                    title={track.title}
                    artist={track.artist}
                    coverUrl={track.coverUrl}
                    onClose={() => setShowComments(false)}
                />
            )}

            {/* Artist overlay */}
            {artistView && (
                <MusicArtistPage
                    artistId={artistView.id}
                    artistName={artistView.name}
                    onClose={() => setArtistView(null)}
                />
            )}

            {/* Add result toast */}
            {addResult && (
                <div className={`music-toast ${addResult.ok ? "music-toast-ok" : "music-toast-err"}`}>
                    {addResult.ok ? "✓ " : "✗ "}{addResult.message}
                </div>
            )}

        </div>
    );
}
