import { useEffect } from "react";

import { useStore } from "@/store";
import { restoreFromIDB, applyRestoredState, subscribeToStore } from "@/persistence/idb";
import { EditorLayout } from "@/editor/layout/EditorLayout";

export const App = () => {
  const hydrated = useStore((s) => s.hydrated);
  const setHydrated = useStore((s) => s.setHydrated);

  useEffect(() => {
    const hydrate = async () => {
      const restored = await restoreFromIDB();
      if (restored) {
        applyRestoredState(restored);
      }
      setHydrated(true);
      subscribeToStore(); // start auto-save only after hydration
    };
    void hydrate();
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
