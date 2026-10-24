import { kvGet, kvSetAsync } from "./kv-db";
import { CHAT_RETRY_VERSIONS_PREFIX as PREFIX } from "./chat-retry-version-store";
import { loadChatMessages, restoreChatRetryMessages, type ChatMessage } from "./chat-storage";
import { loadChatOfflineTurns, restoreChatRetryOfflineTurns, type ChatOfflineTurn } from "./chat-offline-storage";

type Row = ChatMessage | ChatOfflineTurn;
export type RetryVersion = { rows: Row[]; memberIds: string[]; createdAt: string; parent?: number };
export type RetrySeries = { id: string; sessionId: string; kind: "tail" | "notice" | "offline"; anchorBeforeId?: string; active: number; versions: RetryVersion[]; pending?: { beforeIds: string[] } };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function load(sessionId: string): RetrySeries[] {
    const raw = kvGet(PREFIX + sessionId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(series => series.sessionId !== sessionId || !Array.isArray(series.versions)
        || series.versions.some((version: RetryVersion) => !Array.isArray(version.rows) || !Array.isArray(version.memberIds) || version.rows.some(row => row.sessionId !== sessionId)))) throw new Error("重试版本数据异常，未改动聊天记录");
    return parsed;
}
async function save(series: RetrySeries) {
    const all = load(series.sessionId), index = all.findIndex(item => item.id === series.id);
    if (index < 0) all.push(series); else all[index] = series;
    await kvSetAsync(PREFIX + series.sessionId, JSON.stringify(all));
}
const currentRows = (series: RetrySeries): Row[] => series.kind === "offline" ? loadChatOfflineTurns(series.sessionId) : loadChatMessages(series.sessionId);
function tailStart(series: RetrySeries, rows: Row[]): number {
    if (!series.anchorBeforeId) return 0;
    const index = rows.findIndex(row => row.id === series.anchorBeforeId);
    if (index < 0) throw new Error("这段聊天的前文已变动，不能安全切换版本");
    return index + 1;
}
/** Keep a split response/whole group round and its tool protocol together. */
export function retryMessageStart(rows: ChatMessage[], targetId: string, series?: RetrySeries): number {
    if (series?.kind === "tail") return tailStart(series, rows);
    let index = rows.findIndex(row => row.id === targetId);
    if (index < 0) return index;
    const target = rows[index];
    if (target.role === "assistant") {
        const first = rows.findIndex(row => target.responseRoundId ? row.responseRoundId === target.responseRoundId : target.responseBatchId ? row.responseBatchId === target.responseBatchId : row.id === target.id);
        if (first >= 0) index = first;
        while (true) {
            const executions = new Set(rows.slice(index).map(row => row.toolExecutionId).filter(Boolean));
            const linked = rows.findIndex(row => Boolean(row.toolExecutionId && executions.has(row.toolExecutionId)));
            if (linked < 0 || linked >= index) break;
            index = linked;
        }
    }
    return index;
}
function capture(series: RetrySeries, rows: Row[]): Row[] {
    if (series.kind === "notice") {
        const ids = new Set(series.versions[series.active].memberIds);
        return copy(rows.filter(row => ids.has(row.id)));
    }
    return copy(rows.slice(tailStart(series, rows)));
}
export function findRetrySeries(sessionId: string, targetId: string, offline = false): RetrySeries | undefined {
    for (const series of load(sessionId).reverse()) {
        if ((series.kind === "offline") !== offline) continue;
        if (series.pending) {
            const rows = currentRows(series), old = new Set(series.pending.beforeIds);
            const generated = rows.filter(row => !old.has(row.id));
            if (generated.some(row => row.id === targetId && (!('role' in row) || row.role !== "user"))) {
                const recovered = copy(series);
                recovered.versions.push({ rows: recovered.kind === "notice" ? copy(generated) : copy(rows.slice(tailStart(recovered,rows))), memberIds: generated.filter(row => !('role' in row) || row.role !== "user").map(row=>row.id), parent: recovered.active, createdAt: new Date().toISOString() });
                recovered.active = recovered.versions.length - 1;
                delete recovered.pending;
                return recovered;
            }
        }
        const active = series.versions.findIndex(version => version.memberIds.includes(targetId));
        if (active >= 0) return copy({ ...series, active });
    }
}

/** On reopening a room, finish an interrupted local journal without invoking AI. */
export async function recoverPendingRetryVersions(sessionId: string): Promise<boolean> {
    let changed = false;
    for (const series of load(sessionId)) {
        if (!series.pending) continue;
        const rows = currentRows(series), sourceIds = new Set(series.versions[series.active].memberIds);
        if (rows.some(row => sourceIds.has(row.id))) {
            // Preparation was interrupted before replacement; retain current edits.
            series.versions[series.active].rows = capture(series, rows);
            delete series.pending;
            await save(series);
        } else {
            const recovered = await finishRetryVersion(series, series.pending.beforeIds);
            delete recovered.pending;
            await save(recovered);
        }
        changed = true;
    }
    return changed;
}
/** Persist the source before the existing retry path removes anything. */
export async function beginRetryVersion(sessionId: string, targetId: string, kind: RetrySeries["kind"], existing?: RetrySeries): Promise<RetrySeries> {
    const rows: Row[] = kind === "offline" ? loadChatOfflineTurns(sessionId) : loadChatMessages(sessionId);
    const index = kind === "tail" ? retryMessageStart(rows as ChatMessage[], targetId, existing) : rows.findIndex(row => row.id === targetId);
    if (index < 0) throw new Error("所选回复已不存在");
    const target = rows.find(row => row.id === targetId) as ChatMessage | undefined;
    const members = kind === "tail" && target?.role === "assistant" ? (rows as ChatMessage[]).slice(index).filter(row => row.id === targetId || Boolean(target.responseRoundId && row.responseRoundId === target.responseRoundId) || Boolean(target.responseBatchId && row.responseBatchId === target.responseBatchId)).map(row => row.id) : [targetId];
    const series = copy(existing ?? { id: `retry_${Date.now()}_${Math.random().toString(36).slice(2,9)}`, sessionId, kind,
        anchorBeforeId: rows[index - 1]?.id, active: 0, versions: [{ rows: [], memberIds: members, createdAt: new Date().toISOString() }] });
    if (series.sessionId !== sessionId || series.kind !== kind) throw new Error("重试版本与当前回复不一致");
    series.versions[series.active].rows = capture(series, rows);
    series.pending = { beforeIds: rows.map(row => row.id) };
    await save(series);
    return series;
}
export async function finishRetryVersion(series: RetrySeries, beforeIds: string[]): Promise<RetrySeries> {
    if (!load(series.sessionId).some(item => item.id === series.id)) return series;
    const rows = currentRows(series), before = new Set(beforeIds);
    const generated = rows.filter(row => !before.has(row.id));
    if (!generated.some(row => !('role' in row) || row.role === "assistant")) {
        const original = series.versions[series.active].rows, originalIds = new Set(original.map(row => row.id));
        if (series.kind === "offline") await restoreChatRetryOfflineTurns(series.sessionId, [...rows.slice(0,tailStart(series,rows)),...original,...generated.filter(row => !originalIds.has(row.id))] as ChatOfflineTurn[]);
        else await restoreChatRetryMessages(series.sessionId, series.kind === "notice" ? generated.map(row=>row.id) : rows.slice(tailStart(series,rows)).map(row=>row.id), [...original,...generated.filter(row=>!originalIds.has(row.id))] as ChatMessage[]);
        return series;
    }
    const memberIds = generated.filter(row => !('role' in row) || row.role !== "user").map(row => row.id);
    if (!memberIds.length) return series;
    const next = copy(series), parent = next.active;
    delete next.pending;
    next.versions.push({ rows: next.kind === "notice" ? copy(generated) : copy(rows.slice(tailStart(next, rows))), memberIds, createdAt: new Date().toISOString(), parent });
    next.active = next.versions.length - 1;
    await save(next);
    return next;
}
/** Save edits/following chat in the outgoing variant; arrows never invoke AI. */
export async function selectRetryVersion(series: RetrySeries, index: number): Promise<RetrySeries> {
    if (!load(series.sessionId).some(item => item.id === series.id)) throw new Error("重试版本已清除，请重新打开窗口");
    if (!Number.isInteger(index) || index < 0 || index >= series.versions.length) throw new Error("没有这个重试版本");
    if (index === series.active) return series;
    const rows = currentRows(series), fingerprint = JSON.stringify(rows), next = copy(series);
    next.versions[next.active].rows = capture(next, rows);
    next.active = index;
    // All alternatives reach durable storage before replacing the visible branch.
    await save(next);
    const restored = copy(next.versions[index].rows);
    try {
        if (JSON.stringify(currentRows(series)) !== fingerprint) throw new Error("聊天记录刚刚发生变化，请重新打开重试窗口");
        if (next.kind === "offline") await restoreChatRetryOfflineTurns(next.sessionId, [...rows.slice(0,tailStart(next,rows)),...restored] as ChatOfflineTurn[]);
        else {
            const removed = next.kind === "notice" ? next.versions.flatMap(version => version.memberIds) : rows.slice(tailStart(next,rows)).map(row => row.id);
            await restoreChatRetryMessages(next.sessionId, removed, restored as ChatMessage[]);
        }
    } catch (error) {
        next.active = series.active;
        await save(next);
        throw error;
    }
    return next;
}

export function retrySourceText(series: RetrySeries | undefined, targetId: string): string {
    if (!series) return "";
    const rows = series.versions[series.active].rows;
    if (series.kind === "offline") return (rows.find(row => row.id === targetId) as ChatOfflineTurn | undefined)?.assistantContent ?? "";
    const target = rows.find(row => row.id === targetId) as ChatMessage | undefined;
    if (!target || target.role !== "assistant") return "";
    return (rows as ChatMessage[]).filter(row => row.id === targetId || Boolean(target.responseRoundId && row.responseRoundId === target.responseRoundId) || Boolean(target.responseBatchId && row.responseBatchId === target.responseBatchId)).map(row => row.content).join("\n");
}
