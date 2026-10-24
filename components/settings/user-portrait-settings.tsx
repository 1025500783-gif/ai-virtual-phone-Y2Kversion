"use client";
import { useState } from "react";
import { getCurrentIdentityId } from "@/lib/identity-runtime";
import { Toggle } from "@/components/ui/form";
import type { UserIdentity } from "./user-identity";

export async function readProfileImage(file: File): Promise<string> {
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) throw new Error("请选择 12 MB 以内的图片");
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("图片读取失败")); img.src = url; });
        const scale = Math.min(768 / Math.max(img.width, img.height), 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("图片处理失败");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/webp", .82);
    } finally { URL.revokeObjectURL(url); }
}
export function UserPortraitSettings({identity,onChange}: {identity: UserIdentity;onChange:(v:Partial<UserIdentity>)=>void}) {
    const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
    return <div className="flex flex-col gap-3"><div className="ui-toggle-row"><span className="flex flex-col"><span className="menu-label">肖像画</span><span className="menu-desc">让角色结合文字设定了解你的外貌</span></span><Toggle ariaLabel="肖像画" checked={identity.portraitEnabled===true} onChange={portraitEnabled=>onChange({portraitEnabled})}/></div>{identity.portraitEnabled && <div className="flex items-center gap-3">{identity.portraitUrl && <img src={identity.portraitUrl} alt="用户肖像" className="h-20 w-20 rounded-2xl object-cover"/>}<label className="ui-btn ui-btn-soft-action cursor-pointer">{busy?"处理中…":"上传肖像"}<input className="sr-only" type="file" accept="image/*" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;const owner=getCurrentIdentityId();setBusy(true);setError("");try{const portraitUrl=await readProfileImage(file);if(owner===getCurrentIdentityId())onChange({portraitUrl,portraitDescription:undefined});}catch(e){setError(e instanceof Error?e.message:"上传失败");}finally{setBusy(false);}}}/></label>{identity.portraitUrl && <button className="ui-link-btn" onClick={()=>onChange({portraitUrl:undefined,portraitDescription:undefined})}>移除肖像</button>}</div>}{error&&<p role="alert" className="menu-desc">{error}</p>}</div>;
}
