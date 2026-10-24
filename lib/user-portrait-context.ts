import { getCurrentIdentityId } from "./identity-runtime";
import { loadUserIdentities, resolveUserIdentity, saveUserIdentities } from "./settings-storage";

/** Portrait-only metadata; no calendar actions or ordinary photo mutation. */
export function lifePrompt(_session: unknown, _photos: unknown[], visionEnabled: boolean): string {
    const identity = resolveUserIdentity();
    return visionEnabled && identity?.portraitEnabled && identity.portraitUrl && !identity.portraitDescription
        ? '若请求附有标记 user-portrait 的用户肖像，结合用户文字设定辨认；合照人物不明则询问。回复末尾用 <float_state>{"photos":[{"id":"user-portrait","description":"客观外貌描述"}]}</float_state> 记录可确认的外貌，不推断身份或隐私；无可确认信息则不输出此块。'
        : "";
}

type PortraitScope = { identity: string | null; userId: string; portraitUrl: string; signal?: AbortSignal };
export function lifeScope(_sessionId: string | undefined, messages: { content?: unknown }[], signal?: AbortSignal): PortraitScope | null {
    const identity = resolveUserIdentity();
    if (!identity?.portraitEnabled || !identity.portraitUrl) return null;
    const hasReference = messages.some(message => Array.isArray(message.content)
        && message.content.some(part => part?.type === "text" && typeof part.text === "string" && part.text.startsWith("[图片ID:user-portrait]"))
        && message.content.some(part => part?.type === "image_url"));
    return hasReference ? { identity: getCurrentIdentityId(), userId: identity.id, portraitUrl: identity.portraitUrl, signal } : null;
}

export function applyLifeOutput(text: string, scope: PortraitScope | null): string {
    if (!scope) return text;
    const visible = text.replace(/<float_state>([\s\S]*?)<\/float_state>/g, (_block, json: string) => {
        if (scope.signal?.aborted || getCurrentIdentityId() !== scope.identity) return "";
        try {
            const data = JSON.parse(json);
            const photo = Array.isArray(data?.photos) ? data.photos.find((item: unknown) => item && typeof item === "object" && "id" in item && item.id === "user-portrait") : undefined;
            if (typeof photo?.description !== "string" || !photo.description.trim()) return "";
            const identities = loadUserIdentities();
            const current = identities.find(item => item.id === scope.userId);
            if (current?.portraitEnabled && current.portraitUrl === scope.portraitUrl && !current.portraitDescription) {
                saveUserIdentities(identities.map(item => item.id === scope.userId ? { ...item, portraitDescription: photo.description.trim().slice(0, 800) } : item));
            }
        } catch { /* Malformed model metadata never changes saved user data. */ }
        return "";
    });
    return visible.replace(/<float_state>[\s\S]*$/, "");
}

/** Keep metadata private even when tag names cross SSE chunk boundaries. */
export function createLifeStreamFilter() {
    let buffer = "", inside = false;
    return {
        push(chunk: string): string {
            buffer += chunk;
            let out = "";
            for (;;) {
                const tag = inside ? "</float_state>" : "<float_state>", index = buffer.indexOf(tag);
                if (index >= 0) { if (!inside) out += buffer.slice(0, index); buffer = buffer.slice(index + tag.length); inside = !inside; continue; }
                let hold = 0;
                for (let length = 1; length < tag.length; length++) if (buffer.endsWith(tag.slice(0, length))) hold = length;
                if (!inside) out += buffer.slice(0, buffer.length - hold);
                buffer = hold ? buffer.slice(-hold) : "";
                return out;
            }
        },
        flush(): string { const out = inside ? "" : buffer; buffer = ""; return out; },
    };
}
