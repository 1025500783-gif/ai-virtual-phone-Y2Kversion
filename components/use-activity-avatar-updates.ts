"use client";

import { useEffect, useState } from "react";

const events = ["chat-session-avatars-updated", "chat-characters-updated", "user-identities-updated", "settings-updated", "settings-bindings-updated", "chat-sessions-updated", "focus"];

/** Refresh activity presentation without saving a copy of a profile or chat avatar. */
export function useActivityAvatarUpdates(): number {
    const [revision, refresh] = useState(0);
    useEffect(() => {
        const update = () => refresh(value => value + 1);
        events.forEach(event => window.addEventListener(event, update));
        // Catch writes between the initial render and subscribing (including hydration).
        update();
        return () => events.forEach(event => window.removeEventListener(event, update));
    }, []);
    return revision;
}
