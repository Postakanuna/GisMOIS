import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, Upload, ArrowRight, ArrowLeft } from "lucide-react";

interface JoinExcelDialogProps {
  layerId: number;
  layerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedExcel {
  fileName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  previewRows: Record<string, unknown>[];
}

interface JoinPreviewStats {
  totalFeatures: number;
  matchedFeatures: number;
  unmatchedFeatures: number;
  totalExcelRows: number;
  unmatchedExcelRows: number;
  emptyKeyExcelRows: number;
  uniqueExcelKeys: number;
  uniqueMatchedKeys: number;
}

type Step = "upload" | "configure" | "preview" | "done";

export function JoinExcelDialog({ layerId, layerName, open, onOpenChange }: JoinExcelDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [parsedExcel, setParsedExcel] = useState<ParsedExcel | null>(null);
  const [uploading, setUploading] = useState(false);

  const [layerKeyField, setLayerKeyField] = useState<string>("");
  const [excelKeyColumn, setExcelKeyColumn] = useState<string>("");
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

  const [previewStats, setPreviewStats] = useState<JoinPreviewStats | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [joinResult, setJoinResult] = useState<{ enrichedCount: number; totalFeatures: number; skippedCount: number } | null>(null);

  const { data: layerAttributes } = useQuery<string[]>({
    queryKey: ["/api/editable-layers", layerId, "attributes"],
    enabled: open,
    staleTime: 0,
  });

  const resetState = useCallback(() => {
    setStep("upload");
    setParsedExcel(null);
    setUploading(false);
    setLayerKeyField("");
    setExcelKeyColumn("");
    setSelectedColumns(new Set());
    setPreviewStats(null);
    setPreviewLoading(false);
    setJoinResult(null);
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-excel-for-join", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Ошибка загрузки" }));
        throw new Error(err.message);
      }

      const data: ParsedExcel = await response.json();
      setParsedExcel(data);
      setStep("configure");
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const handleLoadPreview = useCallback(async () => {
    if (!parsedExcel || !layerKeyField || !excelKeyColumn) return;
    setPreviewLoading(true);
    try {
      const response = await apiRequest("POST", `/api/editable-layers/${layerId}/join-preview`, {
        layerKeyField,
        excelKeyColumn,
        rows: parsedExcel.rows,
      });
      const stats: JoinPreviewStats = await response.json();
      setPreviewStats(stats);
      setStep("preview");
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }, [parsedExcel, layerKeyField, excelKeyColumn, layerId, toast]);

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!parsedExcel) throw new Error("Нет данных");
      const columnsToJoin = Array.from(selectedColumns).map(col => ({
        sourceColumn: col,
        targetName: col,
      }));
      const response = await apiRequest("POST", `/api/editable-layers/${layerId}/join-excel`, {
        layerKeyField,
        excelKeyColumn,
        rows: parsedExcel.rows,
        columnsToJoin,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setJoinResult(data);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/editable-layers/${layerId}/attributes`] });
      queryClient.invalidateQueries({ queryKey: ["/api/editable-layers", layerId] });
      toast({ title: "Готово", description: `Обогащено ${data.enrichedCount} объектов` });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const availableExcelColumns = parsedExcel
    ? parsedExcel.columns.filter(c => c !== excelKeyColumn)
    : [];

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const selectAllColumns = () => {
    setSelectedColumns(new Set(availableExcelColumns));
  };

  const deselectAllColumns = () => {
    setSelectedColumns(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (joinMutation.isPending) return;
      if (!v) resetState();
      onOpenChange(v);
    }}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-join-excel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Обогащение слоя из XLSX
          </DialogTitle>
          <DialogDescription>
            Добавление атрибутов к объектам слоя «{layerName}» из файла Excel
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Загрузите XLSX-файл с данными для обогащения. Система сопоставит строки файла с объектами слоя по общему ключевому полю.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
                data-testid="input-join-file"
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-upload-join-file"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {uploading ? "Загрузка..." : "Выбрать XLSX-файл"}
              </Button>
            </div>
          )}

          {step === "configure" && parsedExcel && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{parsedExcel.fileName}</Badge>
                <span className="text-muted-foreground">{parsedExcel.totalRows} строк</span>
              </div>

              <div className="space-y-2">
                <Label>Ключевое поле слоя (для сопоставления)</Label>
                <Select value={layerKeyField} onValueChange={setLayerKeyField}>
                  <SelectTrigger data-testid="select-layer-key-field">
                    <SelectValue placeholder="Выберите поле слоя..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(layerAttributes || []).map(attr => (
                      <SelectItem key={attr} value={attr}>{attr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Ключевой столбец XLSX (для сопоставления)</Label>
                <Select value={excelKeyColumn} onValueChange={setExcelKeyColumn}>
                  <SelectTrigger data-testid="select-excel-key-column">
                    <SelectValue placeholder="Выберите столбец XLSX..." />
                  </SelectTrigger>
                  <SelectContent>
                    {parsedExcel.columns.map(col => (
                      <SelectItem key={col} value={col}>{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {excelKeyColumn && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <Label>Столбцы для добавления</Label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={selectAllColumns} data-testid="button-select-all-columns">
                        Все
                      </Button>
                      <Button variant="ghost" size="sm" onClick={deselectAllColumns} data-testid="button-deselect-all-columns">
                        Сбросить
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border p-2">
                    {availableExcelColumns.map(col => (
                      <label key={col} className="flex items-center gap-2 text-sm cursor-pointer hover-elevate rounded px-1 py-0.5">
                        <Checkbox
                          checked={selectedColumns.has(col)}
                          onCheckedChange={() => toggleColumn(col)}
                          data-testid={`checkbox-column-${col}`}
                        />
                        <span>{col}</span>
                      </label>
                    ))}
                  </div>
                  {selectedColumns.size > 0 && (
                    <p className="text-xs text-muted-foreground">Выбрано столбцов: {selectedColumns.size}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "preview" && previewStats && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Объектов в слое:</span>
                  <span className="font-medium" data-testid="text-join-total-features">{previewStats.totalFeatures}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Сопоставлено:</span>
                  <span className="font-medium text-green-600" data-testid="text-join-matched">{previewStats.matchedFeatures}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Не сопоставлено (в слое):</span>
                  <span className={previewStats.unmatchedFeatures > 0 ? "text-yellow-600" : ""} data-testid="text-join-unmatched-features">{previewStats.unmatchedFeatures}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Строк в XLSX:</span>
                  <span data-testid="text-join-total-excel">{previewStats.totalExcelRows}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Строк без пары (в XLSX):</span>
                  <span className={previewStats.unmatchedExcelRows > 0 ? "text-yellow-600" : ""} data-testid="text-join-unmatched-excel">{previewStats.unmatchedExcelRows}</span>
                </div>
                {previewStats.emptyKeyExcelRows > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Пустой ключ (в XLSX):</span>
                    <span className="text-yellow-600" data-testid="text-join-empty-keys">{previewStats.emptyKeyExcelRows}</span>
                  </div>
                )}
                <div className="flex justify-between flex-wrap gap-1">
                  <span className="text-muted-foreground">Добавляемые столбцы:</span>
                  <span className="font-mono text-xs" data-testid="text-join-columns">{Array.from(selectedColumns).join(", ")}</span>
                </div>
              </div>

              {previewStats.matchedFeatures === 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Ни один объект не сопоставлен. Проверьте выбранные ключевые поля.</span>
                </div>
              )}

              {previewStats.matchedFeatures > 0 && previewStats.unmatchedFeatures > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{previewStats.unmatchedFeatures} объектов слоя не будут обогащены (нет совпадений по ключу)</span>
                </div>
              )}
            </div>
          )}

          {step === "done" && joinResult && (
            <div className="space-y-2 p-3 rounded-md bg-green-500/10 text-sm">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Обогащение завершено
              </div>
              <div className="space-y-1 text-muted-foreground">
                <div>Обогащено объектов: {joinResult.enrichedCount}</div>
                {joinResult.skippedCount > 0 && <div>Пропущено (нет совпадений): {joinResult.skippedCount}</div>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 justify-end">
          {step === "configure" && (
            <>
              <Button variant="outline" onClick={() => { resetState(); }} data-testid="button-join-back-upload">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>
              <Button
                disabled={!layerKeyField || !excelKeyColumn || selectedColumns.size === 0 || previewLoading}
                onClick={handleLoadPreview}
                data-testid="button-join-preview"
              >
                {previewLoading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-1" />
                )}
                Предпросмотр
              </Button>
            </>
          )}

          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("configure")} data-testid="button-join-back-configure">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>
              <Button
                disabled={!previewStats || previewStats.matchedFeatures === 0 || joinMutation.isPending}
                onClick={() => joinMutation.mutate()}
                data-testid="button-join-execute"
              >
                {joinMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                )}
                Обогатить ({previewStats?.matchedFeatures || 0} объектов)
              </Button>
            </>
          )}

          {(step === "upload" || step === "done") && (
            <Button variant="outline" onClick={() => { resetState(); onOpenChange(false); }} data-testid="button-join-close">
              Закрыть
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
