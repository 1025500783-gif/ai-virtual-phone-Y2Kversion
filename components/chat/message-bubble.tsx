"use client";
import { voiceDisplayText, voicePlaybackText } from "@/lib/voice-expression";
import { LyricShareCard } from "@/components/music/lyric-share-card";
import { ListeningInviteCard } from "./listening-invite-card";
import { getCurrentIdentityId } from "@/lib/identity-runtime";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { VoiceReferenceGraphic } from "./voice-reference-graphic";
import { PhotoMarkupEditor } from "./photo-markup-editor";

import { useState, useEffect, useCallback, useRef, useMemo, memo, type ReactNode } from "react";
import rough from "roughjs/bin/rough";
import { findCustomStickerByName, resolveCustomStickerUrl } from "@/lib/custom-sticker-storage";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { ChatMessage, createOrGetSession, loadChatMessages, updateMessageMediaStatus, updateMessageMediaData, type ChatPhotoAnnotation, type ChatPhotoGroupItem } from "@/lib/chat-storage";
import { resolveContactCard } from "@/lib/contact-card";
import { loadInteractableCharacters as loadCharacters } from "@/lib/character-storage";
import { CHAT_OPEN_SESSION_EVENT, dispatchOpenAddContact } from "@/lib/chat-notification-events";
import { ContactCardGenerateFlow } from "@/components/chat/contact-card-generate-flow";
import { MediaPreviewOverlay } from "@/components/chat/media-preview-overlay";
import { findStickerByName } from "@/lib/sticker-data";
import { splitBilingualText, containsChinese } from "@/lib/bilingual-text";
import { normalizeChatTextLayout } from "@/lib/chat-text-layout";
import { isInvisibleOrWhitespaceOnly } from "@/lib/rich-message-parser";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { createPortal } from "react-dom";
import { Blocks, Maximize2, ReceiptText, ChevronLeft } from "lucide-react";
import { retryChatGeneratedImage } from "@/lib/generated-image-retry";
import { GeneratedImageErrorDialog } from "./generated-image-error-dialog";
import { ScanPayCard } from "@/components/chat/scan-pay-card";
import { payWithWalletBalance, loadWalletState, WALLET_UPDATED_EVENT } from "@/lib/wallet-storage";
import { formatShoppingPaymentRequestHistory } from "@/lib/shopping-payment-request";
import { toCustomAppIconId } from "@/lib/custom-app-types";
import { ChatPluginSlot } from "@/components/chat/chat-plugin-slot";
import { CHAT_PLUGIN_SLOTS_CHANGED_EVENT, getChatPluginRuntime } from "@/lib/chat-plugin-runtime";
import { IMessageTapbackBadge } from "./imessage-tapback-badge";
import { ApplePayBrand } from "./apple-pay-brand";
import { currencySymbol, normalizeCurrency, fetchExchangeRate, cnyAmount } from "@/lib/exchange-rates";
import { LocationCard } from "./location-map";
import { getQuotePreview, normalizeQuotePreviewText } from "@/lib/chat-quote-preview";

interface MessageBubbleProps {
    quoteSource?: ChatMessage;
    quoteSourceStyle?: React.CSSProperties;
    replyAccessory?: ReactNode;
    msg: ChatMessage;
    onUpdate?: (updated: ChatMessage) => void;
    onPhotoAnnotationsSave?: (target: ChatMessage, annotations: ChatPhotoAnnotation[], previous: ChatPhotoAnnotation[]) => void;
    charName?: string;
    userName?: string;
    onSystemMessage?: (text: string) => void;
    groupSize?: number;
    onShowDetail?: (msg: ChatMessage) => void;
    characterId?: string;
    onMusicPlay?: (title: string, artist?: string, track?: import("@/lib/music-storage").MusicTrack) => void;
    onActionSelect?: (text: string) => void;
    displayContent?: string;
    defaultTranslationExpanded?: boolean;
    reactionStyleForActor?: (actorId: string) => React.CSSProperties | undefined;
}

/** 聊天插件自定义消息气泡：把裸 DOM 容器交给注册了该 kind 的插件渲染 */
function PluginKindBubble({ msg, kind }: { msg: ChatMessage; kind: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [slotVersion, setSlotVersion] = useState(0);

    useEffect(() => {
        const bump = () => setSlotVersion(v => v + 1);
        window.addEventListener(CHAT_PLUGIN_SLOTS_CHANGED_EVENT, bump);
        return () => window.removeEventListener(CHAT_PLUGIN_SLOTS_CHANGED_EVENT, bump);
    }, []);

    const registration = getChatPluginRuntime().getMessageKindRenderer(kind);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !registration) return;
        let cleanup: (() => void) | void;
        try {
            cleanup = registration.renderer(el, msg);
        } catch { /* 渲染失败按占位处理 */ }
        return () => {
            try { if (typeof cleanup === "function") cleanup(); } catch { /* ignore */ }
            el.replaceChildren();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registration, slotVersion, msg.id, msg.content, msg.mediaData]);

    if (!registration) {
        return (
            <div className="bubble bubble-text opacity-60">
                <span className="ts-12">[插件消息：{kind}]（对应插件未启用）</span>
            </div>
        );
    }
    return <div ref={containerRef} data-chat-plugin-kind={kind} />;
}

/**
 * Renders a message bubble based on its mediaType.
 * Falls back to ReactMarkdown for plain text messages.
 */
export const MessageBubble = memo(function MessageBubble({ msg, onUpdate, onPhotoAnnotationsSave, charName, userName, onSystemMessage, groupSize, onShowDetail, characterId, onMusicPlay, onActionSelect, displayContent, replyAccessory, quoteSource, quoteSourceStyle, defaultTranslationExpanded = false, reactionStyleForActor }: MessageBubbleProps) {
    switch (msg.mediaType) {
        case "listening_invite":
            return <ListeningInviteCard msg={msg} />;
        case "red_packet":
            return <RedPacketBubble msg={msg} charName={charName} userName={userName} groupSize={groupSize} onShowDetail={onShowDetail} />;
        case "transfer":
            return <TransferBubble msg={msg} charName={charName} userName={userName} onShowDetail={onShowDetail} />;
        case "gift":
            return <GiftBubble msg={msg} />;
        case "contact_card":
            return <ContactCardBubble msg={msg} characterId={characterId} />;
        case "payment_request":
            return <PaymentRequestBubble msg={msg} charName={charName} userName={userName} onShowDetail={onShowDetail} />;
        case "app_card":
            return <AppCardBubble msg={msg} characterId={characterId} characterName={msg.senderName || charName} />;
        case "image":
            return <ImageBubble msg={msg} onUpdate={onUpdate} onPhotoAnnotationsSave={onPhotoAnnotationsSave} characterId={characterId} reactionStyleForActor={reactionStyleForActor} />;
        case "location":
            return <LocationBubble msg={msg} />;
        case "poke":
            return <PokeBubble msg={msg} charName={charName} userName={userName} />;
        case "sticker":
            return <StickerBubble msg={msg} characterId={characterId} />;
        case "dice":
            return <DiceBubble msg={msg} />;
        case "quote":
            return <QuoteBubble msg={msg} displayContent={displayContent} replyAccessory={replyAccessory} quoteSource={quoteSource} quoteSourceStyle={quoteSourceStyle} defaultTranslationExpanded={defaultTranslationExpanded} reactionStyleForActor={reactionStyleForActor} />;
        case "music_share":
            return <div className="chat-music-share-with-caption">
                <MusicShareBubble msg={msg} onPlay={onMusicPlay} />
                {msg.content.trim() && <div className={`chat-bubble rounded-md chat-music-share-caption chat-bubble-role-${msg.role}`} data-media-type="text" data-ui={msg.role === "user" ? "bubble-user" : "bubble-bot"}>
                    <span className="imessage-bubble-surface" aria-hidden="true" />
                    <TextBubble content={displayContent ?? msg.content} onActionSelect={onActionSelect} defaultTranslationExpanded={defaultTranslationExpanded} chatText={msg.role === "assistant"} />
                </div>}
            </div>;
        case "media_file":
            return msg.mediaData?.photoGroupId
                ? <ImageBubble msg={msg} onUpdate={onUpdate} onPhotoAnnotationsSave={onPhotoAnnotationsSave} characterId={characterId} reactionStyleForActor={reactionStyleForActor} />
                : <MediaFileBubble msg={msg} onUpdate={onUpdate} characterId={characterId} />;
        case "xiaohongshu_note_share":
            return <XiaohongshuShareBubble msg={msg} />;
        case "audio":
            return <VoiceMessageBubble msg={msg} characterId={characterId} onUpdate={onUpdate} defaultTranslationExpanded={defaultTranslationExpanded} />;
        default: {
            // 聊天插件自定义消息类型：mediaType = "plugin:<kind>"，由注册插件渲染
            if (msg.mediaType?.startsWith("plugin:")) {
                return <PluginKindBubble msg={msg} kind={msg.mediaType.slice("plugin:".length)} />;
            }
            const textBubble = <TextBubble content={displayContent ?? msg.content} onActionSelect={onActionSelect} defaultTranslationExpanded={defaultTranslationExpanded} chatText={msg.role === "assistant"} />;
            return (
                <>
                    {textBubble}
                    <ChatPluginSlot name="message.footer" slotProps={{ sessionId: msg.sessionId, message: msg }} className="chat-plugin-message-footer" />
                </>
            );
        }
    }
}, (prev, next) => {
    // Skip function props (onUpdate, onSystemMessage, onShowDetail) — they're inline and always new
    if (prev.msg !== next.msg) {
        if (prev.msg.id !== next.msg.id) return false;
        if (prev.msg.content !== next.msg.content) return false;
        if (prev.msg.mediaType !== next.msg.mediaType) return false;
        if (prev.msg.isRetracted !== next.msg.isRetracted) return false;
        if (prev.msg.isTyping !== next.msg.isTyping) return false;
        if (prev.msg.mediaData?.status !== next.msg.mediaData?.status) return false;
        if (prev.msg.mediaData?.label !== next.msg.mediaData?.label) return false;
        if (prev.msg.mediaData?.musicTrack !== next.msg.mediaData?.musicTrack || prev.msg.mediaData?.musicResolution !== next.msg.mediaData?.musicResolution || prev.msg.mediaData?.musicArtist !== next.msg.mediaData?.musicArtist || prev.msg.mediaData?.musicTitle !== next.msg.mediaData?.musicTitle) return false;
        if (prev.msg.mediaData?.claimedBy?.length !== next.msg.mediaData?.claimedBy?.length) return false;
        if (prev.msg.mediaData?.appName !== next.msg.mediaData?.appName) return false;
        if (prev.msg.mediaData?.appCardTitle !== next.msg.mediaData?.appCardTitle) return false;
        if (prev.msg.mediaData?.appCardBody !== next.msg.mediaData?.appCardBody) return false;
        if (prev.msg.mediaData?.appCardLayout !== next.msg.mediaData?.appCardLayout) return false;
        if (prev.msg.mediaData?.imageGenerationPrompt !== next.msg.mediaData?.imageGenerationPrompt) return false;
        if (prev.msg.mediaData?.imageGenerationStatus !== next.msg.mediaData?.imageGenerationStatus) return false;
        if (prev.msg.mediaData?.imageGenerationError !== next.msg.mediaData?.imageGenerationError) return false;
        if (prev.msg.mediaData?.photoGroupItems?.length !== next.msg.mediaData?.photoGroupItems?.length) return false;
        if (prev.msg.mediaData?.photoGroupActiveIndex !== next.msg.mediaData?.photoGroupActiveIndex) return false;
        if (prev.msg.mediaData?.photoGroupItems?.some((item, index) => {
            const nextItem = next.msg.mediaData?.photoGroupItems?.[index];
            return !nextItem || item.mediaUrl !== nextItem.mediaUrl || item.label !== nextItem.label || JSON.stringify(item.annotations) !== JSON.stringify(nextItem.annotations) || item.tapback !== nextItem.tapback || item.tapbackBy !== nextItem.tapbackBy || JSON.stringify(item.tapbacks) !== JSON.stringify(nextItem.tapbacks);
        })) return false;
        if (prev.msg.mediaData?.photoAnnotations?.length !== next.msg.mediaData?.photoAnnotations?.length) return false;
        if (prev.msg.mediaUrl !== next.msg.mediaUrl) return false;
    }
    if (prev.charName !== next.charName) return false;
    if (prev.userName !== next.userName) return false;
    if (prev.groupSize !== next.groupSize) return false;
    if (prev.characterId !== next.characterId) return false;
    if (prev.displayContent !== next.displayContent) return false;
    if (prev.defaultTranslationExpanded !== next.defaultTranslationExpanded) return false;
    if (prev.reactionStyleForActor !== next.reactionStyleForActor) return false;
    return true;
});

// ── Text Bubble (default) ─────────────────────────────

function extractStyles(text: string): { styles: string; body: string } {
    const styleBlocks: string[] = [];
    const body = text.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
        styleBlocks.push(css);
        return "";
    });
    return { styles: styleBlocks.join("\n"), body };
}

/** Split text into markdown segments and ```html blocks */
function splitChatContent(text: string): { type: "md" | "html"; content: string }[] {
    const segments: { type: "md" | "html"; content: string }[] = [];
    const rx = /```html\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index).trim();
        if (before) segments.push({ type: "md", content: before });
        const html = match[1].trim();
        if (html) segments.push({ type: "html", content: html });
        lastIndex = match.index + match[0].length;
    }
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "md", content: remaining });
    return segments;
}

export function normalizeTextBubbleContent(content: string): string {
    const cleaned = content
        .replace(/\[音乐(?:分享)?(?:[：:][^\]]*)?\]/g, "")
        .replace(/\[[^\]]+拍了拍[^\]]+\]/g, "")
        .replace(/\[[^\]]*?(?:获取指令|获取工具)[:：][^\]]*\]/g, "")
        .replace(/\[[^\]]*?(?:执行动作|工具调用)[:：][^\]]*?[（(][\s\S]*?[)）]\]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    // 只剩零宽字符/BOM 等不可见内容时按空处理，否则会渲染出一个空气泡
    //（也让历史脏数据在显示层直接被隐藏）
    return isInvisibleOrWhitespaceOnly(cleaned) ? "" : cleaned;
}

export function isStandaloneHtmlPreviewContent(content: string): boolean {
    const cleaned = normalizeTextBubbleContent(content);
    if (!cleaned) return false;

    const strippedCodeBlocks = cleaned.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
    if (/^\s*</.test(strippedCodeBlocks)
        && /<script\b[\s\S]*?<\/script>/i.test(strippedCodeBlocks)
        && /<style\b[\s\S]*?<\/style>/i.test(strippedCodeBlocks)) {
        return true;
    }

    const segments = splitChatContent(cleaned);
    return segments.length === 1 && segments[0].type === "html";
}

/** Full-screen iframe modal for interactive HTML content */
function HtmlFullscreenModal({ html, onClose, onActionSelect }: { html: string; onClose: () => void; onActionSelect?: (text: string) => void }) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

    useEffect(() => {
        setPortalTarget(document.querySelector<HTMLElement>(".phone-shell"));
    }, []);

    const srcDoc = useMemo(() => {
        // Inject: action communication only — let AI's HTML render as-is
        const inject = `<script>(function(){
            document.addEventListener("click",function(e){
                var t=e.target.closest("[data-action]");
                if(t){e.preventDefault();window.parent.postMessage({type:"_chat_action",text:t.getAttribute("data-action")},"*");return}
                var target=e.target;
                var interactive=target.closest("a,button,input,textarea,select,summary,label,[role='button']");
                var rect=target.getBoundingClientRect&&target.getBoundingClientRect();
                var backdrop=rect&&rect.width>=window.innerWidth*0.9&&rect.height>=window.innerHeight*0.9;
                if(!interactive&&(target===document.body||target===document.documentElement||backdrop)){
                    window.parent.postMessage({type:"_chat_close"},"*");
                }
            },true);
        })();<\/script>`;
        let h = html;
        if (h.includes("</body>")) h = h.replace("</body>", inject + "</body>");
        else h = h + inject;
        return h;
    }, [html]);

    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== "object") return;
            if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
            if (e.data.type === "_chat_action" && typeof e.data.text === "string") {
                onActionSelect?.(e.data.text);
            }
            if (e.data.type === "_chat_close") {
                onClose();
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [onActionSelect, onClose]);

    if (!portalTarget) return null;

    return createPortal(
        <div className="chat-html-overlay" onClick={onClose}>
            <iframe
                ref={iframeRef}
                srcDoc={srcDoc}
                onClick={(e) => e.stopPropagation()}
            />
        </div>,
        portalTarget
    );
}

function buildChatHtmlDocument(html: string, inline = false): string {
    const action = `document.addEventListener("click",function(e){
                var t=e.target.closest("[data-action]");
                if(t){e.preventDefault();window.parent.postMessage({type:"_chat_action",text:t.getAttribute("data-action")},"*")}
            },true);`;
    // 只量 body，绝不掺 documentElement.scrollHeight：后者至少等于 iframe 视口高，
    // 而视口高就是父层刚设下去的 iframe 高度——量到的是自己，于是高度只涨不缩，
    // 内容收起后卡片底下会留一大片空白。body 的高度是内容撑出来的，可涨可缩。
    const resize = inline ? `
            var n=0;
            var send=function(){
                if(n>=12)return;
                n++;
                var b=document.body;
                if(!b)return;
                var h=Math.max(Math.ceil(b.getBoundingClientRect().height),b.scrollHeight||0,80);
                window.parent.postMessage({type:"_chat_inline_html_resize",h:h},"*");
            };
            window.addEventListener("load",send);
            if(window.ResizeObserver&&document.body){new ResizeObserver(function(){n=0;send();}).observe(document.body);}
            document.addEventListener("toggle",function(){n=0;setTimeout(send,50);},true);
            setTimeout(send,300);
            setTimeout(send,1200);
            setTimeout(send,2500);` : "";
    const inject = `<script>(function(){${action}${resize}})();<\/script>`;
    if (html.includes("</body>")) return html.replace("</body>", inject + "</body>");
    return html + inject;
}

type ChatHtmlFrameVariant = "default" | "offline";

function ChatHtmlInlineFrame({
    html,
    onActionSelect,
    variant = "default",
}: {
    html: string;
    onActionSelect?: (text: string) => void;
    variant?: ChatHtmlFrameVariant;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(240);
    const [expanded, setExpanded] = useState(false);
    const allowFullscreen = variant !== "offline";
    const srcDoc = useMemo(() => buildChatHtmlDocument(html, true), [html]);

    useEffect(() => {
        setHeight(240);
    }, [srcDoc]);

    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== "object") return;
            if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
            if (e.data.type === "_chat_inline_html_resize" && typeof e.data.h === "number") {
                setHeight(Math.max(80, Math.ceil(e.data.h)));
            }
            if (e.data.type === "_chat_action" && typeof e.data.text === "string") {
                onActionSelect?.(e.data.text);
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [onActionSelect]);

    return (
        <div className="chat-html-inline" data-chat-html-inline="" data-variant={variant}>
            <iframe
                ref={iframeRef}
                className="chat-html-inline-frame"
                srcDoc={srcDoc}
                title="AI 生成互动内容"
                style={{ height }}
            />
            {allowFullscreen ? (
                <button
                    type="button"
                    className="chat-html-inline-expand"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(true);
                    }}
                    aria-label="全屏查看"
                    title="全屏查看"
                >
                    <Maximize2 size={14} aria-hidden="true" />
                </button>
            ) : null}
            {allowFullscreen && expanded && (
                <HtmlFullscreenModal
                    html={html}
                    onClose={() => setExpanded(false)}
                    onActionSelect={onActionSelect}
                />
            )}
        </div>
    );
}

/** Inline renderer for ```html blocks, with a fullscreen escape hatch. */
function HtmlPreviewCard({
    html,
    onActionSelect,
    htmlFrameVariant,
}: {
    html: string;
    onActionSelect?: (text: string) => void;
    htmlFrameVariant?: ChatHtmlFrameVariant;
}) {
    return <ChatHtmlInlineFrame html={html} onActionSelect={onActionSelect} variant={htmlFrameVariant} />;
}

function mapMarkdownOutsideCode(text: string, mapper: (segment: string) => string): string {
    const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    return parts.map(part => part.startsWith("`") ? part : mapper(part)).join("");
}

/**
 * 浏览器无法直接打开的支付类 scheme（微信 Native 扫码付、支付宝等）。
 * 命中后在气泡里渲染 ScanPayCard（二维码 + 在钱包中打开 + 复制），并从正文里剥掉这串。
 */
const PAY_SCHEME_RE = /(?:weixin|wechat|alipays|alipay):\/\/[^\s<>"'`)\]，。！？、；]+/gi;

function extractPaySchemeUrls(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of text.matchAll(PAY_SCHEME_RE)) {
        if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
    }
    return out;
}

function stripPaySchemeUrls(text: string): string {
    // 连同包裹的反引号（行内代码）一起剥掉，避免残留 ``
    return text
        .replace(/`*\s*(?:weixin|wechat|alipays|alipay):\/\/[^\s<>"'`)\]，。！？、；]+\s*`*/gi, "")
        .replace(/[ \t]{2,}/g, " ");
}

/**
 * 台词包裹：渲染前把引号内的对话包进 <q> 标签，
 * 让自定义 CSS 可以用 `q { ... }` 单独给台词上样式。
 * - 只处理代码块/行内代码之外的文本
 * - 跳过 HTML 标签内部，避免命中属性里的引号
 * - 支持中文弯引号 “…”、直角引号 「…」、英文直引号 "…"（同一行内成对才包）
 * - 默认无视觉变化（chat.css 已关掉 q 的浏览器默认引号），仅当用户 CSS 写了 q {} 才生效
 */
function wrapQuotedDialogue(text: string): string {
    return mapMarkdownOutsideCode(text, segment =>
        segment.split(/(<[^>]*>)/g).map(part => {
            if (part.startsWith("<")) return part;
            return part
                .replace(/“([^”\n]+)”/g, "<q>“$1”</q>")
                .replace(/「([^」\n]+)」/g, "<q>「$1」</q>")
                .replace(/"([^"\n]+)"/g, "<q>\"$1\"</q>");
        }).join(""),
    );
}

function linkifyBareUrls(text: string): string {
    return mapMarkdownOutsideCode(text, segment => {
        const normalized = segment.replace(
            /https?:\/\/[^\s<>"'`]+(?:\s*[?&]\s*[^\s<>"'`]+)*/g,
            match => match.replace(/\s+/g, ""),
        );
        return normalized.replace(/https?:\/\/[^\s<>"'`()[\]]+/g, (url, offset, source) => {
            const prev = source[offset - 1];
            if (prev === "[" || prev === "(" || prev === "<" || prev === "=" || prev === "\"" || prev === "'") return url;

            const trailing = url.match(/[),.;!?，。！？、]+$/)?.[0] || "";
            const href = trailing ? url.slice(0, -trailing.length) : url;
            return `[${href}](${href})${trailing}`;
        });
    });
}

const MARKDOWN_COMPONENTS = {
    p: ({ node, className, ...props }: any) => (
        <div
            className={["chat-markdown-paragraph", className].filter(Boolean).join(" ")}
            {...props}
        />
    ),
    li: ({ node, ...props }: any) => <li {...props} />,
    blockquote: ({ node, ...props }: any) => <blockquote {...props} />,
    table: ({ node, ...props }: any) => (
        <div className="chat-markdown-table-wrap">
            <table {...props} />
        </div>
    ),
    a: ({ node, ...props }: any) => <a className="chat-markdown-link" target="_blank" rel="noreferrer" {...props} />,
    user: ({ node, ...props }: any) => <span className="rm-user" {...props} />,
    prologue: ({ node, ...props }: any) => <div className="rm-prologue" {...props} />,
    profile: ({ node, ...props }: any) => <div className="rm-profile" {...props} />,
    branches: ({ node, ...props }: any) => <div className="rm-branches" {...props} />,
    content: ({ node, ...props }: any) => <div className="rm-content" {...props} />
} as any;

function MarkdownTextContent({
    content,
    onActionSelect,
    htmlFrameVariant,
}: {
    content: string;
    onActionSelect?: (text: string) => void;
    htmlFrameVariant?: ChatHtmlFrameVariant;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Action delegate for data-action clicks in inline HTML
    useEffect(() => {
        if (!onActionSelect) return;
        const el = containerRef.current;
        if (!el) return;
        const handler = (e: MouseEvent) => {
            const target = (e.target as HTMLElement).closest("[data-action]");
            if (target) {
                e.preventDefault();
                e.stopPropagation();
                const action = target.getAttribute("data-action");
                if (action) onActionSelect(action);
            }
        };
        el.addEventListener("click", handler, true);
        return () => el.removeEventListener("click", handler, true);
    }, [onActionSelect]);

    // Strip [音乐:xxx] and tool tags, collapse newlines
    const cleaned = normalizeTextBubbleContent(content);
    if (!cleaned) return null;

    // 支付类 scheme（微信扫码付 / 支付宝等）→ 渲染成支付卡片，从正文剥离原始串
    const payUrls = extractPaySchemeUrls(cleaned);

    // Auto-detect rich HTML (with <script> + <style>) that wasn't wrapped in ```html
    const strippedCodeBlocks = cleaned.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
    if (/^\s*</.test(strippedCodeBlocks)
        && /<script\b[\s\S]*?<\/script>/i.test(strippedCodeBlocks)
        && /<style\b[\s\S]*?<\/style>/i.test(strippedCodeBlocks)) {
        return <HtmlPreviewCard html={cleaned} onActionSelect={onActionSelect} htmlFrameVariant={htmlFrameVariant} />;
    }

    // FIRST: split out ```html blocks (before extractStyles, so HTML block styles aren't leaked)
    const segments = splitChatContent(cleaned);
    const hasHtmlBlocks = segments.some(s => s.type === "html");

    if (!hasHtmlBlocks) {
        // Simple path: pure markdown — extract styles only from non-html content
        const { styles, body } = extractStyles(cleaned);
        const mdCleaned = wrapQuotedDialogue(linkifyBareUrls(stripPaySchemeUrls(body.trim())));
        if (!mdCleaned && !styles && payUrls.length === 0) return null;
        return (
            <div className="chat-markdown hide-scrollbar break-words" ref={containerRef}>
                {styles && <style dangerouslySetInnerHTML={{ __html: styles }} />}
                {mdCleaned && (
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]} components={MARKDOWN_COMPONENTS}>
                        {mdCleaned}
                    </ReactMarkdown>
                )}
                {payUrls.map((u, i) => <ScanPayCard key={`pay-${i}`} url={u} />)}
            </div>
        );
    }

    // Mixed path: markdown + html blocks
    return (
        <div className="chat-markdown hide-scrollbar break-words" ref={containerRef}>
            {segments.map((seg, i) => {
                if (seg.type === "html") {
                    return <HtmlPreviewCard key={`html-${i}`} html={seg.content} onActionSelect={onActionSelect} htmlFrameVariant={htmlFrameVariant} />;
                }
                // Extract styles only from markdown segments (not from html blocks)
                const { styles, body } = extractStyles(seg.content);
                const mdContent = wrapQuotedDialogue(linkifyBareUrls(stripPaySchemeUrls(body.trim())));
                return (
                    <div key={`md-${i}`}>
                        {styles && <style dangerouslySetInnerHTML={{ __html: styles }} />}
                        {mdContent && (
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]} components={MARKDOWN_COMPONENTS}>
                                {mdContent}
                            </ReactMarkdown>
                        )}
                    </div>
                );
            })}
            {payUrls.map((u, i) => <ScanPayCard key={`pay-${i}`} url={u} />)}
        </div>
    );
}

function PlainTextContent({ content, className }: { content: string; className?: string }) {
    return (
        <div
            className={className ?? ""}
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word", maxWidth: "100%" }}
        >
            {content}
        </div>
    );
}

export const BilingualTextBlock = memo(function BilingualTextBlock({
    text,
    onActionSelect,
    mode = "markdown",
    className,
    defaultExpanded = false,
    htmlFrameVariant,
    chatText = false,
}: {
    text: string;
    onActionSelect?: (text: string) => void;
    mode?: "markdown" | "plain";
    className?: string;
    defaultExpanded?: boolean;
    htmlFrameVariant?: ChatHtmlFrameVariant;
    chatText?: boolean;
}) {
    const bilingual = splitBilingualText(text, { allowUnchangedTranslation: true });
    const [showTranslated, setShowTranslated] = useState(false);
    const [originalWidth, setOriginalWidth] = useState<number | null>(null);
    const originalRef = useRef<HTMLDivElement>(null);
    const translationPressRef = useRef<{ x: number; y: number; startedAt: number; moved: boolean } | null>(null);
    const suppressTranslationClickRef = useRef(false);
    useEffect(() => {
        setShowTranslated(false);
    }, [text]);
    useEffect(() => {
        if (!defaultExpanded || !originalRef.current) return;
        const element = originalRef.current;
        const measure = () => setOriginalWidth(Math.ceil(element.getBoundingClientRect().width));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [text, defaultExpanded]);
    const renderContent = (content: string, extraClass?: string) => {
        if (chatText) content = normalizeChatTextLayout(content);
        if (mode === "plain") return <PlainTextContent content={content} className={extraClass} />;
        return (
            <div className={extraClass}>
                <MarkdownTextContent content={content} onActionSelect={onActionSelect} htmlFrameVariant={htmlFrameVariant} />
            </div>
        );
    };

    if (!bilingual) {
        return renderContent(text, className);
    }

    // An explicit unchanged pair (e.g. Lars|Lars) preserves the original once.
    if (!containsChinese(bilingual.translated)) {
        return <div className="chat-bilingual-block" data-chat-text-layout="">
            <div className="chat-bilingual-section">{renderContent(bilingual.original, "chat-bilingual-content")}</div>
        </div>;
    }

    const toggleTranslation = (event: React.MouseEvent<HTMLDivElement>) => {
        if (defaultExpanded) return;
        if (suppressTranslationClickRef.current) {
            suppressTranslationClickRef.current = false;
            return;
        }
        const interactive = (event.target as HTMLElement).closest("a,button,input,textarea,select,[role='button']");
        if (interactive && interactive !== event.currentTarget && event.currentTarget.contains(interactive)) return;
        event.stopPropagation();
        setShowTranslated(value => !value);
    };

    return (
        <div
            className={`chat-bilingual-block ${defaultExpanded ? "chat-bilingual-block-auto" : "chat-bilingual-block-switch"} ${className ?? ""}`.trim()}
            data-chat-text-layout={chatText || undefined}
            onPointerDownCapture={event => {
                suppressTranslationClickRef.current = false;
                translationPressRef.current = { x: event.clientX, y: event.clientY, startedAt: event.timeStamp, moved: false };
            }}
            onPointerMoveCapture={event => {
                const press = translationPressRef.current;
                if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 8) press.moved = true;
            }}
            onPointerUpCapture={event => {
                const press = translationPressRef.current;
                suppressTranslationClickRef.current = Boolean(press && (press.moved || event.timeStamp - press.startedAt >= 500));
                translationPressRef.current = null;
                // WebKit can suppress click after the chat's pointerdown prevents default.
                if (event.pointerType === "touch" && !defaultExpanded && !suppressTranslationClickRef.current) {
                    const interactive = (event.target as HTMLElement).closest("a,button,input,textarea,select,[role='button']");
                    if (!interactive || interactive === event.currentTarget || !event.currentTarget.contains(interactive)) {
                        setShowTranslated(value => !value);
                        suppressTranslationClickRef.current = true;
                    }
                }
            }}
            onPointerCancelCapture={() => {
                translationPressRef.current = null;
                suppressTranslationClickRef.current = true;
            }}
            onClick={toggleTranslation}
            role={defaultExpanded ? undefined : "button"}
            tabIndex={defaultExpanded ? undefined : 0}
            aria-label={defaultExpanded ? undefined : (showTranslated ? "显示原文" : "显示译文")}
            onKeyDown={event => {
                if (defaultExpanded || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                setShowTranslated(value => !value);
            }}
        >
            {defaultExpanded ? <>
                <div ref={originalRef} className="chat-bilingual-section chat-bilingual-section-original">
                    {renderContent(bilingual.original, "chat-bilingual-content")}
                </div>
                <div className="chat-bilingual-divider" style={originalWidth ? { width: `${originalWidth}px` } : undefined} />
                <div className="chat-bilingual-section chat-bilingual-section-translation">
                    {renderContent(bilingual.translated, "chat-bilingual-content")}
                </div>
            </> : (
                <div className={`chat-bilingual-section ${showTranslated ? "chat-bilingual-section-translation" : "chat-bilingual-section-original"}`}>
                    {renderContent(showTranslated ? bilingual.translated : bilingual.original, "chat-bilingual-content")}
                </div>
            )}
        </div>
    );
});

function TextBubble({ content, onActionSelect, defaultTranslationExpanded = false, chatText = false }: { content: string; onActionSelect?: (text: string) => void; defaultTranslationExpanded?: boolean; chatText?: boolean }) {
    return <BilingualTextBlock text={content} onActionSelect={onActionSelect} mode="markdown" defaultExpanded={defaultTranslationExpanded} chatText={chatText} />;
}

// ── Red Packet ─────────────────────────────

function RedPacketBubble({ msg, charName, userName, groupSize, onShowDetail }: {
    msg: ChatMessage; charName?: string; userName?: string; groupSize?: number;
    onShowDetail?: (msg: ChatMessage) => void;
}) {
    const d = msg.mediaData;
    const isDeclined = d?.status === "declined";
    const claimedBy = d?.claimedBy || [];
    const claimedAmounts = d?.claimedAmounts || {};
    const totalRecipients = d?.count || 1;
    const allClaimed = d?.status === "opened" || claimedBy.length >= totalRecipients;
    const isDone = allClaimed || isDeclined;
    const userId = getCurrentIdentityId() ?? "";
    const names = [userName ?? "", ...(resolveUserIdentity()?.previousNames ?? [])];
    const userShare = d?.claimedAmountsByUserId?.[userId] ?? names.map(name => claimedAmounts[name]).find(amount => amount !== undefined);

    const bgClass = isDeclined
        ? "bg-declined-gradient"
        : isDone ? "bg-opened-gradient" : "bg-redpacket-gradient";

    return (
        <div
            className={`chat-red-packet-card w-[240px] rounded-xl overflow-hidden cursor-pointer ${!isDone ? "red-packet-pulse" : ""}`}
            onClick={() => onShowDetail?.(msg)}
        >
            <div className={`chat-red-packet-body p-4 flex items-center gap-3 min-h-[70px] ${bgClass}`}>
                <div className="ts-32 shrink-0">🧧</div>
                <div className="flex-1 min-w-0">
                    <div className="text-white ts-15 font-medium">
                        {d?.label || "恭喜发财，大吉大利"}
                    </div>
                    {userShare != null && (
                        <div className="ts-20 font-bold mt-1 ui-text-white-85">{currencySymbol(normalizeCurrency(d?.currency))}{userShare.toFixed(2)}</div>
                    )}
                    {isDeclined && <div className="ts-12 mt-1 ui-text-white-70">已退回</div>}
                </div>
            </div>
            <div className="ui-media-footer px-4 py-1.5 ts-11" {...(isDeclined ? { "data-status": "declined" } : {})}>
                <span>微信红包</span>
                {totalRecipients > 1 && claimedBy.length > 0 && (
                    <span className="ml-1 opacity-70">· {claimedBy.length}/{totalRecipients}已领取</span>
                )}
            </div>
        </div>
    );
}

// ── Transfer ─────────────────────────────

function formatApplePayAmount(value: unknown): string {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) return "0";
    return amount.toLocaleString("zh-CN", {
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
    });
}

function TransferBubble({ msg, charName, userName, onShowDetail }: {
    msg: ChatMessage; charName?: string; userName?: string;
    onShowDetail?: (msg: ChatMessage) => void;
}) {
    const d = msg.mediaData;
    const isReceived = d?.status === "received";
    const isDeclined = d?.status === "declined";

    const bgClass = isDeclined
        ? "bg-declined-gradient"
        : isReceived ? "bg-opened-gradient" : "bg-transfer-gradient";
    const amountText = formatApplePayAmount(d?.amount);
    const currency = normalizeCurrency(d?.currency);
    const symbol = currencySymbol(currency);
    const statusText = isReceived ? "已收款" : isDeclined ? "已拒绝" : "";

    return (
        <div
            className="chat-transfer-card w-[240px] rounded-xl overflow-hidden cursor-pointer"
            onClick={() => onShowDetail?.(msg)}
        >
            <div className="chat-transfer-legacy">
                <div className={`chat-transfer-body p-4 flex items-center gap-3 ${bgClass}`}>
                    <div className="ts-28 shrink-0">💰</div>
                    <div className="flex-1">
                        <div className="text-white ts-24 font-bold">{symbol}{d?.amount?.toFixed(2)} {currency}</div>
                        <div className="ts-13 mt-0.5 ui-text-white-85">{d?.label || "转账"}</div>
                    </div>
                </div>
                {d?.recipientName && (
                    <div className={`px-4 py-1 ts-12 ui-text-white-70 ${bgClass}`}>转给 {d.recipientName}</div>
                )}
                <div
                    className="ui-media-footer px-4 py-2 ts-12 flex justify-between items-center"
                    {...(isDeclined ? { "data-status": "declined" } : {})}
                >
                    <span>微信转账</span>
                    {isReceived && <span>已收款</span>}
                    {isDeclined && <span>已退回</span>}
                </div>
            </div>
            <div className="imessage-transfer-card hidden" aria-label={`Apple Pay 转账 ${currency} ${amountText}`}>
                <div className="imessage-transfer-main">
                    <ApplePayBrand />
                    <div className="imessage-transfer-amount">{symbol}{amountText}</div>
                </div>
                <div className="imessage-transfer-footer">
                    <span className="imessage-transfer-note">{d?.label || "转账"}</span>
                    {statusText && <span className="imessage-transfer-status">{statusText}</span>}
                </div>
            </div>
        </div>
    );
}

// ── Payment Request ─────────────────────────────

function PaymentRequestBubble({ msg, charName, userName, onShowDetail }: {
    msg: ChatMessage; charName?: string; userName?: string;
    onShowDetail?: (msg: ChatMessage) => void;
}) {
    const d = msg.mediaData;
    const status = d?.status;
    const isPaid = status === "paid";
    const isDeclined = status === "declined";
    const requester = msg.role === "user" ? (userName || "你") : (msg.senderName || charName || "对方");
    const amount = typeof d?.amount === "number" ? d.amount.toFixed(2) : d?.paymentRequestAmountLabel || "0.00";
    const itemsText = d?.paymentRequestItemsText || (d?.paymentRequestItems || [])
        .map(item => `${item.title}/${item.detail}/${item.priceLabel}/${item.quantityLabel}`)
        .join("; ");
    const statusText = isPaid ? "已代付" : isDeclined ? "已拒绝" : "待代付";

    return (
        <div
            className="chat-payment-request-card w-[248px] rounded-xl overflow-hidden cursor-pointer"
            onClick={() => onShowDetail?.(msg)}
        >
            <div className={`chat-payment-request-body p-4 flex items-start gap-3 ${isDeclined ? "bg-declined-gradient" : isPaid ? "bg-opened-gradient" : "bg-transfer-gradient"}`}>
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0 text-white">
                    <ReceiptText size={22} strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-white ts-12 ui-text-white-85">{requester}发起代付请求</div>
                    <div className="text-white ts-24 font-bold mt-1">{currencySymbol(normalizeCurrency(d?.currency))}{amount} {normalizeCurrency(d?.currency)}</div>
                    <div className="ts-12 mt-1 ui-text-white-85 line-clamp-2">{itemsText || "商品订单"}</div>
                </div>
            </div>
            <div
                className="ui-media-footer px-4 py-2 ts-12 flex justify-between items-center"
                {...(isDeclined ? { "data-status": "declined" } : {})}
            >
                <span>代付请求</span>
                <span>{statusText}</span>
            </div>
        </div>
    );
}

// ── Custom App Card ─────────────────────────────

function AppCardBubble({ msg, characterId, characterName }: { msg: ChatMessage; characterId?: string; characterName?: string }) {
    const d = msg.mediaData;
    const appName = d?.appName || "APP";
    const layout = normalizeAppCardLayout(d?.appCardLayout);
    const title = layout.title || d?.appCardTitle || d?.label || appName;
    const subtitle = layout.subtitle;
    const body = d?.appDirectiveId
        ? (layout.body || d?.appCardBody || "")
        : (layout.body || d?.appCardBody || d?.appCardSummary || msg.content);
    const toneClass = d?.appCardTone ? ` tone-${String(d.appCardTone).replace(/[^a-z0-9_-]/gi, "")}` : "";
    const cardOpenDisabled = layout.openDisabled || (layout.actions.length > 0 && layout.actions.every(action => action.disabled));
    const style = {
        ...(layout.accentColor ? { "--chat-app-card-accent": layout.accentColor } : {}),
        ...(layout.background ? { "--chat-app-card-bg": layout.background } : {}),
    } as React.CSSProperties;
    const openApp = () => {
        if (cardOpenDisabled) return;
        if (!d?.appId || typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("open-app", {
            detail: {
                appId: toCustomAppIconId(d.appId),
                launchContext: {
                    source: d.appDirectiveId ? "chat_directive" : "chat_card",
                    messageId: msg.id,
                    sessionId: msg.sessionId,
                    characterId,
                    characterName,
                    appId: d.appId,
                    appName: d.appName,
                    directiveId: d.appDirectiveId,
                    directiveLabel: d.appDirectiveLabel,
                    directiveArgs: d.appDirectiveArgs,
                    directiveRaw: d.appDirectiveRaw,
                    sceneId: d.appSceneId,
                    sceneTag: d.appSceneTag,
                    appTags: d.appTags,
                    historyText: d.appHistoryText || msg.content,
                    historyRole: d.appHistoryRole,
                    summary: d.appCardSummary || msg.content,
                },
            },
        }));
    };

    if (layout.html) {
        return (
            <div className={`chat-app-custom-card${toneClass}`} data-disabled={cardOpenDisabled || undefined} style={style} onClick={openApp}>
                <iframe
                    title={title}
                    className="chat-app-custom-card-frame"
                    sandbox=""
                    style={{ height: layout.height }}
                    srcDoc={buildAppCardSrcDoc(layout.html)}
                />
            </div>
        );
    }

    return (
        <div className={`chat-app-card${toneClass}`} data-disabled={cardOpenDisabled || undefined} style={style} onClick={openApp}>
            <div className="chat-app-card-head">
                <span className="chat-app-card-icon" aria-hidden>
                    <Blocks size={18} strokeWidth={2} />
                </span>
                <span className="chat-app-card-name">{layout.appLabel || appName}</span>
                {layout.status ? <span className="chat-app-card-status">{layout.status}</span> : null}
            </div>
            {layout.image ? <img className="chat-app-card-image" src={layout.image} alt="" /> : null}
            <div className="chat-app-card-title">{title}</div>
            {subtitle ? <div className="chat-app-card-subtitle">{subtitle}</div> : null}
            {body ? <div className="chat-app-card-body">{body}</div> : null}
            {layout.sections.length > 0 ? (
                <div className="chat-app-card-sections">
                    {layout.sections.map((section, index) => (
                        <div className="chat-app-card-section" key={`${section.title || "section"}-${index}`}>
                            {section.title ? <div className="chat-app-card-section-title">{section.title}</div> : null}
                            {section.text ? <div className="chat-app-card-section-text">{section.text}</div> : null}
                            {section.rows.length > 0 ? (
                                <div className="chat-app-card-rows">
                                    {section.rows.map((row, rowIndex) => (
                                        <div className="chat-app-card-row" key={`${row.label}-${rowIndex}`}>
                                            <span>{row.label}</span>
                                            <strong>{row.value}</strong>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {section.chips.length > 0 ? (
                                <div className="chat-app-card-chips">
                                    {section.chips.map((chip, chipIndex) => <span key={`${chip}-${chipIndex}`}>{chip}</span>)}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {layout.actions.length > 0 ? (
                <div className="chat-app-card-actions">
                    {layout.actions.map((action, index) => (
                        <button
                            type="button"
                            key={`${action.label}-${index}`}
                            data-style={action.style || "default"}
                            disabled={action.disabled}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (action.disabled) return;
                                openApp();
                            }}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

type NormalizedAppCardLayout = {
    appLabel: string;
    title: string;
    subtitle: string;
    body: string;
    html: string;
    height: number;
    status: string;
    image: string;
    accentColor: string;
    background: string;
    openDisabled: boolean;
    sections: Array<{
        title: string;
        text: string;
        rows: Array<{ label: string; value: string }>;
        chips: string[];
    }>;
    actions: Array<{ label: string; style: string; disabled: boolean }>;
};

function cardRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cardText(value: unknown, max = 240): string {
    return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cardTextArray(value: unknown, maxItems = 6): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => cardText(item, 80)).filter(Boolean).slice(0, maxItems);
}

function cardNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function stripAppCardExecutableHtml(html: string): string {
    return html
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
        .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
        .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
}

function buildAppCardSrcDoc(html: string): string {
    const safeHtml = stripAppCardExecutableHtml(html);
    if (/<html[\s>]/i.test(safeHtml)) return safeHtml;
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    *{box-sizing:border-box;}
  </style>
</head>
<body>${safeHtml}</body>
</html>`;
}

function normalizeAppCardLayout(value: unknown): NormalizedAppCardLayout {
    const record = cardRecord(value);
    const sections = Array.isArray(record.sections) ? record.sections : [];
    const rows = Array.isArray(record.rows) ? [{ title: record.rowsTitle, rows: record.rows }] : [];
    const normalizedSections = [...sections, ...rows].map(item => {
        const section = cardRecord(item);
        const sectionRows = Array.isArray(section.rows) ? section.rows : [];
        return {
            title: cardText(section.title, 80),
            text: cardText(section.text ?? section.body, 500),
            rows: sectionRows.map(row => {
                const rowRecord = cardRecord(row);
                return {
                    label: cardText(rowRecord.label ?? rowRecord.name, 80),
                    value: cardText(rowRecord.value ?? rowRecord.text, 160),
                };
            }).filter(row => row.label || row.value).slice(0, 8),
            chips: cardTextArray(section.chips ?? section.tags),
        };
    }).filter(section => section.title || section.text || section.rows.length || section.chips.length).slice(0, 6);
    const actions = Array.isArray(record.actions) ? record.actions : [];
    return {
        appLabel: cardText(record.appLabel, 60),
        title: cardText(record.title, 100),
        subtitle: cardText(record.subtitle, 160),
        body: cardText(record.body ?? record.text, 1000),
        html: cardText(record.html, 20000),
        height: cardNumber(record.height ?? record.cardHeight, 220, 96, 520),
        status: cardText(record.status, 60),
        image: cardText(record.image ?? record.imageUrl, 2000),
        accentColor: cardText(record.accentColor, 40),
        background: cardText(record.background, 120),
        openDisabled: record.openDisabled === true || record.clickDisabled === true || record.disabled === true || record.clickable === false,
        sections: normalizedSections,
        actions: actions.map(item => {
            const action = cardRecord(item);
            return {
                label: cardText(action.label ?? action.text, 40),
                style: cardText(action.style, 30),
                disabled: action.disabled === true || action.enabled === false,
            };
        }).filter(action => action.label).slice(0, 3),
    };
}

// ── Contact card（推荐联系人名片） ─────────────────────────────
// 三态：已好友（角标，点击开会话）/ 已建档未添加（点击跳添加页）/
// 未建档（点击进入现场生成档案流程——AI 幻觉转建档）。
// 名字实时按推荐人同世界解析，建档后所有同名旧名片自动可添加。

function ContactCardBubble({ msg, characterId }: { msg: ChatMessage; characterId?: string }) {
    const contactName = msg.mediaData?.contactCardName || msg.mediaData?.label || "";
    const [showGenerateFlow, setShowGenerateFlow] = useState(false);
    const [resolveTick, setResolveTick] = useState(0);

    const resolved = useMemo(
        () => (characterId && contactName ? resolveContactCard(characterId, contactName) : { character: null, isContact: false }),
        // resolveTick：建档完成后强制重新解析
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [characterId, contactName, resolveTick],
    );
    const recommenderName = useMemo(
        () => loadCharacters().find(c => c.id === characterId)?.name || "对方",
        [characterId],
    );

    function handleClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (!contactName) return;
        if (resolved.character && resolved.isContact) {
            // 已是好友：直接打开与 TA 的会话
            const session = createOrGetSession(resolved.character.id);
            window.dispatchEvent(new CustomEvent(CHAT_OPEN_SESSION_EVENT, { detail: { sessionId: session.id } }));
            return;
        }
        if (resolved.character) {
            // 已建档未添加：跳「添加朋友」页并预载资料
            dispatchOpenAddContact(resolved.character.id);
            return;
        }
        if (characterId) setShowGenerateFlow(true);
    }

    return (
        <>
            <div className="chat-contact-card" onClick={handleClick} role="button">
                <div className="chat-contact-card-main">
                    <div className="chat-contact-card-avatar">
                        {resolved.character?.avatar
                            ? <img src={resolved.character.avatar} alt="" />
                            : <CharAvatarFallbackInline name={contactName} />}
                    </div>
                    <div className="chat-contact-card-info">
                        <div className="chat-contact-card-name">{contactName || "联系人"}</div>
                        <div className="chat-contact-card-sub">
                            {resolved.character
                                ? `微信号: ${resolved.character.wechatID || resolved.character.id.slice(0, 10)}`
                                : "点击查看"}
                        </div>
                    </div>
                    {resolved.isContact && <span className="chat-contact-card-badge">已添加</span>}
                </div>
                <div className="chat-contact-card-footer">个人名片</div>
            </div>
            {showGenerateFlow && characterId && typeof document !== "undefined" && createPortal(
                <ContactCardGenerateFlow
                    recommenderCharacterId={characterId}
                    recommenderName={recommenderName}
                    contactName={contactName}
                    sessionId={msg.sessionId}
                    messageId={msg.id}
                    onClose={() => setShowGenerateFlow(false)}
                    onCreated={() => setResolveTick(t => t + 1)}
                />,
                document.body,
            )}
        </>
    );
}

/** 无头像时的首字占位（名片专用，避免依赖其它气泡的 fallback 组件） */
function CharAvatarFallbackInline({ name }: { name: string }) {
    return (
        <div className="chat-contact-card-avatar-fallback">
            {(name || "?").slice(0, 1)}
        </div>
    );
}

// ── Gift ─────────────────────────────

function GiftBubble({ msg }: { msg: ChatMessage }) {
    const d = msg.mediaData;
    const title = d?.giftName || d?.label || "礼物";
    const recipient = d?.recipientName;
    const merchant = d?.giftMerchantLabel || "购物订单";
    const serial = (d?.shoppingGiftId || d?.giftOrderId || msg.id || "gift")
        .replace(/[^a-z0-9]/gi, "")
        .slice(-6)
        .toUpperCase() || "GIFT01";
    const sentLabel = d?.giftSentAt
        ? new Date(d.giftSentAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "";

    return (
        <div
            className="chat-gift-card w-[248px] rounded-none"
        >
            <div
                className="chat-gift-card-body relative min-h-[338px] px-5 py-5"
            >
                <div className="relative z-[1] min-h-[298px] flex flex-col">
                    <div className="chat-gift-card-header flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="chat-gift-card-kicker ts-11 uppercase font-semibold tracking-normal text-[var(--c-icon)]">Gift Card</div>
                            <div className="chat-gift-card-source ts-12 text-[var(--c-text)] mt-1 truncate">{merchant}</div>
                        </div>
                        <div className="chat-gift-card-status ts-11 font-semibold px-2 py-1 shrink-0">
                            已送出
                        </div>
                    </div>

                    <div className="chat-gift-card-divider my-4 h-px" />

                    <div className="chat-gift-card-main min-h-[86px]">
                        <div className="min-w-0 flex-1">
                            <div className="chat-gift-card-label ts-10 uppercase font-semibold text-[var(--c-icon)]">Selected Gift</div>
                            <div className="chat-gift-card-title ts-24 font-semibold text-[var(--c-text-title)] leading-[1.12] break-words mt-1">
                                {title}
                            </div>
                        </div>
                    </div>

                    <div className="chat-gift-card-grid mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
                        {recipient && (
                            <GiftInfoCell label="收礼人" value={recipient} strong />
                        )}
                        <GiftInfoCell label="编号" value={`G-${serial}`} />
                        <GiftInfoCell label="来源" value={merchant} />
                        <GiftInfoCell label="礼物值" value={d?.giftPriceLabel || "心意礼物"} />
                        {sentLabel && <GiftInfoCell label="送出" value={sentLabel} />}
                    </div>

                    <div className="flex-1" />

                    <div className="chat-gift-card-footer mt-5 pt-3 flex items-center justify-between gap-3">
                        <div className="ts-10 uppercase font-semibold text-[var(--c-icon)]">Gift Certificate</div>
                        <div className="chat-gift-card-brand ts-10 font-semibold text-[var(--c-icon)]">AI PHONE</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function GiftInfoCell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="chat-gift-card-cell min-w-0">
            <div className="chat-gift-card-cell-label ts-10 text-[var(--c-icon)]">{label}</div>
            <div className={`chat-gift-card-cell-value ts-12 mt-1 leading-snug truncate ${strong ? "font-semibold text-[var(--c-text-title)]" : "text-[var(--c-text)]"}`}>
                {value}
            </div>
        </div>
    );
}

// ── Image (placeholder) ─────────────────────────────

function GeneratedImagePromptDialog({
    value,
    onChange,
    onCancel,
    onConfirm,
    busy,
    error,
}: {
    value: string;
    onChange: (value: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
    busy: boolean;
    error?: string;
}) {
    return (
        <div
            className="modal-overlay"
            data-ui="modal"
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onPointerCancel={e => e.stopPropagation()}
            onPointerMove={e => e.stopPropagation()}
            onContextMenu={e => e.stopPropagation()}
            onClick={e => {
                e.stopPropagation();
                onCancel();
            }}
        >
            <div className="modal-dialog chat-generated-image-prompt-dialog" data-ui="modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="modal-header" data-ui="modal-header">
                    <h3 className="modal-title">重新生成图片</h3>
                </div>
                <div className="modal-body chat-generated-image-prompt-body" data-ui="modal-body">
                    <textarea
                        className="ui-textarea chat-generated-image-prompt-textarea"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        placeholder="输入图片提示词"
                        disabled={busy}
                    />
                    {error && <div className="chat-generated-image-retry-error">{error}</div>}
                </div>
                <div className="modal-footer" data-ui="modal-footer">
                    <button className="ui-btn ui-btn-ghost" onClick={onCancel}>取消</button>
                    <button
                        className="ui-btn ui-btn-action"
                        disabled={busy || !value.trim()}
                        onClick={onConfirm}
                    >
                        生成
                    </button>
                </div>
            </div>
        </div>
    );
}

function RoughPhotoShape({ annotation }: { annotation: ChatPhotoAnnotation }) {
    const paths = useMemo(() => {
        if (!annotation.shape && !annotation.doodlePath) return [];
        const generator = rough.generator();
        const cx = (annotation.x ?? .5) * 1000;
        const cy = (annotation.y ?? .5) * 1000;
        const size = (annotation.size || .25) * 1000;
        const options = {
            stroke: annotation.color,
            strokeWidth: (annotation.width || .01) * 1000,
            roughness: annotation.roughness || 1.8,
            bowing: annotation.bowing || 1.25,
            seed: annotation.seed || 1,
            fill: annotation.fill || "none",
            fillStyle: "solid",
        };
        if (annotation.doodlePath) return generator.toPaths(generator.path(annotation.doodlePath, { ...options, strokeWidth: options.strokeWidth / 10, roughness: options.roughness / 10 }));
        let drawable;
        if (annotation.shape === "circle") drawable = generator.ellipse(cx, cy, size, size * .78, options);
        else if (annotation.shape === "box") drawable = generator.rectangle(cx - size / 2, cy - size * .38, size, size * .76, options);
        else if (annotation.shape === "underline") drawable = generator.line(cx - size / 2, cy, cx + size / 2, cy, options);
        else if (annotation.shape === "arrow") drawable = generator.path(`M ${cx - size / 2} ${cy + size * .25} L ${cx + size / 2} ${cy - size * .25} M ${cx + size / 2} ${cy - size * .25} L ${cx + size * .18} ${cy - size * .28} M ${cx + size / 2} ${cy - size * .25} L ${cx + size * .34} ${cy + size * .05}`, options);
        else if (annotation.shape === "heart") drawable = generator.path(`M ${cx} ${cy + size * .42} C ${cx - size * .58} ${cy + size * .06}, ${cx - size * .48} ${cy - size * .44}, ${cx} ${cy - size * .12} C ${cx + size * .48} ${cy - size * .44}, ${cx + size * .58} ${cy + size * .06}, ${cx} ${cy + size * .42}`, options);
        else drawable = generator.polygon(Array.from({ length: 10 }, (_, index) => {
            const radius = index % 2 ? size * .22 : size * .5;
            const angle = -Math.PI / 2 + index * Math.PI / 5;
            return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as [number, number];
        }), options);
        return generator.toPaths(drawable);
    }, [annotation]);
    const cx = (annotation.x ?? .5) * 1000;
    const cy = (annotation.y ?? .5) * 1000;
    return <g opacity={annotation.opacity ?? 1} transform={`rotate(${annotation.rotation || 0} ${cx} ${cy})${annotation.doodlePath ? " scale(10)" : ""}`}>
        {paths.map((path, index) => <path key={index} d={path.d} fill={path.fill || "none"} stroke={path.stroke} strokeWidth={path.strokeWidth} />)}
    </g>;
}

function PhotoAnnotationLayer({ annotations, selectedId }: { annotations?: ChatPhotoAnnotation[]; selectedId?: string | null }) {
    const layerRef = useRef<SVGSVGElement>(null);
    const [emojiAspect, setEmojiAspect] = useState(1);
    const hasMarks = Boolean(annotations?.length);
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        // Coordinates follow the photo; glyphs must retain equal physical X/Y scale.
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) setEmojiAspect(width / height);
        });
        observer.observe(layer);
        return () => observer.disconnect();
    }, [hasMarks]);
    if (!annotations?.length) return null;
    return (
        <svg ref={layerRef} className="chat-photo-annotation-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            {annotations.map(annotation => annotation.kind === "rough_shape" ? (
                <RoughPhotoShape key={annotation.id} annotation={annotation} />
            ) : annotation.kind === "emoji" && annotation.emoji ? (
                <g key={annotation.id} transform={`translate(${(annotation.x ?? .5) * 1000} ${(annotation.y ?? .5) * 1000}) scale(1 ${emojiAspect}) rotate(${annotation.rotation || 0})`}>
                    {selectedId === annotation.id && <circle
                        cx={0}
                        cy={0}
                        r={76 * (annotation.scale || 1)}
                        fill="none"
                        stroke="rgba(255,255,255,.92)"
                        strokeWidth="5"
                        strokeDasharray="14 10"
                    />}
                    <text
                        x={0}
                        y={0}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={120 * (annotation.scale || 1)}
                        fontFamily="Apple Color Emoji, Segoe UI Emoji, sans-serif"
                    >{annotation.emoji}</text>
                </g>
            ) : annotation.kind === "stroke" && annotation.points?.length ? (
                <g key={annotation.id}>
                    <polyline
                        points={Array.from({ length: Math.floor(annotation.points.length / 2) }, (_, index) => `${annotation.points![index * 2] * 1000},${annotation.points![index * 2 + 1] * 1000}`).join(" ")}
                        fill="none"
                        stroke={annotation.color}
                        strokeWidth={(annotation.width || 0.012) * 1000}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    {annotation.renderStyle === "handdrawn" && <polyline
                        points={Array.from({ length: Math.floor(annotation.points.length / 2) }, (_, index) => `${annotation.points![index * 2] * 1000},${annotation.points![index * 2 + 1] * 1000}`).join(" ")}
                        fill="none"
                        stroke={annotation.color}
                        strokeWidth={(annotation.width || 0.012) * 580}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity=".28"
                        transform="translate(2.2 1.4)"
                    />}
                </g>
            ) : annotation.kind === "text" && annotation.text ? (
                <text key={annotation.id} x={(annotation.x ?? 0.5) * 1000} y={(annotation.y ?? 0.5) * 1000} fill={annotation.color} fontSize="64" fontWeight="700" fontFamily="Segoe Print, Bradley Hand, Comic Sans MS, cursive" fontStyle="italic" paintOrder="stroke" stroke="rgba(0,0,0,.38)" strokeWidth="8" transform={`rotate(-3 ${(annotation.x ?? 0.5) * 1000} ${(annotation.y ?? 0.5) * 1000})`}>{annotation.text}</text>
            ) : null)}
        </svg>
    );
}

function PhotoAnnotationEditor(props: Omit<React.ComponentProps<typeof PhotoMarkupEditor>, "renderLayer">) {
    return <PhotoMarkupEditor {...props} renderLayer={(annotations, selectedId) => <PhotoAnnotationLayer annotations={annotations} selectedId={selectedId} />} />;
}

function PhotoGroupBubble({ msg, items, onUpdate, onPhotoAnnotationsSave, reactionStyleForActor }: { msg: ChatMessage; items: ChatPhotoGroupItem[]; onUpdate?: (updated: ChatMessage) => void; onPhotoAnnotationsSave?: MessageBubbleProps["onPhotoAnnotationsSave"]; reactionStyleForActor?: MessageBubbleProps["reactionStyleForActor"] }) {
    const [resolved, setResolved] = useState<ChatPhotoGroupItem[]>(items);
    const [index, setIndex] = useState(() => Math.max(0, Math.min(items.length - 1, msg.mediaData?.photoGroupActiveIndex ?? 0)));
    const [dragX, setDragX] = useState(0);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailIndex, setDetailIndex] = useState(0);
    const [marking, setMarking] = useState(false);
    const dragGesture = useRef<{ x: number; y: number; lastY: number; mode: "pending" | "photo" | "page" } | null>(null);
    const suppressStackClick = useRef(false);
    const mediaSourcesKey = items.map(item => `${item.messageId}:${item.mediaUrl || ""}`).join("|");

    useEffect(() => {
        let cancelled = false;
        const revokes: string[] = [];
        Promise.all(items.map(async item => {
            if (!item.mediaUrl || !isMediaStoreRef(item.mediaUrl)) return item;
            const url = await loadMediaObjectUrl(item.mediaUrl);
            if (url) revokes.push(url);
            return { ...item, mediaUrl: url || undefined };
        })).then(next => { if (!cancelled) setResolved(next); });
        return () => { cancelled = true; revokes.forEach(url => URL.revokeObjectURL(url)); };
        // Annotation-only updates must not revoke and recreate the blob URLs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaSourcesKey]);

    useEffect(() => {
        setResolved(previous => items.map(item => {
            const existing = previous.find(candidate => candidate.messageId === item.messageId);
            const mediaUrl = isMediaStoreRef(item.mediaUrl || "")
                ? (existing?.mediaUrl && !isMediaStoreRef(existing.mediaUrl) ? existing.mediaUrl : undefined)
                : item.mediaUrl;
            return { ...item, mediaUrl };
        }));
    }, [items]);

    useEffect(() => {
        const next = Math.max(0, Math.min(resolved.length - 1, msg.mediaData?.photoGroupActiveIndex ?? 0));
        setIndex(next);
    }, [msg.mediaData?.photoGroupActiveIndex, resolved.length]);

    const move = (direction: number) => {
        if (!resolved.length) return;
        const nextIndex = (index + direction + resolved.length) % resolved.length;
        const lead = resolved[nextIndex];
        const stored = loadChatMessages(msg.sessionId).find(message => message.id === msg.id);
        if (stored && lead) {
            const mediaData = {
                ...stored.mediaData,
                photoGroupActiveIndex: nextIndex,
                photoGroupLeadMessageId: lead.messageId,
                photoGroupLeadLabel: lead.label,
            };
            updateMessageMediaData(stored.id, mediaData);
            onUpdate?.({ ...stored, mediaData });
        }
        setIndex(nextIndex);
    };
    const scrollPageBy = (origin: HTMLElement, deltaY: number) => {
        let node: HTMLElement | null = origin.parentElement;
        while (node) {
            const style = window.getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
                node.scrollTop -= deltaY;
                return;
            }
            node = node.parentElement;
        }
        window.scrollBy(0, -deltaY);
    };
    const active = resolved[detailIndex];
    const saveAnnotations = (annotations: ChatPhotoAnnotation[]) => {
        if (!active) return;
        const stored = loadChatMessages(msg.sessionId).find(message => message.id === active.messageId);
        if (!stored) return;
        const previous = stored.mediaData?.photoAnnotations || [];
        if (onPhotoAnnotationsSave) onPhotoAnnotationsSave(stored, annotations, previous);
        else {
            const mediaData = { ...stored.mediaData, photoAnnotations: annotations };
            updateMessageMediaData(stored.id, mediaData);
            onUpdate?.({ ...stored, mediaData });
        }
        setResolved(prev => prev.map(item => item.messageId === active.messageId ? { ...item, annotations } : item));
        setMarking(false);
    };

    return (
        <>
            <div className="chat-photo-stack-wrap">
                <button type="button" className="chat-photo-stack-count" aria-label={`查看全部 ${resolved.length} 张照片`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setDetailIndex(index); setDetailOpen(true); }}><span className="chat-photo-stack-grid-icon" aria-hidden="true"><i/><i/><i/><i/></span>{index + 1} / {resolved.length} 张照片</button>
                <div
                    className="chat-photo-stack"
                    onPointerDown={event => {
                        dragGesture.current = { x: event.clientX, y: event.clientY, lastY: event.clientY, mode: "pending" };
                        suppressStackClick.current = false;
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={event => {
                        const gesture = dragGesture.current;
                        if (!gesture) return;
                        const dx = event.clientX - gesture.x;
                        const dy = event.clientY - gesture.y;
                        if (gesture.mode === "pending" && Math.hypot(dx, dy) >= 10) {
                            // The photo owns a leftward gesture unless the movement is clearly vertical.
                            gesture.mode = dx < -4 || Math.abs(dx) >= Math.abs(dy) * .72 ? "photo" : "page";
                        }
                        if (gesture.mode === "photo") {
                            event.preventDefault();
                            setDragX(Math.min(0, dx));
                        } else if (gesture.mode === "page") {
                            event.preventDefault();
                            scrollPageBy(event.currentTarget, event.clientY - gesture.lastY);
                        }
                        gesture.lastY = event.clientY;
                    }}
                    onPointerUp={() => {
                        const mode = dragGesture.current?.mode;
                        if (mode === "photo" && dragX < -42) { suppressStackClick.current = true; move(1); }
                        else if (mode === "page") suppressStackClick.current = true;
                        dragGesture.current = null;
                        setDragX(0);
                    }}
                    onPointerCancel={() => { dragGesture.current = null; setDragX(0); }}
                    onClick={event => { event.stopPropagation(); suppressStackClick.current = false; }}
                >
                    {Array.from({ length: Math.min(resolved.length, 9) }, (_, depthIndex) => Math.min(resolved.length, 9) - 1 - depthIndex).map(depth => {
                        const itemIndex = (index + depth) % resolved.length;
                        const item = resolved[itemIndex];
                        const isFront = depth === 0;
                        const scale = 1 - Math.min(depth, 8) * 0.018 + (isFront ? -Math.min(Math.abs(dragX) / 2800, .08) : Math.min(Math.abs(dragX) / 3600, .045));
                        const spreadX = depth === 0 ? 0 : 7 + depth * 2.5;
                        const translateX = isFront ? dragX : spreadX + Math.max(-8, dragX * .06);
                        const restingRotation = depth === 0 ? 0 : Math.min(7, 1.2 + depth * .62);
                        return <div key={`${item.messageId}-${depth}`} className="chat-photo-stack-card" data-depth={depth} style={{ zIndex: 20 - depth, filter: `saturate(${Math.max(.72, 1 - depth * .035)})`, transform: `translate3d(${translateX}px, ${depth * -3.2}px, 0) rotate(${isFront ? dragX / 28 : restingRotation}deg) scale(${scale})` }}>
                            {item.mediaUrl ? <img src={item.mediaUrl} alt={item.label || `照片 ${itemIndex + 1}`} draggable={false} /> : <div className="chat-photo-stack-text">{item.label || "文字图片"}</div>}
                            <PhotoAnnotationLayer annotations={item.annotations} />
                        </div>;
                    })}
                    {resolved[index] && <div className="photo-front-reaction" data-message-role={msg.role} style={{ transform: `translateX(${dragX}px)` }}><IMessageTapbackBadge tapback={resolved[index].tapback} tapbackBy={resolved[index].tapbackBy} reactions={resolved[index].tapbacks} reactionStyleForActor={reactionStyleForActor} /></div>}
                </div>
            </div>
            {detailOpen && createPortal(
                <div className="chat-photo-group-overlay" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
                    <div className="chat-photo-group-header"><button className="photo-glass-button" aria-label="返回聊天" onClick={() => setDetailOpen(false)}><ChevronLeft /></button><strong>{resolved.length} 张照片</strong><span /></div>
                    <div className="chat-photo-group-grid" onClick={event => event.stopPropagation()}>
                        {resolved.map((item, itemIndex) => <button key={item.messageId} type="button" onClick={() => { setDetailIndex(itemIndex); setMarking(true); }} data-active={detailIndex === itemIndex || undefined}>
                            {item.mediaUrl ? <img src={item.mediaUrl} alt={item.label || ""} /> : <span>{item.label || "文字图片"}</span>}
                            <PhotoAnnotationLayer annotations={item.annotations} />
                        </button>)}
                    </div>
                </div>,
                document.body,
            )}
            {marking && active && <PhotoAnnotationEditor imageUrl={active.mediaUrl} fallbackText={active.label} initial={active.annotations} onSave={saveAnnotations} onClose={() => setMarking(false)} />}
        </>
    );
}

function ImageBubble(props: { msg: ChatMessage; onUpdate?: (updated: ChatMessage) => void; onPhotoAnnotationsSave?: MessageBubbleProps["onPhotoAnnotationsSave"]; characterId?: string; reactionStyleForActor?: MessageBubbleProps["reactionStyleForActor"] }) {
    const items = props.msg.mediaData?.photoGroupItems;
    return items && items.length > 1
        ? <PhotoGroupBubble msg={props.msg} items={items} onUpdate={props.onUpdate} onPhotoAnnotationsSave={props.onPhotoAnnotationsSave} reactionStyleForActor={props.reactionStyleForActor} />
        : <SingleImageBubble {...props} />;
}

function SingleImageBubble({
    msg,
    onUpdate,
    onPhotoAnnotationsSave,
    characterId,
}: {
    msg: ChatMessage;
    onUpdate?: (updated: ChatMessage) => void;
    onPhotoAnnotationsSave?: MessageBubbleProps["onPhotoAnnotationsSave"];
    characterId?: string;
}) {
    const d = msg.mediaData;
    const label = d?.label || "照片";
    const rawUrl = msg.mediaUrl || "";
    // 媒体维护压缩后 mediaUrl 是 media-store:// 引用，直接当 <img src> 会裂图，
    // 与 MediaFileBubble 相同：先解析为 object URL 再渲染。
    const [resolvedUrl, setResolvedUrl] = useState<string>(isMediaStoreRef(rawUrl) || rawUrl.startsWith("asset://") ? "" : rawUrl);
    const [refExpired, setRefExpired] = useState(false);
    const [showPromptEditor, setShowPromptEditor] = useState(false);
    const [promptDraft, setPromptDraft] = useState("");
    const [regenerating, setRegenerating] = useState(false);
    // retryError 只用于提示词弹窗内的即时校验；生成失败改用一次性弹窗，不再挂红字
    const [retryError, setRetryError] = useState("");
    const [failureNotice, setFailureNotice] = useState("");
    const isPending = d?.imageGenerationStatus === "pending";
    const canRegenerate = !isPending && Boolean(d?.label?.trim());
    const [showPreview, setShowPreview] = useState(false);
    const [marking, setMarking] = useState(false);

    useEffect(() => {
        if (rawUrl.startsWith("asset://")) {
            let active = true;
            setResolvedUrl("");
            setRefExpired(false);
            getChatImageFromIndexedDB(rawUrl.slice(8)).then(url => {
                if (active) { setResolvedUrl(url || ""); setRefExpired(!url); }
            }).catch(() => { if (active) setRefExpired(true); });
            return () => { active = false; };
        }
        if (!isMediaStoreRef(rawUrl)) {
            setResolvedUrl(rawUrl);
            setRefExpired(false);
            return;
        }
        let revokeUrl = "";
        loadMediaObjectUrl(rawUrl).then(objUrl => {
            if (objUrl) { setResolvedUrl(objUrl); revokeUrl = objUrl; }
            else setRefExpired(true);
        });
        return () => { if (revokeUrl) URL.revokeObjectURL(revokeUrl); };
    }, [rawUrl]);

    const openPromptEditor = useCallback(() => {
        setPromptDraft(d?.label?.trim() || "");
        setRetryError("");
        setShowPromptEditor(true);
    }, [d?.label]);

    const handleRetry = useCallback(() => {
        const nextDescription = promptDraft.trim();
        if (!nextDescription) {
            setRetryError("提示词不能为空");
            return;
        }
        setShowPromptEditor(false);
        setRegenerating(true);
        setRetryError("");
        retryChatGeneratedImage(msg, characterId, nextDescription)
            .then(updated => {
                onUpdate?.(updated);
            })
            .catch(error => {
                setFailureNotice(error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
                setRegenerating(false);
            });
    }, [characterId, msg, onUpdate, promptDraft]);

    // 预览层与提示词对话框：图片正常/失败占位两种形态共用（操作按钮统一收在点开后的预览层里）
    const previewAndDialog = (
        <>
            {showPreview && (
                <MediaPreviewOverlay
                    imageUrl={resolvedUrl || undefined}
                    description={!resolvedUrl ? label : undefined}
                    saveFilename={resolvedUrl ? ensureExtension(label, "image") : undefined}
                    annotations={d?.photoAnnotations}
                    onAnnotate={() => { setShowPreview(false); setMarking(true); }}
                    onRegenerate={canRegenerate ? () => { setShowPreview(false); openPromptEditor(); } : undefined}
                    regenerating={regenerating}
                    onClose={() => setShowPreview(false)}
                />
            )}
            {showPromptEditor && typeof document !== "undefined" && createPortal(
                <GeneratedImagePromptDialog
                    value={promptDraft}
                    onChange={setPromptDraft}
                    onConfirm={handleRetry}
                    onCancel={() => setShowPromptEditor(false)}
                    busy={regenerating}
                    error={retryError}
                />,
                document.body,
            )}
            {failureNotice && (
                <GeneratedImageErrorDialog message={failureNotice} onClose={() => setFailureNotice("")} />
            )}
            {marking && (
                <PhotoAnnotationEditor
                    imageUrl={resolvedUrl || undefined}
                    fallbackText={label}
                    initial={d?.photoAnnotations}
                    onClose={() => setMarking(false)}
                    onSave={annotations => {
                        const previous = msg.mediaData?.photoAnnotations || [];
                        if (onPhotoAnnotationsSave) onPhotoAnnotationsSave(msg, annotations, previous);
                        else {
                            const mediaData = { ...msg.mediaData, photoAnnotations: annotations };
                            updateMessageMediaData(msg.id, mediaData);
                            onUpdate?.({ ...msg, mediaData });
                        }
                        setMarking(false);
                    }}
                />
            )}
        </>
    );

    if (resolvedUrl) {
        return (
            <>
                <div
                    className="chat-photo-card chat-photo-card--image rounded-none"
                    style={{ cursor: "pointer" }}
                    onClick={e => { e.stopPropagation(); setShowPreview(true); }}
                >
                    <img
                        src={resolvedUrl}
                        alt={label}
                        className="chat-photo-card-image block max-w-[240px] max-h-[320px] w-auto h-auto"
                    />
                    <PhotoAnnotationLayer annotations={d?.photoAnnotations} />
                </div>
                {previewAndDialog}
            </>
        );
    }
    // media-store 引用解析中：占个位，避免闪一下重试卡
    if ((isMediaStoreRef(rawUrl) || rawUrl.startsWith("asset://")) && !refExpired) {
        return <div className="chat-photo-card w-[180px] aspect-square rounded-none" />;
    }
    if (isPending) {
        return (
            <div className="chat-photo-card chat-photo-card--pending w-[180px] aspect-square rounded-none">
                <div className="chat-photo-card-pending-inner">
                    <div className="chat-photo-card-loader" aria-hidden="true">
                        <span className="chat-photo-card-loader-orbit" />
                        <span className="chat-photo-card-loader-core" />
                    </div>
                    <div className="chat-photo-card-pending-text">图片接收中...</div>
                </div>
            </div>
        );
    }
    return (
        <div className="chat-generated-image-retry-stack">
            <div
                className="chat-photo-card chat-photo-card--text w-[180px] aspect-square rounded-none"
                style={{ cursor: "pointer" }}
                onClick={e => { e.stopPropagation(); setShowPreview(true); }}
            >
                <div className="chat-photo-card-placeholder w-full h-full flex items-center justify-center px-5">
                    <div className="chat-photo-card-text">{label}</div>
                </div>
            </div>
            {previewAndDialog}
        </div>
    );
}

// ── Location ─────────────────────────────

function LocationBubble({ msg }: { msg: ChatMessage }) {
    return <LocationCard label={msg.mediaData?.label || "位置"} />;
}

// ── Poke ─────────────────────────────

// 骰子点位：3x3 宫格（0-8）中每个点数要点亮的格子
const DICE_BUBBLE_PIPS: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
};

// 让指定点数朝向屏幕所需的立方体末态旋转（配合各面的摆放变换）
const DICE_BUBBLE_ORIENTATIONS: Record<number, [number, number]> = {
    1: [0, 0],
    2: [-90, 0],
    3: [0, -90],
    4: [0, 90],
    5: [90, 0],
    6: [0, 180],
};

/** 骰子消息：3D 实骰。新消息立方体翻滚约 1.4 秒后定格在掷出的点数；历史消息直接定格 */
function DiceBubble({ msg }: { msg: ChatMessage }) {
    const face = Math.min(6, Math.max(1, Number(msg.mediaData?.diceFace) || 1));
    // 挂载瞬间判定一次：只有刚发出的消息播翻滚动画
    const rollingRef = useRef(Date.now() - new Date(msg.createdAt).getTime() < 6000);
    const [rx, ry] = DICE_BUBBLE_ORIENTATIONS[face];

    return (
        <div className="dice-bubble3d" aria-label={`骰子 ${face} 点`}>
            <div className="dice-bubble3d-tilt">
                <div
                    className="dice-bubble3d-cube"
                    {...(rollingRef.current ? { "data-rolling": "" } : {})}
                    style={{ "--dice-rx": `${rx}deg`, "--dice-ry": `${ry}deg` } as React.CSSProperties}
                >
                    {[1, 2, 3, 4, 5, 6].map(f => (
                        <span key={f} className="dice-bubble3d-face" data-face={f}>
                            {Array.from({ length: 9 }, (_, cell) => (
                                <span
                                    key={cell}
                                    className="dice-bubble3d-pip"
                                    {...(DICE_BUBBLE_PIPS[f].includes(cell) ? { "data-on": "" } : {})}
                                />
                            ))}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

function PokeBubble({ msg, charName, userName }: { msg: ChatMessage; charName?: string; userName?: string }) {
    // Prefer mediaData fields (group chat aware), fallback to old role-based logic
    const sender = msg.mediaData?.pokeSender || (msg.role === "user" ? (userName || "你") : (charName || "对方"));
    const target = msg.mediaData?.pokeTarget || (msg.role === "user" ? (charName || "对方") : (userName || "你"));
    // Replace user's own name with "你" for display
    const displaySender = sender === userName ? "你" : sender;
    const displayTarget = target === userName ? "你" : target;
    return (
        <div
            className="chat-sys-msg ts-12 mx-auto text-center"
        >
            {displaySender} 拍了拍 {displayTarget}
        </div>
    );
}

// ── Sticker ─────────────────────────────

// In-memory cache: assetId/name → resolved URL (survives re-renders, cleared on page reload)
const _stickerUrlCache = new Map<string, string>();

/** Pre-populate sticker cache for a character. Call before rendering messages. */
export async function prewarmStickerCache(characterId: string): Promise<void> {
    const { resolveCustomStickerMap } = await import("@/lib/custom-sticker-storage");
    const map = await resolveCustomStickerMap(characterId);
    for (const [name, url] of Object.entries(map)) {
        _stickerUrlCache.set(`${characterId}:${name}`, url);
    }
}

function AlignedStickerImage({ src, label }: { src: string; label: string }) {
    const imageRef = useRef<HTMLImageElement>(null);
    useEffect(() => {
        const image = imageRef.current;
        const row = image?.closest<HTMLElement>("[data-imessage-group] .chat-msg-wrapper");
        if (!image || !row) return;
        let visibleBottom = 1;
        const measure = () => {
            if (!image.naturalWidth || !image.naturalHeight) return;
            const rect = image.getBoundingClientRect();
            const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
            const paintedHeight = image.naturalHeight * scale;
            const bottom = rect.top + (rect.height - paintedHeight) / 2 + paintedHeight * visibleBottom;
            row.style.setProperty("--group-avatar-bottom", `${row.getBoundingClientRect().bottom - bottom}px`);
        };
        const loaded = () => {
            // Ignore transparent padding, not just the square object-contain box.
            try {
                const canvas = document.createElement("canvas");
                const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (context) {
                    context.drawImage(image, 0, 0, canvas.width, canvas.height);
                    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                    outer: for (let y = canvas.height - 1; y >= 0; y--) {
                        for (let x = 0; x < canvas.width; x++) {
                            if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
                                visibleBottom = (y + 1) / canvas.height;
                                break outer;
                            }
                        }
                    }
                }
            } catch { /* Cross-origin images still align to their painted image bounds. */ }
            measure();
        };
        image.addEventListener("load", loaded);
        row.addEventListener("animationend", measure);
        const observer = new ResizeObserver(measure);
        observer.observe(row); observer.observe(image);
        if (image.complete && image.naturalWidth) loaded();
        return () => {
            image.removeEventListener("load", loaded);
            row.removeEventListener("animationend", measure);
            observer.disconnect();
            row.style.removeProperty("--group-avatar-bottom");
        };
    }, [src]);
    return <img ref={imageRef} src={src} alt={label || "表情包"} className="w-[120px] h-[120px] object-contain" style={{ WebkitTouchCallout: 'none', userSelect: 'none', pointerEvents: 'none' }} />;
}

function StickerBubble({ msg, characterId }: { msg: ChatMessage; characterId?: string }) {
    const d = msg.mediaData;
    const label = d?.label || "";

    // Check pre-resolved URL or memory cache first
    const cacheKey = `${characterId || ""}:${label}`;
    const cachedUrl = d?.stickerUrl || _stickerUrlCache.get(cacheKey);
    const [resolvedUrl, setResolvedUrl] = useState<string | null>(cachedUrl || null);

    useEffect(() => {
        if (resolvedUrl || d?.stickerUrl || !label || !characterId) return;
        const custom = findCustomStickerByName(characterId, label);
        if (!custom) return;
        if (custom.externalUrl) {
            _stickerUrlCache.set(cacheKey, custom.externalUrl);
            setResolvedUrl(custom.externalUrl);
            return;
        }
        if (!custom.assetId) return;
        // Check cache
        const cached = _stickerUrlCache.get(cacheKey);
        if (cached) { setResolvedUrl(cached); return; }
        // Only hit IndexedDB once, then cache
        let cancelled = false;
        resolveCustomStickerUrl(custom.assetId).then(url => {
            if (!cancelled && url) {
                _stickerUrlCache.set(cacheKey, url);
                setResolvedUrl(url);
            }
        });
        return () => { cancelled = true; };
    }, [label, characterId, d?.stickerUrl]);

    const imgUrl = d?.stickerUrl || resolvedUrl;
    if (imgUrl) {
        return (
            <div className="chat-sticker chat-sticker-image sticker-bounce p-1">
                <AlignedStickerImage src={imgUrl} label={label} />
            </div>
        );
    }
    // 2. Fallback: look up emoji from built-in sticker data
    const matched = label ? findStickerByName(label) : undefined;
    if (matched?.emoji) {
        return (
            <div className="chat-sticker chat-sticker-emoji sticker-bounce px-4 py-3 ts-48 text-center leading-none">
                {matched.emoji}
            </div>
        );
    }
    // 3. No match — show label as styled tag
    return (
        <div className="chat-sticker chat-sticker-fallback px-4 py-2 ts-14 text-[var(--c-text)] bg-black/5 rounded-lg text-center">
            [{label || "表情包"}]
        </div>
    );
}

// ── Quote ─────────────────────────────

function QuoteBubble({ msg, displayContent, replyAccessory, quoteSource, quoteSourceStyle, defaultTranslationExpanded = false, reactionStyleForActor }: Pick<MessageBubbleProps, "msg" | "displayContent" | "replyAccessory" | "quoteSource" | "quoteSourceStyle" | "defaultTranslationExpanded" | "reactionStyleForActor">) {
    const d = msg.mediaData;
    return (
        <div className={`chat-quote-message chat-quote-message-${msg.role} max-w-full`}>
            <span className="chat-quote-connector" aria-hidden="true" />
            {(
                <div style={quoteSourceStyle} className="chat-quote-preview bg-black/[0.06] border-l-[3px] border-l-black/15 px-2.5 py-1.5 ts-12 text-[var(--c-icon)] mb-1.5 rounded-r-[6px] truncate max-w-full">
                    {normalizeQuotePreviewText(d?.quotePreview || "") || (quoteSource ? getQuotePreview(quoteSource) : "原消息暂不可用")}
                </div>
            )}
            {msg.content && (
                <div className="chat-quote-reply">
                    <span className="imessage-bubble-surface" aria-hidden="true" />
                    {replyAccessory && <span className="chat-quote-reply-accessory" onPointerDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>{replyAccessory}</span>}
                    <TextBubble content={displayContent ?? msg.content} defaultTranslationExpanded={defaultTranslationExpanded} />
                    {(d?.tapback || d?.tapbacks?.length) && (
                        <IMessageTapbackBadge
                            tapback={d.tapback}
                            tapbackBy={d.tapbackBy || "user"}
                            reactions={d.tapbacks}
                            reactionStyleForActor={reactionStyleForActor}
                        />
                    )}
                </div>
            )}
        </div>
    );
}


// ── Media Detail Modal (red packet / transfer) ─────────────────────────────

interface MediaDetailModalProps {
    msg: ChatMessage;
    userName: string;
    charName?: string;
    groupSize?: number;
    onAccept: (updatedMsg: ChatMessage, sysText: string, actionType: string) => void;
    onClose: () => void;
}

export function MediaDetailModal({ msg, userName, charName, groupSize, onAccept, onClose }: MediaDetailModalProps) {
    const d = msg.mediaData;
    const isRedPacket = msg.mediaType === "red_packet";
    const isTransfer = msg.mediaType === "transfer";
    const isPaymentRequest = msg.mediaType === "payment_request";
    const [paymentError, setPaymentError] = useState("");

    const isFromUser = msg.role === "user";
    // Private incoming messages may not carry senderName in older stored records;
    // the rendered character/alias is already supplied by the room as charName.
    const senderDisplay = isFromUser ? userName : (d?.senderName || msg.senderName || charName || "对方");
    const currency = normalizeCurrency(d?.currency);
    const [walletCurrency, setWalletCurrency] = useState(() => loadWalletState().currency || "CNY");
    useEffect(() => { const update = () => setWalletCurrency(loadWalletState().currency || "CNY"); window.addEventListener(WALLET_UPDATED_EVENT, update); return () => window.removeEventListener(WALLET_UPDATED_EVENT, update); }, []);
    const settled = d?.status === "received" || d?.status === "paid";
    const targetCurrency = settled ? d?.receivedCurrency || "CNY" : walletCurrency;
    const foreignAmount = currency !== targetCurrency ? `${currencySymbol(currency)}${formatApplePayAmount(d?.amount)}` : "";
    const [liveCny, setLiveCny] = useState<number | null>(typeof d?.cnyAmount === "number" ? d.cnyAmount : null);
    const [liveRate, setLiveRate] = useState<number | null>(null);
    const [quoteKey, setQuoteKey] = useState("");
    const currentQuoteKey = `${msg.id}:${currency}:${targetCurrency}:${d?.amount}`;
    useEffect(() => {
        setLiveCny(null);
        setLiveRate(null);
        setPaymentError("");
        if ((!isTransfer && !isRedPacket && !isPaymentRequest) || currency === targetCurrency || settled) return;
        let active = true;
        void fetchExchangeRate(currency, targetCurrency).then(rate => {
            if (!active) return;
            if (rate) { setQuoteKey(currentQuoteKey); setLiveRate(rate); setLiveCny(cnyAmount(Number(d?.amount || 0), rate)); }
            else setPaymentError("汇率查询失败，请关闭后重试；尚未收款。");
        });
        return () => { active = false; };
    }, [msg.id, isTransfer, isRedPacket, isPaymentRequest, currency, targetCurrency, d?.status, d?.amount, currentQuoteKey]);
    const resolvedCny = settled ? d?.receivedAmount ?? d?.cnyAmount ?? Number(d?.amount || 0) : currency === targetCurrency ? Number(d?.amount || 0) : quoteKey === currentQuoteKey ? liveCny : null;
    if (!isRedPacket && !isTransfer && !isPaymentRequest) return null;

    // ── Red packet state ──
    const claimedBy = d?.claimedBy || [];
    const claimedAmounts = d?.claimedAmounts || {};
    const totalRecipients = d?.count || 1;
    const allClaimed = d?.status === "opened" || claimedBy.length >= totalRecipients;
    const identityId = getCurrentIdentityId() ?? "";
    const identity = resolveUserIdentity();
    const userNames = [userName, ...(identity?.previousNames ?? [])];
    const alreadyClaimed = d?.claimedByUserIds?.includes(identityId) || userNames.some(name => claimedBy.includes(name));
    const userShare = d?.claimedAmountsByUserId?.[identityId] ?? userNames.map(name => claimedAmounts[name]).find(amount => amount !== undefined);
    const isDeclined = d?.status === "declined";
    const isReceived = d?.status === "received";
    const isPaid = d?.status === "paid";

    // ── Transfer state ──
    const isRecipient = !d?.recipientName || userNames.includes(d.recipientName);
    const transferDone = isReceived || isDeclined;
    const paymentDone = isPaid || isDeclined || d?.status === "canceled";

    // Can user act?
    const canClaimRedPacket = isRedPacket && !isFromUser && !allClaimed && !isDeclined && !alreadyClaimed;
    const canActTransfer = isTransfer && !isFromUser && !transferDone && isRecipient;
    const canActPaymentRequest = isPaymentRequest && !isFromUser && !paymentDone;

    // 拼手气：随机分配（二倍均值法）
    const calcShare = (): number => {
        const total = d?.amount || 0;
        const claimedTotal = Object.values(claimedAmounts).reduce((s, v) => s + v, 0);
        const remaining = total - claimedTotal;
        const leftCount = totalRecipients - claimedBy.length;
        if (leftCount <= 1) return Math.round(remaining * 100) / 100;
        const max = (remaining / leftCount) * 2;
        const share = Math.max(0.01, Math.random() * max);
        return Math.round(Math.min(share, remaining - 0.01 * (leftCount - 1)) * 100) / 100;
    };

    const handleRedPacketAccept = () => {
        if (resolvedCny === null || walletCurrency !== (loadWalletState().currency || "CNY")) { setPaymentError("请等待汇率查询完成后领取。"); return; }
        const share = totalRecipients > 1 ? calcShare() : (d?.amount || 0);
        const newClaimedBy = [...claimedBy, userName];
        const newClaimedAmounts = { ...claimedAmounts, [userName]: share };
        const newAllClaimed = newClaimedBy.length >= totalRecipients;
        const newStatus = newAllClaimed ? "opened" as const : "pending" as const;
        const updatedData = { ...d, status: newStatus, claimedBy: newClaimedBy, claimedAmounts: newClaimedAmounts, claimedByUserIds: [...(d?.claimedByUserIds ?? []), identityId], claimedAmountsByUserId: { ...d?.claimedAmountsByUserId, [identityId]: share }, receivedCurrency: walletCurrency, receivedAmount: cnyAmount(share, currency === walletCurrency ? 1 : liveRate!), exchangeRate: currency === walletCurrency ? 1 : liveRate!, exchangeRateAt: new Date().toISOString() };
        updateMessageMediaData(msg.id, updatedData);
        onAccept({ ...msg, mediaData: updatedData }, `${userName}领取了${senderDisplay}的红包，金额:${share} ${currency}`, "accept_red_packet");
    };

    const handleRedPacketDecline = () => {
        const updatedData = { ...d, status: "declined" as const };
        updateMessageMediaStatus(msg.id, "declined");
        onAccept({ ...msg, mediaData: updatedData }, `${userName}退回了${senderDisplay}的红包`, "decline_red_packet");
    };

    const handleTransferAccept = () => {
        if (walletCurrency !== (loadWalletState().currency || "CNY")) { setPaymentError("钱包币种已变化，请重新打开转账。"); return; }
        if (resolvedCny === null) { setPaymentError("正在查询最新汇率，请稍后再领取。"); return; }
        updateMessageMediaStatus(msg.id, "received");
        const acceptedRate = currency === targetCurrency ? 1 : liveRate ?? undefined;
        const updatedData = { ...d, status: "received" as const, receivedCurrency: targetCurrency, receivedAmount: resolvedCny, exchangeRate: acceptedRate, exchangeRateAt: new Date().toISOString(), ...(targetCurrency === "CNY" ? { cnyAmount: resolvedCny, exchangeRateToCny: acceptedRate } : {}) };
        onAccept({ ...msg, mediaData: updatedData }, `${userName}领取了${senderDisplay}的转账`, "accept_transfer");
    };

    const handleTransferDecline = () => {
        updateMessageMediaStatus(msg.id, "declined");
        const updatedData = { ...d, status: "declined" as const };
        onAccept({ ...msg, mediaData: updatedData }, `${userName}拒收了${senderDisplay}的转账`, "decline_transfer");
    };

    const handlePaymentRequestAccept = () => {
        const amount = Number(d?.amount ?? d?.paymentRequestAmountLabel ?? 0);
        const safeAmount = Number.isFinite(amount) && resolvedCny !== null ? Math.max(0, resolvedCny) : 0;
        if (resolvedCny === null || walletCurrency !== (loadWalletState().currency || "CNY")) { setPaymentError("请等待汇率查询完成后支付。"); return; }
        if (safeAmount <= 0) {
            setPaymentError("金额无效，无法代付。");
            return;
        }
        const result = payWithWalletBalance({
            amount: safeAmount,
            title: "代付",
            detail: formatShoppingPaymentRequestHistory({
                amount: safeAmount,
                amountLabel: d?.paymentRequestAmountLabel,
                items: d?.paymentRequestItems,
                itemsText: d?.paymentRequestItemsText,
            }),
            category: "代付",
            relatedOrderId: d?.shoppingOrderId,
        });
        if (!result.ok || !result.transaction) {
            setPaymentError(result.error ?? "余额不足，无法代付。");
            return;
        }
        const updatedData = {
            ...d,
            status: "paid" as const,
            paymentResolvedAt: new Date().toISOString(),
            paymentPayerName: userName,
            paymentWalletTransactionId: result.transaction.id,
            receivedCurrency: targetCurrency,
            receivedAmount: safeAmount,
            exchangeRate: currency === targetCurrency ? 1 : liveRate ?? undefined,
            exchangeRateAt: new Date().toISOString(),
        };
        updateMessageMediaData(msg.id, updatedData);
        onAccept({ ...msg, mediaData: updatedData }, `${userName}接受了${senderDisplay}的代付请求`, "accept_payment_request");
    };

    const handlePaymentRequestDecline = () => {
        const updatedData = {
            ...d,
            status: "declined" as const,
            paymentResolvedAt: new Date().toISOString(),
            paymentPayerName: userName,
        };
        updateMessageMediaData(msg.id, updatedData);
        onAccept({ ...msg, mediaData: updatedData }, `${userName}拒绝了${senderDisplay}的代付请求`, "decline_payment_request");
    };

    // Gradient class
    const gradientClass = isRedPacket ? "bg-redpacket-gradient" : isTransfer ? "bg-transfer-gradient" : "bg-transfer-gradient";

    // Status label
    let statusText = "";
    if (isRedPacket) {
        if (isDeclined) statusText = "已退回";
        else if (alreadyClaimed && userShare != null) statusText = `你领取了 ${currencySymbol(currency)}${userShare.toFixed(2)} ${currency}`;
        else if (allClaimed) statusText = "红包已领完";
        else if (isFromUser) statusText = "你发出的红包";
    } else {
        if (isTransfer) {
            if (isReceived) statusText = "已收款";
            else if (isDeclined) statusText = "已退回";
            else if (isFromUser) statusText = "你发出的转账";
            else if (!isRecipient) statusText = `转给 ${d?.recipientName}`;
        } else if (isPaymentRequest) {
            if (isPaid) statusText = "已代付";
            else if (isDeclined) statusText = "已拒绝";
            else if (isFromUser) statusText = "你发出的代付请求";
        }
    }

    const paymentItemsText = d?.paymentRequestItemsText || (d?.paymentRequestItems || [])
        .map(item => `${item.title}/${item.detail}/${item.priceLabel}/${item.quantityLabel}`)
        .join("; ");
    const modalAmountText = isTransfer
        ? formatApplePayAmount(d?.amount)
        : typeof d?.amount === "number" && Number.isFinite(d.amount)
            ? d.amount.toFixed(2)
            : String(d?.paymentRequestAmountLabel || "0.00");

    return (
        <div className={`modal-overlay${isTransfer ? " imessage-transfer-modal-overlay" : ""}`} onClick={onClose}>
            <div className={`media-modal${isTransfer ? " media-modal-transfer" : ""}`} onClick={(e) => e.stopPropagation()}>
                {/* Header with gradient */}
                <div className={`media-modal-header ${gradientClass}`}>
                    {isTransfer ? (
                        <>
                            <div className="media-modal-emoji media-modal-transfer-legacy">💰</div>
                            <ApplePayBrand className="imessage-transfer-detail-brand hidden" />
                        </>
                    ) : <div className="media-modal-emoji">{isRedPacket ? "🧧" : "🧾"}</div>}
                    <div className="media-modal-amount">{currencySymbol(currency)}{currency === "CNY" ? modalAmountText : formatApplePayAmount(d?.amount)}</div>
                    {(isTransfer || isRedPacket || isPaymentRequest) && foreignAmount && <div className="media-modal-sub">按汇率折算为 {targetCurrency} {currencySymbol(targetCurrency)}{resolvedCny === null ? "查询中" : formatApplePayAmount(resolvedCny)}{(d?.exchangeRate ?? (quoteKey === currentQuoteKey ? liveRate : null)) != null && <div>1 {currency} = {d?.exchangeRate ?? liveRate} {targetCurrency}</div>}</div>}
                    <div className="media-modal-label">
                        {isRedPacket ? (d?.label || "恭喜发财，大吉大利") : isTransfer ? (d?.label || "转账") : "代付请求"}
                    </div>
                    <div className="media-modal-sub">来自 {senderDisplay}</div>
                    {isTransfer && d?.recipientName && (
                        <div className="media-modal-sub">转给 {d.recipientName}</div>
                    )}
                    {isRedPacket && totalRecipients > 1 && (
                        <div className="media-modal-sub">共{totalRecipients}个 · 拼手气红包 · {claimedBy.length}/{totalRecipients}已领取</div>
                    )}
                </div>

                {/* Body */}
                <div className="media-modal-body">
                    {isPaymentRequest && paymentItemsText ? (
                        <div className="media-modal-list">
                            <div className="media-modal-list-row" style={{ alignItems: "flex-start", gap: 12 }}>
                                <span style={{ whiteSpace: "normal", lineHeight: 1.5 }}>{paymentItemsText}</span>
                            </div>
                        </div>
                    ) : null}
                    {paymentError ? <div className="media-modal-status" style={{ color: "#b91c1c" }}>{paymentError}</div> : null}

                    {/* Claimed list for red packet */}
                    {isRedPacket && claimedBy.length > 0 && (
                        <div className="media-modal-list">
                            {claimedBy.map((name) => (
                                <div key={name} className="media-modal-list-row">
                                    <span>{name}</span>
                                    <span className="media-modal-list-amt">{currencySymbol(currency)}{(claimedAmounts[name] ?? 0).toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Action buttons or status */}
                    {canClaimRedPacket ? (
                        <div className="media-modal-actions">
                            <button onClick={handleRedPacketAccept} className="ui-btn ui-btn-redpacket">领取</button>
                            <button onClick={handleRedPacketDecline} className="ui-btn ui-btn-outline">退回</button>
                        </div>
                    ) : canActTransfer ? (
                        <div className="media-modal-actions">
                            <button onClick={handleTransferAccept} className="ui-btn ui-btn-transfer">收款</button>
                            <button onClick={handleTransferDecline} className="ui-btn ui-btn-outline">退回</button>
                        </div>
                    ) : canActPaymentRequest ? (
                        <div className="media-modal-actions">
                            <button onClick={handlePaymentRequestAccept} className="ui-btn ui-btn-transfer">帮TA代付</button>
                            <button onClick={handlePaymentRequestDecline} className="ui-btn ui-btn-outline">拒绝</button>
                        </div>
                    ) : statusText ? (
                        <div className="media-modal-status">{statusText}</div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

// ── Music Share Bubble ──────────────────────────

// ── Media File Bubble ────────────────────────────────

export function MediaImageWithPreview({
    url,
    title,
    filename,
    onError,
    onRegenerate,
    regenerating,
}: {
    url: string;
    title: string;
    filename?: string;
    onError?: () => void;
    onRegenerate?: () => void;
    regenerating?: boolean;
}) {
    const [preview, setPreview] = useState(false);
    const saveName = filename || title;
    return (
        <>
            <div className="chat-media-file-wrap">
                <div className="chat-media-file-card chat-media-file-image" onClick={(e) => { e.stopPropagation(); setPreview(true); }}>
                    {title && <div className="chat-media-file-title">{title}</div>}
                    <img src={url} alt={title} style={{ cursor: "pointer" }} onError={onError} />
                </div>
            </div>
            {preview && (
                <MediaPreviewOverlay
                    imageUrl={url}
                    saveFilename={ensureExtension(saveName, "image")}
                    onRegenerate={onRegenerate ? () => { setPreview(false); onRegenerate(); } : undefined}
                    regenerating={regenerating}
                    onClose={() => setPreview(false)}
                />
            )}
        </>
    );
}

function MediaSaveButton({ url, filename }: { url: string; filename: string }) {
    return (
        <button
            className="chat-media-file-save"
            aria-label="保存文件"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const { downloadUrl } = await import("@/lib/download-utils");
                await downloadUrl(url, filename);
            }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </button>
    );
}

const DEFAULT_EXT: Record<string, string> = { audio: ".mp3", image: ".png", video: ".mp4", file: ".bin" };

function ensureExtension(name: string, fileType: string): string {
    if (!name) return `file${DEFAULT_EXT[fileType] || ""}`;
    if (/\.\w{2,5}$/.test(name)) return name;
    return `${name}${DEFAULT_EXT[fileType] || ""}`;
}

function MediaFileBubble({
    msg,
    onUpdate,
    characterId,
}: {
    msg: ChatMessage;
    onUpdate?: (updated: ChatMessage) => void;
    characterId?: string;
}) {
    const rawUrl = msg.mediaUrl || "";
    const fileType = msg.mediaData?.fileType || "file";
    const title = msg.mediaData?.fileName || msg.content || "";
    const [resolvedUrl, setResolvedUrl] = useState<string>(isMediaStoreRef(rawUrl) ? "" : rawUrl);
    const [expired, setExpired] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showImagePromptEditor, setShowImagePromptEditor] = useState(false);
    const [imagePromptDraft, setImagePromptDraft] = useState("");
    const [imageRegenerating, setImageRegenerating] = useState(false);
    // 同 ImageBubble：弹窗内校验用 imageRetryError，生成失败走一次性弹窗
    const [imageRetryError, setImageRetryError] = useState("");
    const [imageFailureNotice, setImageFailureNotice] = useState("");

    useEffect(() => {
        if (!isMediaStoreRef(rawUrl)) {
            // Plain URLs (e.g. the fresh data URL written by image regeneration)
            // must re-sync when the message's mediaUrl changes — resolvedUrl is
            // only initialized at mount, which left the old image on screen
            // until the chat app was reopened.
            setResolvedUrl(rawUrl);
            setExpired(false);
            return;
        }
        let revokeUrl = "";
        loadMediaObjectUrl(rawUrl).then(objUrl => {
            if (objUrl) { setResolvedUrl(objUrl); revokeUrl = objUrl; }
            else setExpired(true);
        });
        return () => { if (revokeUrl) URL.revokeObjectURL(revokeUrl); };
    }, [rawUrl]);

    const togglePlay = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const audio = audioRef.current;
        if (!audio) return;
        if (playing) { audio.pause(); } else { audio.play(); }
    }, [playing]);

    const handleTimeUpdate = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || !audio.duration) return;
        setProgress(audio.currentTime / audio.duration);
    }, []);

    const openImagePromptEditor = useCallback(() => {
        setImagePromptDraft(msg.mediaData?.label?.trim() || "");
        setImageRetryError("");
        setShowImagePromptEditor(true);
    }, [msg.mediaData?.label]);

    const handleRegenerateImage = useCallback(() => {
        const nextDescription = imagePromptDraft.trim();
        if (!nextDescription) {
            setImageRetryError("提示词不能为空");
            return;
        }
        setShowImagePromptEditor(false);
        setImageRegenerating(true);
        setImageRetryError("");
        retryChatGeneratedImage(msg, characterId, nextDescription)
            .then(updated => {
                onUpdate?.(updated);
            })
            .catch(error => {
                setImageFailureNotice(error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
                setImageRegenerating(false);
            });
    }, [characterId, imagePromptDraft, msg, onUpdate]);

    const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        const audio = audioRef.current;
        if (!audio || !audio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * audio.duration;
    }, []);

    const url = resolvedUrl;

    if (expired) {
        return (
            <div className="chat-media-file-card chat-media-file-generic">
                <span className="chat-media-file-title" style={{ opacity: 0.5 }}>文件已过期</span>
            </div>
        );
    }

    // 存储空间清理会置空 mediaUrl 并打上 mediaCleanedAt：占位说明而不是一张点不动的文件卡。
    if (!rawUrl && msg.mediaData?.mediaCleanedAt) {
        return (
            <div className="chat-media-file-card chat-media-file-generic">
                <span className="chat-media-file-title" style={{ opacity: 0.5 }}>{title ? `${title} · 已清理` : "文件已清理"}</span>
            </div>
        );
    }

    if (!url && isMediaStoreRef(rawUrl)) {
        return (
            <div className="chat-media-file-card chat-media-file-generic">
                <span className="chat-media-file-title" style={{ opacity: 0.5 }}>加载中...</span>
            </div>
        );
    }

    if (fileType === "image" && !url) {
        const fallbackTitle = msg.mediaData?.label?.trim() || title || "图片";
        return (
            <div className="chat-media-file-card chat-media-file-generic">
                <span className="chat-media-file-title">{fallbackTitle}</span>
            </div>
        );
    }

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    if (fileType === "audio" && url) {
        return (
            <div className="chat-media-file-wrap">
                <div className="chat-media-file-card chat-media-file-audio">
                    <audio
                        ref={audioRef}
                        src={url}
                        preload="metadata"
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => { setPlaying(false); setProgress(0); }}
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
                    />
                    <div className="chat-media-file-header">
                        <button className="chat-media-file-play" onClick={togglePlay}>
                            {playing ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                            )}
                        </button>
                        <div className="chat-media-file-info">
                            <div className="chat-media-file-title">{title}</div>
                            <div className="chat-media-file-time">
                                {duration > 0 ? `${formatTime(progress * duration)} / ${formatTime(duration)}` : "加载中..."}
                            </div>
                        </div>
                    </div>
                    <div className="chat-media-file-progress" onClick={handleSeek}>
                        <div className="chat-media-file-progress-fill" style={{ width: `${progress * 100}%` }} />
                    </div>
                </div>
                <MediaSaveButton url={url} filename={ensureExtension(title, "audio")} />
            </div>
        );
    }

    if (fileType === "image" && url) {
        const displayTitle = msg.mediaData?.imageGenerationPrompt ? "" : title;
        // 重试把状态落库为 pending（见 generated-image-retry.ts），角标据此显示——
        // 比组件内的 imageRegenerating 可靠：滚远了卸载再回来，角标还在。
        const imageRegenPending = msg.mediaData?.imageGenerationStatus === "pending";
        const canRegenerateImage = !imageRegenPending
            && Boolean(msg.mediaData?.label?.trim())
            && (msg.mediaData?.imageGenerationStatus === "generated" || Boolean(msg.mediaData?.imageGenerationPrompt));
        return (
            <div className="chat-generated-image-retry-stack">
                <div className="chat-generated-image-regen-wrap">
                    <MediaImageWithPreview
                        url={url}
                        title={displayTitle}
                        filename={title}
                        onRegenerate={canRegenerateImage ? openImagePromptEditor : undefined}
                        regenerating={imageRegenerating}
                    />
                    {imageRegenPending && (
                        <div className="chat-generated-image-regen-badge" aria-hidden="true">
                            <span className="chat-generated-image-regen-spinner" />
                            生成中
                        </div>
                    )}
                </div>
                {showImagePromptEditor && typeof document !== "undefined" && createPortal(
                    <GeneratedImagePromptDialog
                        value={imagePromptDraft}
                        onChange={setImagePromptDraft}
                        onConfirm={handleRegenerateImage}
                        onCancel={() => setShowImagePromptEditor(false)}
                        busy={imageRegenerating}
                        error={imageRetryError}
                    />,
                    document.body,
                )}
                {imageFailureNotice && (
                    <GeneratedImageErrorDialog
                        message={imageFailureNotice}
                        onClose={() => setImageFailureNotice("")}
                    />
                )}
            </div>
        );
    }

    if (fileType === "video" && url) {
        return (
            <div className="chat-media-file-wrap">
                <div className="chat-media-file-card chat-media-file-video">
                    {title && <div className="chat-media-file-title">{title}</div>}
                    <video src={url} controls preload="metadata" onClick={(e) => e.stopPropagation()} />
                </div>
                <MediaSaveButton url={url} filename={ensureExtension(title, "video")} />
            </div>
        );
    }

    return (
        <div className="chat-media-file-wrap">
            <div className="chat-media-file-card chat-media-file-generic" onClick={(e) => {
                e.stopPropagation();
                if (!url) return;
                // 与右侧保存按钮同路：iOS 走系统分享卡，其余平台常规下载（window.open 在 iOS 上会跳浏览器）
                void (async () => {
                    const { downloadUrl } = await import("@/lib/download-utils");
                    await downloadUrl(url, ensureExtension(title, "file"));
                })();
            }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span className="chat-media-file-title">{title}</span>
            </div>
            {url && <MediaSaveButton url={url} filename={ensureExtension(title, "file")} />}
        </div>
    );
}

function MusicShareBubble({ msg, onPlay }: { msg: ChatMessage; onPlay?: MessageBubbleProps["onMusicPlay"] }) {
    const track = msg.mediaData?.musicTrack;
    const title = track?.title || msg.mediaData?.musicTitle || "未知歌曲";
    const artist = track?.artist || msg.mediaData?.musicArtist || "";
    const [failedCover, setFailedCover] = useState<string>();
    const pending = msg.mediaData?.musicResolution === "pending";
    const unresolved = msg.mediaData?.musicResolution === "unresolved";
    const canPlay = !!onPlay;
    if (msg.listeningContext?.reference) return <div style={{ width: "min(340px, 100%)" }} onClick={e => e.stopPropagation()}>
        <LyricShareCard title={title} artist={artist} text={msg.listeningContext.reference.text} coverUrl={msg.mediaData?.musicCoverUrl || track?.coverUrl} onPlay={onPlay ? () => onPlay(title, artist || undefined, track) : undefined} />
    </div>;
    return (
        <div
            className="chat-music-share-card"
            role={canPlay ? "button" : undefined}
            tabIndex={canPlay ? 0 : undefined}
            aria-label={`播放音乐：${title}${artist ? ` · ${artist}` : ""}`}
            onKeyDown={(e) => {
                if (canPlay && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault(); e.stopPropagation(); onPlay?.(title, artist || undefined, track);
                }
            }}
            onClick={(e) => { e.stopPropagation(); if (canPlay) onPlay?.(title, artist || undefined, track); }}
        >
            <div className="chat-music-share-body">
                <div className="chat-music-share-cover">
                    {track?.coverUrl && failedCover !== track.coverUrl ? <img src={track.coverUrl} alt="专辑封面" loading="lazy" onError={() => setFailedCover(track.coverUrl)} /> : <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>}
                </div>
                <div className="chat-music-share-info">
                    <div className="chat-music-share-title">{title}</div>
                    {artist && <div className="chat-music-share-artist">{artist}</div>}
                </div>
                {canPlay && <span className="chat-music-share-play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5a1 1 0 0 1 1.5-.86l10 6.5a1 1 0 0 1 0 1.72l-10 6.5A1 1 0 0 1 8 18.5z" /></svg></span>}
            </div>
            {msg.listeningContext?.reference && <div className="chat-music-share-lyric">“{msg.listeningContext.reference.text}”</div>}
            <div className="chat-music-share-footer">
                <svg aria-hidden="true" width="13" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.54c.03 3.23 2.83 4.3 2.86 4.31-.02.08-.45 1.54-1.48 3.05-.9 1.3-1.83 2.6-3.3 2.63-1.44.03-1.9-.85-3.55-.85s-2.17.82-3.54.88c-1.42.05-2.5-1.42-3.4-2.72-1.85-2.67-3.27-7.55-1.37-10.85.94-1.64 2.62-2.68 4.44-2.7 1.39-.03 2.7.93 3.55.93.85 0 2.45-1.15 4.13-.98.7.03 2.67.28 3.93 2.12-.1.06-2.35 1.37-2.27 4.18ZM14.34 4.47c.75-.91 1.25-2.18 1.11-3.44-1.08.04-2.39.72-3.16 1.63-.7.8-1.32 2.1-1.15 3.34 1.2.09 2.42-.61 3.2-1.53Z" /></svg>
                <span>Music</span>
                {(pending || unresolved) && <span className="chat-music-share-status" role="status">{pending ? "正在匹配歌曲" : "轻点重新匹配播放"}</span>}
            </div>
        </div>
    );
}

// ── Xiaohongshu Share Bubble ──────────────────────────

function XiaohongshuShareBubble({ msg }: { msg: ChatMessage }) {
    const data = msg.mediaData;
    const title = data?.xiaohongshuTitle || "小红书帖子";
    const author = data?.xiaohongshuAuthor || "小红书用户";
    const body = data?.xiaohongshuBody || "";
    const description = data?.xiaohongshuDescription || "";
    const tags = data?.xiaohongshuTags || [];
    const coverIcon = data?.xiaohongshuCoverIcon || (data?.xiaohongshuNoteType === "video" ? "▶" : "小");
    const [imageUrl, setImageUrl] = useState<string>("");

    useEffect(() => {
        let cancelled = false;
        const assetId = data?.xiaohongshuImageAssetId;
        if (!assetId) {
            setImageUrl("");
            return;
        }
        getChatImageFromIndexedDB(assetId)
            .then((url) => {
                if (!cancelled) setImageUrl(url || "");
            })
            .catch(() => {
                if (!cancelled) setImageUrl("");
            });
        return () => {
            cancelled = true;
        };
    }, [data?.xiaohongshuImageAssetId]);

    return (
        <div className="chat-xhs-share-card">
            <div className="chat-xhs-share-head">
                <span className="chat-xhs-share-mark">RED</span>
                <span>{data?.xiaohongshuNoteType === "video" ? "视频帖子" : "小红书帖子"}</span>
            </div>
            <div className="chat-xhs-share-body">
                <div className={`chat-xhs-share-cover chat-xhs-share-cover--${data?.xiaohongshuTone || "blush"}`}>
                    {imageUrl ? <img src={imageUrl} alt="" /> : <span>{coverIcon}</span>}
                </div>
                <div className="chat-xhs-share-info">
                    <div className="chat-xhs-share-title">{title}</div>
                    <div className="chat-xhs-share-author">{author}</div>
                    <div className="chat-xhs-share-desc">{description || body}</div>
                </div>
            </div>
            {tags.length > 0 ? (
                <div className="chat-xhs-share-tags">
                    {tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}
                </div>
            ) : null}
        </div>
    );
}

// ── Voice Message ───────────────────────────────

// 模块级在途表：同一条消息全局只允许一个合成请求。组件重渲染/卸载重挂都
// 复用同一个 Promise——之前"挂载即合成 + 取消竞态"会把同一条语音反复送去
// 计费还留下点不动的死气泡（用户实报），点击触发 + 全局去重从根上断掉。
const _voiceSynthInFlight = new Map<string, Promise<string>>();

function synthesizeVoiceForMessage(msgId: string, characterId: string, speechText: string): Promise<string> {
    const existing = _voiceSynthInFlight.get(msgId);
    if (existing) return existing;
    const task = (async () => {
        const { resolveVoiceConfig, synthesizeSpeech } = await import("@/lib/tts-service");
        const vc = resolveVoiceConfig(characterId);
        if (!vc) throw new Error("未绑定语音配置");
        const blob = await synthesizeSpeech(speechText, vc);
        if (!blob) throw new Error("合成失败");
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("音频编码失败"));
            reader.readAsDataURL(blob);
        });
        // 直接落库（不依赖会话缓存）——合成一次的音频永久保存，绝不重复计费
        const { persistMessageVoiceAudio } = await import("@/lib/chat-storage");
        await persistMessageVoiceAudio(msgId, dataUrl, speechText);
        return dataUrl;
    })();
    _voiceSynthInFlight.set(msgId, task);
    task.catch(() => {}).then(() => { _voiceSynthInFlight.delete(msgId); });
    return task;
}

function VoiceMessageBubble({ msg, characterId, onUpdate, defaultTranslationExpanded = false }: { msg: ChatMessage; characterId?: string; onUpdate?: (m: ChatMessage) => void; defaultTranslationExpanded?: boolean }) {
    const [playing, setPlaying] = useState(false);
    const [synthesizing, setSynthesizing] = useState(false);
    const [synthFailed, setSynthFailed] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const transcript = msg.mediaData?.label ?? "";
    const text = voiceDisplayText(transcript) || "语音消息";
    const bilingual = splitBilingualText(text, { allowUnchangedTranslation: true });
    const authoredSpeech = voicePlaybackText(transcript, msg.mediaData?.speechText);
    const speechText = (splitBilingualText(authoredSpeech, { allowUnchangedTranslation: true })?.original || authoredSpeech) || bilingual?.original || text;
    const synthesizedFromText = msg.mediaData?.synthesizedFromText;
    const needsResynthesis = msg.role !== "user" && synthesizedFromText !== speechText;
    const duration = msg.mediaData?.voiceDuration || Math.max(2, Math.ceil(speechText.length / 4));

    const playSrc = (src: string) => {
        setSynthFailed(false);
        // 必须用 <audio> 元素:iOS 静音拨键会掐掉 Web Audio 的输出(表现为全线
        // 无声),媒体元素不受影响。元素属于宿主页面,锁屏媒体卡片指向站点本身,
        // 点了只会回到 App;播完清 src 让卡片立即撤下。
        const audio = new Audio(src);
        audioRef.current = audio;
        setPlaying(true);
        const finalize = () => {
            if (audioRef.current === audio) audioRef.current = null;
            try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* ignore */ }
            if (mountedRef.current) setPlaying(false);
        };
        audio.onended = finalize;
        const fail = () => { if (mountedRef.current) setSynthFailed(true); finalize(); };
        audio.onerror = fail;
        audio.play().catch(fail);
    };

    // 点击才合成（不再挂载即合成）：已有音频直接播；没有就现场合成一次，
    // 合成结果已在任务内落库，之后任何时候点都是直接播放，不再消耗额度。
    const handlePlay = () => {
        if (synthesizing) return;
        if (playing && audioRef.current) {
            const active = audioRef.current;
            active.pause();
            setPlaying(false);
            return;
        }
        if (audioRef.current) {
            const active = audioRef.current;
            setSynthFailed(false);
            setPlaying(true);
            active.play().catch(() => {
                if (mountedRef.current) { setPlaying(false); setSynthFailed(true); }
            });
            return;
        }
        if (msg.mediaUrl && !needsResynthesis) {
            playSrc(msg.mediaUrl);
            return;
        }
        if (msg.role === "user" || !characterId) {
            if (msg.mediaUrl) playSrc(msg.mediaUrl);
            return;
        }
        setSynthesizing(true);
        setSynthFailed(false);
        synthesizeVoiceForMessage(msg.id, characterId, speechText)
            .then((dataUrl) => {
                if (onUpdate) onUpdate({ ...msg, mediaUrl: dataUrl, mediaData: { ...msg.mediaData, synthesizedFromText: speechText } });
                if (!mountedRef.current) return;
                setSynthesizing(false);
                playSrc(dataUrl);
            })
            .catch(() => {
                if (!mountedRef.current) return;
                setSynthesizing(false);
                setSynthFailed(true);
            });
    };

    useEffect(() => () => { audioRef.current?.pause(); }, []);

    return (
        <div className="voice-msg-bubble" onClick={handlePlay} role="button" tabIndex={0}
            aria-label={synthesizing ? "正在生成语音" : synthFailed ? "播放失败，点击重试" : playing ? "暂停语音" : "播放语音"}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePlay(); } }}>
            <VoiceReferenceGraphic playing={playing} synthesizing={synthesizing} failed={synthFailed} duration={duration}/>
        </div>
    );
}
