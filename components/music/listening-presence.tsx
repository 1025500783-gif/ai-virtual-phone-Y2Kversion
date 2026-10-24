"use client";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { getListeningRoom, subscribeListeningRoom, leaveListeningRoom, joinGroupListeningAsUser } from "@/lib/listen-together";
import { loadCharacters } from "@/lib/character-storage";
import { getChatSessionMetadata, pushChatMessage } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { getChatCharacterAvatar } from "@/lib/chat-session-avatar";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { useMusicControlsOptional } from "@/lib/music-context";
import { extractListeningColor, LISTENING_COLOR_FALLBACK } from "@/lib/listening-cover-color";
import { X } from "lucide-react";
import { useActivityAvatarUpdates } from "@/components/use-activity-avatar-updates";
const serverSnapshot = () => null;
export function useListeningPresence() {
    useActivityAvatarUpdates();
    const room = useSyncExternalStore(subscribeListeningRoom, getListeningRoom, serverSnapshot);
    const characters = loadCharacters();
    const character = room ? characters.find(c => c.id === room.characterId) : null;
    const session = room ? getChatSessionMetadata().find(s => s.id === room.sessionId) : null;
    const user = resolveUserIdentity(session?.contactId, session?.isGroup ? "group_chat" : "chat");
    const members = room?.isGroup ? (room.members || []).map(m => {const c=characters.find(c=>c.id===m.characterId);return {...m,name:c?.name || "群成员",avatar:getChatCharacterAvatar(session,c)};}) : [];
    return { members, room: room?.status === "declined" ? null : room, name: room?.isGroup ? session?.groupName || "群聊" : session?.alias || character?.name || "对方", avatar: room?.isGroup ? session?.groupAvatar : getChatCharacterAvatar(session, character), userName: user?.name || "你", userAvatar: user?.avatarUrl };
}
export function ListeningAvatar({ src, name }: { src?: string | null; name: string }) {
    const [resolved, setResolved] = useState<string | null>(null);
    useEffect(() => {
        let alive = true; setResolved(null);
        if (src) {
            if (/^(https?:|data:|blob:|\/)/.test(src)) setResolved(src);
            else getChatImageFromIndexedDB(src.replace(/^asset:\/\//, "")).then(value => { if (alive) setResolved(value); }).catch(() => {});
        }
        return () => { alive = false; };
    }, [src]);
    return resolved ? <img src={resolved} alt="" draggable={false} onError={() => setResolved(null)} /> : <span>{name.slice(0, 1)}</span>;
}
export function ListeningDuration({ startedAt }: { startedAt: number }) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 15000);
        return () => window.clearInterval(timer);
    }, [startedAt]);
    const minutes = Math.max(0, Math.floor((now - startedAt) / 60000));
    return <span>{minutes < 1 ? "一起听 · 此刻开始" : `一起听了 ${minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ` : ""}${minutes % 60} 分钟`}</span>;
}
export function ListeningDuet({ userAvatar, userName, avatar, name, joined, playing }: {
    userAvatar?: string | null; userName: string; avatar?: string | null; name: string; joined: boolean; playing: boolean;
}) {
    return <span className="listening-duet" data-joined={joined} data-playing={playing} aria-hidden="true">
        <span className="listening-duet-person"><span className="listening-duet-photo"><ListeningAvatar src={userAvatar} name={userName} /></span></span>
        <span className="listening-duet-person"><span className="listening-duet-photo"><ListeningAvatar src={avatar} name={name} /></span></span>
    </span>;
}
// Decorative spectrum: fixed radial bars change length; neither the ring nor color rotates.
const spectrumBars = Array.from({ length: 64 }, (_, index) => {
    const angle = index * Math.PI * 2 / 64;
    return {
        rotation: index * 360 / 64,
        length: 3 + 5 * (.5 + .5 * Math.sin(angle * 3 + .8)) ** 2,
        delay: -.7 * (.5 + .5 * Math.sin(angle * 2)) - .21 * Math.cos(angle * 5),
        duration: 1.1 + .25 * (.5 + .5 * Math.cos(angle * 3)),
    };
});
function ListeningWaveRing() {
    return <svg className="listening-ring" viewBox="0 0 88 88" fill="none">
        <circle className="listening-ring-base" cx="44" cy="44" r="34" />
        <g className="listening-wave-window listening-spectrum">
            {spectrumBars.map((bar, index) => <g key={index} transform={"translate(44 44) rotate(" + bar.rotation + ") translate(0 -32)"}>
                <line className="listening-spectrum-bar" x1="0" y1="0" x2="0" y2={-bar.length}
                    style={{ "--spectrum-delay": bar.delay + "s", "--spectrum-duration": bar.duration + "s" } as CSSProperties} />
            </g>)}
        </g>
    </svg>;
}

export function ListeningPlanets({ presence, playing }: { presence: ReturnType<typeof useListeningPresence>; playing: boolean }) {
    const player = useMusicControlsOptional();
    const [color,setColor] = useState(LISTENING_COLOR_FALLBACK);
    const cover = player?.currentTrack?.coverUrl;
    useEffect(()=>{let alive=true;extractListeningColor(cover).then(value=>{if(alive)setColor(value);});return()=>{alive=false;};},[cover]);
    if (!presence.room) return null;
    const joined = presence.members.filter(m => m.status === "joined");
    return <div className="listening-planets" style={{"--listening-cover-color":color} as CSSProperties} aria-hidden="true" data-orbiting={presence.room.status === "joined" && playing ? "true" : "false"}>
        <ListeningWaveRing />
        {presence.room.userJoined !== false && <span className="listening-orbit listening-orbit-user"><span className="listening-planet"><ListeningAvatar src={presence.userAvatar} name={presence.userName} /></span></span>}
        {presence.room.isGroup ? <>
            {joined.slice(0,2).map((m,index)=><span key={m.characterId} className={"listening-orbit " + (index ? "listening-orbit-third" : "listening-orbit-char")}><span className="listening-planet"><ListeningAvatar src={m.avatar} name={m.name}/></span></span>)}
            {joined.length > 2 && <span className="listening-planet-more">+{joined.length-2}</span>}
        </> : <span className="listening-orbit listening-orbit-char"><span className="listening-planet"><ListeningAvatar src={presence.avatar} name={presence.name} /></span></span>}
    </div>;
}
export function ListeningPlayerPresence() {
    const presence = useListeningPresence();
    const player = useMusicControlsOptional();
    const [open, setOpen] = useState(false);
    const room = presence.room;
    useEffect(() => setOpen(false), [room?.id]);
    if (!room) return null;
    const label = room.userJoined === false ? `${presence.name}的一起听` : room.status === "invited" ? `等待${presence.name}加入` : `和${presence.name}一起听`;
    return <>
        <button className="listening-player-presence" onClick={() => setOpen(true)} aria-label={label + "，查看成员"}>
            <ListeningDuet userAvatar={presence.userAvatar} userName={presence.userName} avatar={presence.avatar} name={presence.name} joined={room.status === "joined"} playing={!!player?.isPlaying} />
            <span className="listening-presence-copy"><strong>{label}</strong><small>{room.status === "joined" ? <ListeningDuration startedAt={room.startedAt} /> : "等待回应"}</small></span>
        </button>
        {open && <div className="listening-members-overlay" onClick={() => setOpen(false)} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
            <div className="listening-members" role="dialog" aria-modal="true" aria-label="一起听成员" onClick={e => e.stopPropagation()} onKeyDown={e => {
                if (e.key !== "Tab") return;
                const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }}>
                <header><strong>一起听</strong><button autoFocus aria-label="关闭成员面板" onClick={() => setOpen(false)}><X size={20} /></button></header>
                <div className="listening-member"><span className="listening-member-avatar"><ListeningAvatar src={presence.userAvatar} name={presence.userName} /></span><span>{presence.userName}<small>{room.userJoined === false ? "尚未加入" : "你"}</small></span></div>
                {room.isGroup ? presence.members.map(m => <div className="listening-member" key={m.characterId}><span className="listening-member-avatar"><ListeningAvatar src={m.avatar} name={m.name}/></span><span>{m.name}<small>{m.status === "joined" ? "一起听中" : m.status === "invited" ? "等待加入" : "暂未加入"}</small></span></div>) : <div className="listening-member"><span className="listening-member-avatar"><ListeningAvatar src={presence.avatar} name={presence.name} /></span><span>{presence.name}<small>{room.status === "invited" ? "邀请中" : player?.isPlaying ? "一起听中" : "音乐已暂停"}</small></span></div>}
                <button className="listening-end" onClick={() => {
                    if (getListeningRoom()?.id !== room.id) return;
                    if (room.isGroup && room.userJoined === false) { joinGroupListeningAsUser(room.sessionId); setOpen(false); return; }
                    leaveListeningRoom(room.sessionId);
                    pushChatMessage({ sessionId: room.sessionId, role: "system", content: room.status === "invited" ? "用户取消了一起听邀请。" : room.isGroup ? "用户退出了一起听。" : "用户结束了一起听。" });
                    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: room.sessionId } }));
                    setOpen(false);
                }}>{room.isGroup && room.userJoined === false ? "加入一起听" : room.status === "invited" ? "取消邀请" : room.isGroup ? "退出一起听" : "结束一起听"}</button>
            </div>
        </div>}
    </>;
}
