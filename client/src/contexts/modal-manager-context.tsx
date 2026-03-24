import { createContext, useContext, useRef, useCallback, type ReactNode } from "react";

interface ModalManagerContextType {
  bringToFront: () => number;
}

const ModalManagerContext = createContext<ModalManagerContextType>({
  bringToFront: () => 100,
});

export function ModalManagerProvider({ children }: { children: ReactNode }) {
  const counterRef = useRef(100);

  const bringToFront = useCallback(() => {
    counterRef.current += 1;
    return counterRef.current;
  }, []);

  return (
    <ModalManagerContext.Provider value={{ bringToFront }}>
      {children}
    </ModalManagerContext.Provider>
  );
}

export function useModalManager() {
  return useContext(ModalManagerContext);
}
