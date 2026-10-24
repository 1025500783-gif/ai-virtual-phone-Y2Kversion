// This version travels with the code. Bump it together with a public release.
export const YYK_VERSION = "1.2.0";
export const YYK_REPOSITORY = "https://github.com/Yyk-Y2k/ai-virtual-phone-Y2Kversion";
export const YYK_UPDATE_URL = "https://raw.githubusercontent.com/Yyk-Y2k/ai-virtual-phone-Y2Kversion/main/public/yyk-update.json";
export const YYK_UPDATE_KEY = "float-yyk-update-preferences-v1";
export type UpdateNotice = { version: string; date: string; changes: { title: string; text: string }[] };
export type UpdatePreferences = { seenVersion?: string; checkedAt?: number; notice?: UpdateNotice; dismissed?: string; laterVersion?: string; laterUntil?: number };
const versionParts = (value: unknown): number[] | null => typeof value === "string" && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value) ? value.split(".").map(Number) : null;
export function newerVersion(candidate: string, current: string): boolean {
    const a = versionParts(candidate), b = versionParts(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}
export function parseUpdate(value: unknown): UpdateNotice | null {
    if (!value || typeof value !== "object") return null;
    const d = value as Record<string, unknown>;
    if (d.schema !== 1 || d.published !== true || !versionParts(d.version)
        || typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
        || !Array.isArray(d.changes) || d.changes.length < 1 || d.changes.length > 8) return null;
    const changes: UpdateNotice["changes"] = [];
    for (const item of d.changes) {
        if (!item || typeof item.title !== "string" || !item.title.trim() || item.title.length > 80
            || typeof item.text !== "string" || item.text.length > 240) return null;
        changes.push({ title: item.title, text: item.text });
    }
    return { version: d.version as string, date: d.date, changes };
}
export function readUpdatePreferences(storage: Pick<Storage, "getItem">): UpdatePreferences {
    try {
        const d = JSON.parse(storage.getItem(YYK_UPDATE_KEY) || "{}");
        if (!d || typeof d !== "object") return {};
        const notice = parseUpdate({ ...d.notice, schema: 1, published: true });
        return { seenVersion: versionParts(d.seenVersion) ? d.seenVersion : undefined, notice: notice || undefined, checkedAt: Number.isFinite(d.checkedAt) ? d.checkedAt : undefined,
            dismissed: versionParts(d.dismissed) ? d.dismissed : undefined,
            laterVersion: versionParts(d.laterVersion) ? d.laterVersion : undefined,
            laterUntil: Number.isFinite(d.laterUntil) ? d.laterUntil : undefined };
    } catch { return {}; }
}
export function shouldShowUpdate(notice: UpdateNotice, preferences: UpdatePreferences, now = Date.now()): boolean {
    return newerVersion(notice.version, YYK_VERSION) && preferences.dismissed !== notice.version
        && !(preferences.laterVersion === notice.version && (preferences.laterUntil || 0) > now);
}
export async function fetchUpdate(signal: AbortSignal): Promise<UpdateNotice | null> {
    try {
        const response = await fetch(YYK_UPDATE_URL, { signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) return null;
        const text = await response.text();
        if (text.length > 16000) return null;
        return parseUpdate(JSON.parse(text));
    } catch { return null; }
}
