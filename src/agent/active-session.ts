import { AgentSession } from "./session";
import { useStore } from "@/store";

let activeSession: AgentSession | null = null;

export const getOrCreateSession = (): AgentSession => {
  if (activeSession === null) {
    const { conversationHistory, activeSessionId } = useStore.getState();
    const isRestored = conversationHistory.length > 0 && activeSessionId !== null;
    activeSession = isRestored ? AgentSession.resume() : AgentSession.create();
  }
  return activeSession;
};

export const setActiveSession = (session: AgentSession | null): void => {
  activeSession = session;
};
