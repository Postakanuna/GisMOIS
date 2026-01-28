import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { type ProjectionType, registerProjections, PROJECTION_INFO } from "@/lib/projections";

interface ProjectionContextType {
  currentProjection: ProjectionType;
  setProjection: (projection: ProjectionType) => void;
  projectionInfo: typeof PROJECTION_INFO;
}

const ProjectionContext = createContext<ProjectionContextType | null>(null);

const STORAGE_KEY = "gis-projection";

export function ProjectionProvider({ children }: { children: ReactNode }) {
  const [currentProjection, setCurrentProjection] = useState<ProjectionType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "EPSG:3857" || saved === "EPSG:3395") {
        return saved;
      }
    }
    return "EPSG:3857";
  });

  useEffect(() => {
    registerProjections();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, currentProjection);
  }, [currentProjection]);

  const setProjection = useCallback((projection: ProjectionType) => {
    setCurrentProjection(projection);
  }, []);

  return (
    <ProjectionContext.Provider
      value={{
        currentProjection,
        setProjection,
        projectionInfo: PROJECTION_INFO,
      }}
    >
      {children}
    </ProjectionContext.Provider>
  );
}

export function useProjection() {
  const context = useContext(ProjectionContext);
  if (!context) {
    throw new Error("useProjection must be used within a ProjectionProvider");
  }
  return context;
}
