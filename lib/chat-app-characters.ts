import { loadInteractableCharacters } from "./character-storage";
import { withChatCharacterAvatar } from "./chat-session-avatar";

/** Activity presentation only; stored character profiles remain unchanged. */
export function loadActivityCharacters() {
    return loadInteractableCharacters().map(character => withChatCharacterAvatar(null, character));
}

export const loadChatAppCharacters = loadActivityCharacters;
