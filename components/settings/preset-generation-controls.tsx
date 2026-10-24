"use client";

import { useId } from "react";
import type { GenerationParameterKey, PresetConfig } from "@/lib/settings-types";
import { resolveEnabledGenerationParameters } from "@/lib/generation-parameters";
import styles from "./preset-controls.module.css";

const controls: Array<{ key: GenerationParameterKey; field: keyof PresetConfig; name: string; min: number; max: number; step: number; fallback: number }> = [
    { key: "temperature", field: "temperature", name: "Temperature", min: 0, max: 2, step: .05, fallback: .8 },
    { key: "top_p", field: "top_p", name: "Top P", min: 0, max: 1, step: .05, fallback: 1 },
    { key: "top_k", field: "top_k", name: "Top K", min: 0, max: 100, step: 1, fallback: 0 },
    { key: "min_p", field: "min_p", name: "Min P", min: 0, max: 1, step: .01, fallback: 0 },
    { key: "top_a", field: "top_a", name: "Top A", min: 0, max: 1, step: .01, fallback: 0 },
    { key: "repetition_penalty", field: "repetition_penalty", name: "重复惩罚", min: 1, max: 2, step: .05, fallback: 1 },
    { key: "frequency_penalty", field: "frequency_penalty", name: "频率惩罚", min: -2, max: 2, step: .05, fallback: 0 },
    { key: "presence_penalty", field: "presence_penalty", name: "存在惩罚", min: -2, max: 2, step: .05, fallback: 0 },
    { key: "max_tokens", field: "openai_max_tokens", name: "输出 Token 上限", min: 0, max: 8192, step: 128, fallback: 0 },
];

export function PresetGenerationControls({ preset, onChange }: { preset: PresetConfig; onChange: (updates: Partial<PresetConfig>) => void }) {
    const id = useId();
    const enabled = resolveEnabledGenerationParameters(preset);
    return <div className={styles.wide}>
        <p className={styles.hint}>关闭后不发送该预设参数。接口必需的输出上限与任务专用预算仍会保留。</p>
        <div className={styles.parameters}>{controls.map(control => {
            const value = typeof preset[control.field] === "number" ? preset[control.field] as number : control.fallback;
            const active = enabled.has(control.key);
            const updateValue = (raw: string) => {
                if (!raw.trim()) return;
                const number = Number(raw);
                if (!Number.isFinite(number)) return;
                const next = Math.max(control.min, control.key === "max_tokens" ? Math.floor(number) : Math.min(control.max, number));
                onChange({ [control.field]: next });
            };
            return <div key={control.key} className={`${styles.parameter} ${control.key === "max_tokens" ? styles.wide : ""}`}>
                <div className={styles.parameterHeader}>
                    <label htmlFor={`${id}-${control.key}`}>{control.name}</label>
                <input id={`${id}-${control.key}`} type="number" min={control.min} max={control.key === "max_tokens" ? undefined : control.max}
                    step={control.step} disabled={!active} value={value} onChange={event => updateValue(event.target.value)} />
                    <button type="button" className={styles.switch} aria-pressed={active} aria-label={`发送 ${control.name}`}
                        onClick={() => {
                            const next = new Set(enabled);
                            if (active) next.delete(control.key); else next.add(control.key);
                            onChange({ enabled_generation_parameters: [...next] });
                        }}><span /></button>
                </div>
                <input type="range" aria-label={`${control.name}滑块`} min={control.min} max={Math.max(control.max, value)} step={control.step}
                    disabled={!active} value={value} onChange={event => updateValue(event.target.value)} />
                {control.key === "max_tokens" && <span className={styles.hint}>0 表示不指定预设上限</span>}
            </div>;
        })}</div>
    </div>;
}
