/** Small, bounded, shared cover sampling for listening effects. */
export const LISTENING_COLOR_FALLBACK = "rgb(211, 133, 164)";
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
export function chooseListeningColor(data: Uint8ClampedArray): string {
    const bins = new Map<string, { count: number; r: number; g: number; b: number }>();
    let total = 0;
    for (let i=0;i<data.length;i+=4) {
        if(data[i+3]<128)continue;
        const r=data[i],g=data[i+1],b=data[i+2],key=[r>>5,g>>5,b>>5].join(",");
        const bin=bins.get(key)||{count:0,r:0,g:0,b:0};bin.count++;bin.r+=r;bin.g+=g;bin.b+=b;bins.set(key,bin);total++;
    }
    const top=[...bins.values()].sort((a,b)=>b.count-a.count);
    if(!top.length)return LISTENING_COLOR_FALLBACK;
    const selected=top.slice(0,3).find(c=>{const r=c.r/c.count,g=c.g/c.count,b=c.b/c.count,max=Math.max(r,g,b),min=Math.min(r,g,b);return c.count/total>=.05 && max>45 && min<225 && max-min>25;})||top[0];
    return `rgb(${Math.round(selected.r/selected.count)}, ${Math.round(selected.g/selected.count)}, ${Math.round(selected.b/selected.count)})`;
}
export function extractListeningColor(url?: string | null): Promise<string> {
    if(!url || typeof window==="undefined")return Promise.resolve(LISTENING_COLOR_FALLBACK);
    if(cache.has(url))return Promise.resolve(cache.get(url)!);
    if(pending.has(url))return pending.get(url)!;
    // Cap concurrent image decodes during rapid track changes as well as retained colors.
    if(pending.size>=4)return Promise.resolve(LISTENING_COLOR_FALLBACK);
    const promise=new Promise<string>(resolve=>{
        const img=new Image();let finished=false;
        const finish=(color:string)=>{if(finished)return;finished=true;clearTimeout(timer);img.onload=null;img.onerror=null;img.src="";if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(url,color);resolve(color);};
        const timer=setTimeout(()=>finish(LISTENING_COLOR_FALLBACK),2500);
        img.crossOrigin="anonymous";img.onerror=()=>finish(LISTENING_COLOR_FALLBACK);
        img.onload=()=>{try{const canvas=document.createElement("canvas");canvas.width=canvas.height=32;const ctx=canvas.getContext("2d");if(!ctx)return finish(LISTENING_COLOR_FALLBACK);ctx.drawImage(img,0,0,32,32);finish(chooseListeningColor(ctx.getImageData(0,0,32,32).data));}catch{finish(LISTENING_COLOR_FALLBACK);}};
        img.src=url;
    });
    pending.set(url,promise);void promise.finally(()=>pending.delete(url));return promise;
}
