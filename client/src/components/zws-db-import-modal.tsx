import { useState, useEffect } from "react";
import { Loader2, Database, CheckSquare, Square, CheckCheck, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
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
  onClose: () => void;
  baseUrl: string;
  username?: string;
  password?: string;
  zwsConnectionId: number | null;
  sceneId: number | null;
}

export function ZwsDbImportModal({
  onClose,
  baseUrl,
  username,
  password,
  zwsConnectionId,
  sceneId,
}: ZwsDbImportModalProps) {
  const [layers, setLayers] = useState<ZwsLayerInfo[]>([]);
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [fetchingLayers, setFetchingLayers] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress[]>([]);

  useEffect(() => {
    if (!baseUrl) return;
    setFetchingLayers(true);
    setFetchError(null);
    fetch("/api/zulu/zws/custom/layers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, username, password }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Не удалось получить список слоёв");
        }
        return res.json();
      })
      .then((data) => {
        const layerList: ZwsLayerInfo[] = (data.layers || []).map((l: any) => ({
          name: l.name,
          title: l.title || l.name,
          geometryType: l.geometryType,
        }));
        setLayers(layerList);
        setSelectedLayers(new Set(layerList.map((l) => l.name)));
      })
      .catch((err: any) => {
        setFetchError(err.message || "Ошибка загрузки слоёв");
      })
      .finally(() => setFetchingLayers(false));
  }, []);

  const toggleLayer = (name: string) => {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelectedLayers(new Set(layers.map((l) => l.name)));
  const deselectAll = () => setSelectedLayers(new Set());

  const handleImport = async () => {
    if (!sceneId || selectedLayers.size === 0) return;
    const toImport = layers.filter((l) => selectedLayers.has(l.name));
    const initialProgress: ImportProgress[] = toImport.map((l) => ({
      layerName: l.name,
      status: "pending",
    }));
    setProgress(initialProgress);
    setImporting(true);

    for (let i = 0; i < toImport.length; i++) {
      const layer = toImport[i];
      setProgress((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: "loading" } : p))
      );
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
          if (res.status === 401) {
            throw new Error(
              "Требуется авторизация — укажите логин и пароль в настройках подключения"
            );
          } else if (res.status === 403) {
            throw new Error("Доступ к слою запрещён");
          } else if (res.status === 404) {
            throw new Error("Слой не найден на сервере");
          } else if (res.status === 422) {
            throw new Error(err.message || "Слой недоступен");
          } else if (res.status === 504) {
            throw new Error("Превышено время ожидания ответа ZWS-сервера");
          } else {
            throw new Error(err.message || "Ошибка импорта");
          }
        }
        const data = await res.json();
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i ? { ...p, status: "done", featureCount: data.featureCount } : p
          )
        );
      } catch (err: any) {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i ? { ...p, status: "error", error: err.message } : p
          )
        );
      }
    }

    await queryClient.invalidateQueries({
      queryKey: ["/api/scenes", sceneId, "editable-layers"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["/api/editable-layers/viewport-batch"],
    });
    setImporting(false);
  };

  const allDone =
    progress.length > 0 &&
    progress.every((p) => p.status === "done" || p.status === "error");

  const handleBeforeClose = () => {
    if (importing) return true;
  };

  const doneCount = progress.filter((p) => p.status === "done").length;
  const totalCount = progress.length;
  const progressPercent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <DraggableModal
      isOpen={true}
      onClose={onClose}
      onBeforeClose={handleBeforeClose}
      title="Загрузка ZWS-слоёв в базу данных"
      headerIcon={<Database className="h-4 w-4 text-primary" />}
      defaultWidth={480}
      defaultHeight={500}
      minWidth={400}
      minHeight={320}
      resizable
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 flex flex-col p-3 gap-3">

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
              <div className="flex items-center justify-between shrink-0">
                <span className="text-sm text-muted-foreground">
                  Выбрано: {selectedLayers.size} из {layers.length}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={selectAll}
                    data-testid="button-select-all-zws"
                  >
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Все
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={deselectAll}
                    data-testid="button-deselect-all-zws"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Снять
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto rounded-md border">
                <div className="p-1.5 space-y-0.5">
                  {layers.map((layer) => (
                    <div
                      key={layer.name}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleLayer(layer.name)}
                      data-testid={`zws-layer-item-${layer.name}`}
                    >
                      <Checkbox
                        checked={selectedLayers.has(layer.name)}
                        onCheckedChange={() => toggleLayer(layer.name)}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`zws-layer-checkbox-${layer.name}`}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {layer.title}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {layer.name}
                          {layer.geometryType && ` · ${layer.geometryType}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {progress.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-sm font-medium">
                  {allDone ? "Импорт завершён" : "Импорт слоёв..."}
                </span>
                <span className="text-xs text-muted-foreground">
                  {doneCount}/{totalCount}
                </span>
              </div>
              {!allDone && (
                <Progress value={progressPercent} className="h-1.5" />
              )}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1 max-h-64">
                {progress.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md bg-muted/30 border"
                  >
                    <div className="flex items-center gap-2">
                      {item.status === "pending" && (
                        <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      {item.status === "loading" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                      )}
                      {item.status === "done" && (
                        <CheckSquare className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                      {item.status === "error" && (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      )}
                      <span className="text-sm truncate">{item.layerName}</span>
                      {item.status === "done" && item.featureCount !== undefined && (
                        <Badge variant="secondary" className="ml-auto text-xs shrink-0">
                          {item.featureCount} объектов
                        </Badge>
                      )}
                    </div>
                    {item.status === "error" && item.error && (
                      <p className="text-xs text-destructive pl-5 leading-snug">
                        {item.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={importing}
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
