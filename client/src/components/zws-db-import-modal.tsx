import { useState, useEffect, useCallback } from "react";
import { Loader2, Database, CheckSquare, Square, CheckCheck, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { queryClient } from "@/lib/queryClient";

interface ZwsLayerInfo {
  name: string;
  title: string;
  geometryType?: string;
}

interface ImportProgress {
  layerName: string;
  status: "pending" | "loading" | "done" | "error";
  featureCount?: number;
  error?: string;
}

interface ZwsDbImportModalProps {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  username?: string;
  password?: string;
  zwsConnectionId: number | null;
  sceneId: number | null;
  onSuccess?: () => void;
}

export function ZwsDbImportModal({
  open,
  onClose,
  baseUrl,
  username,
  password,
  zwsConnectionId,
  sceneId,
  onSuccess,
}: ZwsDbImportModalProps) {
  const [layers, setLayers] = useState<ZwsLayerInfo[]>([]);
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [fetchingLayers, setFetchingLayers] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress[]>([]);

  const fetchLayers = useCallback(async () => {
    if (!baseUrl) return;
    setFetchingLayers(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/zulu/zws/custom/layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, username, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Не удалось получить список слоёв");
      }
      const data = await res.json();
      const layerList: ZwsLayerInfo[] = (data.layers || []).map((l: any) => ({
        name: l.name,
        title: l.title || l.name,
        geometryType: l.geometryType,
      }));
      setLayers(layerList);
      setSelectedLayers(new Set(layerList.map(l => l.name)));
    } catch (err: any) {
      setFetchError(err.message || "Ошибка загрузки слоёв");
    } finally {
      setFetchingLayers(false);
    }
  }, [baseUrl, username, password]);

  useEffect(() => {
    if (open) {
      setLayers([]);
      setSelectedLayers(new Set());
      setFetchError(null);
      setProgress([]);
      setImporting(false);
      fetchLayers();
    }
  }, [open, fetchLayers]);

  const toggleLayer = (name: string) => {
    setSelectedLayers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelectedLayers(new Set(layers.map(l => l.name)));
  const deselectAll = () => setSelectedLayers(new Set());

  const handleImport = async () => {
    if (!sceneId || selectedLayers.size === 0) return;
    const toImport = layers.filter(l => selectedLayers.has(l.name));
    const initialProgress: ImportProgress[] = toImport.map(l => ({ layerName: l.name, status: "pending" }));
    setProgress(initialProgress);
    setImporting(true);

    for (let i = 0; i < toImport.length; i++) {
      const layer = toImport[i];
      setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: "loading" } : p));
      try {
        const res = await fetch("/api/zulu/zws/import-to-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            layerName: layer.name,
            displayName: layer.title,
            geometryType: layer.geometryType,
            sceneId,
            zwsConnectionId,
            baseUrl,
            username,
            password,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Ошибка импорта");
        }
        const data = await res.json();
        setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: "done", featureCount: data.featureCount } : p));
      } catch (err: any) {
        setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: "error", error: err.message } : p));
      }
    }

    await queryClient.invalidateQueries({ queryKey: ["/api/scenes", sceneId, "editable-layers"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/editable-layers/viewport-batch"] });
    setImporting(false);
    onSuccess?.();
  };

  const handleBeforeClose = () => {
    if (importing && !allDone) return true;
  };

  const doneCount = progress.filter(p => p.status === "done").length;
  const totalCount = progress.length;
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const allDone = progress.length > 0 && progress.every(p => p.status === "done" || p.status === "error");

  return (
    <DraggableModal
      isOpen={open}
      onClose={onClose}
      onBeforeClose={handleBeforeClose}
      title="Загрузка ZWS-слоёв в базу данных"
      headerIcon={<Database className="h-4 w-4 text-primary" />}
      defaultWidth={480}
      defaultHeight={480}
      minWidth={400}
      minHeight={300}
      resizable
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-auto p-4 space-y-4 min-h-0">
          {fetchingLayers && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Получение списка слоёв...
            </div>
          )}

          {fetchError && (
            <div className="flex items-center gap-2 text-sm text-destructive rounded-md bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {fetchError}
            </div>
          )}

          {!fetchingLayers && !fetchError && layers.length > 0 && !importing && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Выбрано: {selectedLayers.size} из {layers.length}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={selectAll} data-testid="button-select-all-zws">
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Все
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={deselectAll} data-testid="button-deselect-all-zws">
                    <X className="h-3 w-3 mr-1" />
                    Снять
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1 rounded-md border" style={{ maxHeight: "calc(100% - 110px)" }}>
                <div className="p-2 space-y-0.5">
                  {layers.map(layer => (
                    <div
                      key={layer.name}
                      className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      onClick={() => toggleLayer(layer.name)}
                      data-testid={`zws-layer-item-${layer.name}`}
                    >
                      <Checkbox
                        checked={selectedLayers.has(layer.name)}
                        onCheckedChange={() => toggleLayer(layer.name)}
                        data-testid={`checkbox-zws-layer-${layer.name}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{layer.title}</p>
                        {layer.title !== layer.name && (
                          <p className="text-xs text-muted-foreground truncate">{layer.name}</p>
                        )}
                      </div>
                      {layer.geometryType && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {layer.geometryType}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          {importing && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Загрузка слоёв в БД...</span>
                <span className="font-medium">{doneCount} / {totalCount}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <ScrollArea className="rounded-md border" style={{ maxHeight: "calc(100% - 120px)" }}>
                <div className="p-2 space-y-0.5">
                  {progress.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded">
                      {p.status === "pending" && <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
                      {p.status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                      {p.status === "done" && <CheckSquare className="h-4 w-4 text-green-500 shrink-0" />}
                      {p.status === "error" && <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className={`flex-1 truncate ${p.status === "error" ? "text-destructive" : ""}`}>
                        {p.layerName}
                      </span>
                      {p.status === "done" && p.featureCount !== undefined && (
                        <span className="text-xs text-muted-foreground shrink-0">{p.featureCount} объектов</span>
                      )}
                      {p.status === "error" && (
                        <span className="text-xs text-destructive shrink-0 max-w-[120px] truncate">{p.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={importing && !allDone}
            data-testid="button-cancel-zws-import"
          >
            {allDone ? "Закрыть" : "Отмена"}
          </Button>
          {!allDone && (
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importing || selectedLayers.size === 0 || !sceneId || fetchingLayers}
              data-testid="button-start-zws-import"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Загрузка...
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  Загрузить выбранные ({selectedLayers.size})
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
