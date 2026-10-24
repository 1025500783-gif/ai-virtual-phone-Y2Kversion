import type { ForwardedChat } from "./chat-forward-types";
import type { ScreenshotPerspective } from "./chat-screenshot-view";
export type ChatScreenshot = { dataUrl: string; width: number; height: number; perspective: ScreenshotPerspective };

async function renderChatScreenshot(record: ForwardedChat, perspective: ScreenshotPerspective, guard: () => void = () => {}): Promise<ChatScreenshot> {
    guard();
    if (typeof document === "undefined") throw new Error("聊天截图需要在应用页面中生成");
    const [{createRoot},{flushSync},{createElement},{toPng},{ChatScreenshotFrame}] = await Promise.all([import("react-dom/client"),import("react-dom"),import("react"),import("html-to-image"),import("@/components/chat/chat-screenshot-frame")]);
    guard();
    const host=document.createElement("div");host.setAttribute("aria-hidden","true");host.inert=true;host.style.cssText="position:fixed;left:-10000px;top:0;pointer-events:none;z-index:-1";document.body.appendChild(host);
    const root=createRoot(host);
    try {
        flushSync(()=>root.render(createElement(ChatScreenshotFrame,{record,perspective})));
        const node=host.firstElementChild as HTMLElement;
        await Promise.all([...node.querySelectorAll("img")].map(image=>new Promise<void>((resolve,reject)=>{
            if(image.complete){image.naturalWidth?resolve():reject(new Error("截图中的图片无法读取，请重新选择"));return;}
            const timer=setTimeout(()=>reject(new Error("截图图片加载超时，请重试")),8000);
            image.onload=()=>{clearTimeout(timer);resolve()};image.onerror=()=>{clearTimeout(timer);reject(new Error("截图中的图片无法读取，请重新选择"))};
        })));
        // Canvas export cannot paint WebKit slice masks. Use the original
        // chat stylesheet's role-aware 20px/7px fallback radius in the bitmap.
        for (const surface of node.querySelectorAll<HTMLElement>("[data-screenshot-surface]")) {
            const computed=getComputedStyle(surface);
            const mask=computed.getPropertyValue("-webkit-mask-box-image-source");
            if((!mask || mask==="none") && computed.borderRadius!=="0px")continue;
            const bubble=surface.closest<HTMLElement>("[data-forward-role]");
            const radius=bubble?.getAttribute("data-forward-role")==="user" ? "20px 20px 7px 20px" : "20px 20px 20px 7px";
            for(const property of ["-webkit-mask-box-image-source","-webkit-mask-box-image","mask-border-source","mask-border","mask-image","-webkit-mask-image"])surface.style.setProperty(property,"none","important");
            surface.style.setProperty("border-radius",radius,"important");if(bubble)bubble.style.setProperty("border-radius",radius,"important");
        }
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));guard();
        const width=node.offsetWidth,height=node.scrollHeight;
        if(!width || !height || height>16000 || width*height>8000000)throw new Error("所选聊天过长，请减少消息后分批截图");
        const ratio=Math.min(2,16000/height,Math.sqrt(16000000/(width*height)));
        const dataUrl=await toPng(node,{width,height,pixelRatio:ratio,skipFonts:true,backgroundColor:record.theme?.background || "#fff",cacheBust:false});
        guard();
        if(dataUrl.length>20*1024*1024)throw new Error("截图过大，请减少消息后分批截图");
        return {dataUrl,width:Math.round(width*ratio),height:Math.round(height*ratio),perspective};
    } finally {root.unmount();host.remove()}
}

let screenshotQueue: Promise<void> = Promise.resolve();
export async function createChatScreenshot(record: ForwardedChat, perspective: ScreenshotPerspective, guard: () => void = () => {}): Promise<ChatScreenshot> {
    const previous=screenshotQueue;let release!:()=>void;screenshotQueue=new Promise<void>(resolve=>{release=resolve});
    await previous;try{guard();return await renderChatScreenshot(record,perspective,guard)}finally{release()}
}

export async function saveChatScreenshot(image: ChatScreenshot): Promise<string> {
    if(!image.dataUrl.startsWith("data:image/png;base64,"))throw new Error("截图格式不正确");
    const bytes=Uint8Array.from(atob(image.dataUrl.split(",")[1]),value=>value.charCodeAt(0));
    const {saveChatImageToIndexedDB}=await import("./chat-asset-storage");
    return "asset://" + await saveChatImageToIndexedDB(new Blob([bytes],{type:"image/png"}));
}
