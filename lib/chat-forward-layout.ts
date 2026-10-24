import type { ForwardedChat, ForwardedEntry } from "./chat-forward-types";
import { shouldShowTimestamp } from "./chat-time";

/** Same sender/time boundaries as the original iMessage conversation. */
export function forwardedEntryLayout(record: ForwardedChat, index: number) {
    const entry = record.entries[index];
    const sameRun = (left: ForwardedEntry | undefined, right: ForwardedEntry | undefined) => !!left && !!right
        && left.isUser === right.isUser
        && (left.speakerId || left.speaker) === (right.speakerId || right.speaker)
        && !shouldShowTimestamp(right.createdAt, left.createdAt);
    const consecutive = sameRun(record.entries[index - 1], entry);
    const groupSpeaker = (record.sourceKind === "group" || record.origin === "character_composed") && !entry.isUser;
    return { consecutive, groupSpeaker, showName: groupSpeaker && !consecutive, showAvatar: groupSpeaker && !sameRun(entry, record.entries[index + 1]) };
}
