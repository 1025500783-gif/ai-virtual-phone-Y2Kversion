"use client";
import "@/styles/chat-retry-versions.css";
import { useEffect, useRef, useState } from "react";

export function RetryGuidanceDialog({ onCancel, onConfirm, preserveFollowing = false, versionIndex = 0, versionCount = 1, onSelectVersion, versionText = "", versionBusy = false }: {
    onCancel: () => void; onConfirm: (guidance: string) => void; preserveFollowing?: boolean;
    versionIndex?: number; versionCount?: number; onSelectVersion?: (index: number) => void; versionText?: string; versionBusy?: boolean;
}) {
    const [text, setText] = useState("");
    const form = useRef<HTMLFormElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        form.current?.querySelector("textarea")?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    return <div className="chat-retry-overlay" onPointerDown={event => event.stopPropagation()} onClick={onCancel}>
        <form ref={form} className="chat-retry-dialog" role="dialog" aria-modal="true" aria-labelledby="retry-guidance-title" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); onConfirm(text); }} onKeyDown={event => {
            if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
            if (event.key === "Tab") {
                const items = [...event.currentTarget.querySelectorAll<HTMLElement>("textarea:not(:disabled),button:not(:disabled),[tabindex='0']")];
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }}>
            <div className="chat-retry-heading"><h3 id="retry-guidance-title">重试指导</h3>
                <div className="chat-retry-version-nav" aria-label="回复版本">
                    <span aria-live="polite">{versionIndex + 1}/{versionCount}</span>
                    <button type="button" aria-label="上一个版本" title="上一个版本" disabled={versionBusy || versionIndex <= 0 || !onSelectVersion} onClick={() => onSelectVersion?.(versionIndex - 1)}><svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M8 1 1 6l7 5Z" fill="currentColor" /></svg></button>
                    <button type="button" aria-label="下一个版本" title="下一个版本" disabled={versionBusy || versionIndex >= versionCount - 1 || !onSelectVersion} onClick={() => onSelectVersion?.(versionIndex + 1)}><svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="m2 1 7 5-7 5Z" fill="currentColor" /></svg></button>
                </div>
            </div>
            {versionText && <div className="chat-retry-version-preview" aria-label="当前回复版本" tabIndex={0}>{versionText}</div>}
            <p>希望这次怎么改？仅指导本次重生成，可留空。</p>
            <textarea aria-label="重试指导" disabled={versionBusy} value={text} onChange={event => setText(event.target.value)} maxLength={2000} placeholder="例如：不要跳过我的问题，语气更自然一点……" />
            <small>{preserveFollowing ? "重试将保留后续聊天记录。" : "重试将替换所选回复及之后的内容，旧内容保留在版本中。"}切换后，取消会保留当前选中版本。</small>
            <div className="chat-retry-actions"><button type="button" disabled={versionBusy} onClick={onCancel}>取消</button><button type="submit" disabled={versionBusy}>开始重试</button></div>
        </form>
    </div>;
}
