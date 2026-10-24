import type { GenerationParameterKey, PresetConfig } from "./settings-types";

export const GENERATION_PARAMETER_KEYS: readonly GenerationParameterKey[] = [
    "temperature", "top_p", "top_k", "min_p", "top_a", "repetition_penalty",
    "frequency_penalty", "presence_penalty", "max_tokens",
];

export function isGenerationParameterKey(value: unknown): value is GenerationParameterKey {
    return typeof value === "string" && GENERATION_PARAMETER_KEYS.includes(value as GenerationParameterKey);
}

export function resolveEnabledGenerationParameters(preset: PresetConfig | null): Set<GenerationParameterKey> {
    if (Array.isArray(preset?.enabled_generation_parameters)) return new Set(preset.enabled_generation_parameters.filter(isGenerationParameterKey));
    const keys = new Set<GenerationParameterKey>(["temperature", "top_p", "frequency_penalty", "presence_penalty"]);
    if (preset?.top_k && preset.top_k > 0) keys.add("top_k");
    if (preset?.min_p && preset.min_p > 0) keys.add("min_p");
    if (preset?.top_a && preset.top_a > 0) keys.add("top_a");
    if (preset?.repetition_penalty !== undefined && preset.repetition_penalty !== 1) keys.add("repetition_penalty");
    if (preset?.openai_max_tokens && preset.openai_max_tokens > 0) keys.add("max_tokens");
    return keys;
}
