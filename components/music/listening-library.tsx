"use client";
import { useEffect, useState, useRef, useMemo, type CSSProperties, type ReactNode } from "react";
import { listeningEntryTiming } from "@/lib/listening-motion";
import { createPortal } from "react-dom";
import { ArrowLeft, Headphones, Plus, Play, Pause, Trash2, Pencil, ChevronDown, Check, Music2 } from "lucide-react";
import { getChatCharacterAvatar } from "@/lib/chat-session-avatar";
import { useMusicControlsOptional } from "@/lib/music-context";
import { loadChatSessions, pushChatMessage, CHAT_REQUEST_REPLY_EVENT } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { canCurrentIdentityInteract } from "@/lib/identity-access";
import { getCurrentIdentityId } from "@/lib/identity-runtime";
import { activateListeningSong } from "@/lib/listening-playback";
import { resolveListeningSongCover } from "@/lib/listening-song-cover";
import { getListeningRoom, inviteListeningRoom, inviteGroupListeningRoom } from "@/lib/listen-together";
import { createListeningPlaylist, editListeningPlaylist, deleteListeningPlaylist, listeningRanking, loadListeningLibrary, LISTENING_LIBRARY_EVENT, type SharedListeningSong } from "@/lib/listening-library";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { ListeningAvatar, useListeningPresence } from "./listening-presence";
import styles from "./listening-library.module.css";
import ListeningAlbumShelf from "./listening-album-shelf";

function PlaylistCover({songs, name}: {songs: SharedListeningSong[]; name: string}) {
    const latest = songs.reduce<SharedListeningSong | undefined>((a,b)=>!a || b.addedAt >= a.addedAt ? b : a, undefined);
    const [cover,setCover] = useState<string>();
    const [failed,setFailed] = useState(false);
    useEffect(()=>{
        let active=true;setCover(latest?.coverUrl);setFailed(false);
        if(latest && !latest.coverUrl) void resolveListeningSongCover(latest).then(url=>{if(active)setCover(url);});
        return()=>{active=false;};
    },[latest?.id,latest?.coverUrl]);
    return <span className={styles.albumArt + " " + styles.songCover}>{cover && !failed ? <img src={cover} alt="" loading="lazy" onError={()=>setFailed(true)}/> : <span>{name.slice(0,12)}</span>}</span>;
}

function ListeningTrackCover({song,currentCover}: {song: SharedListeningSong; currentCover?: string}) {
    const ref=useRef<HTMLSpanElement>(null);
    const [resolved,setResolved]=useState<string>();
    const [failed,setFailed]=useState(false);
    const supplied=currentCover || song.coverUrl;
    const cover=supplied || resolved;
    useEffect(()=>{
        let alive=true;setResolved(undefined);
        if(supplied)return;
        const load=()=>{void resolveListeningSongCover(song).then(url=>{if(alive)setResolved(url);});};
        const node=ref.current;
        if(!node || typeof IntersectionObserver==="undefined"){load();return()=>{alive=false;};}
        const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}},{rootMargin:"80px"});
        observer.observe(node);
        return()=>{alive=false;observer.disconnect();};
    },[song.id,supplied]);
    useEffect(()=>setFailed(false),[cover]);
    return <span ref={ref} className={styles.songCoverImage}>{cover && !failed && <img src={cover} alt="" loading="lazy" onError={()=>setFailed(true)}/>}</span>;
}

export default function ListeningLibrary({ sessionId, heroActions, heroSessionId }: { sessionId?: string; heroActions?: ReactNode; heroSessionId?: string }) {
    const rootRef = useRef<HTMLElement>(null);
    const detailRef = useRef<HTMLDivElement>(null);
    const draftRef = useRef<HTMLInputElement>(null);
    const savingDraft = useRef(false);
    const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressStart = useRef({x:0,y:0});
    const held = useRef(false);
    const [deleteTarget,setDeleteTarget] = useState<string | null>(null);
    const clearHold = () => {if(hold.current)clearTimeout(hold.current);hold.current=null;};
    useEffect(()=>()=>clearHold(),[]);
    const player = useMusicControlsOptional();
    const [invitePicker, setInvitePicker] = useState(false);
    const presence = useListeningPresence();
    const user = resolveUserIdentity();
    const [expanded, setExpanded] = useState<string | null>(null);
    const [album, setAlbum] = useState<string | null>(null);
    const [, refresh] = useState(0);
    const [tab, setTab] = useState<"rank" | "library">(sessionId ? "library" : "rank");
    const [scope, setScope] = useState(sessionId || getListeningRoom()?.sessionId || "");
    const [picker, setPicker] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => { const update = () => refresh(n => n+1); const events = [LISTENING_LIBRARY_EVENT,"settings-bindings-updated","chat-sessions-updated"]; events.forEach(e => window.addEventListener(e,update)); return () => events.forEach(e => window.removeEventListener(e,update)); }, []);
    const chars = loadCharacters().filter(c => canCurrentIdentityInteract(c.id));
    const sessions = loadChatSessions().filter(s => !s.isSpectator && (s.isGroup ? s.participantIds?.some(canCurrentIdentityInteract) : canCurrentIdentityInteract(s.contactId)));
    const session = sessions.find(s => s.id === scope);
    const sessionName = (id: string) => { const s = sessions.find(s => s.id === id); return s?.isGroup ? s.groupName || "群聊" : s?.alias || chars.find(c => c.id === s?.contactId)?.name || "选择聊天"; };
    const actorName = (id: string) => id === "self" ? "你" : chars.find(c => c.id === id)?.name || "成员";
    const playlists = loadListeningLibrary().playlists.filter(p => p.sessionId === scope && session);
    const ranking = listeningRanking().filter(r => chars.some(c => c.id === r.characterId));
    const heroRoom = (!heroSessionId || presence.room?.sessionId === heroSessionId) ? presence.room : null;
    const hasListeningState = !!heroRoom && heroRoom.status !== "declined";
    const roomSession = sessions.find(s=>s.id===heroRoom?.sessionId);
    const joined = hasListeningState && heroRoom?.userJoined !== false && (heroRoom?.isGroup ? presence.members.some(m=>m.status==="joined") : heroRoom?.status==="joined");
    const partnerAvatar = roomSession?.isGroup ? roomSession.groupAvatar : presence.avatar;
    const entry = useMemo(()=>listeningEntryTiming(joined,heroRoom?.lastGlowAt),[joined,heroRoom?.id,heroRoom?.lastGlowAt,heroRoom?.glowEpoch]);
    const invite = (id: string) => { try { const target=sessions.find(s=>s.id===id); if(!target)return; const invitation=target.isGroup?inviteGroupListeningRoom(id):inviteListeningRoom(id,target.contactId); const track=player?.currentTrack; pushChatMessage({sessionId:id,role:"user",content:"邀请你一起听歌。",mediaType:"listening_invite",mediaData:{listeningInvite:{roomId:invitation.id,title:track?.title,artist:track?.artist,coverUrl:track?.coverUrl}}});setInvitePicker(false);setNotice("");window.dispatchEvent(new CustomEvent(CHAT_REQUEST_REPLY_EVENT,{detail:{sessionId:id}})); } catch(e){setNotice(e instanceof Error?e.message:"邀请失败");} };
    const act = (fn: () => void) => { try { fn(); setNotice(""); } catch (e) { setNotice(e instanceof Error ? e.message : "操作失败"); } };
    const saveDraft = () => {
        if(editing!=="new" || savingDraft.current)return;
        savingDraft.current=true;
        try {if(name.trim())createListeningPlaylist(scope,name.trim(),"self");setEditing(null);setName("");setNotice("");} catch(e){savingDraft.current=false;setNotice(e instanceof Error?e.message:"保存失败");}
    };
    useEffect(()=>{if(editing==="new")draftRef.current?.focus({preventScroll:true});},[editing]);
    useEffect(()=>{
        if(!album || player?.showFullPlayer)return;
        const node=detailRef.current;if(!node)return;
        const previous=document.activeElement as HTMLElement|null;
        const siblings=Array.from(node.parentElement?.children||[]).filter(el=>el!==node) as HTMLElement[];
        const saved=siblings.map(el=>el.inert);siblings.forEach(el=>el.inert=true);
        node.focus({preventScroll:true});
        return()=>{siblings.forEach((el,i)=>el.inert=saved[i]);if(previous?.isConnected)previous.focus({preventScroll:true});};
    },[album,player?.showFullPlayer]);
    const play = async (song: SharedListeningSong, action: "toggle" | "open" = "toggle") => {
        if (busy) return;
        setBusy(true); setNotice("");
        try { await activateListeningSong(song,action,()=>player?.openFullPlayer()); }
        catch(e) { setNotice(e instanceof Error ? e.message : "暂时无法播放"); }
        finally { setBusy(false); }
    };
    return <section ref={rootRef} className={styles.page} data-listening-home={!sessionId || undefined} data-listening-active={!sessionId && hasListeningState || undefined} data-entry-ready={entry.ready} data-entry-animate={entry.animate} style={{"--listening-page-delay":`${entry.delayMs}ms`} as CSSProperties} aria-label="一起听榜单与歌单">
        {!sessionId && <div className={styles.hero} key={`${heroRoom?.id}:${heroRoom?.lastGlowAt || 0}`}>
            {entry.ready && <div className={styles.starField} aria-hidden="true">{[[9,25,16],[86,14,9],[15,67,11],[90,66,18],[28,8,5],[71,39,8],[6,48,5],[74,83,6],[32,89,4],[59,19,3],[81,55,3],[23,41,3],[65,70,4],[45,53,2],[93,37,2],[12,80,2],[55,92,3],[38,30,2]].map(([x,y,size],i)=><span key={i} data-dot={size<5} style={{left:`${x}%`,top:`${y}%`,right:"auto",fontSize:`${size}px`,width:size<5?`${size}px`:undefined,height:size<5?`${size}px`:undefined,animationDuration:`${2.8+i%6*.57}s`,animationDelay:`${-i*.93}s`} as CSSProperties}>{size<5?"":"✦"}</span>)}</div>}
            <div className={styles.recordTitle}><span className={styles.titleStars} aria-hidden="true" style={{visibility:entry.ready ? "visible" : "hidden"}}><i>✦</i> <i>·</i> <i>✦</i></span><strong>THE SOUND</strong><em>of our time</em></div>
            <div className={styles.photoReveal} data-expanded={hasListeningState}><div className={styles.photoStage}>
                {hasListeningState && <div className={styles.pair} data-joined={joined}><span className={styles.heroAvatar}><span className={styles.heroPhoto}><ListeningAvatar src={user?.avatarUrl} name={user?.name || "你"}/></span></span><span className={styles.heroAvatar}><span className={styles.heroPhoto}><ListeningAvatar src={partnerAvatar} name={presence.name}/></span></span></div>}
            </div></div>
            {heroActions ? <div className={styles.heroActions}>{heroActions}</div> : <><button className={styles.inviteButton} disabled={!!presence.room} onClick={()=>setInvitePicker(!invitePicker)} aria-expanded={invitePicker}>{presence.room ? (joined ? "一起听进行中" : "等待加入") : "邀请一起听"}</button>{invitePicker && <div className={styles.invitePicker} role="group" aria-label="邀请一起听的聊天" onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();setInvitePicker(false);}}}><div className={styles.inviteHeading}>邀请谁来听<button aria-label="收起邀请列表" onClick={()=>setInvitePicker(false)}>×</button></div>{sessions.map(s=><button className={styles.inviteRow} key={s.id} onClick={()=>invite(s.id)}><span className={styles.avatar}><ListeningAvatar src={s.isGroup?s.groupAvatar:getChatCharacterAvatar(s,chars.find(c=>c.id===s.contactId))} name={sessionName(s.id)}/></span><span className={styles.inviteLabel}><strong>{sessionName(s.id)}</strong><small>{s.isGroup?"群聊 · 一起分享此刻":"一起听同一首歌"}</small></span><Plus size={16}/></button>)}{!sessions.length && <p>先建立一个聊天室</p>}</div>}</>}
        </div>}
        {!sessionId && <div className={styles.sectionHead}><h3>陪伴时光</h3></div>}
        {tab === "rank" ? <>
            {!ranking.length && <div className={styles.empty}>还没有一起听的时光<br/><small>下一首歌，和喜欢的人一起听。</small></div>}
            {heroSessionId && sessions.some(s=>s.id===heroSessionId && (s.isGroup || !ranking.some(r=>r.characterId===s.contactId))) && <details className={styles.currentLibrary}><summary>{sessionName(heroSessionId)} · 共同歌单</summary><ListeningLibrary sessionId={heroSessionId}/></details>}
            <ol className={styles.ranking}>{ranking.map(r => { const c=chars.find(c=>c.id===r.characterId)!; const chats=sessions.filter(s=>!s.isGroup && s.contactId===c.id); return <li key={c.id} className={styles.person}>
                <button className={styles.rankButton} aria-expanded={expanded===c.id} onClick={()=>setExpanded(expanded===c.id?null:c.id)}><span className={styles.rank}>{r.rank}</span><span className={styles.avatar}><ListeningAvatar src={getChatCharacterAvatar(chats[0],c)} name={c.name}/></span><strong>{c.name}<small>一起听过的时光</small></strong><span className={styles.time}>{Math.floor(r.milliseconds/60000)}<small> 分钟</small></span></button>
                {expanded===c.id && <div className={styles.expanded}>{chats.length ? chats.map(s=><ListeningLibrary key={s.id} sessionId={s.id}/>) : <p className={styles.hint}>暂无可访问的共同歌单</p>}</div>}
            </li>; })}</ol></> : <>
            <div className={styles.scope}><button aria-expanded={picker} aria-controls="listening-session-picker" onClick={() => setPicker(!picker)}>{sessionName(scope)}<ChevronDown size={16}/></button>
            {picker && <div id="listening-session-picker" className={styles.picker} role="group" aria-label="选择聊天" onKeyDown={e => { if(e.key === "Escape"){e.stopPropagation();setPicker(false);} }}>{sessions.map(s => <button key={s.id} onClick={() => {setScope(s.id);setPicker(false);setEditing(null);}}>{sessionName(s.id)}{s.id === scope && <Check size={16}/>}</button>)}</div>}</div>
            {!session && <div className={styles.empty}>先选择一个聊天，建立你们的歌单。</div>}

            {session && <ListeningAlbumShelf><div className={styles.albumCard + " " + styles.createAlbum}><button className={styles.albumArt} aria-label="创建歌单" onClick={()=>{savingDraft.current=false;setEditing("new");setName("");}}><Plus size={30}/></button>{editing==="new" ? <input ref={draftRef} className={styles.albumNameInput} data-listening-name aria-label="新歌单名称" placeholder="歌单名称" value={name} maxLength={60} onChange={e=>setName(e.target.value)} onBlur={saveDraft} onKeyDown={e=>{if(e.key==="Enter" && !e.nativeEvent.isComposing){e.preventDefault();saveDraft();}if(e.key==="Escape"){e.stopPropagation();savingDraft.current=true;setEditing(null);}}}/> : <button className={styles.createName} onClick={()=>{savingDraft.current=false;setEditing("new");setName("");}}>创建歌单</button>}</div>{playlists.map(p=><div key={p.id} className={styles.albumCard}>
                <button className={styles.albumOpen} onPointerDown={e=>{if(e.button!==0)return;held.current=false;pressStart.current={x:e.clientX,y:e.clientY};clearHold();hold.current=setTimeout(()=>{held.current=true;setDeleteTarget(p.id);},550);}} onPointerMove={e=>{if(Math.hypot(e.clientX-pressStart.current.x,e.clientY-pressStart.current.y)>8)clearHold();}} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold} onContextMenu={e=>{e.preventDefault();clearHold();held.current=true;setDeleteTarget(p.id);}} onKeyDown={e=>{if(e.key==="Delete"){e.preventDefault();setDeleteTarget(p.id);}}} onClick={()=>{if(held.current){held.current=false;return;}setAlbum(p.id);}}><PlaylistCover songs={p.songs} name={p.name}/><strong>{p.name}</strong><small>{p.songs.length} 首 · {actorName(p.updatedBy)}最近整理</small></button>
                {deleteTarget===p.id && <div className={styles.deleteMenu}><button onClick={()=>act(()=>{deleteListeningPlaylist(scope,p.id);setDeleteTarget(null);})}><Trash2 size={14}/>删除歌单</button><button onClick={()=>setDeleteTarget(null)}>取消</button></div>}
            </div>)}</ListeningAlbumShelf>}
            {playlists.filter(p=>p.id===album).map(p => createPortal(<div ref={detailRef} className={styles.albumDetail} hidden={!!player?.showFullPlayer} tabIndex={-1} role="dialog" aria-modal="true" aria-label={p.name} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();setEditing(null);setAlbum(null);}if(e.key==="Tab"){const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));const first=items[0],last=items.at(-1);if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}}}}><div className={styles.detailHeader+" music-header"}><button className="music-header-action" aria-label="返回共同歌单" onClick={()=>setAlbum(null)}><ArrowLeft size={25} strokeWidth={1.8}/></button><span className="music-header-title">共同歌单</span><button className="music-header-action" aria-label={`修改${p.name}名称`} onClick={()=>{setEditing(p.id);setName(p.name);}}><Pencil size={21} strokeWidth={1.8}/></button></div><article className={styles.playlist} key={p.id}><div className={styles.detailIdentity}><PlaylistCover songs={p.songs} name={p.name}/><h3>{p.name}</h3><small>{p.songs.length} 首 · {actorName(p.updatedBy)}最近整理</small></div>
            {editing && editing !== "new" && <form className={styles.edit} onSubmit={e => { e.preventDefault();act(() => {if(editing === "new"){const created=createListeningPlaylist(scope,name,"self");setAlbum(created.id);}else editListeningPlaylist(scope,editing,"self",{name});setEditing(null);}); }}><input aria-label="歌单名称" placeholder="给歌单起个名字" value={name} maxLength={60} onChange={e=>setName(e.target.value)}/><button type="submit" disabled={!name.trim()}>保存</button><button type="button" onClick={()=>setEditing(null)}>取消</button></form>}
                {!p.songs.length && <p className={styles.hint}>还没有歌曲，等一首让你们心动的。</p>}
                <div className={styles.songList}>{p.songs.map((song,index)=><div className={styles.song} key={song.id}><button className={styles.songArtwork} disabled={busy} aria-label={`${player?.currentTrack?.id===song.id && player.isPlaying ? "暂停" : "播放"}${song.title}`} aria-pressed={player?.currentTrack?.id===song.id && !!player.isPlaying} onClick={()=>void play(song)}><Music2 size={18}/><ListeningTrackCover song={song} currentCover={player?.currentTrack?.id===song.id ? player.currentTrack.coverUrl : undefined}/><span className={styles.songPlay}>{player?.currentTrack?.id===song.id && player.isPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}</span></button><button className={styles.songLabel} disabled={busy} aria-label={`打开${song.title}播放详情`} onClick={()=>void play(song,"open")}><strong>{song.title}</strong><small>{song.artist}</small><span className={styles.songCredit}>{actorName(song.addedBy)}加入</span></button><span className={styles.songNumber} aria-hidden="true">{String(index+1).padStart(2,"0")}</span><button className={styles.songRemove} aria-label={`从${p.name}移除${song.title}`} onClick={()=>act(()=>editListeningPlaylist(scope,p.id,"self",{removeId:song.id}))}><Trash2 size={16}/></button></div>)}</div>
            </article>{notice && <p role="status" className={styles.notice}>{notice}</p>}</div>,rootRef.current?.closest(".music-app") || rootRef.current!,p.id))}
        </>}
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
    </section>;
}
