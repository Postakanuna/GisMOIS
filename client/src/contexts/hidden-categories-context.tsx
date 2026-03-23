import { createContext, useContext, useState, useCallback } from "react";

interface HiddenCategoriesContextValue {
  hiddenCategories: Record<number, Set<string>>;
  toggleCategory: (layerId: number, value: string) => void;
  isHidden: (layerId: number, value: string) => boolean;
  clearLayer: (layerId: number) => void;
}

const HiddenCategoriesContext = createContext<HiddenCategoriesContextValue>({
  hiddenCategories: {},
  toggleCategory: () => {},
  isHidden: () => false,
  clearLayer: () => {},
});

export function HiddenCategoriesProvider({ children }: { children: React.ReactNode }) {
  const [hiddenCategories, setHiddenCategories] = useState<Record<number, Set<string>>>({});

  const toggleCategory = useCallback((layerId: number, value: string) => {
    setHiddenCategories(prev => {
      const current = prev[layerId] ? new Set(prev[layerId]) : new Set<string>();
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      return { ...prev, [layerId]: current };
    });
  }, []);

  const isHidden = useCallback((layerId: number, value: string): boolean => {
    return hiddenCategories[layerId]?.has(value) ?? false;
  }, [hiddenCategories]);

  const clearLayer = useCallback((layerId: number) => {
    setHiddenCategories(prev => {
      const next = { ...prev };
      delete next[layerId];
      return next;
    });
  }, []);

  return (
    <HiddenCategoriesContext.Provider value={{ hiddenCategories, toggleCategory, isHidden, clearLayer }}>
      {children}
    </HiddenCategoriesContext.Provider>
  );
}

export function useHiddenCategories() {
  return useContext(HiddenCategoriesContext);
}
