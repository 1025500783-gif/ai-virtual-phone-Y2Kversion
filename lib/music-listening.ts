import type { MusicControlSnapshot } from "./music-control-bridge";

export type TimedLyric = { time: number; text: string };
export type MusicListeningContext = {
    version: 1;
    identityId: string | null;
    capturedAt: string;
    trackId: string;
    title: string;
    artist: string;
    position: number;
    isPlaying: boolean;
    lines: TimedLyric[];
    reference?: TimedLyric;
    selectedLines?: TimedLyric[];
};

export const MUSIC_LISTENING_INSTRUCTION = "音乐是对话背景，不是每轮必答话题。优先回应用户当前的文字、需求和情绪；持续播放、换歌或一起听状态本身不要求点评、引用歌词或追问。具体歌词只依据用户明确分享的歌词卡或输入的文字，不猜测用户此刻听到哪一句，也不声称实时听到了某句。\n角色可以出于自己的兴趣、已有经历或当前话题，按意图选择推荐歌曲或邀请此刻一起听，使用对应的分享或邀请协议；无需等待用户索要，也不设置分享频率或每轮任务。近期已分享或讨论过时，除非有新的相关内容，不重复推荐、复述歌词或硬拉回音乐。\n可依据歌曲与歌手信息理解整首歌；角色是否认识、听过、喜欢，结合生活环境、经历及已有听歌记录判断。模型知识不等于角色经历，不凭年龄、职业或性格标签分配品味，不虚构熟悉程度，不为迎合用户假装喜欢。歌词或歌名不能直接证明用户的动机，结合附言和对话判断；只表达当前互动需要的部分，不输出分析过程。";

const cache = new Map<string, TimedLyric[]>();
export function parseTimedLyrics(lrc: string): TimedLyric[] {
    const cached = cache.get(lrc);
    if (cached) return cached;
    const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    const lines: TimedLyric[] = [];
    for (const row of lrc.split(/\r?\n/)) {
        const stamps = [...row.matchAll(/\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g)];
        if (!stamps.length) continue;
        const text = row.replace(/\[[^\]]*\]/g, "").trim();
        for (const stamp of stamps) {
            lines.push({ time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) - offset), text });
        }
    }
    lines.sort((a, b) => a.time - b.time);
    const unique = lines.filter((line, i) => !i || line.time !== lines[i - 1].time || line.text !== lines[i - 1].text);
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    cache.set(lrc, unique);
    return unique;
}

const compact = (text: string, limit: number) => text.replace(/\s+/g, " ").trim().slice(0, limit);
export function createMusicListeningContext(
    snapshot: MusicControlSnapshot, identityId: string | null, capturedAt: string,
    reference?: TimedLyric,
): MusicListeningContext | undefined {
    const track = snapshot.currentTrack;
    if (!track || !Number.isFinite(snapshot.currentTime)) return;
    const lyrics = parseTimedLyrics(track.lyrics || "");
    let index = lyrics.length - 1;
    while (index >= 0 && lyrics[index].time > snapshot.currentTime) index--;
    // Keep blank timestamps: instrumental gaps must not be labelled as singing.
    const lines = index < 0 ? [] : [...lyrics.slice(0, index).filter(line => line.text).slice(-2), lyrics[index]];
    if (!lines.length && !reference) return;
    return {
        version: 1, identityId, capturedAt, trackId: track.id,
        title: compact(track.title, 100), artist: compact(track.artist, 100),
        position: Math.max(0, snapshot.currentTime), isPlaying: snapshot.isPlaying,
        lines: lines.map(line => ({ time: line.time, text: compact(line.text, 240) })),
        ...(reference ? { reference: { time: reference.time, text: compact(reference.text, 240) } } : {}),
    };
}

export function lyricTimestamp(time: number): string {
    const seconds = Math.max(0, Math.floor(time));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function musicListeningHistoryText(message: { role: string; listeningContext?: MusicListeningContext | null }, body: string): string {
    const context = message.listeningContext;
    if (message.role !== "user" || !context?.reference) return body;
    const heading = `[用户分享歌词：${compact(context.title, 100)} · ${compact(context.artist, 100)}]`;
    const reference = context.reference;
    const lines = (context.selectedLines?.length ? context.selectedLines : [reference]).map(line => `明确引用 ${lyricTimestamp(line.time)}：${compact(line.text, 240)}`);
    return `${body}\n${heading}\n${lines.join("\n")}`;
}
