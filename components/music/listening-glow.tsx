"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { useListeningPresence } from "./listening-presence";
import { getListeningRoom, recordListeningGlow } from "@/lib/listen-together";

export function ListeningGlow() {
    const shimmerId = useId().replace(/:/g, "");
    const { room } = useListeningPresence();
    const [pulse, setPulse] = useState(0);
    useEffect(() => {
        if (!room || room.status !== "joined" || room.userJoined === false) { setPulse(0); return; }
        const current = getListeningRoom();
        if (current?.id !== room.id) return;
        if (!current.lastGlowAt) {
            recordListeningGlow(current.id);
            setPulse(n => n + 1);
        }
    }, [room?.id, room?.status, room?.glowEpoch, room?.userJoined]);
    return room?.status === "joined" && room.userJoined !== false && pulse > 0
        ? <div key={pulse} className="listening-global-glow" aria-hidden="true">
            <div className="listening-music-motes">
                {[[17,48,28.05,.45],[43,39,19.8,.85],[72,51,33,1.15],[84,43,21.45,1.5]].map(([x,y,size,start],i)=><span key={i} style={{left:`${x}%`,top:`${y}%`,"--note-size":`${size}px`,"--note-start":`${start}s`} as CSSProperties}>
                    <svg viewBox="0 0 24 24"><path d={i%2 ? "M9 4v12.2a4.7 3.1-15 1 0 2 2.5V8l9-2v8.2a4.7 3.1-15 1 0 2 2.5V1z" : "M10 3v13.2a4.7 3.1-15 1 0 2 2.5V7c3 1 5 2 5 5 3-4 0-7-5-9z"}/></svg>
                </span>)}
            </div>
            <svg className="listening-love-line" viewBox="0 0 400 800" preserveAspectRatio="none" fill="none">
                <defs>
                    <linearGradient id={shimmerId} x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox" spreadMethod="reflect">
                        <stop offset="0" stopColor="#c19686" />
                        <stop offset=".26" stopColor="#e1bfa8" />
                        <stop offset=".42" stopColor="#c19686" />
                        <stop offset=".46" stopColor="#fff0ce" />
                        <stop offset=".5" stopColor="#e1bfa8" />
                        <stop offset=".68" stopColor="#c19686" />
                        <stop offset="1" stopColor="#d3aa95" />
                    </linearGradient>
                </defs>
                <path stroke={`url(#${shimmerId})`} pathLength="1" d="M -20 420 C 20 420 55 430 80 417 C 108 400 151 317 134 302 C 110 280 77 405 97 431 C 112 448 142 425 150 403 C 163 379 186 389 180 411 C 174 435 149 443 143 425 C 135 407 156 386 173 395 C 189 405 187 422 199 411 C 208 400 209 397 212 395 C 205 418 206 442 218 435 C 230 428 248 403 257 390 C 247 411 266 417 278 403 C 296 384 279 374 261 395 C 242 419 252 440 278 432 C 315 421 347 414 420 417" />
            </svg>
        </div> : null;
}
