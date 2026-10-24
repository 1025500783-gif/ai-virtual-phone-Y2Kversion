import type { PresetConfig, Prompt } from "./settings-types";
import { getPromptScopes } from "./preset-scope";
import { resolveContentTagLabel } from "./content-tag-utils";

let editorIdSequence = 0;
/** Local editor IDs must also work on the phone's plain-HTTP LAN origin. */
export function createPresetEditorId(prefix: "prompt" | "group"): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") return `${prefix}-${cryptoApi.randomUUID()}`;
    if (typeof cryptoApi?.getRandomValues === "function") {
        const words = cryptoApi.getRandomValues(new Uint32Array(4));
        return `${prefix}-${Array.from(words, word => word.toString(16).padStart(8, "0")).join("")}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${(++editorIdSequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function presetDisplayGroupKey(prompt: Prompt): string {
    if (prompt.displayGroup === null) return `__ungrouped:${prompt.identifier}`;
    return prompt.displayGroup?.trim() || (prompt.marker ? "__markers__" : getPromptScopes(prompt)[0]?.[0] ?? "__all__");
}

export function normalizePresetGroups(value: unknown): PresetConfig["displayGroups"] {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    return value.flatMap(item => {
        if (!item || typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim() || seen.has(item.id.trim())) return [];
        seen.add(item.id.trim());
        return [{ id: item.id.trim(), name: item.name.trim().slice(0, 80) }];
    });
}

/** One-time migration only. Default App groups become explicit editor groups. */
export function preparePresetGroups(preset: PresetConfig): PresetConfig {
    if (preset.groupingVersion === 1) return { ...preset, prompts: preset.prompts.map(prompt => prompt.displayGroup === undefined ? { ...prompt, displayGroup: null } : prompt) };
    const groups = [...(preset.displayGroups ?? [])];
    const assigned = new Map<string, string>();
    for (const group of groupPresetPrompts(orderedPresetPrompts(preset))) {
        const explicit = groups.some(item => item.id === group.key) || group.prompts.some(prompt => typeof prompt.displayGroup === "string");
        if (!explicit && !(preset.builtIn && group.prompts.length > 1)) continue;
        if (group.key.startsWith("__ungrouped:")) continue;
        if (!groups.some(item => item.id === group.key)) groups.push({ id: group.key, name: group.key === "__markers__" ? "资料与记忆" : group.key === "__all__" ? "通用" : resolveContentTagLabel(group.key) });
        group.prompts.forEach(prompt => assigned.set(prompt.identifier, group.key));
    }
    return { ...preset, groupingVersion: 1, displayGroups: groups, prompts: preset.prompts.map(prompt => ({ ...prompt, displayGroup: assigned.get(prompt.identifier) ?? null })) };
}

export function renamePresetGroup(preset: PresetConfig, id: string, name: string): Partial<PresetConfig> {
    const groups = (preset.displayGroups ?? []).filter(group => group.id !== id);
    return { displayGroups: [...groups, { id, name: name.trim().slice(0, 80) }] };
}

export function dissolvePresetGroup(preset: PresetConfig, id: string): Partial<PresetConfig> {
    return {
        displayGroups: (preset.displayGroups ?? []).filter(group => group.id !== id),
        prompts: preset.prompts.map(prompt => presetDisplayGroupKey(prompt) === id ? { ...prompt, displayGroup: null } : prompt),
    };
}

export function deletePresetGroup(preset: PresetConfig, id: string): Partial<PresetConfig> {
    const removed = new Set(preset.prompts.filter(prompt => presetDisplayGroupKey(prompt) === id).map(prompt => prompt.identifier));
    return {
        displayGroups: (preset.displayGroups ?? []).filter(group => group.id !== id),
        prompts: preset.prompts.filter(prompt => !removed.has(prompt.identifier)),
        prompt_order: preset.prompt_order?.filter(entry => !removed.has(entry.identifier)),
    };
}

/** Group the view only. Membership order always follows the original prompt order. */
export function groupPresetPrompts(prompts: Prompt[]): Array<{ key: string; prompts: Prompt[] }> {
    const groups = new Map<string, Prompt[]>();
    for (const prompt of prompts) {
        const key = presetDisplayGroupKey(prompt);
        const members = groups.get(key) ?? [];
        members.push(prompt);
        groups.set(key, members);
    }
    return [...groups].map(([key, members]) => ({ key, prompts: members }));
}

export function movePresetEntryToGroup(prompts: Prompt[], id: string, group: string, targetIds: string[], after: boolean): Prompt[] {
    const assigned = prompts.map(prompt => prompt.identifier === id ? { ...prompt, displayGroup: group } : prompt);
    return movePresetPrompts(assigned, [id], targetIds, after);
}

export function orderedPresetPrompts(preset: PresetConfig): Prompt[] {
    const seen = new Set<string>();
    const result: Prompt[] = [];
    const append = (p: Prompt | undefined) => {
        if (p && !seen.has(p.identifier)) { seen.add(p.identifier); result.push(p); }
    };
    for (const entry of preset.prompt_order ?? []) append(preset.prompts.find(p => p.identifier === entry.identifier));
    preset.prompts.forEach(append);
    return result;
}

/** A drag moves only the selected IDs. Display grouping never calls this function. */
export function movePresetPrompts(prompts: Prompt[], movingIds: string[], targetIds: string[], after: boolean): Prompt[] {
    const moving = new Set(movingIds);
    const targets = new Set(targetIds.filter(id => !moving.has(id)));
    if (!targets.size) return prompts;
    const rest = prompts.filter(p => !moving.has(p.identifier));
    const positions = rest.flatMap((p, index) => targets.has(p.identifier) ? [index] : []);
    if (!positions.length) return prompts;
    const index = after ? Math.max(...positions) + 1 : Math.min(...positions);
    rest.splice(index, 0, ...prompts.filter(p => moving.has(p.identifier)));
    return rest;
}

/** Bulk organization never changes injection order, scopes or enabled states. */
export function assignPresetPromptsToGroup(preset: PresetConfig, ids: string[], group: { id: string; name: string }): Partial<PresetConfig> {
    const selected = new Set(ids);
    if (!group.id.trim() || !group.name.trim() || !preset.prompts.some(prompt => selected.has(prompt.identifier))) return {};
    return {
        groupingVersion: 1,
        displayGroups: preset.displayGroups?.some(item => item.id === group.id) ? preset.displayGroups : [...(preset.displayGroups ?? []), { id: group.id, name: group.name.trim().slice(0, 80) }],
        prompts: preset.prompts.map(prompt => selected.has(prompt.identifier) ? { ...prompt, displayGroup: group.id } : prompt),
    };
}
