"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, GripVertical, MoreHorizontal, Plus, AlertCircle, Check } from "lucide-react";
import type { PresetConfig, Prompt } from "@/lib/settings-types";
import { resolveContentTagLabel } from "@/lib/content-tag-utils";
import { groupPresetPrompts, movePresetEntryToGroup, movePresetPrompts, orderedPresetPrompts, presetDisplayGroupKey, renamePresetGroup, dissolvePresetGroup, deletePresetGroup, preparePresetGroups, createPresetEditorId, assignPresetPromptsToGroup } from "@/lib/preset-order";
import { promptScopeLabel } from "@/lib/preset-scope";
import { ConfirmDialog, ContentDialog } from "@/components/ui/modal";
import { usePresetDrag, type PresetDragIntent } from "./use-preset-drag";
import styles from "./preset-controls.module.css";
const defaultGroupLabel = (key: string) => key === "__markers__" ? "资料与记忆" : key === "__all__" ? "通用" : resolveContentTagLabel(key);
type Row = { id: string; groupKey: string; prompts: Prompt[]; label: string; header: boolean; grouped: boolean; open?: boolean };

export function PresetEntryGroups({ preset, editingId, onReorder, onCollapse, onAdd, onUpdate, children }: {
    preset: PresetConfig; editingId: string | null; onCollapse?: () => void;
    onReorder: (prompts: Prompt[]) => void; children: (prompt: Prompt, index: number) => ReactNode;
    onAdd: (groupId: string) => void; onUpdate: (updates: Partial<PresetConfig>) => void;
}) {
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkDialog, setBulkDialog] = useState<"existing" | "new" | null>(null);
    const [newGroupName, setNewGroupName] = useState("");
    const bulkTrigger = useRef<HTMLButtonElement | null>(null);
    const closeBulkDialog = () => { setBulkDialog(null); requestAnimationFrame(() => bulkTrigger.current?.focus()); };
    useEffect(() => { setSelecting(false); setSelected(new Set()); setBulkDialog(null); }, [preset.id]);
    const toggleSelected = (ids: string[]) => setSelected(current => {
        const next = new Set(current), remove = ids.every(id => current.has(id));
        ids.forEach(id => { if (remove) next.delete(id); else next.add(id); });
        return next;
    });
    const finishGrouping = (group: { id: string; name: string }) => {
        if (!selected.size) return;
        onUpdate(assignPresetPromptsToGroup(prepared, [...selected], group));
        setExpanded(current => new Set([...current, `group:${group.id}`]));
        setAnnouncement(`已将 ${selected.size} 条条目并入${group.name}分组`);
        setSelected(new Set()); setSelecting(false); setBulkDialog(null);
    };
    const root = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [announcement, setAnnouncement] = useState("");
    const [renameId, setRenameId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState("");
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const deleteDialog = useRef<HTMLDivElement>(null);
    const groupLabel = (key: string) => preset.displayGroups?.find(group => group.id === key)?.name ?? defaultGroupLabel(key);
    const prepared = useMemo(() => preparePresetGroups(preset), [preset]);
    useEffect(() => {
        if (preset.groupingVersion !== 1) onUpdate({ prompts: prepared.prompts, displayGroups: prepared.displayGroups, groupingVersion: 1 });
    }, [preset.groupingVersion, prepared]);
    const prompts = useMemo(() => orderedPresetPrompts(prepared), [prepared]);
    const groups = useMemo(() => {
        const result = groupPresetPrompts(prompts);
        for (const group of preset.displayGroups ?? []) if (!result.some(item => item.key === group.id)) result.push({ key: group.id, prompts: [] });
        return result;
    }, [prompts, preset.displayGroups]);
    useEffect(() => { if (deleteId) deleteDialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [deleteId]);
    useEffect(() => {
        const close = (event: PointerEvent) => root.current?.querySelectorAll<HTMLDetailsElement>("details[data-group-menu][open]").forEach(menu => { if (!menu.contains(event.target as Node)) menu.open = false; });
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, []);
    const editingPrompt = prompts.find(prompt => prompt.identifier === editingId);
    const editingGroupId = editingPrompt ? `group:${presetDisplayGroupKey(editingPrompt)}` : null;
    useEffect(() => {
        if (editingGroupId) setExpanded(current => current.has(editingGroupId) ? current : new Set([...current, editingGroupId]));
    }, [editingGroupId]);
    const rows = useMemo(() => {
        const result: Row[] = [];
        for (const group of groups) {
            const id = `group:${group.key}`;
            if (group.prompts.length > 1 || preset.displayGroups?.some(item => item.id === group.key)) {
                const open = expanded.has(id) || group.prompts.some(p => p.identifier === editingId);
                result.push({ id, groupKey: group.key, prompts: group.prompts, label: groupLabel(group.key), header: true, grouped: true, open });
                if (!open) continue;
            }
            for (const prompt of group.prompts) result.push({ id: prompt.identifier, groupKey: group.key, prompts: [prompt], label: prompt.name, header: false, grouped: !!prepared.displayGroups?.some(item => item.id === group.key) });
        }
        return result;
    }, [groups, expanded, editingId, preset.displayGroups]);
    const reorder = useCallback((from: number, to: number, after = to > from, intent?: PresetDragIntent) => {
        if ((from === to && intent !== "detach") || !rows[from] || !rows[to]) return;
        const source = rows[from], target = rows[to];        if (intent === "create" && !source.header && !target.grouped) {
            const id = createPresetEditorId("group");
            const assigned = prompts.map(prompt => [source.id, target.id].includes(prompt.identifier) ? { ...prompt, displayGroup: id } : prompt);
            const next = movePresetPrompts(assigned, [source.id], [target.id], after);
            onUpdate({ displayGroups: [...(preset.displayGroups ?? []), { id, name: "新分组" }], prompts: next, prompt_order: next.map(prompt => ({ identifier: prompt.identifier, enabled: preset.prompt_order?.find(entry => entry.identifier === prompt.identifier)?.enabled ?? prompt.enabled })) });
            setExpanded(current => new Set([...current, `group:${id}`])); setAnnouncement("已新建分组"); return;
        }
        if (intent === "detach" && !source.header) {
            const assigned = prompts.map(prompt => prompt.identifier === source.id ? { ...prompt, displayGroup: null } : prompt);
            const boundary = prompts.filter(prompt => presetDisplayGroupKey(prompt) === target.groupKey).map(prompt => prompt.identifier);
            onReorder(movePresetPrompts(assigned, [source.id], boundary, after)); setAnnouncement(`已将${source.label}移出分组`); return;
        }
        const next = source.header || (!intent && source.groupKey !== target.groupKey)
            ? movePresetPrompts(prompts, source.prompts.map(p => p.identifier), target.prompts.map(p => p.identifier), after)
            : movePresetEntryToGroup(prompts, source.id, target.groupKey, target.prompts.map(p => p.identifier), target.header ? false : after);
        if (next === prompts) return;
        onReorder(next);
        if (!source.header && (intent === "join" || source.groupKey === target.groupKey)) setExpanded(current => new Set([...current, `group:${target.groupKey}`]));
        setAnnouncement(source.header ? `已移动${source.label}分组` : `已将${source.label}移入${groupLabel(target.groupKey)}`);
    }, [rows, prompts, onReorder]);
    const drag = usePresetDrag(root, rows, reorder, groupLabel);
    const renderRow = (row: Row) => {
        const index = rows.indexOf(row);
        return <div key={row.id} data-preset-row={row.id} data-preset-group={row.groupKey} className={row.header ? styles.group : styles.entry}>
            {selecting ? <button type="button" role="checkbox"
                aria-checked={row.prompts.length > 0 && row.prompts.every(p => selected.has(p.identifier)) ? true : row.prompts.some(p => selected.has(p.identifier)) ? "mixed" : false}
                aria-label={`${row.header ? "选择整组" : "选择条目"}：${row.label}`}
                disabled={!row.prompts.length} className={styles.selectionCheck}
                onClick={() => toggleSelected(row.prompts.map(p => p.identifier))}>
                <span>{row.prompts.some(p => selected.has(p.identifier)) && (row.prompts.every(p => selected.has(p.identifier)) ? <Check size={12} strokeWidth={3} /> : "−")}</span>
            </button> : <button type="button" className={styles.grip} aria-label={`移动${row.header ? row.label + "分组" : row.label}`}
                title="拖动排序；悬停半秒可合组，横向拖出可独立。Alt + ↑ / ↓ 排序"
                onContextMenu={event => event.preventDefault()}
                onPointerDown={event => drag.onPointerDown(index, event)}
                onClick={event => { if (drag.suppressClick.current) { event.preventDefault(); event.stopPropagation(); drag.suppressClick.current = false; } }}
                onKeyDown={event => {
                    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                    event.preventDefault();
                    const own = new Set(row.prompts.map(p => p.identifier)), direction = event.key === "ArrowUp" ? -1 : 1;
                    let target = index + direction;
                    while (rows[target] && rows[target].prompts.every(p => own.has(p.identifier))) target += direction;
                    if (rows[target]) reorder(index, target);
                }}><GripVertical size={15} /></button>}
            {row.header ? <button type="button" className={styles.groupTitle} aria-expanded={row.open} onClick={() => {
                if (row.open) onCollapse?.();
                setExpanded(current => { const next = new Set(current); if (row.open) next.delete(row.id); else next.add(row.id); return next; });
            }}><span>{row.label}</span><span className={styles.count}>{row.prompts.length}</span><ChevronDown size={15} style={{ transform: row.open ? "rotate(180deg)" : undefined }} /></button>
                : selecting ? <button type="button" className={styles.selectionEntry} onClick={() => toggleSelected([row.id])}>
                    <span>{row.label}</span><small>{promptScopeLabel(row.prompts[0])}</small>
                </button> : <div className={styles.entryBody}>{children(row.prompts[0], prompts.indexOf(row.prompts[0]))}</div>}
            {row.header && !selecting && <details className={styles.groupMenu} data-group-menu onToggle={event => {
                const menu = event.currentTarget;
                if (!menu.open) return;
                menu.removeAttribute("data-open-up");
                const bottom = root.current?.closest(".page-body")?.getBoundingClientRect().bottom ?? window.innerHeight;
                if ((menu.querySelector("div")?.getBoundingClientRect().bottom ?? 0) > bottom - 8) menu.setAttribute("data-open-up", "true");
            }} onKeyDown={event => {
                if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); event.stopPropagation(); }
            }}><summary aria-label={`操作${row.label}分组`}><MoreHorizontal size={17} /></summary>
                <div className={styles.groupMenuItems}>
                    <button type="button" onClick={event => { event.currentTarget.closest("details")!.open = false; setDraftName(row.label); setRenameId(row.groupKey); }}>改名</button>
                    <button type="button" onClick={() => { onCollapse?.(); onUpdate(dissolvePresetGroup(preset, row.groupKey)); }}>解散</button>
                    <button type="button" className={styles.dangerAction} onClick={event => { event.currentTarget.closest("details")!.open = false; setDeleteId(row.groupKey); }}>删除整组</button>
                </div>
            </details>}
        </div>;
    };
    return <>
        <div className={styles.selectionToolbar}>
            <h2>提示词条目 · {preset.prompts.length}</h2>
            {selecting && <button type="button" onClick={() => setSelected(selected.size === prompts.length ? new Set() : new Set(prompts.map(p => p.identifier)))}>{selected.size === prompts.length && prompts.length ? "取消全选" : "全选"}</button>}
            <button type="button" onClick={() => { onCollapse?.(); setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "完成" : "选择"}</button>
        </div>
        {selecting && <p className={styles.selectedCount}>已选 {selected.size} 条</p>}
        {selecting && <div className={styles.bulkActions}>
            <button type="button" disabled={!selected.size || !prepared.displayGroups?.length} onClick={event => { bulkTrigger.current = event.currentTarget; setBulkDialog("existing"); }}>并入已有分组</button>
            <button type="button" disabled={!selected.size} onClick={event => { bulkTrigger.current = event.currentTarget; setNewGroupName(""); setBulkDialog("new"); }}><Plus size={14} />新建分组</button>
        </div>}
        <div ref={root} className={styles.entryList}>
            {groups.map(group => {
                const header = rows.find(row => row.header && row.groupKey === group.key);
                const members = rows.filter(row => !row.header && row.groupKey === group.key);
                return <section key={group.key} data-preset-section={group.key} data-expanded={header?.open || undefined}
                    data-drop-target={drag.hover?.group === group.key || undefined} data-drop-ready={drag.hover?.group === group.key && drag.hover.ready || undefined}
                    className={header ? styles.groupPanel : styles.soloPanel}>
                    {header && renderRow(header)}
                    {(members.length > 0 || header?.open) && <div className={header ? styles.groupContents : undefined}>{members.map(renderRow)}
                        {header?.open && !selecting && <button type="button" className={styles.groupAdd} aria-label={`在${header.label}组新增条目`} onClick={() => onAdd(group.key)}><Plus size={14} />新增条目</button>}
                    </div>}
                </section>;
            })}
        </div>
        <span className={styles.srOnly} role="status">{drag.hover?.ready ? drag.hover.message : announcement}</span>
        {bulkDialog && <div className={styles.groupDialogHost} role="dialog" aria-modal="true" aria-label={bulkDialog === "new" ? "新建分组" : "并入已有分组"} onKeyDown={event => {
            if (event.key === "Escape") { event.stopPropagation(); closeBulkDialog(); }
            if (event.key === "Tab") {
                const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }}>
            <ContentDialog title={bulkDialog === "new" ? "新建分组" : "并入已有分组"} confirmLabel={bulkDialog === "new" ? "创建并移入" : ""} onCancel={closeBulkDialog} onConfirm={() => {
                if (newGroupName.trim()) finishGrouping({ id: createPresetEditorId("group"), name: newGroupName.trim().slice(0, 80) });
            }}>
                <p className={styles.bulkHint}>已选择 {selected.size} 条条目，保留原有注入顺序与适用范围。</p>
                {bulkDialog === "new" ? <label className={styles.groupNameField}>分组名称<input autoFocus aria-label="新分组名称" className="ui-input" value={newGroupName} maxLength={80} onChange={event => setNewGroupName(event.target.value)} onKeyDown={event => {
                    if (event.key === "Enter" && newGroupName.trim()) finishGrouping({ id: createPresetEditorId("group"), name: newGroupName.trim().slice(0, 80) });
                }} /></label> : <div className={styles.groupDestinations}>
                    {prepared.displayGroups?.map((group, index) => <button type="button" autoFocus={index === 0} key={group.id} onClick={() => finishGrouping(group)}>
                        <span>{group.name}</span><small>{prompts.filter(p => p.displayGroup === group.id).length} 条</small>
                    </button>)}
                </div>}
            </ContentDialog>
        </div>}
        {renameId && <div className={styles.groupDialogHost} role="dialog" aria-modal="true" aria-label="分组改名" onKeyDown={event => { if (event.key === "Escape") setRenameId(null); }}>
            <ContentDialog title="分组改名" confirmLabel="保存" onCancel={() => setRenameId(null)} onConfirm={() => {
                if (!draftName.trim()) return;
                onUpdate(renamePresetGroup(preset, renameId, draftName)); setRenameId(null);
            }}><label className={styles.groupNameField}>分组名称<input autoFocus aria-label="分组名称" className="ui-input" value={draftName} maxLength={80} onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && draftName.trim()) { onUpdate(renamePresetGroup(preset, renameId, draftName)); setRenameId(null); } }} /></label></ContentDialog>
        </div>}
        {deleteId && <div className={styles.groupDialogHost} ref={deleteDialog} role="dialog" aria-modal="true" aria-label="删除整组" onKeyDown={event => { if (event.key === "Escape") setDeleteId(null); }}>
            <ConfirmDialog title="删除整组？" message={`将删除「${groupLabel(deleteId)}」及其中 ${prompts.filter(prompt => presetDisplayGroupKey(prompt) === deleteId).length} 条条目。此操作无法撤销。`} icon={AlertCircle} variant="danger" confirmLabel="删除整组" onCancel={() => setDeleteId(null)} onConfirm={() => { onCollapse?.(); onUpdate(deletePresetGroup(preset, deleteId)); setDeleteId(null); }} />
        </div>}
    </>;
}
