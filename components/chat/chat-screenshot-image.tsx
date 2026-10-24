"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {X,ZoomIn,ZoomOut,Download} from "lucide-react";
import styles from "./forwarded-chat.module.css";

export function ChatScreenshotImage({url,filename="chat-screenshot.png"}:{url:string;filename?:string}) {
    const [open,setOpen]=useState(false),[zoom,setZoom]=useState(false),[saving,setSaving]=useState(false);
    const panel=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
    useEffect(()=>{if(!open)return;panel.current?.querySelector<HTMLButtonElement>("button")?.focus();return()=>trigger.current?.focus()},[open]);
    return <><button ref={trigger} type="button" className={styles.screenshotThumbnail} aria-label="查看聊天长图" onClick={()=>{setZoom(false);setOpen(true)}}><img src={url} alt="聊天长图" /></button>
        {open && createPortal(<div ref={panel} className={styles.screenshotViewer} role="dialog" aria-modal="true" aria-label="聊天截图" onKeyDown={event=>{
            if(event.key==="Escape"){event.stopPropagation();setOpen(false)}
            if(event.key!=="Tab")return;const nodes=[...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')],first=nodes[0],last=nodes.at(-1);
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
        }}><header><button type="button" aria-label="关闭聊天截图" onClick={()=>setOpen(false)}><X size={20}/></button><span>聊天截图</span><button type="button" aria-label={zoom?"适应屏幕":"放大聊天截图"} onClick={()=>setZoom(value=>!value)}>{zoom?<ZoomOut size={20}/>:<ZoomIn size={20}/>}</button><button type="button" disabled={saving} aria-label="保存聊天截图" onClick={async()=>{setSaving(true);try{const {downloadUrl}=await import("@/lib/download-utils");await downloadUrl(url,filename)}finally{setSaving(false)}}}><Download size={20}/></button></header>
            <div className={styles.screenshotScroll} tabIndex={0}><img src={url} alt="聊天截图大图" style={{width:zoom?"200%":"100%",maxWidth:zoom?"none":"780px"}} /></div>
        </div>,document.body)}</>;
}
