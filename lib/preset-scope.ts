import type { Prompt } from "./settings-types";
import { getPromptTags, normalizePromptScopeTags, getTagsLabel, type TagProfile } from "./content-tag-utils";

/** Invalid/absent data falls back to legacy tags; never broaden a malformed import. */
export function normalizeScopeAlternatives(value: unknown): string[][] | undefined {
    if (!Array.isArray(value) || !value.length) return undefined;
    const result: string[][] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        if (!Array.isArray(entry) || entry.some(tag => typeof tag !== "string" || !tag.trim())) return undefined;
        const tags = normalizePromptScopeTags(entry) ?? [];
        if (!tags.length) return [[]];
        const key = JSON.stringify([...tags].sort());
        if (!seen.has(key)) { result.push(tags); seen.add(key); }
    }
    return result.length ? result : undefined;
}

export function getPromptScopes(prompt: Prompt): string[][] {
    return normalizeScopeAlternatives(prompt.scopeAlternatives) ?? [getPromptTags(prompt)];
}

export function matchesPromptScope(prompt: Prompt, activeTags: string[]): boolean {
    return getPromptScopes(prompt).some(tags => tags.every(tag => activeTags.includes(tag)));
}

export function promptScopeLabel(prompt: Prompt, profiles?: TagProfile[]): string {
    return getPromptScopes(prompt).map(tags => getTagsLabel(tags, profiles)).join(" 或 ");
}

export function promptScopeKey(prompt: Prompt): string {
    return JSON.stringify(getPromptScopes(prompt).map(tags => [...tags].sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function togglePromptScope(prompt: Prompt, tags: string[]): Partial<Prompt> {
    if (!tags.length) return { scopeAlternatives: [[]], tags: undefined, featureTag: undefined, followUpOnly: undefined };
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(t => b.includes(t));
    const current = getPromptScopes(prompt).filter(scope => scope.length);
    const next = current.some(scope => same(scope, tags))
        ? current.filter(scope => !same(scope, tags))
        : [...current, tags];
    // Removing the final selection explicitly returns to universal.
    return { scopeAlternatives: next.length ? next : [[]], tags: undefined, featureTag: undefined, followUpOnly: undefined };
}
