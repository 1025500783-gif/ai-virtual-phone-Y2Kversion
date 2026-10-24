"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, BookOpen, Check, Code2, FileText, X } from "lucide-react";
import { CHAT_APP_SETTINGS_UPDATED_EVENT, loadChatAppSettings, saveChatAppSettings, type ChatAppSettings, type ChatSession } from "@/lib/chat-storage";
import { getFloatingBindingSlot, isCombinedToolsEnabled, updateFloatingBinding, type FloatingBindingTarget } from "@/lib/floating-tools";
import { getFloatingPageContext, subscribeFloatingPageContext } from "@/lib/floating-tools-context";
import { loadApiConfigs, loadBindingConfig, loadWorldBooks, resolveBinding, saveBindingConfig } from "@/lib/settings-storage";
import { CONTENT_APP_LABELS, type BindingSlot, type ContentAppId } from "@/lib/settings-types";
import { DebugPromptPanel } from "./debug-prompt-panel";
import styles from "./floating-tools.module.css";

type View = "menu" | "api" | "books" | "shortcut" | "prompt" | null;
type Position = { x: number; y: number };
const EMPTY_SETTINGS: Partial<ChatAppSettings> = {};
const SHORTCUTS = [
    { id: "settings", label: "设置" }, { id: "desktop", label: "桌面" },
    { id: "chat", label: "聊天" }, { id: "calendar", label: "日历" },
    { id: "settings:worldbook", label: "世界书" }, { id: "settings:api", label: "API 设置" },
];
// Only applications with verified resolveBinding request paths are exposed here.
const BINDING_APPS = new Set(["diary", "reading", "cocreate", "story", "game", "xiaohongshu", "dwelling", "checkphone", "shopping", "calendar", "interview_magazine", "vn", "adventure"]);

export function FloatingTools({ activeApp, chatSession }: { activeApp: string | null; chatSession: ChatSession | null }) {
    const nested = useSyncExternalStore(subscribeFloatingPageContext, getFloatingPageContext, () => null);
    const [settings, setSettings] = useState<Partial<ChatAppSettings>>(EMPTY_SETTINGS);
    const [view, setView] = useState<View>(null);
    const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
    const [panelPosition, setPanelPosition] = useState<Position>({ x: 16, y: 90 });
    const [ready, setReady] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [idle, setIdle] = useState(false);
    const [revision, setRevision] = useState(0);
    const layerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef(position);
    const edgeRef = useRef<"left" | "right">("right");
    const dragRef = useRef<{ id: number; x: number; y: number; start: Position; moved: boolean } | null>(null);
    const ignoreClick = useRef(false);
    const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const enabled = isCombinedToolsEnabled(settings);
    const shortcut = SHORTCUTS.find(item => item.id === settings.floatingToolsShortcut) || SHORTCUTS[0];
    const override = nested?.ownerApp === activeApp && (!nested.sessionId || nested.sessionId === chatSession?.id) ? nested : null;
    const target: FloatingBindingTarget | null = override
        ? { appId: override.appId, characterId: override.characterId }
        : activeApp === "chat" && chatSession
            ? { appId: chatSession.isGroup ? "group_chat" : "chat", characterId: chatSession.isGroup ? undefined : chatSession.contactId }
            : activeApp && BINDING_APPS.has(activeApp) ? { appId: activeApp } : null;
    const targetKey = target ? `${target.appId}:${target.characterId || "app"}` : "none";
    const scopeLabel = override?.label || (target?.appId === "chat" ? "当前角色 · 聊天"
        : target ? `${CONTENT_APP_LABELS[target.appId as ContentAppId] || target.appId} · 应用默认` : "悬浮工具");
    const previousContext = useRef(`${activeApp}:${targetKey}`);

    useEffect(() => {
        const sync = () => setSettings(loadChatAppSettings());
        sync(); window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
        return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
    }, []);
    useEffect(() => { if (!enabled) setView(null); }, [enabled]);
    useEffect(() => {
        const context = `${activeApp}:${targetKey}`;
        if (previousContext.current !== context) setView(null);
        previousContext.current = context;
    }, [activeApp, targetKey]);
    useEffect(() => {
        if (!enabled) return;
        const reload = () => setRevision(n => n + 1);
        window.addEventListener("settings-bindings-updated", reload);
        window.addEventListener("focus", reload);
        return () => { window.removeEventListener("settings-bindings-updated", reload); window.removeEventListener("focus", reload); };
    }, [enabled]);

    const place = useCallback((next: Position, snap = false) => {
        const layer = layerRef.current;
        if (!layer) return;
        const safe = Number.parseFloat(getComputedStyle(layer).getPropertyValue("--safe-area-top")) || 48;
        const x = snap ? (edgeRef.current === "left" ? 8 : layer.clientWidth - 62) : next.x;
        const p = { x: Math.max(8, Math.min(layer.clientWidth - 62, x)), y: Math.max(safe + 16, Math.min(layer.clientHeight - 86, next.y)) };
        positionRef.current = p; setPosition(p);
    }, []);
    useLayoutEffect(() => {
        if (!enabled || !layerRef.current) { setReady(false); return; }
        const saved = loadChatAppSettings().floatingToolsPosition;
        edgeRef.current = saved?.edge === "left" ? "left" : "right";
        const ratio = Number.isFinite(saved?.ratio) ? Math.max(0, Math.min(1, saved!.ratio)) : .61;
        place({ x: 0, y: layerRef.current.clientHeight * ratio }, true);
        setReady(true);
        const observer = new ResizeObserver(() => place(positionRef.current, true));
        observer.observe(layerRef.current);
        return () => observer.disconnect();
    }, [enabled, place]);
    const wake = useCallback(() => {
        setIdle(false);
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => { if (!dragRef.current) setIdle(true); }, 3000);
    }, []);
    useEffect(() => { wake(); return () => { if (idleTimer.current) clearTimeout(idleTimer.current); if (tapTimer.current) clearTimeout(tapTimer.current); }; }, [enabled, view, wake]);
    useLayoutEffect(() => {
        const layer = layerRef.current, panel = panelRef.current;
        if (!layer || !panel || !view || view === "prompt") return;
        const layout = () => {
            const safe = Number.parseFloat(getComputedStyle(layer).getPropertyValue("--safe-area-top")) || 48;
            setPanelPosition({ x: Math.max(12, Math.min(layer.clientWidth - panel.offsetWidth - 12, positionRef.current.x + 27 - panel.offsetWidth / 2)), y: Math.max(safe + 16, Math.min(layer.clientHeight - panel.offsetHeight - 24, positionRef.current.y + 27 - panel.offsetHeight / 2)) });
        };
        layout(); const observer = new ResizeObserver(layout); observer.observe(panel); return () => observer.disconnect();
    }, [view, position, revision]);

    // Modal focus stays inside the new tool, leaving legacy panels untouched.
    useLayoutEffect(() => {
        if (!view || !enabled) return;
        const layer = layerRef.current;
        if (!layer) return;
        const siblings = [...(layer.parentElement?.children || [])].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== layer);
        const inertBefore = siblings.map(node => node.inert);
        siblings.forEach(node => { node.inert = true; });
        const focusable = () => [...layer.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length && node !== buttonRef.current);
        focusable()[0]?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); setView(view === "menu" ? null : "menu"); }
            if (event.key !== "Tab") return;
            const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            siblings.forEach((node, i) => { node.inert = inertBefore[i]; });
            document.removeEventListener("keydown", onKey);
            queueMicrotask(() => { if (buttonRef.current && !buttonRef.current.hidden) buttonRef.current.focus(); });
        };
    }, [enabled, view]);

    function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (event.button !== 0) return;
        event.stopPropagation(); ignoreClick.current = false; wake();
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: positionRef.current, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) {
            const layer = layerRef.current, rect = layer?.getBoundingClientRect();
            const scaleX = layer && rect ? rect.width / layer.clientWidth : 1;
            const scaleY = layer && rect ? rect.height / layer.clientHeight : 1;
            setDragging(true); place({ x: drag.start.x + dx / (scaleX || 1), y: drag.start.y + dy / (scaleY || 1) });
        }
    }
    function pointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
        const drag = dragRef.current, layer = layerRef.current;
        if (!drag || drag.id !== event.pointerId || !layer) return;
        dragRef.current = null; setDragging(false);
        if (drag.moved) {
            ignoreClick.current = event.type !== "pointercancel";
            edgeRef.current = positionRef.current.x + 27 < layer.clientWidth / 2 ? "left" : "right";
            place(positionRef.current, true);
            saveChatAppSettings({ ...loadChatAppSettings(), floatingToolsPosition: { edge: edgeRef.current, ratio: positionRef.current.y / layer.clientHeight } });
        } else if (event.type === "pointerup" && event.pointerType === "touch") {
            tapTimer.current = setTimeout(() => setView("menu"), 80);
        }
        wake();
    }

    if (!enabled) return null;
    const config = view ? loadBindingConfig() : null;
    const slot = config && target ? getFloatingBindingSlot(config, target) : {};
    const resolved = config && target ? resolveBinding(config, target.characterId, target.appId) : {};
    const inheritedApi = view === "api" && config && target
        ? resolveBinding(updateFloatingBinding(config, target, { apiConfigId: undefined }), target.characterId, target.appId).apiConfigId
        : undefined;
    const apis = view === "api" ? loadApiConfigs() : [];
    const books = view === "books" ? loadWorldBooks() : [];
    function update(patch: Partial<BindingSlot>) {
        if (target) saveBindingConfig(updateFloatingBinding(loadBindingConfig(), target, patch));
    }
    function navigate() {
        setView(null);
        const [app, mode] = shortcut.id.split(":");
        if (app === "settings" && !mode) window.dispatchEvent(new CustomEvent("settings-navigate", { detail: { page: "main" } }));
        window.dispatchEvent(new CustomEvent("mascot-navigate", { detail: { app, mode } }));
    }
    const scopeNote = target?.characterId ? "只调整此角色在本应用的配置，从下一次请求生效。" : "调整本应用默认配置；角色的应用专属配置仍优先。";
    return <div ref={layerRef} className={styles.layer} data-floating-tools="">
        <button ref={buttonRef} className={styles.assist} type="button" aria-label="打开悬浮工具" aria-expanded={!!view} aria-controls="combined-floating-panel"
            data-idle={idle && !view || undefined} data-dragging={dragging || undefined} hidden={!!view || !ready}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
            onClick={() => { if (ignoreClick.current) { ignoreClick.current = false; return; } if (tapTimer.current) clearTimeout(tapTimer.current); setRevision(n => n + 1); setView("menu"); }}
            onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") ignoreClick.current = false;
                const steps: Record<string, Position> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } };
                if (steps[event.key]) { event.preventDefault(); place({ x: position.x + steps[event.key].x, y: position.y + steps[event.key].y }); wake(); }
            }}><span className={styles.disc} /></button>
        {view && <>
            <div className={styles.veil} onClick={() => setView(null)} aria-hidden="true" />
            {view === "prompt" ? <div className={styles.promptHost} role="dialog" aria-modal="true" aria-label="完整提示词查看器" id="combined-floating-panel"><DebugPromptPanel managed onManagedClose={() => setView("menu")} /></div>
            : <div ref={panelRef} className={styles.panel} id="combined-floating-panel" role="dialog" aria-modal="true" aria-label="悬浮工具" style={{ left: panelPosition.x, top: panelPosition.y }}>
                <header className={styles.header}><span>{view === "shortcut" ? "页面快捷入口" : scopeLabel}</span><button type="button" aria-label={view === "menu" ? "关闭悬浮工具" : "返回工具"} onClick={() => setView(view === "menu" ? null : "menu")}>{view === "menu" ? <X size={17} /> : <ArrowLeft size={18} />}</button></header>
                {view === "menu" && <>
                    <div className={styles.tiles}>
                        <button type="button" onClick={() => setView("prompt")}><FileText className={styles.pink} />提示词</button>
                        <button type="button" disabled={!target} onClick={() => setView("api")}><Code2 className={styles.blue} />API</button>
                        <button type="button" disabled={!target} onClick={() => setView("books")}><BookOpen className={styles.green} />世界书</button>
                        <button type="button" aria-label={`前往${shortcut.label}`} onClick={navigate}><ArrowLeft />{shortcut.label}</button>
                    </div>
                    <button className={styles.shortcut} type="button" onClick={() => setView("shortcut")}>快捷入口 <span>更改 ›</span></button>
                    {!target && <p className={styles.note}>进入生成内容的页面后，可调整该页面的 API 与世界书。</p>}
                </>}
                {view === "shortcut" && <div className={styles.detail}><h3>快捷入口</h3><p>轻点第四格，前往所选页面。</p>{SHORTCUTS.map(item => <button type="button" className={styles.option} key={item.id} aria-pressed={shortcut.id === item.id} onClick={() => saveChatAppSettings({ ...loadChatAppSettings(), floatingToolsShortcut: item.id })}>{item.label}{shortcut.id === item.id && <Check size={17} />}</button>)}</div>}
                {view === "api" && <div className={styles.detail}><h3>本页 API</h3><p>{scopeNote}</p><button type="button" className={styles.option} aria-pressed={!slot.apiConfigId} onClick={() => update({ apiConfigId: undefined })}><span>继承原配置<small>{apis.find(api => api.id === inheritedApi)?.name || "尚未配置"}</small></span>{!slot.apiConfigId && <Check size={17} />}</button>{apis.map(api => <button type="button" className={styles.option} key={api.id} aria-pressed={slot.apiConfigId === api.id} onClick={() => update({ apiConfigId: api.id })}><span>{api.name}<small>{api.defaultModel}</small></span>{slot.apiConfigId === api.id && <Check size={17} />}</button>)}{!apis.length && <p>请先在设置中添加 API。</p>}</div>}
                {view === "books" && <div className={styles.detail}><h3>本页世界书</h3><p>{scopeNote}</p><button type="button" className={styles.option} aria-pressed={slot.worldBookMode !== "replace"} onClick={() => update({ worldBookIds: undefined, worldBookMode: undefined })}>恢复继承{slot.worldBookMode !== "replace" && <Check size={17} />}</button><p>{slot.worldBookMode === "replace" ? "本页单独选择；全不选即停用继承世界书。" : "目前沿用已有绑定及角色世界。勾选后改为本页单独选择。"}</p>{books.map(book => {
                    const checked = resolved.worldBookIds?.includes(book.id) === true;
                    return <button type="button" key={book.id} role="checkbox" aria-checked={checked} className={styles.option} onClick={() => {
                        const ids = new Set(resolved.worldBookIds || []); if (checked) ids.delete(book.id); else ids.add(book.id);
                        update({ worldBookIds: [...ids], worldBookMode: "replace" });
                    }}>{book.name}{checked && <Check size={17} />}</button>;
                })}{!books.length && <p>请先导入世界书。</p>}<p>选中的条目仍按启用状态与触发规则注入；任务额外指定的世界书不在此列表中控制。</p></div>}
            </div>}
        </>}
    </div>;
}
