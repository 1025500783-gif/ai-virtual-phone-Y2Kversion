import type { ChatAppSettings } from "./chat-storage";
import type { BindingConfig, BindingSlot } from "./settings-types";

export type FloatingToolKey = "promptViewerEnabled" | "quickActionEnabled" | "floatingToolsEnabled";

// Preserve existing preferences, including both legacy switches enabled together.
export function isCombinedToolsEnabled(settings: Partial<ChatAppSettings>): boolean {
    return settings.floatingToolsEnabled === true && !settings.promptViewerEnabled && !settings.quickActionEnabled;
}

export function changeFloatingTool(settings: ChatAppSettings, key: FloatingToolKey, enabled: boolean): ChatAppSettings {
    if (!enabled) return { ...settings, [key]: false };
    return key === "floatingToolsEnabled"
        ? { ...settings, floatingToolsEnabled: true, promptViewerEnabled: false, quickActionEnabled: false }
        : { ...settings, [key]: true, floatingToolsEnabled: false };
}

export type FloatingBindingTarget = { appId: string; characterId?: string };
export function getFloatingBindingSlot(config: BindingConfig, target: FloatingBindingTarget): BindingSlot {
    return target.characterId
        ? config.characterBindings.find(b => b.characterId === target.characterId)?.appOverrides[target.appId] || {}
        : config.appDefaults?.[target.appId] || {};
}

export function updateFloatingBinding(config: BindingConfig, target: FloatingBindingTarget, patch: Partial<BindingSlot>): BindingConfig {
    const slot = { ...getFloatingBindingSlot(config, target), ...patch };
    if (!target.characterId) return { ...config, appDefaults: { ...config.appDefaults, [target.appId]: slot } };
    const existing = config.characterBindings.find(b => b.characterId === target.characterId);
    const next = { characterId: target.characterId, defaults: existing?.defaults || {}, appOverrides: { ...existing?.appOverrides, [target.appId]: slot } };
    return { ...config, characterBindings: existing
        ? config.characterBindings.map(b => b.characterId === target.characterId ? next : b)
        : [...config.characterBindings, next] };
}
