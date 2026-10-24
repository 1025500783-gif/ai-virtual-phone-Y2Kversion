import type { ForwardedChat, ForwardedEntry } from "./chat-forward-types";
export type ScreenshotPerspective = { kind: "user" } | { kind: "character"; characterId: string; name: string };

/** Rendering projection only: speaker, text, timestamps and original roles remain immutable. */
export function projectChatScreenshot(record: ForwardedChat, perspective: ScreenshotPerspective): ForwardedChat {
    return { ...record, entries: record.entries.map(entry => {
        const own = perspective.kind === "user" ? entry.isUser : entry.speakerId ? entry.speakerId === perspective.characterId : entry.speaker === perspective.name;
        if (own === entry.isUser) return { ...entry };
        const template = (own ? record.theme?.self : record.theme?.other) || record.entries.find(item => item.isUser === own)?.appearance;
        const bubble = { ...entry.appearance?.bubble };
        for (const key of ["background", "color", "borderRadius", "border", "boxShadow"])
            if (template?.bubble[key]) bubble[key] = template.bubble[key];
        if (!template) { bubble.background = own ? "#38acfc" : "#e9e9eb"; bubble.color = own ? "#fff" : "#202024"; }
        return { ...entry, isUser: own, appearance: { bubble, ...(template?.surface ? { surface: template.surface } : {}), voiceInk: own ? "#fff" : "#38acfc", voiceTextVisible: entry.appearance?.voiceTextVisible } };
    }) };
}

export function screenshotTitle(record: ForwardedChat, perspective: ScreenshotPerspective) {
    if (record.sourceKind === "group") return record.sourceNames?.group || record.title;
    return perspective.kind === "character" ? record.sourceNames?.user || record.entries.find(entry => entry.isUser)?.speaker || record.title : record.sourceNames?.character || record.entries.find(entry => !entry.isUser)?.speaker || record.title;
}
