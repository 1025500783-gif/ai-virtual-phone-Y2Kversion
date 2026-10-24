"use client";

import { useEffect, useRef, type RefObject } from "react";
import { loadChatMessages } from "@/lib/chat-storage";
import { getKeyboardAutoSendDebounceMs, isKeyboardAutoSendEnabled, IDLE_REPLY_CONFIG_UPDATED } from "@/lib/keyboard-auto-send-config";

interface ChatIdleAutoReplyOptions {
    active: boolean;
    pending: boolean;
    generating: boolean;
    /** Choosing media, recording/transcribing, settings, menus and other unfinished actions. */
    busy: boolean;
    sessionId: string;
    /** Last non-system message, empty when it is not a user message. */
    messageId: string;
    onTrigger: () => void;
}

function visible(element: HTMLElement | null): boolean {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return false;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
}

/** One reply per newly sent turn, after a quiet interval. Focus/keyboard visibility is irrelevant. */
export function useChatIdleAutoReply(rootRef: RefObject<HTMLElement | null>, options: ChatIdleAutoReplyOptions): void {
    const latest = useRef(options);
    latest.current = options;
    const wake = useRef<() => void>(() => {});
    const attempted = useRef("");

    useEffect(() => {
        const sessionId = options.sessionId;
        attempted.current = "";
        let timer = 0;
        let candidate = "";
        let lastActivity = Date.now();
        let wasBlocked = false;
        let composing = false;
        let windowFocused = true;
        const pointers = new Set<number>();
        let enabled = isKeyboardAutoSendEnabled(sessionId);
        let delay = getKeyboardAutoSendDebounceMs(sessionId);
        const cancel = () => { window.clearTimeout(timer); timer = 0; };
        const scope = () => rootRef.current?.closest(".phone-shell") || rootRef.current?.parentElement;
        const withinScope = (event: Event) => event.target instanceof Node && !!scope()?.contains(event.target);
        const blocked = () => {
            const root = rootRef.current;
            if (latest.current.busy || composing || pointers.size || !windowFocused || document.visibilityState !== "visible" || !visible(root)) return true;
            if (root?.querySelector<HTMLTextAreaElement>(".chat-input-textarea")?.value.trim()) return true;
            // Covers portalled floating tools and app dialogs outside the ChatRoom subtree.
            return Array.from((scope() || document).querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .pv-panel, [data-chat-idle-busy]')).some(visible);
        };
        const check = () => {
            cancel();
            const cur = latest.current;
            if (cur.sessionId !== sessionId) return;
            const key = `${sessionId}:${cur.messageId}`;
            // Manual reply/stop/failure must not cause an automatic retry of the same turn.
            if (cur.generating && cur.messageId) attempted.current = key;
            if (!enabled || !cur.active || !cur.pending || cur.generating || !cur.messageId || attempted.current === key) return;
            if (candidate !== key) { candidate = key; lastActivity = Date.now(); }
            if (blocked()) {
                wasBlocked = true;
                timer = window.setTimeout(check, 250);
                return;
            }
            if (wasBlocked) { wasBlocked = false; lastActivity = Date.now(); }
            const remaining = delay - (Date.now() - lastActivity);
            if (remaining > 0) {
                // Only pending, enabled turns are monitored. No viewport polling or history scans here.
                timer = window.setTimeout(check, Math.min(remaining, 250));
                return;
            }
            const messages = loadChatMessages(sessionId);
            let last;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role !== "system") { last = messages[i]; break; }
            }
            if (last?.role !== "user" || last.id !== cur.messageId) return;
            attempted.current = key;
            cur.onTrigger();
        };
        const activity = () => {
            lastActivity = Date.now();
            cancel();
            // Let React commit the click/input handler before inspecting drafts and panel state.
            timer = window.setTimeout(check, 0);
        };
        const onActivity = (event: Event) => {
            if (!withinScope(event)) return;
            // Foreground input may resume without a window focus event on mobile.
            // Scroll/focusout alone are insufficient: they can also be programmatic.
            if (document.visibilityState === "visible" && ["input", "keydown", "click", "focusin"].includes(event.type)) windowFocused = true;
            activity();
        };
        const onPointerDown = (event: PointerEvent) => {
            if (!withinScope(event)) return;
            if (document.visibilityState === "visible") windowFocused = true;
            pointers.add(event.pointerId);
            activity();
        };
        const onPointerUp = (event: PointerEvent) => { if (pointers.delete(event.pointerId)) activity(); };
        const onCompositionStart = (event: Event) => { if (withinScope(event)) { composing = true; activity(); } };
        const onCompositionEnd = (event: Event) => { if (withinScope(event)) { composing = false; activity(); } };
        const onVisibility = () => { pointers.clear(); composing = false; activity(); };
        const onWindowBlur = () => { windowFocused = false; onVisibility(); };
        const onWindowFocus = () => { windowFocused = true; activity(); };
        const refreshConfig = () => {
            enabled = isKeyboardAutoSendEnabled(sessionId);
            delay = getKeyboardAutoSendDebounceMs(sessionId);
            activity();
        };
        const events = ["input", "keydown", "click", "focusin", "focusout", "wheel", "scroll"];
        events.forEach(type => document.addEventListener(type, onActivity, { capture: true, passive: true }));
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointerup", onPointerUp, true);
        document.addEventListener("pointercancel", onPointerUp, true);
        document.addEventListener("compositionstart", onCompositionStart, true);
        document.addEventListener("compositionend", onCompositionEnd, true);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
        window.addEventListener(IDLE_REPLY_CONFIG_UPDATED, refreshConfig);
        wake.current = activity;
        activity();
        return () => {
            cancel();
            wake.current = () => {};
            events.forEach(type => document.removeEventListener(type, onActivity, true));
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("pointerup", onPointerUp, true);
            document.removeEventListener("pointercancel", onPointerUp, true);
            document.removeEventListener("compositionstart", onCompositionStart, true);
            document.removeEventListener("compositionend", onCompositionEnd, true);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("blur", onWindowBlur);
            window.removeEventListener("focus", onWindowFocus);
            window.removeEventListener(IDLE_REPLY_CONFIG_UPDATED, refreshConfig);
        };
    }, [rootRef, options.sessionId]);

    useEffect(() => { wake.current(); }, [options.active, options.pending, options.generating, options.busy, options.messageId]);
}
