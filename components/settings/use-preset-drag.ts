"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { settleMenuRows } from "@/lib/menu-reorder-animation";

export type PresetDragRow = { id: string; groupKey: string; header: boolean; grouped: boolean; label: string };
export type PresetDragIntent = "join" | "detach" | "create";
type Hover = { group: string; ready: boolean; message?: string } | null;

/** One pointer gesture for mouse/touch. The full card floats outside clipped swipe rows. */
export function usePresetDrag(root: RefObject<HTMLDivElement | null>, rows: PresetDragRow[], commit: (from: number, to: number, after: boolean, intent?: PresetDragIntent) => void, label: (group: string) => string) {
    const latest = useRef({ rows, commit, label }); latest.current = { rows, commit, label };
    const active = useRef<(() => void) | null>(null);
    const settling = useRef<(() => void) | null>(null);
    const suppressClick = useRef(false);
    const [hover, setHover] = useState<Hover>(null);
    useEffect(() => () => { active.current?.(); settling.current?.(); }, []);
    const onPointerDown = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || active.current) return;
        settling.current?.(); settling.current = null;
        const node = root.current, source = latest.current.rows[index];
        if (!node || !source) return;
        event.preventDefault(); event.stopPropagation(); suppressClick.current = false;
        const handle = event.currentTarget, pointerId = event.pointerId;
        const start = { x: event.clientX, y: event.clientY };
        let point = { ...start }, started = false, frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
        let floating: HTMLElement | null = null, original: HTMLElement | null = null, sourceRect: DOMRect;
        let items: Array<{ node: HTMLElement; row: PresetDragRow; rect: DOMRect }> = [];
        let scrollNode: HTMLElement | null = null, startScroll = 0;
        let targetId = source.id, after = false, hoverGroup: string | null = null, hoverStart = 0, ready = false;
        let hint: HTMLElement | null = null;
        let intent: PresetDragIntent | undefined;
        const resetStyles = () => {
            items.forEach(item => { item.node.style.removeProperty("transform"); item.node.style.removeProperty("transition"); item.node.removeAttribute("data-drag-source"); });
            original?.removeAttribute("data-drag-source");
        };
        const updateHover = (group: string | null) => {
            if (group === hoverGroup) return;
            hoverGroup = group; hoverStart = performance.now(); ready = false;
            setHover(group ? { group, ready: false } : null);
            if (hint) hint.hidden = true;
        };
        const paint = () => {
            if (!started || !floating) return;
            const viewport = scrollNode?.getBoundingClientRect();
            if (scrollNode && viewport) {
                const top = Math.max(viewport.top, node.closest(".page-shell")?.querySelector(".page-header")?.getBoundingClientRect().bottom ?? viewport.top);
                const step = point.y < top + 45 ? -Math.min(10, (top + 45 - point.y) / 4) : point.y > viewport.bottom - 45 ? Math.min(10, (point.y - viewport.bottom + 45) / 4) : 0;
                if (step) scrollNode.scrollTop += step;
            }
            const scroll = (scrollNode?.scrollTop ?? 0) - startScroll;
            const delta = point.y - start.y;
            floating.style.top = `${sourceRect.top + delta}px`;
            floating.style.left = `${sourceRect.left + Math.max(-24, Math.min(24, point.x - start.x))}px`;
            const anchor = items.find(item => item.row.id === source.id)?.rect ?? sourceRect;
            const center = anchor.top + anchor.height / 2 + delta + scroll;
            let target = items.filter(item => !(source.header && item.row.groupKey === source.groupKey && item.row.id !== source.id)).reduce<typeof items[number] | null>((best, item) => {
                const distance = Math.abs(center - (item.rect.top + item.rect.height / 2));
                return !best || distance < Math.abs(center - (best.rect.top + best.rect.height / 2)) ? item : best;
            }, null);
            if (!target) target = items.find(item => item.row.id === source.id) ?? null;            if (!source.header && target?.row.id === source.id && Math.abs(delta) > 10) {
                const direction = Math.sign(delta);
                const origin = anchor.top + anchor.height / 2;
                const neighbor = items.filter(item => !item.row.header && item.row.groupKey === source.groupKey && item.row.id !== source.id && Math.sign(item.rect.top + item.rect.height / 2 - origin) === direction)
                    .sort((a, b) => Math.abs(a.rect.top + a.rect.height / 2 - origin) - Math.abs(b.rect.top + b.rect.height / 2 - origin))[0];
                if (neighbor && Math.abs(center - origin) >= Math.abs(neighbor.rect.top + neighbor.rect.height / 2 - origin) * .32) target = neighbor;
            }
            if (target) {
                targetId = target.row.id;
                after = source.header || (target.row.groupKey === source.groupKey && !target.row.header) ? items.indexOf(target) > items.findIndex(item => item.row.id === source.id) : center > target.rect.top + target.rect.height / 2;
                const horizontalDetach = source.grouped && !source.header && Math.abs(point.x - start.x) > 44;
                const sectionBoxes = Array.from(node.querySelectorAll<HTMLElement>("[data-preset-section]")).map(section => section.getBoundingClientRect());
                const inGap = sectionBoxes.some(box => Math.abs(point.y - box.top) < 10 || Math.abs(point.y - box.bottom) < 10);
                                const detached = !source.header && source.grouped && (horizontalDetach || inGap);
                const pointerY = point.y + scroll;
                const create = !source.header && !target.row.grouped && target.row.id !== source.id && !inGap && pointerY > target.rect.top + target.rect.height * .22 && pointerY < target.rect.bottom - target.rect.height * .22;
                const crossGroup = !source.header && target.row.groupKey !== source.groupKey && !inGap && (target.row.grouped || create);
                if (detached) {
                    updateHover(null); intent = "detach";
                    if (hint) { hint.textContent = "松手独立条目"; hint.hidden = false; }
                } else {
                    intent = crossGroup ? (create ? "create" : "join") : undefined;
                    updateHover(crossGroup ? target.row.groupKey : null);
                    if (!hoverGroup && hint) hint.hidden = true;
                    if (hoverGroup && !ready && performance.now() - hoverStart >= 500) {
                        ready = true;
                        const message = create ? `与「${target.row.label.replace(/^[▸▹▶►]\s*/, "")}」新建分组` : `移动至${latest.current.label(hoverGroup)}组`;
                        setHover({ group: hoverGroup, ready: true, message });
                        if (hint) { hint.textContent = message; hint.hidden = false; }
                    }
                }                const from = items.findIndex(item => item.row.id === source.id), to = items.indexOf(target);
                const permitShift = !crossGroup && !detached;
                const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                items.forEach((item, i) => {
                    if (item.row.id === source.id || (source.header && item.row.groupKey === source.groupKey)) return;
                    const shift = permitShift && i > from && i <= to ? -(sourceRect.height + 8) : permitShift && i < from && i >= to ? sourceRect.height + 8 : 0;
                    item.node.style.transition = reduce ? "none" : "transform 180ms cubic-bezier(.22,.8,.25,1)";
                    item.node.style.transform = shift ? `translate3d(0,${shift}px,0)` : "";
                });
            }
            frame = requestAnimationFrame(paint);
        };
        const begin = () => {
            if (!root.current) return;
            started = true; suppressClick.current = true;
            const elements = Array.from(node.querySelectorAll<HTMLElement>("[data-preset-row]"));
            items = elements.flatMap(element => {
                const row = latest.current.rows.find(row => row.id === element.dataset.presetRow);
                return row ? [{ node: element, row, rect: element.getBoundingClientRect() }] : [];
            });
            const rowNode = items.find(item => item.row.id === source.id)?.node;
            if (!rowNode) return;
            original = source.header ? rowNode.closest<HTMLElement>("[data-preset-section]") ?? rowNode : rowNode;
            sourceRect = original.getBoundingClientRect();
            scrollNode = node.closest<HTMLElement>(".page-body"); startScroll = scrollNode?.scrollTop ?? 0;
            floating = original.cloneNode(true) as HTMLElement;
            const computed = getComputedStyle(original);
            for (let i = 0; i < computed.length; i++) { const key = computed[i]; if (key.startsWith("--")) floating.style.setProperty(key, computed.getPropertyValue(key)); }
            floating.setAttribute("data-preset-drag-overlay", "true"); floating.setAttribute("aria-hidden", "true"); floating.setAttribute("inert", "");
            floating.querySelectorAll("[data-preset-row]").forEach(element => element.removeAttribute("data-preset-row"));
            floating.removeAttribute("data-preset-row");
            Object.assign(floating.style, { position: "fixed", left: `${sourceRect.left}px`, top: `${sourceRect.top}px`, margin: "0", width: `${original.offsetWidth}px`, height: `${original.offsetHeight}px`, transform: `scale(${sourceRect.width / original.offsetWidth})`, transformOrigin: "top left", zIndex: "2147483000", pointerEvents: "none", boxShadow: "0 16px 45px #0003, 0 2px 8px #0002", opacity: "1", background: "var(--c-panel, #fff)", overflow: "visible" });
            // Browsers may composite transformed swipe content separately. Flatten it in the floating copy.
            floating.querySelectorAll<HTMLElement>(".ui-swipe-content").forEach(element => { element.style.transform = "none"; element.style.transition = "none"; });
            floating.querySelectorAll(".ui-swipe-actions").forEach(element => element.remove());
            hint = document.createElement("div"); hint.hidden = true; hint.setAttribute("data-preset-drag-hint", "true");
            Object.assign(hint.style, { position: "absolute", bottom: "-36px", right: "4px", borderRadius: "12px", padding: "7px 12px", fontSize: "12px", background: "var(--c-panel, #fff)", color: "var(--c-text-title, #222)", boxShadow: "0 3px 16px #0002", whiteSpace: "nowrap" });
            floating.append(hint); document.body.append(floating); original.setAttribute("data-drag-source", "true");
            handle.setPointerCapture(pointerId);
            frame = requestAnimationFrame(paint);
        };
        const cleanupListeners = () => {
            if (timer) clearTimeout(timer); cancelAnimationFrame(frame);
            window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", escape);
            try { if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* detached handle */ }
            active.current = null; setHover(null);
        };
        const finish = (save: boolean) => {
            cleanupListeners();
            if (!started) return;
            const before = new Map(items.map(item => [item.node, item.node.getBoundingClientRect().top]));
            const from = latest.current.rows.findIndex(row => row.id === source.id), to = latest.current.rows.findIndex(row => row.id === targetId);
            const allowed = save && from >= 0 && to >= 0 && (intent === "detach" || !hoverGroup || ready);
            const visual = floating; floating = null; hint?.remove(); resetStyles();
            if (visual) original?.setAttribute("data-drag-source", "true");
            if (allowed && (from !== to || intent === "detach")) latest.current.commit(from, to, after, intent);
            requestAnimationFrame(() => {
                const elements = Array.from(node.querySelectorAll<HTMLElement>("[data-preset-row]"));
                const destination = elements.find(element => element.dataset.presetRow === source.id);
                const destNode = source.header ? destination?.closest<HTMLElement>("[data-preset-section]") ?? destination : destination;
                // Measure the committed layout before FLIP introduces temporary transforms.
                // The floating source owns its landing animation; only other rows run FLIP.
                const landing = destNode?.getBoundingClientRect();
                const startRect = visual?.getBoundingClientRect();
                const otherRows = elements.filter(element => element !== destination && !(source.header && destNode?.contains(element)));
                const stopRows = settleMenuRows(otherRows, before, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
                let animation: Animation | undefined;
                if (visual && destNode && landing && startRect) {
                    destNode.setAttribute("data-drag-source", "true");
                    const scale = landing.width / Math.max(1, destNode.offsetWidth);
                    animation = visual.animate([{ left: `${startRect.left}px`, top: `${startRect.top}px` }, { left: `${landing.left}px`, top: `${landing.top}px`, transform: `scale(${scale})` }], { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220, easing: "cubic-bezier(.22,.8,.25,1)", fill: "forwards" });
                }
                const done = () => { visual?.remove(); original?.removeAttribute("data-drag-source"); destNode?.removeAttribute("data-drag-source"); };
                if (animation) { animation.onfinish = done; animation.oncancel = done; } else done();
                settling.current = () => { stopRows(); animation?.cancel(); done(); };
            });
        };
        const move = (e: PointerEvent) => { if (e.pointerId !== pointerId) return; point = { x: e.clientX, y: e.clientY }; if (!started && event.pointerType === "mouse" && Math.hypot(point.x - start.x, point.y - start.y) > 5) { if (timer) clearTimeout(timer); begin(); } if (started && e.cancelable) e.preventDefault(); };
        const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(true); };
        const cancel = (e?: PointerEvent) => { if (!e || e.pointerId === pointerId) finish(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } };
        window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", escape);
        timer = setTimeout(begin, event.pointerType === "mouse" ? 100 : 220);
        active.current = () => { cleanupListeners(); resetStyles(); floating?.remove(); };
    };
    return { onPointerDown, hover, suppressClick };
}
