"use client";
import { Children, cloneElement, isValidElement, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import styles from "./listening-library.module.css";

// Ported from design/music-private/index.html: selection-relative depth and rotation.
export default function ListeningAlbumShelf({children}: {children: ReactNode}) {
    const cards=Children.toArray(children);
    const [selected,setSelected]=useState(0);
    const active=Math.min(selected,Math.max(0,cards.length-1));
    const gesture=useRef<{x:number;y:number}|null>(null);
    const suppressClickUntil=useRef(0);
    const move=(direction:number)=>{if(cards.length)setSelected((active+direction+cards.length)%cards.length);};
    return <div className={styles.albumShelf} data-coverflow>
        <div className={styles.flowColumn}>
            <div className={styles.flowStage} role="group" aria-label="共同歌单" onKeyDown={e=>{
                if((e.target as HTMLElement).tagName==="INPUT")return;
                if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();move(e.key==="ArrowRight"?1:-1);}
            }} onPointerDownCapture={e=>{gesture.current={x:e.clientX,y:e.clientY};}} onPointerCancel={()=>{gesture.current=null;}}
            onPointerUpCapture={e=>{
                const start=gesture.current;gesture.current=null;if(!start)return;
                const dx=e.clientX-start.x,dy=e.clientY-start.y;
                if(Math.abs(dx)>35 && Math.abs(dx)>Math.abs(dy)*1.2){suppressClickUntil.current=Date.now()+350;move(dx<0?1:-1);}
            }} onClickCapture={e=>{if(Date.now()<suppressClickUntil.current){e.preventDefault();e.stopPropagation();}}}>
                {cards.map((card,index)=>{
                    if(!isValidElement(card))return card;
                    let offset=index-active;
                    if(offset>cards.length/2)offset-=cards.length;
                    if(offset < -cards.length/2)offset+=cards.length;
                    const distance=Math.abs(offset);
                    return cloneElement(card as ReactElement<HTMLAttributes<HTMLDivElement>>,{
                        style:{'--offset':offset,'--side':Math.sign(offset),'--distance':distance,visibility:distance>2?'hidden':undefined} as CSSProperties,
                        'aria-current':index===active?'true':undefined,
                        onClickCapture:e=>{if(index!==active){e.preventDefault();e.stopPropagation();setSelected(index);}},
                    });
                })}
            </div>
        </div>
    </div>;
}
