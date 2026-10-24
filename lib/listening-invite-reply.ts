/** Observe only the originating chat composer; typing (even then deleting) keeps reply manual. */
export function waitForListeningInviteDraft(composer: HTMLElement | null, onIdle: () => void): () => void {
    let typed = !!composer?.querySelector<HTMLTextAreaElement>(".chat-input-textarea")?.value.trim();
    const detect = (event: Event) => {
        if ((event.target as HTMLElement)?.matches(".chat-input-textarea")) typed = true;
    };
    composer?.addEventListener("input", detect, true);
    const timer = window.setTimeout(() => {
        composer?.removeEventListener("input", detect, true);
        if (!typed) onIdle();
    }, 2000);
    return () => { window.clearTimeout(timer); composer?.removeEventListener("input", detect, true); };
}
