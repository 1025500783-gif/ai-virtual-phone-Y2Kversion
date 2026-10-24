// Nested generation surfaces can override the desktop app while they are mounted.
export type FloatingPageContext = { ownerApp: string; appId: string; characterId?: string; sessionId?: string; label: string };
let context: FloatingPageContext | null = null;
const listeners = new Set<() => void>();
export const getFloatingPageContext = () => context;
export const subscribeFloatingPageContext = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export function registerFloatingPageContext(next: FloatingPageContext) {
    context = next;
    listeners.forEach(listener => listener());
    return () => {
        if (context !== next) return;
        context = null;
        listeners.forEach(listener => listener());
    };
}
