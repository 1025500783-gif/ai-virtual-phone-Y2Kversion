"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Headphones } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-storage";
import { getListeningRoom, subscribeListeningRoom, respondToListeningInvitation } from "@/lib/listen-together";

const serverSnapshot = () => null;
export function ListeningInviteCard({ msg, readOnly = false }: { msg: ChatMessage; readOnly?: boolean }) {
    const room = useSyncExternalStore(subscribeListeningRoom, getListeningRoom, serverSnapshot);
    const invite = msg.mediaData?.listeningInvite;
    const [failedCover, setFailedCover] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [slide, setSlide] = useState<number | null>(null);
    const drag = useRef<{ x: number; y: number; scale: number } | null>(null);
    const status = room?.id === invite?.roomId && room?.sessionId === msg.sessionId ? room?.status : undefined;
    const label = status === "joined" ? "已加入 · 一起听中" : status === "declined" || invite?.response === "declined" ? "已婉拒" : status === "invited" ? "等待回应" : invite?.response === "accepted" ? "已接受过这份邀请" : invite?.initiator === "character" ? "邀请已失效" : "邀请已发送";
    const cover = invite?.coverUrl && failedCover !== invite.coverUrl ? invite.coverUrl : undefined;
    const actionable = !readOnly && status === "invited" && invite?.initiator === "character";
    const respond = async (accept: boolean) => {
        if (!actionable || busy || !invite) return;
        setBusy(true); setError("");
        try { await respondToListeningInvitation(invite.roomId, msg.sessionId, accept); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败，请重试"); }
        finally { setBusy(false); setSlide(null); }
    };
    const visualStatus = status || (invite?.response === "declined" ? "declined" : invite?.response === "accepted" ? "accepted" : undefined);
    return <div className="listening-invite-card listening-invite-record listening-invite-bare" data-status={visualStatus} role="group" aria-label={["一起听邀请", invite?.title, invite?.artist, label].filter(Boolean).join("，")}>
        <div className="listening-record-stage" role={actionable ? "button" : "img"} tabIndex={actionable ? 0 : undefined}
            aria-label={actionable ? "一起听邀请，向右滑动或右箭头接受，向左滑动或左箭头拒绝" : label}
            aria-disabled={busy || undefined} style={actionable ? { touchAction: "pan-y", cursor: "grab" } : undefined}
            onContextMenu={e => { if (actionable) { e.preventDefault(); e.stopPropagation(); } }}
            onClick={e => { if (actionable) e.stopPropagation(); }}
            onPointerDown={e => {
                if (!actionable || busy || e.button !== 0) return;
                e.stopPropagation();
                drag.current = { x: e.clientX, y: e.clientY, scale: e.currentTarget.getBoundingClientRect().width / e.currentTarget.offsetWidth || 1 };
                e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
                if (!drag.current) return;
                const dx = (e.clientX - drag.current.x) / drag.current.scale;
                const dy = (e.clientY - drag.current.y) / drag.current.scale;
                if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; setSlide(null); return; }
                setSlide(Math.max(0, Math.min(70, 27 + dx)));
            }}
            onPointerUp={e => {
                if (!drag.current) return;
                e.stopPropagation();
                const dx = (e.clientX - drag.current.x) / drag.current.scale;
                drag.current = null; setSlide(null);
                if (Math.abs(dx) >= 20) void respond(dx > 0);
            }}
            onPointerCancel={() => { drag.current = null; setSlide(null); }}
            onLostPointerCapture={() => { drag.current = null; setSlide(null); }}
            onKeyDown={e => {
                if (!actionable || !["ArrowRight", "ArrowLeft", "Enter", " "].includes(e.key)) return;
                e.preventDefault(); e.stopPropagation(); void respond(e.key !== "ArrowLeft");
            }}>
            <div className="listening-record-slide" style={slide === null ? undefined : { transform: `translateX(${slide}px)`, transition: "none" }}><div className="listening-record-disc">
                <span className="listening-record-label">{cover && <img src={cover} alt="" draggable={false} onError={() => setFailedCover(cover)} />}</span>
                <i className="listening-record-spindle" />
            </div></div>
            <div className="listening-record-sleeve">{cover
                ? <img src={cover} alt="" draggable={false} onError={() => setFailedCover(cover)} />
                : <span className="listening-record-empty"><Headphones size={32} strokeWidth={1} /><span>FOR YOU</span></span>}
                <span className="listening-record-sleeve-edge" />
            </div>
        </div>
        {actionable && busy && <div className="listening-invite-gesture-hint" role="status">正在连接…</div>}
        {error && <div className="listening-invite-gesture-hint" role="status">{error}</div>}
    </div>;
}
