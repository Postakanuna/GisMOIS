import { useState, useCallback, useRef, useEffect } from "react";
import { Search, MapPin, Hash, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { DrawnFeature } from "@shared/schema";

type SearchMode = "address" | "object";

interface MapSearchBarProps {
  onZoomToCoordinates: (lat: number, lon: number, zoom?: number) => void;
  onZoomToFeature: (feature: DrawnFeature) => void;
}

export function MapSearchBar({ onZoomToCoordinates, onZoomToFeature }: MapSearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("address");
  const [isSearching, setIsSearching] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setResultText(null);

    try {
      if (mode === "address") {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) throw new Error("Ошибка поиска");
        const data = await res.json();
        if (data.found) {
          onZoomToCoordinates(data.lat, data.lon, 16);
          setResultText(data.address);
        } else {
          toast({ title: "Адрес не найден", description: "Попробуйте уточнить запрос", variant: "destructive" });
        }
      } else {
        const id = parseInt(trimmed);
        if (isNaN(id)) {
          toast({ title: "Неверный ID", description: "Введите числовой ID объекта", variant: "destructive" });
          return;
        }
        const res = await fetch(`/api/features/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            toast({ title: "Объект не найден", description: `Объект с ID ${id} не найден`, variant: "destructive" });
          } else {
            throw new Error("Ошибка поиска");
          }
          return;
        }
        const feature: DrawnFeature = await res.json();
        onZoomToFeature(feature);
        const props = feature.properties as Record<string, unknown> | null;
        const name = props?.["name"] || props?.["Наименование"] || props?.["NAME"] || props?.["название"];
        setResultText(name ? `#${feature.id} — ${name}` : `Объект #${feature.id}`);
      }
    } catch (error) {
      console.error("Search error:", error);
      toast({ title: "Ошибка поиска", description: "Не удалось выполнить поиск", variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  }, [query, mode, onZoomToCoordinates, onZoomToFeature, toast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResultText(null);
    inputRef.current?.focus();
  }, []);

  const toggleMode = useCallback(() => {
    setMode(prev => prev === "address" ? "object" : "address");
    setQuery("");
    setResultText(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="px-3 py-2 border-b shrink-0" data-testid="map-search-bar">
      <div className="flex items-center gap-1 rounded-md border bg-muted/30 px-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={toggleMode}
          title={mode === "address" ? "Режим: поиск адреса. Нажмите для переключения на поиск по ID" : "Режим: поиск по ID. Нажмите для переключения на поиск адреса"}
          data-testid="button-toggle-search-mode"
        >
          {mode === "address" ? <MapPin className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}
        </Button>
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === "address" ? "Поиск адреса..." : "ID объекта..."}
          className="h-7 flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm px-1"
          data-testid="input-map-search"
        />
        {query && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={clearSearch} data-testid="button-clear-search">
            <X className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleSearch}
          disabled={isSearching || !query.trim()}
          data-testid="button-search"
        >
          {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="mt-1 text-xs text-muted-foreground truncate min-h-[1.25rem]" data-testid="text-search-result">
        {resultText || "\u00A0"}
      </div>
    </div>
  );
}
