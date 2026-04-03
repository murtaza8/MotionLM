import { useEffect } from "react";

import { useStore } from "@/store";
import {
  restoreFromIDB,
  applyRestoredState,
  subscribeToStore,
  listConversations,
  loadConversation,
} from "@/persistence/idb";
import { EditorLayout } from "@/editor/layout/EditorLayout";

export const App = () => {
  const hydrated = useStore((s) => s.hydrated);
  const setHydrated = useStore((s) => s.setHydrated);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const restored = await restoreFromIDB();
        if (restored) {
          applyRestoredState(restored);
        }

        const AGE_LIMIT_MS = 24 * 60 * 60 * 1000;
        const sessions = await listConversations();
        const recent = sessions[0];
        if (recent && Date.now() - recent.lastActiveAt < AGE_LIMIT_MS) {
          const messages = await loadConversation(recent.sessionId);
          if (messages && messages.length > 0) {
            useStore.setState({
              conversationHistory: messages,
              activeSessionId: recent.sessionId,
            });
          }
        }
      } catch (err) {
        console.error("[motionlm] hydration error:", err);
      } finally {
        setHydrated(true);
      }
    };

    // Subscribe synchronously so the cleanup returned below can unsubscribe.
    // subscribeToStore only writes when state references change, so subscribing
    // before hydration is safe — the first write fires after applyRestoredState
    // sets new references, not on the initial empty state.
    const unsubscribe = subscribeToStore();
    void hydrate();
    return unsubscribe;
  }, [setHydrated]);

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-base)]">
        <span className="text-sm text-[var(--text-tertiary)]">
          Loading project...
        </span>
      </div>
    );
  }

  return <EditorLayout />;
};
