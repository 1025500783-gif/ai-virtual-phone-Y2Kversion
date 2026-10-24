import { useEffect, useRef } from "react";

export function useEchoSendGesture(eligible: boolean, sendEcho: () => void, normalClick: () => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const gesture = useRef<{ x: number; y: number; button: HTMLElement } | null>(null);
    const press = useRef<{ x: number; y: number; button: HTMLElement } | null>(null);
    const suppressClick = useRef(false);
    const latest = useRef({ eligible, sendEcho, normalClick });
    latest.current = { eligible, sendEcho, normalClick };
    const clear = () => { clearTimeout(timer.current); gesture.current = null; };
    const cancel = () => { suppressClick.current = true; press.current = null; clear(); };

    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => { if (!eligible && gesture.current) cancel(); }, [eligible]);
    useEffect(() => {
        const keydown = (e: KeyboardEvent) => { if (e.key === "Escape" && (gesture.current || press.current)) cancel(); };
        const blur = () => { if (gesture.current || press.current) cancel(); };
        const visibility = () => { if (document.hidden) blur(); };
        window.addEventListener("keydown", keydown);
        window.addEventListener("blur", blur);
        document.addEventListener("visibilitychange", visibility);
        return () => {
            window.removeEventListener("keydown", keydown);
            window.removeEventListener("blur", blur);
            document.removeEventListener("visibilitychange", visibility);
        };
    }, []);

    return {
        handlers: {
            onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
                if (e.button !== 0 || !e.isPrimary) return;
                e.preventDefault(); clear(); suppressClick.current = false;
                press.current = { x: e.clientX, y: e.clientY, button: e.currentTarget };
                if (!latest.current.eligible) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                gesture.current = { x: e.clientX, y: e.clientY, button: e.currentTarget };
                timer.current = setTimeout(() => {
                    if (!gesture.current || !latest.current.eligible) return;
                    // Consume release/click even when sending clears the draft.
                    cancel();
                    latest.current.sendEcho();
                }, 2000);
            },
            onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
                const g = gesture.current || press.current; if (!g) return;
                const r = g.button.getBoundingClientRect();
                if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12
                    || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancel();
            },
            onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
                const p = press.current;
                const bounds = e.currentTarget.getBoundingClientRect();
                const touchTap = e.pointerType === "touch" && p && !suppressClick.current
                    && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 12
                    && e.clientX >= bounds.left && e.clientX <= bounds.right && e.clientY >= bounds.top && e.clientY <= bounds.bottom;
                press.current = null;
                clear();
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                // WebKit may omit click after preventDefault preserves textarea focus.
                if (touchTap) { suppressClick.current = true; latest.current.normalClick(); }
            },
            onPointerCancel: cancel,
            onLostPointerCapture: () => { if (gesture.current) cancel(); },
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
                if (e.key === "Enter" || e.key === " ") suppressClick.current = false;
            },
            onClick: (e: React.MouseEvent) => {
                if (suppressClick.current) { e.preventDefault(); suppressClick.current = false; return; }
                suppressClick.current = false;
                latest.current.normalClick();
            },
        },
    };
}
