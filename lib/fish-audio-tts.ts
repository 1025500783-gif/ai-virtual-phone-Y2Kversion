import type { VoiceApiConfig } from "./settings-types";
import { fishAudioSpeechRequest } from "./fish-audio-protocol";
export * from "./fish-audio-protocol";

export async function synthesizeFishAudio(text: string, config: VoiceApiConfig): Promise<Blob> {
    const { headers, body } = fishAudioSpeechRequest(text, config);
    const { registerIdentityRequest, assertIdentityActive } = await import("./identity-runtime");
    assertIdentityActive();
    const controller = new AbortController();
    const release = registerIdentityRequest(controller);
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
        // Only the user's selected model. No redirects, retries, or fallback.
        const response = await fetch("/api/voice/fish-audio", { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal, cache: "no-store", redirect: "error", credentials: "same-origin" });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            if (payload?.error === "invalid_origin") throw new Error("Float 请求来源校验失败，请刷新当前站点后重试；请求未发送至 Fish Audio");
            if (payload?.error === "fish_network_error") throw new Error("Float 服务器无法连接 Fish Audio，请检查服务器出网或代理；未自动重试");
            if (payload?.error === "fish_timeout") throw new Error("Fish Audio 服务端请求超时，未自动重试");
            const hint = response.status === 401 ? "密钥无效或已过期"
                : response.status === 402 ? "所选模型不可用、余额或账户权限不足；已停止请求，不会切换模型"
                : response.status === 403 ? "账户无权使用此音色或所选模型"
                : response.status === 404 ? "音色或所选模型不存在，请检查配置"
                : response.status === 429 ? "所选模型限流，请稍后手动重试"
                : "所选模型语音合成失败，请稍后手动重试";
            throw new Error(`Fish Audio (${response.status})：${hint}`);
        }
        const type = (response.headers.get("content-type") || "").toLowerCase();
        if (!type.startsWith("audio/") && !type.startsWith("application/octet-stream")) throw new Error("Fish Audio 返回的不是音频数据");
        const blob = await response.blob();
        if (!blob.size) throw new Error("Fish Audio 返回了空音频");
        assertIdentityActive();
        return new Blob([blob], { type: "audio/mpeg" });
    } catch (error) {
        if (controller.signal.aborted) throw new Error("Fish Audio 请求已取消或超时，未自动重试");
        if (error instanceof TypeError) throw new Error("无法连接 Float 语音接口，请检查当前站点网络；未自动重试");
        throw error;
    } finally {
        clearTimeout(timer);
        release();
    }
}
