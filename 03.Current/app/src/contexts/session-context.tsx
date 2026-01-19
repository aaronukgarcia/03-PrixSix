"use client";

import { createContext, useContext, ReactNode } from "react";

interface SessionContextState {
  sessionId: string | null;
}

export const SessionContext = createContext<SessionContextState>({ sessionId: null });

interface SessionProviderProps {
  children: ReactNode;
  sessionId: string | null;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ children, sessionId }) => {
  return (
    <SessionContext.Provider value={{ sessionId }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  return context;
};
