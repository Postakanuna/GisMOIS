import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface Scene {
  id: number;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  role: "owner" | "editor" | "viewer";
}

interface SceneContextType {
  currentScene: Scene | null;
  currentSceneId: number | null;
  setCurrentSceneId: (id: number | null) => void;
  isLoading: boolean;
  canEdit: boolean;
  isOwner: boolean;
}

const SceneContext = createContext<SceneContextType | null>(null);

export function SceneProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [currentSceneId, setCurrentSceneIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem("currentSceneId");
    return stored ? parseInt(stored) : null;
  });

  const { data: currentScene, isLoading } = useQuery<Scene>({
    queryKey: ["/api/scenes", currentSceneId],
    enabled: !!currentSceneId,
  });

  const setCurrentSceneId = (id: number | null) => {
    if (id === null) {
      localStorage.removeItem("currentSceneId");
    } else {
      localStorage.setItem("currentSceneId", String(id));
    }
    setCurrentSceneIdState(id);
  };

  useEffect(() => {
    if (location === "/" && !currentSceneId && !isLoading) {
      setLocation("/gis/scenes");
    }
  }, [location, currentSceneId, isLoading, setLocation]);

  const canEdit = currentScene?.role === "owner" || currentScene?.role === "editor";
  const isOwner = currentScene?.role === "owner";

  return (
    <SceneContext.Provider
      value={{
        currentScene: currentScene || null,
        currentSceneId,
        setCurrentSceneId,
        isLoading,
        canEdit,
        isOwner,
      }}
    >
      {children}
    </SceneContext.Provider>
  );
}

export function useScene() {
  const context = useContext(SceneContext);
  if (!context) {
    throw new Error("useScene must be used within a SceneProvider");
  }
  return context;
}
