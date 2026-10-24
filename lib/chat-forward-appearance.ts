import type { CSSProperties } from "react";
import type { ForwardedEntry } from "./chat-forward-types";

const properties = {
    "--bubble-text-ink":"--bubble-text-ink","--voice-ink":"--voice-ink","--bubble-surface-color":"--bubble-surface-color","--bubble-surface-opacity":"--bubble-surface-opacity","--im26-base-blue":"--im26-base-blue","--im26-base-incoming":"--im26-base-incoming",
    background: "background", color: "color", borderRadius: "border-radius", border: "border", boxShadow: "box-shadow",
    backdropFilter: "backdrop-filter", WebkitBackdropFilter: "-webkit-backdrop-filter", padding: "padding",
    fontSize: "font-size", lineHeight: "line-height", fontWeight: "font-weight", letterSpacing: "letter-spacing",
    WebkitMaskBoxImage: "-webkit-mask-box-image", maskBorder: "mask-border",
} as const;

/** Only visual properties cross the snapshot boundary; never copy arbitrary styles or HTML. */
export function forwardedStyle(value?: Record<string, string>): CSSProperties {
    const out: Record<string, string> = {};
    for (const key of Object.keys(properties)) {
        const item = value?.[key];
        if (typeof item === "string" && item.length <= 4096) out[key] = item;
    }
    return out as CSSProperties;
}

export function captureForwardedStickerUrl(messageId: string): string | undefined {
    if(typeof document === "undefined")return undefined;
    return document.getElementById("message-"+messageId)?.querySelector<HTMLImageElement>(".chat-sticker img")?.src;
}

export function captureForwardedDisplayText(messageId: string): string | undefined {
    if (typeof document === "undefined") return undefined;
    const bubble = document.getElementById("message-" + messageId)?.querySelector<HTMLElement>("[data-msg-id]");
    return bubble?.innerText;
}

export function captureForwardedTheme(messageId: string) {
    if (typeof document === "undefined") return undefined;
    const room = document.getElementById("message-" + messageId)?.closest<HTMLElement>(".chat-room-wrapper");
    if (!room) return undefined;
    const sample = (role: string) => {
        const bubble = room.querySelector(`[data-ui="bubble-${role}"][data-msg-id]`);
        const id = bubble?.closest(".chat-msg-wrapper")?.id.replace(/^message-/, "");
        return id ? captureForwardedAppearance(id) : undefined;
    };
    return { preset: room.dataset.beautyPreset as "classic" | "glass" | undefined, dark: room.hasAttribute("data-chat-dark"), width: Math.min(480, Math.max(280, room.clientWidth)), ink: getComputedStyle(room).getPropertyValue("--im26-ink").trim() || "#050505", background: getComputedStyle(room).getPropertyValue("--im26-page").trim() || "#fff", self: sample("user"), other: sample("bot") };
}

export function captureForwardedAppearance(messageId: string): ForwardedEntry["appearance"] {
    if (typeof document === "undefined") return undefined;
    const wrapper = document.getElementById("message-" + messageId);
    const bubble = wrapper?.querySelector<HTMLElement>("[data-msg-id]");
    if (!bubble || !bubble.getClientRects().length) return undefined;
    const read = (element: Element) => {
        const computed = getComputedStyle(element), out: Record<string, string> = {};
        for (const [key, css] of Object.entries(properties)) {
            let value = computed.getPropertyValue(css).trim();
            // Keep bundled bubble masks portable across local and private deployments.
            if (key === "WebkitMaskBoxImage" || key === "maskBorder") value = value.replace(/url\(["']?[^)"']*[\/]([^/"')]+\.svg(?:\?[^"')]+)?)["']?\)/g, 'url("/$1")');
            if (value && value.length <= 4096) out[key] = value;
        }
        return out;
    };
    const surface = bubble.querySelector(":scope > .imessage-bubble-surface");
    const voice = bubble.querySelector(".voice-msg-bubble");
    return { bubble: read(bubble), ...(surface ? { surface: read(surface) } : {}),
        ...(voice ? { voiceInk: getComputedStyle(voice).color } : {}),
        voiceTextVisible: !!wrapper?.querySelector(".voice-msg-text-bubble") };
}
