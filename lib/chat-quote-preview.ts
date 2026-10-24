import type { ChatMessage } from "./chat-storage";
import { splitBilingualText } from "./bilingual-text";
import { currencySymbol, normalizeCurrency } from "./exchange-rates";

/** Keep only the language actually quoted, never the raw `original | translation` protocol. */
export function normalizeQuotePreviewText(value: string): string {
    const text = value.trim();
    if (!text) return "";
    return splitBilingualText(text, { allowUnchangedTranslation: true })?.original || text;
}

function formatQuoteAmount(value: unknown): string {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "";
    return amount.toLocaleString("zh-CN", {
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
    });
}

/** Copy readable content, not media URLs or an empty content field. */
export function getQuotePreview(message: ChatMessage): string {
    if (message.listeningContext?.reference) {
        const { title, reference } = message.listeningContext;
        return `${title} · ${reference.text}`;
    }
    const d = message.mediaData;
    if (d?.photoGroupId && (d.photoGroupCount || 0) > 1) {
        const index = Math.max(0, Math.min((d.photoGroupCount || 1) - 1, d.photoGroupActiveIndex ?? 0));
        const label = d.photoGroupLeadLabel?.trim() || d.label?.trim() || "照片";
        return `照片组 ${index + 1} / ${d.photoGroupCount}：${label}`;
    }
    const text = normalizeQuotePreviewText(d?.label || message.content || "");
    const labeled = (kind: string, value = text) => value ? `${kind}：${value}` : `${kind}消息`;
    switch (message.mediaType) {
        case "audio": return labeled("语音", (message.content || d?.label || d?.synthesizedFromText || "").trim());
        case "transfer": {
            const currency = normalizeCurrency(d?.currency);
            const amountText = formatQuoteAmount(d?.amount);
            const amount = amountText ? `${currencySymbol(currency)}${amountText}` : "";
            return labeled("转账", [amount, text].filter(Boolean).join(" · "));
        }
        case "red_packet": {
            const amountText = formatQuoteAmount(d?.amount);
            const amount = amountText ? `¥${amountText}` : "";
            return labeled("红包", [amount, text].filter(Boolean).join(" · "));
        }
        case "gift": return labeled("礼物", [d?.giftName, text].filter((value, index, values) => value && values.indexOf(value) === index).join(" · "));
        case "image": return labeled("图片");
        case "sticker": return labeled("表情包");
        case "location": return labeled("位置");
        case "contact_card": return labeled("名片", d?.contactCardName || text);
        case "app_card": return labeled("卡片", [d?.appCardTitle, d?.appCardSummary || d?.appCardBody || text].filter(Boolean).join(" · "));
        case "music":
        case "music_share": return labeled("音乐", [d?.musicTitle, d?.musicArtist].filter(Boolean).join(" — ") || text);
        case "media_file": return labeled("文件", d?.fileName || text);
        default: return text || "消息";
    }
}
