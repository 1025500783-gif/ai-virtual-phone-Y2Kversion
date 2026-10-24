import { loadBindingConfig, loadVoiceConfigs, resolveBinding } from "./settings-storage";
import { elevenLabsVoiceInstruction } from "./voice-guides/elevenlabs";
import { fishAudioVoiceInstruction } from "./voice-guides/fish-audio";

const expressiveModels = new Set(["eleven_v3", "eleven_v4", "eleven_v4_turbo"]);
export const VOICE_EXPRESSION_GUIDANCE_ENABLED = true;
export function supportsVoiceExpression(provider: string, model: string | undefined): boolean {
    return provider === "FishAudio" ? ["s2.1-pro-free", "s2.1-pro", "s2-pro", "drama-3"].includes(model || "") : provider === "ElevenLabs" && expressiveModels.has(model?.trim() || "");
}
export function voiceExpressionInstruction(characterIds: string[], call = false): string {
    if (!VOICE_EXPRESSION_GUIDANCE_ENABLED) return "";
    const bindings = loadBindingConfig();
    const configs = loadVoiceConfigs();
    const fishIds: string[] = [];
    const elevenIds: string[] = [];
    for (const id of new Set(characterIds)) {
        const slot = resolveBinding(bindings, id, "chat");
        const config = configs.find(item => item.id === slot.voiceConfigId);
        if (!config || !supportsVoiceExpression(config.provider, config.model)) continue;
        (config.provider === "FishAudio" ? fishIds : elevenIds).push(id);
    }
    return [
        elevenIds.length ? elevenLabsVoiceInstruction(elevenIds, call) : "",
        fishIds.length ? fishAudioVoiceInstruction(fishIds, call) : "",
    ].filter(Boolean).join("\n\n");
}

// A separate marker avoids nested [] breaking the existing voice-message envelope.
const marker = /\{voice\s*[:：]\s*([^{}]*)\}/gi;
const directionAliases: Record<string, string> = {
    "呼气": "exhales", "叹气": "sighs", "叹息": "sighs", "深吸气": "inhales deeply",
    "短停顿": "short pause", "长停顿": "long pause", "停顿": "pause",
    "低沉": "low tone", "清嗓子": "clears throat", "清嗓": "clears throat",
    "轻笑": "chuckles", "笑": "laughs", "耳语": "whispers", "喊叫": "shouting",
};
export function voiceDisplayText(text: string): string {
    return text.replace(marker, "").trim();
}
export function voiceSpeechText(text: string): string {
    return text.replace(marker, (_whole, direction: string) => {
        const value = direction.trim();
        const translated = directionAliases[value];
        if (translated) return `[${translated}]`;
        // Unknown malformed directions must never become spoken dialogue.
        return /^[a-zA-Z][a-zA-Z ,'-]{0,100}$/.test(value) ? `[${value}]` : "";
    }).trim();
}

/** Reuse authored cues only while they still belong to the current transcript. */
export function voicePlaybackText(transcript: string, authoredSpeech?: string): string {
    const fallback = voiceSpeechText(transcript);
    if (!authoredSpeech) return fallback;
    const authored = voiceSpeechText(authoredSpeech);
    const withoutDirections = authored.replace(/\[[a-zA-Z][a-zA-Z ,'-]{0,100}\]/g, "");
    const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
    return normalized(withoutDirections) === normalized(voiceDisplayText(transcript)) ? authored : fallback;
}

/** Keep prior authored vocal/scene cues available to the next model turn. */
export function voiceHistoryText(transcript: string, authoredSpeech?: string): string {
    if (!authoredSpeech) return transcript || "语音消息";
    const withMarkers = voiceSpeechText(authoredSpeech)
        .replace(/\[([a-zA-Z][a-zA-Z ,'-]{0,100})\]/g, "{voice:$1}");
    const normalized = (text: string) => voiceDisplayText(text).replace(/\s+/g, " ").trim();
    return normalized(withMarkers) === normalized(transcript) ? withMarkers : transcript || "语音消息";
}
