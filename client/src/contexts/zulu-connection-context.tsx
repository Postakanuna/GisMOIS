import { createContext, useContext, type ReactNode } from "react";
import { useZuluConnection } from "@/hooks/use-zulu-connection";

type ZuluConnectionContextType = ReturnType<typeof useZuluConnection>;

const ZuluConnectionContext = createContext<ZuluConnectionContextType | null>(null);

export function ZuluConnectionProvider({ children }: { children: ReactNode }) {
  const zuluConnection = useZuluConnection();
  
  return (
    <ZuluConnectionContext.Provider value={zuluConnection}>
      {children}
    </ZuluConnectionContext.Provider>
  );
}

export function useZuluConnectionContext() {
  const context = useContext(ZuluConnectionContext);
  if (!context) {
    throw new Error("useZuluConnectionContext must be used within ZuluConnectionProvider");
  }
  return context;
}
