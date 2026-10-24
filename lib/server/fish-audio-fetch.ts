import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProxyAgent, type Dispatcher } from "undici";
import { proxyFetch } from "../proxy-fetch";

const exec = promisify(execFile);
let windowsDispatcher: Promise<Dispatcher | null> | undefined;

async function getWindowsDispatcher(): Promise<Dispatcher | null> {
    try {
        const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
        const [enabled, server] = await Promise.all([
            exec("reg.exe", ["query", key, "/v", "ProxyEnable"], { windowsHide: true, timeout: 3000 }),
            exec("reg.exe", ["query", key, "/v", "ProxyServer"], { windowsHide: true, timeout: 3000 }),
        ]);
        if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled.stdout)) return null;
        const raw = server.stdout.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1].trim();
        if (!raw) return null;
        const address = raw.includes("=") ? raw.match(/(?:^|;)https=([^;]+)/i)?.[1] || raw.match(/(?:^|;)http=([^;]+)/i)?.[1] : raw;
        if (!address) return null;
        const url = new URL(address.includes("://") ? address : `http://${address}`);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        return new ProxyAgent(url.href);
    } catch { return null; }
}

export async function fishAudioFetch(url: string, init: RequestInit): Promise<Response> {
    // Select the network path before the single synthesis attempt. Never retry it.
    if (process.env.NODE_ENV !== "development" || process.platform !== "win32"
        || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) return proxyFetch(url, init);
    windowsDispatcher ??= getWindowsDispatcher();
    const dispatcher = await windowsDispatcher;
    return dispatcher ? fetch(url, { ...init, dispatcher } as RequestInit) : fetch(url, init);
}
