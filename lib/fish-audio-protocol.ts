import type { VoiceApiConfig } from "./settings-types";

export const FISH_AUDIO_BASE_URL = "https://api.fish.audio/v1";
export const FISH_AUDIO_FREE_MODEL = "s2.1-pro-free";
// Unknown IDs fall back on the provider; retired S1 will also be substituted.
export const FISH_AUDIO_MODELS = [FISH_AUDIO_FREE_MODEL, "s2.1-pro", "s2-pro", "drama-3"];
export const FISH_AUDIO_FREE_UNTIL = Date.parse("2026-12-01T00:00:00Z");

export function fishAudioSpeechRequest(text: string, config: VoiceApiConfig, now = Date.now()) {
    if (!config.model || !FISH_AUDIO_MODELS.includes(config.model)) throw new Error("请选择有效的 Fish Audio 模型；不会自动使用默认模型");
    if (config.model === FISH_AUDIO_FREE_MODEL && (!Number.isFinite(now) || now >= FISH_AUDIO_FREE_UNTIL)) throw new Error("Fish Audio 已到当前免费期截止时间，请等待免费政策核实；不会切换付费模型");
    if (config.baseUrl && config.baseUrl !== FISH_AUDIO_BASE_URL) throw new Error("Fish Audio 仅支持官方接口地址");
    if (!config.apiKey?.trim()) throw new Error("Fish Audio API Key 未配置");
    if (!config.defaultVoice?.trim()) throw new Error("请填写 Fish Audio 音色 ID（reference_id）");
    return {
        url: `${FISH_AUDIO_BASE_URL}/tts`,
        headers: { Authorization: `Bearer ${config.apiKey.trim()}`, "Content-Type": "application/json", Accept: "audio/mpeg", model: config.model },
        body: { text: fishAudioSpeechText(text), reference_id: config.defaultVoice.trim(), format: "mp3", sample_rate: 44100, mp3_bitrate: 128 },
    };
}

export function fishAudioSpeechText(text: string): string {
    const aliases: Record<string, string> = {
        chuckles: "chuckling", laughs: "laughing", sighs: "sighing", whispers: "whispering",
        "clears throat": "clear throat", "short pause": "break", "long pause": "long-break",
    };
    return text.replace(/\[([a-zA-Z][a-zA-Z ,'-]{0,100})\]/g, (whole, cue: string) => aliases[cue.toLowerCase()] ? `[${aliases[cue.toLowerCase()]}]` : whole);
}
