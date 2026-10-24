"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Prompt } from "@/lib/settings-types";
import { getTagsLabel, resolveContentTagLabel, type TagGroupProfile } from "@/lib/content-tag-utils";
import { getPromptScopes, normalizeScopeAlternatives } from "@/lib/preset-scope";
import styles from "./preset-controls.module.css";
const same = (a: string[], b: string[]) => a.length === b.length && a.every(t => b.includes(t));

function MultiSelect({ label, value, children, open, onOpenChange }: { label: string; value: string; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) {
    const ref = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, []);
    useEffect(() => {
        if (!open) return;
        const position = () => {
            const element = ref.current, summary = element?.querySelector("summary");
            if (!element || !summary) return;
            const rect = summary.getBoundingClientRect();
            const page = element.closest(".page-body")?.getBoundingClientRect();
            const bottom = Math.min(window.innerHeight, page?.bottom ?? window.innerHeight);
            const top = Math.max(0, page?.top ?? 0);
            const below = bottom - rect.bottom - 12, above = rect.top - top - 12;
            const upward = below < 200 && above > below;
            element.dataset.openUp = String(upward);
            element.style.setProperty("--scope-menu-height", `${Math.max(44, Math.min(260, upward ? above : below))}px`);
        };
        const frame = requestAnimationFrame(position);
        window.addEventListener("resize", position);
        window.addEventListener("scroll", position, true);
        return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
    }, [open]);
    return <details ref={ref} open={open} onToggle={event => onOpenChange(event.currentTarget.open)} className={styles.scopeColumn} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } }
        if (ref.current?.open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const items = Array.from(ref.current.querySelectorAll<HTMLInputElement>('input:not(:disabled)'));
            const i = items.indexOf(document.activeElement as HTMLInputElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (i + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
            items[next]?.focus();
        }
    }}>
        <summary aria-label={label}><span>{value}</span><ChevronDown size={14} /></summary>
        <div className={styles.scopeMenu} role="group" aria-label={`${label}多选`}>{children}</div>
    </details>;
}

export function PresetScopePicker({ prompt, groups, onChange, activeMenu, onMenuChange }: {
    prompt: Prompt; groups: TagGroupProfile[]; onChange: (updates: Partial<Prompt>) => void; activeMenu: string | null; onMenuChange: (menu: string, open: boolean) => void;
}) {
    const scopes = getPromptScopes(prompt);
    const apps = [...new Set(scopes.flatMap(scope => scope[0] ? [scope[0]] : []))];
    const appLabel = (app: string) => groups.find(group => group.tags[0] === app)?.label ?? resolveContentTagLabel(app);
    const save = (next: string[][], order = apps) => {
        const arranged = order.flatMap(app => next.filter(scope => scope[0] === app));
        onChange({ scopeAlternatives: normalizeScopeAlternatives(arranged) ?? [[]], tags: undefined, featureTag: undefined, followUpOnly: undefined });
    };
    const toggleApp = (app: string) => {
        if (!app) { save([]); return; }
        if (apps.includes(app)) save(scopes.filter(scope => scope[0] !== app), apps.filter(key => key !== app));
        else save([...scopes.filter(scope => scope.length), [app]], [...apps, app]);
    };
    const toggleMinor = (app: string, tags: string[]) => {
        const other = scopes.filter(scope => scope[0] !== app);
        const current = scopes.filter(scope => scope[0] === app);
        if (tags.length === 1) { save([...other, [app]]); return; }
        const next = current.some(scope => same(scope, tags)) ? current.filter(scope => !same(scope, tags)) : [...current.filter(scope => scope.length > 1), tags];
        save([...other, ...(next.length ? next : [[app]])]);
    };
    const option = (label: string, checked: boolean, onToggle: () => void, rank?: number) => <label key={label} className={styles.scopeOption}>
        <input type="checkbox" aria-label={label} checked={checked} onChange={onToggle} /><span>{label}</span>{rank !== undefined && <small>{rank + 1}</small>}
    </label>;
    const minorLabel = (app: string, scope: string[]) => groups.find(group => group.tags[0] === app)?.minors.find(minor => same(minor.tags, scope))?.label ?? getTagsLabel(scope);
    const minorSummary = apps.map(app => `${apps.length > 1 ? appLabel(app) + "：" : ""}${scopes.filter(scope => scope[0] === app).map(scope => minorLabel(app, scope)).join("、")}`).join("；");
    return <div className={styles.scopePicker}>
        <p className={styles.hint}>多选，按点击顺序排列；任一范围匹配即生效。</p>
        <div className={styles.scopeColumns}>
            <MultiSelect open={activeMenu === "app"} onOpenChange={open => onMenuChange("app", open)} label="适用 App" value={apps.map(appLabel).join("、") || "通用"}>
                {option("通用", !apps.length, () => toggleApp(""))}
                {groups.filter(group => group.tags.length).map(group => option(group.label, apps.includes(group.tags[0]), () => toggleApp(group.tags[0]), apps.includes(group.tags[0]) ? apps.indexOf(group.tags[0]) : undefined))}
                {apps.filter(app => !groups.some(group => group.tags[0] === app)).map(app => option(appLabel(app), true, () => toggleApp(app), apps.indexOf(app)))}
            </MultiSelect>
            <MultiSelect open={activeMenu === "minor"} onOpenChange={open => onMenuChange("minor", open)} label="适用子场景" value={minorSummary || "全部场景"}>
                {!apps.length && <p className={styles.hint}>通用适用于所有场景</p>}
                {apps.map(app => {
                    const group = groups.find(group => group.tags[0] === app);
                    const options = group?.minors ?? [{ id: app, label: "通用", tags: [app] }];
                    const current = scopes.filter(scope => scope[0] === app);
                    const unknown = current.filter(scope => !options.some(minor => same(minor.tags, scope)));
                    return <fieldset key={app} className={styles.scopeSection}>
                        {apps.length > 1 && <legend>{appLabel(app)}</legend>}
                        {options.map(minor => option(minor.label, current.some(scope => same(scope, minor.tags)), () => toggleMinor(app, minor.tags)))}
                        {unknown.map(scope => option(getTagsLabel(scope), true, () => toggleMinor(app, scope)))}
                    </fieldset>;
                })}
            </MultiSelect>
        </div>
    </div>;
}
