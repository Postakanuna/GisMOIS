import { useState, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DraggableModal } from "@/components/ui/draggable-modal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/contexts/scene-context";
import {
  Loader2,
  MapPin,
  Navigation,
  Check,
  X,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  Search,
} from "lucide-react";

interface ExcelColumn {
  index: number;
  name: string;
  detectedType: string;
}

interface ExcelParseResult {
  fileName: string;
  columns: ExcelColumn[];
  previewRows: Record<string, unknown>[];
  allRows: Record<string, unknown>[];
  totalRows: number;
}

type ColumnRole = "latitude" | "longitude" | "address" | "attribute" | "skip";

interface ColumnMapping {
  role: ColumnRole;
  targetName: string;
}

interface ExcelImportModalProps {
  parseResult: ExcelParseResult;
  onClose: () => void;
  onSuccess: () => void;
}

export function ExcelImportModal({ parseResult, onClose, onSuccess }: ExcelImportModalProps) {
  const { toast } = useToast();
  const { currentSceneId } = useScene();
  
  const [layerName, setLayerName] = useState(
    parseResult.fileName.replace(/\.(xlsx?|xls)$/i, "")
  );
  
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>(() => {
    const initial: Record<string, ColumnMapping> = {};
    for (const col of parseResult.columns) {
      if (col.detectedType === "latitude") {
        initial[col.name] = { role: "latitude", targetName: col.name };
      } else if (col.detectedType === "longitude") {
        initial[col.name] = { role: "longitude", targetName: col.name };
      } else {
        initial[col.name] = { role: "attribute", targetName: col.name };
      }
    }
    return initial;
  });

  const latitudeColumn = useMemo(() => {
    for (const [colName, mapping] of Object.entries(columnMappings)) {
      if (mapping.role === "latitude") return colName;
    }
    return null;
  }, [columnMappings]);

  const longitudeColumn = useMemo(() => {
    for (const [colName, mapping] of Object.entries(columnMappings)) {
      if (mapping.role === "longitude") return colName;
    }
    return null;
  }, [columnMappings]);

  const addressColumn = useMemo(() => {
    for (const [colName, mapping] of Object.entries(columnMappings)) {
      if (mapping.role === "address") return colName;
    }
    return null;
  }, [columnMappings]);

  const attributeColumns = useMemo(() => {
    return Object.entries(columnMappings)
      .filter(([_, mapping]) => mapping.role === "attribute")
      .map(([colName, mapping]) => ({
        sourceColumn: colName,
        targetName: mapping.targetName,
      }));
  }, [columnMappings]);

  const hasCoordinates = !!latitudeColumn && !!longitudeColumn;
  const hasAddress = !!addressColumn;
  const isValid = (hasCoordinates || hasAddress) && layerName.trim();

  const handleRoleChange = useCallback((columnName: string, role: ColumnRole) => {
    setColumnMappings(prev => {
      const newMappings = { ...prev };
      
      if (role === "latitude" || role === "longitude" || role === "address") {
        for (const [key, mapping] of Object.entries(newMappings)) {
          if (mapping.role === role && key !== columnName) {
            newMappings[key] = { ...mapping, role: "attribute" };
          }
        }
      }

      if (role === "address") {
        for (const [key, mapping] of Object.entries(newMappings)) {
          if ((mapping.role === "latitude" || mapping.role === "longitude") && key !== columnName) {
            newMappings[key] = { ...mapping, role: "attribute" };
          }
        }
      }

      if (role === "latitude" || role === "longitude") {
        for (const [key, mapping] of Object.entries(newMappings)) {
          if (mapping.role === "address" && key !== columnName) {
            newMappings[key] = { ...mapping, role: "attribute" };
          }
        }
      }
      
      newMappings[columnName] = {
        ...prev[columnName],
        role,
      };
      
      return newMappings;
    });
  }, []);

  const handleTargetNameChange = useCallback((columnName: string, targetName: string) => {
    setColumnMappings(prev => ({
      ...prev,
      [columnName]: {
        ...prev[columnName],
        targetName,
      },
    }));
  }, []);

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/editable-layers/import-excel", {
        name: layerName.trim(),
        rows: parseResult.allRows,
        columnMapping: {
          latitudeColumn: latitudeColumn || "",
          longitudeColumn: longitudeColumn || "",
          addressColumn: addressColumn || "",
          attributes: attributeColumns,
        },
        sceneId: currentSceneId,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Ошибка импорта");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", currentSceneId, "editable-layers"] });
      const geocodeInfo = data.geocoded ? " (через геокодирование)" : "";
      toast({
        title: "Импорт завершён",
        description: `Создано ${data.importedCount} точек${geocodeInfo}${data.skippedCount > 0 ? `, пропущено ${data.skippedCount} строк` : ""}`,
      });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка импорта",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getRoleBadge = (role: ColumnRole) => {
    switch (role) {
      case "latitude":
        return <Badge variant="default" className="bg-green-600"><MapPin className="h-3 w-3 mr-1" />Широта</Badge>;
      case "longitude":
        return <Badge variant="default" className="bg-blue-600"><Navigation className="h-3 w-3 mr-1" />Долгота</Badge>;
      case "address":
        return <Badge variant="default" className="bg-purple-600"><Search className="h-3 w-3 mr-1" />Адрес</Badge>;
      case "attribute":
        return <Badge variant="secondary"><Check className="h-3 w-3 mr-1" />Атрибут</Badge>;
      case "skip":
        return <Badge variant="outline" className="text-muted-foreground"><X className="h-3 w-3 mr-1" />Пропустить</Badge>;
    }
  };

  const formatCellValue = (value: unknown, maxLen = 50): string => {
    if (value === null || value === undefined) return "";
    let str = typeof value === "object" ? JSON.stringify(value) : String(value);
    str = str.replace(/\n/g, " ");
    if (str.length > maxLen) str = str.slice(0, maxLen) + "...";
    return str;
  };

  return (
    <DraggableModal
      isOpen={true}
      title="Импорт из Excel"
      onClose={onClose}
      defaultWidth={900}
      defaultHeight={600}
      minWidth={700}
      minHeight={400}
    >
      <div className="flex flex-col h-full gap-4 p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="layer-name">Название слоя</Label>
            <Input
              id="layer-name"
              value={layerName}
              onChange={(e) => setLayerName(e.target.value)}
              placeholder="Введите название слоя"
              data-testid="input-excel-layer-name"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Badge variant="outline">
              {parseResult.totalRows} строк
            </Badge>
            <Badge variant="outline">
              {parseResult.columns.length} колонок
            </Badge>
          </div>
        </div>

        {!hasCoordinates && !hasAddress ? (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-sm">
              Укажите колонки с координатами (широта/долгота) или колонку с адресом для геокодирования
            </span>
          </div>
        ) : null}

        {hasAddress ? (
          <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-md">
            <Search className="h-4 w-4 text-purple-500" />
            <span className="text-sm">
              Адреса будут геокодированы через Яндекс Геокодер. Для {parseResult.totalRows} строк это может занять до {Math.ceil(parseResult.totalRows / 40)} сек.
            </span>
          </div>
        ) : null}

        <div className="flex-1 border rounded-md overflow-hidden">
          <div className="bg-muted/50 border-b p-2">
            <span className="text-sm font-medium">Настройка колонок</span>
          </div>
          
          <ScrollArea className="h-[calc(100%-40px)]">
            <div className="p-3 space-y-3">
              {parseResult.columns.map((col) => {
                const mapping = columnMappings[col.name];
                return (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 p-2 border rounded-md bg-card overflow-hidden"
                    data-testid={`column-mapping-${col.index}`}
                  >
                    <div className="min-w-0 w-[200px] shrink-0">
                      <div className="font-medium text-sm truncate">{col.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {formatCellValue(parseResult.previewRows[0]?.[col.name], 30)}
                      </div>
                    </div>
                    
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    
                    <select
                      value={mapping?.role || "attribute"}
                      onChange={(e) => handleRoleChange(col.name, e.target.value as ColumnRole)}
                      className="w-[160px] shrink-0 h-9 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid={`select-role-${col.index}`}
                    >
                      <option value="latitude">Широта</option>
                      <option value="longitude">Долгота</option>
                      <option value="address">Адрес (геокодер)</option>
                      <option value="attribute">Атрибут</option>
                      <option value="skip">Пропустить</option>
                    </select>

                    {mapping?.role === "attribute" && (
                      <Input
                        value={mapping.targetName}
                        onChange={(e) => handleTargetNameChange(col.name, e.target.value)}
                        placeholder="Имя в БД"
                        className="w-[140px] shrink-0"
                        data-testid={`input-target-name-${col.index}`}
                      />
                    )}

                    <div className="w-[90px] shrink-0 flex justify-end">
                      {getRoleBadge(mapping?.role || "attribute")}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-shrink-0 border rounded-md overflow-hidden">
          <div className="bg-muted/50 border-b p-2 flex items-center justify-between">
            <span className="text-sm font-medium">Предпросмотр данных</span>
            <span className="text-xs text-muted-foreground">
              Показаны первые {Math.min(5, parseResult.previewRows.length)} из {parseResult.totalRows} строк
            </span>
          </div>
          
          <ScrollArea className="max-h-[150px]">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    {parseResult.columns
                      .filter(col => columnMappings[col.name]?.role !== "skip")
                      .map((col) => (
                        <th key={col.name} className="px-2 py-1 text-left border-r whitespace-nowrap">
                          {columnMappings[col.name]?.role === "attribute" 
                            ? columnMappings[col.name].targetName 
                            : col.name}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.previewRows.slice(0, 5).map((row, idx) => (
                    <tr key={idx} className="border-t">
                      {parseResult.columns
                        .filter(col => columnMappings[col.name]?.role !== "skip")
                        .map((col) => (
                          <td key={col.name} className="px-2 py-1 border-r truncate max-w-[150px]">
                            {formatCellValue(row[col.name])}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-sm text-muted-foreground">
            {hasCoordinates ? (
              <span className="text-green-600">
                <Check className="h-4 w-4 inline mr-1" />
                Координаты настроены
              </span>
            ) : hasAddress ? (
              <span className="text-purple-600">
                <Search className="h-4 w-4 inline mr-1" />
                Геокодирование по адресу
              </span>
            ) : (
              <span className="text-amber-500">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                Укажите координаты или адрес
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-excel-import">
              Отмена
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={!isValid || importMutation.isPending}
              data-testid="button-confirm-excel-import"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {hasAddress ? "Геокодирование..." : "Импорт..."}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Импортировать
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </DraggableModal>
  );
}
