import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DraggableModal } from "@/components/ui/draggable-modal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Settings2, Plus, Trash2, Save, X, Search, ArrowDown, ArrowUpDown, ArrowUp, Filter, CheckSquare, Square, Undo2 } from "lucide-react";
import type { DrawnFeature, AttributeField, AttributeFieldType, LayerSchemaDefinition } from "@shared/schema";

interface PendingEdit {
  featureId: number;
  originalProperties: Record<string, unknown>;
  newProperties: Record<string, unknown>;
}

interface AttributeTableCloseRef {
  tryClose: () => boolean;
}

interface AttributeTableProps {
  features: DrawnFeature[];
  selectedFeatureIds: number[];
  layerSchema: LayerSchemaDefinition | null;
  onFeatureSelect: (featureId: number, multi?: boolean) => void;
  onFeatureUpdate: (featureId: number, properties: Record<string, unknown>) => void;
  onBatchUpdate?: (updates: { id: number; properties: Record<string, unknown> }[]) => Promise<void>;
  onBatchDelete?: (ids: number[]) => void;
  onSchemaUpdate: (fields: AttributeField[]) => void;
  onSelectAll?: (featureIds: number[]) => void;
  onClearSelection?: () => void;
  onRequestClose?: (hasUnsavedChanges: boolean) => void;
  closeRef?: React.MutableRefObject<AttributeTableCloseRef | null>;
  layerName: string;
}

type SortDirection = "asc" | "desc" | null;
type SortConfig = { column: string; direction: SortDirection };
type ColumnFilters = Record<string, string>;

const FIELD_TYPE_LABELS: Record<AttributeFieldType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  boolean: "Да/Нет",
  select: "Список",
};

const ROW_HEIGHT = 36;

export function AttributeTable({
  features,
  selectedFeatureIds,
  layerSchema,
  onFeatureSelect,
  onFeatureUpdate,
  onBatchUpdate,
  onBatchDelete,
  onSchemaUpdate,
  onSelectAll,
  onClearSelection,
  onRequestClose,
  closeRef,
  layerName,
}: AttributeTableProps) {
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [editingFields, setEditingFields] = useState<AttributeField[]>([]);
  const [editingCell, setEditingCell] = useState<{ featureId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasScrolledToSelected, setHasScrolledToSelected] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: "", direction: null });
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  
  const [pendingEdits, setPendingEdits] = useState<Map<number, PendingEdit>>(new Map());
  const [undoStack, setUndoStack] = useState<PendingEdit[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  
  const hasPendingChanges = pendingEdits.size > 0;
  const canUndo = undoStack.length > 0;
  
  const handleCloseRequest = useCallback(() => {
    if (hasPendingChanges) {
      setShowCloseConfirm(true);
    } else {
      onRequestClose?.(false);
    }
  }, [hasPendingChanges, onRequestClose]);
  
  const handleDiscardAndClose = useCallback(() => {
    setPendingEdits(new Map());
    setUndoStack([]);
    setShowCloseConfirm(false);
    onRequestClose?.(false);
  }, [onRequestClose]);
  
  const handleSaveAndClose = useCallback(async () => {
    if (onBatchUpdate && pendingEdits.size > 0) {
      setIsSaving(true);
      try {
        const updates = Array.from(pendingEdits.values()).map(edit => ({
          id: edit.featureId,
          properties: edit.newProperties,
        }));
        await onBatchUpdate(updates);
        setPendingEdits(new Map());
        setUndoStack([]);
        setShowCloseConfirm(false);
        onRequestClose?.(false);
      } finally {
        setIsSaving(false);
      }
    }
  }, [onBatchUpdate, pendingEdits, onRequestClose]);

  useEffect(() => {
    if (closeRef) {
      closeRef.current = {
        tryClose: () => {
          if (hasPendingChanges) {
            setShowCloseConfirm(true);
            return true;
          }
          return false;
        },
      };
    }
    return () => {
      if (closeRef) {
        closeRef.current = null;
      }
    };
  }, [closeRef, hasPendingChanges]);

  const fields = layerSchema?.fields || [];
  
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    _checkbox: 40,
    _id: 60,
    _type: 80,
  });
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredAndSortedFeatures = useMemo(() => {
    let result = [...features];
    
    // Apply global search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(feature => {
        if (feature.id.toString().includes(query)) return true;
        if (feature.geometryType.toLowerCase().includes(query)) return true;
        
        for (const value of Object.values(feature.properties)) {
          if (value !== null && value !== undefined) {
            if (value.toString().toLowerCase().includes(query)) {
              return true;
            }
          }
        }
        return false;
      });
    }
    
    // Apply column filters
    Object.entries(columnFilters).forEach(([column, filterValue]) => {
      if (!filterValue.trim()) return;
      
      const filter = filterValue.toLowerCase();
      result = result.filter(feature => {
        if (column === "_id") {
          return feature.id.toString().includes(filter);
        }
        if (column === "_type") {
          const typeLabel = feature.geometryType === "Point" ? "точка" : 
                           feature.geometryType === "LineString" ? "линия" : "полигон";
          return typeLabel.includes(filter) || feature.geometryType.toLowerCase().includes(filter);
        }
        const value = feature.properties[column];
        if (value === null || value === undefined) return false;
        return value.toString().toLowerCase().includes(filter);
      });
    });
    
    // Apply sorting
    if (sortConfig.column && sortConfig.direction) {
      result.sort((a, b) => {
        let aVal: unknown;
        let bVal: unknown;
        
        if (sortConfig.column === "_id") {
          aVal = a.id;
          bVal = b.id;
        } else if (sortConfig.column === "_type") {
          aVal = a.geometryType;
          bVal = b.geometryType;
        } else {
          aVal = a.properties[sortConfig.column];
          bVal = b.properties[sortConfig.column];
        }
        
        // Handle null/undefined
        if (aVal === null || aVal === undefined) aVal = "";
        if (bVal === null || bVal === undefined) bVal = "";
        
        // Compare
        let comparison = 0;
        if (typeof aVal === "number" && typeof bVal === "number") {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal), "ru");
        }
        
        return sortConfig.direction === "desc" ? -comparison : comparison;
      });
    }
    
    return result;
  }, [features, searchQuery, columnFilters, sortConfig]);

  const filteredFeatures = filteredAndSortedFeatures;
  
  const handleSort = useCallback((column: string) => {
    setSortConfig(prev => {
      if (prev.column !== column) {
        return { column, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { column, direction: "desc" };
      }
      return { column: "", direction: null };
    });
  }, []);
  
  const handleColumnFilterChange = useCallback((column: string, value: string) => {
    setColumnFilters(prev => ({
      ...prev,
      [column]: value
    }));
  }, []);
  
  const handleSelectAll = useCallback(() => {
    if (onSelectAll) {
      const allIds = filteredFeatures.map(f => f.id);
      onSelectAll(allIds);
    }
  }, [filteredFeatures, onSelectAll]);
  
  const handleClearSelection = useCallback(() => {
    if (onClearSelection) {
      onClearSelection();
    }
  }, [onClearSelection]);
  
  const handleCheckboxChange = useCallback((featureId: number, checked: boolean) => {
    // Use multi=true mode for checkbox behavior
    onFeatureSelect(featureId, true);
  }, [onFeatureSelect]);

  const rowVirtualizer = useVirtualizer({
    count: filteredFeatures.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const [currentSelectedIndex, setCurrentSelectedIndex] = useState(0);

  const scrollToSelectedByIndex = useCallback((indexInSelection: number) => {
    if (selectedFeatureIds.length === 0) return;
    
    const safeIndex = indexInSelection % selectedFeatureIds.length;
    const targetId = selectedFeatureIds[safeIndex];
    const rowIndex = filteredFeatures.findIndex(f => f.id === targetId);
    
    if (rowIndex !== -1) {
      rowVirtualizer.scrollToIndex(rowIndex, { align: "center" });
    }
  }, [selectedFeatureIds, filteredFeatures, rowVirtualizer]);

  const scrollToNextSelected = useCallback(() => {
    if (selectedFeatureIds.length === 0) return;
    
    const nextIndex = (currentSelectedIndex + 1) % selectedFeatureIds.length;
    setCurrentSelectedIndex(nextIndex);
    scrollToSelectedByIndex(nextIndex);
  }, [selectedFeatureIds.length, currentSelectedIndex, scrollToSelectedByIndex]);

  const prevSelectedRef = useRef<number[]>([]);
  
  useEffect(() => {
    const selectedChanged = JSON.stringify(prevSelectedRef.current) !== JSON.stringify(selectedFeatureIds);
    
    if (selectedChanged) {
      prevSelectedRef.current = selectedFeatureIds;
      setCurrentSelectedIndex(0);
      setHasScrolledToSelected(false);
    }
  }, [selectedFeatureIds]);

  useEffect(() => {
    if (!hasScrolledToSelected && selectedFeatureIds.length > 0 && filteredFeatures.length > 0) {
      const timer = setTimeout(() => {
        scrollToSelectedByIndex(0);
        setHasScrolledToSelected(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasScrolledToSelected, selectedFeatureIds, filteredFeatures, scrollToSelectedByIndex]);

  useEffect(() => {
    const newWidths: Record<string, number> = { _checkbox: 40, _id: 60, _type: 80 };
    fields.forEach((field) => {
      if (!columnWidths[field.name]) {
        newWidths[field.name] = 120;
      } else {
        newWidths[field.name] = columnWidths[field.name];
      }
    });
    setColumnWidths(newWidths);
  }, [fields]);

  const handleResizeStart = useCallback((e: React.MouseEvent, column: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      column,
      startX: e.clientX,
      startWidth: columnWidths[column] || 100,
    };
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = moveEvent.clientX - resizingRef.current.startX;
      const newWidth = Math.max(40, resizingRef.current.startWidth + delta);
      setColumnWidths(prev => ({ ...prev, [resizingRef.current!.column]: newWidth }));
    };
    
    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [columnWidths]);

  useEffect(() => {
    if (showSchemaDialog) {
      setEditingFields(fields.length > 0 ? [...fields] : []);
    }
  }, [showSchemaDialog, fields]);

  const handleAddField = () => {
    setEditingFields([
      ...editingFields,
      { name: "", type: "text", required: false },
    ]);
  };

  const handleRemoveField = (index: number) => {
    setEditingFields(editingFields.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index: number, updates: Partial<AttributeField>) => {
    setEditingFields(editingFields.map((field, i) => 
      i === index ? { ...field, ...updates } : field
    ));
  };

  const handleSaveSchema = () => {
    const validFields = editingFields.filter(f => f.name.trim() !== "");
    onSchemaUpdate(validFields);
    setShowSchemaDialog(false);
  };

  const startEditing = (featureId: number, field: string, currentValue: unknown) => {
    setEditingCell({ featureId, field });
    setEditValue(currentValue?.toString() || "");
  };

  const getFeatureProperties = useCallback((featureId: number): Record<string, unknown> => {
    const pending = pendingEdits.get(featureId);
    if (pending) {
      return pending.newProperties;
    }
    const feature = features.find(f => f.id === featureId);
    return feature?.properties || {};
  }, [pendingEdits, features]);

  const saveEdit = useCallback(() => {
    if (!editingCell) return;
    
    const feature = features.find(f => f.id === editingCell.featureId);
    if (!feature) return;

    const fieldDef = fields.find(f => f.name === editingCell.field);
    let parsedValue: unknown = editValue;
    
    if (fieldDef?.type === "number") {
      parsedValue = parseFloat(editValue) || 0;
    } else if (fieldDef?.type === "boolean") {
      parsedValue = editValue === "true";
    }

    const currentProps = getFeatureProperties(editingCell.featureId);
    const newProperties = {
      ...currentProps,
      [editingCell.field]: parsedValue,
    };

    const existingPending = pendingEdits.get(editingCell.featureId);
    const originalProperties = existingPending?.originalProperties || feature.properties;
    
    setPendingEdits(prev => {
      const newMap = new Map(prev);
      newMap.set(editingCell.featureId, {
        featureId: editingCell.featureId,
        originalProperties,
        newProperties,
      });
      return newMap;
    });
    
    setUndoStack(prev => [...prev, {
      featureId: editingCell.featureId,
      originalProperties: currentProps,
      newProperties,
    }]);
    
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, features, fields, editValue, getFeatureProperties, pendingEdits]);

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const handleSaveAllChanges = useCallback(async () => {
    if (!onBatchUpdate || pendingEdits.size === 0) return;
    
    setIsSaving(true);
    try {
      const updates = Array.from(pendingEdits.values()).map(edit => ({
        id: edit.featureId,
        properties: edit.newProperties,
      }));
      await onBatchUpdate(updates);
      setPendingEdits(new Map());
      setUndoStack([]);
    } finally {
      setIsSaving(false);
    }
  }, [onBatchUpdate, pendingEdits]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    
    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    
    setPendingEdits(prev => {
      const newMap = new Map(prev);
      const existingPending = newMap.get(lastAction.featureId);
      
      if (existingPending) {
        const feature = features.find(f => f.id === lastAction.featureId);
        if (JSON.stringify(lastAction.originalProperties) === JSON.stringify(feature?.properties)) {
          newMap.delete(lastAction.featureId);
        } else {
          newMap.set(lastAction.featureId, {
            ...existingPending,
            newProperties: lastAction.originalProperties,
          });
        }
      }
      return newMap;
    });
  }, [undoStack, features]);

  const handleDeleteSelected = useCallback(() => {
    if (!onBatchDelete || selectedFeatureIds.length === 0) return;
    onBatchDelete(selectedFeatureIds);
  }, [onBatchDelete, selectedFeatureIds]);

  const renderCellValue = (feature: DrawnFeature, field: AttributeField) => {
    const pendingEdit = pendingEdits.get(feature.id);
    const displayValue = pendingEdit ? pendingEdit.newProperties[field.name] : feature.properties[field.name];
    const isEditing = editingCell?.featureId === feature.id && editingCell?.field === field.name;
    const hasChange = pendingEdit && pendingEdit.newProperties[field.name] !== pendingEdit.originalProperties[field.name];

    if (isEditing) {
      if (field.type === "boolean") {
        return (
          <Switch
            checked={editValue === "true"}
            onCheckedChange={(checked) => {
              setEditValue(checked.toString());
              setTimeout(saveEdit, 0);
            }}
            autoFocus
          />
        );
      }
      
      if (field.type === "select" && field.options) {
        return (
          <Select 
            value={editValue} 
            onValueChange={(val) => {
              setEditValue(val);
              setTimeout(saveEdit, 0);
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      return (
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="h-7 text-xs"
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          onBlur={saveEdit}
          autoFocus
        />
      );
    }

    if (field.type === "boolean") {
      return (
        <Badge 
          variant={displayValue ? "default" : "secondary"} 
          className={`cursor-pointer ${hasChange ? "ring-2 ring-primary ring-offset-1" : ""}`}
          onClick={() => startEditing(feature.id, field.name, displayValue)}
        >
          {displayValue ? "Да" : "Нет"}
        </Badge>
      );
    }

    return (
      <span 
        className={`cursor-pointer hover:bg-muted px-1 rounded truncate block ${hasChange ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
        onClick={() => startEditing(feature.id, field.name, displayValue)}
      >
        {displayValue?.toString() || "-"}
      </span>
    );
  };

  const totalWidth = columnWidths._checkbox + columnWidths._id + columnWidths._type + fields.reduce((sum, f) => sum + (columnWidths[f.name] || 120), 0);
  
  const renderColumnHeader = (column: string, label: string, width: number, canResize = true) => {
    const isSorted = sortConfig.column === column;
    const hasFilter = columnFilters[column]?.trim();
    
    return (
      <div 
        key={column}
        className="relative px-1 py-1 text-left font-medium text-muted-foreground text-xs border-r select-none flex-shrink-0 flex items-center gap-0.5"
        style={{ width }}
      >
        <button
          className="flex items-center gap-0.5 hover:text-foreground transition-colors flex-1 min-w-0"
          onClick={() => handleSort(column)}
          data-testid={`sort-${column}`}
        >
          <span className="truncate">{label}</span>
          {isSorted ? (
            sortConfig.direction === "asc" ? (
              <ArrowUp className="h-3 w-3 shrink-0" />
            ) : (
              <ArrowDown className="h-3 w-3 shrink-0" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />
          )}
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button 
              className={`p-0.5 rounded hover:bg-muted ${hasFilter ? "text-primary" : "opacity-50 hover:opacity-100"}`}
              data-testid={`filter-${column}`}
            >
              <Filter className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <Input
              placeholder="Фильтр..."
              value={columnFilters[column] || ""}
              onChange={(e) => handleColumnFilterChange(column, e.target.value)}
              className="h-7 text-xs"
              data-testid={`filter-input-${column}`}
            />
            {columnFilters[column] && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full mt-1 h-6 text-xs"
                onClick={() => handleColumnFilterChange(column, "")}
              >
                Сбросить
              </Button>
            )}
          </PopoverContent>
        </Popover>
        {canResize && (
          <div
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50"
            onMouseDown={(e) => handleResizeStart(e, column)}
            data-testid={`resize-handle-${column}`}
          />
        )}
      </div>
    );
  };

  if (features.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col h-full" data-testid="attribute-table-container">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium whitespace-nowrap" data-testid="text-layer-name">{layerName}</span>
            <Badge variant="secondary" className="text-xs" data-testid="badge-feature-count">
              {searchQuery || Object.values(columnFilters).some(v => v.trim()) 
                ? `${filteredFeatures.length} из ${features.length}` 
                : `${features.length}`}
            </Badge>
            {selectedFeatureIds.length > 0 && (
              <Badge variant="outline" className="text-xs" data-testid="badge-selected-count">
                Выбрано: {selectedFeatureIds.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onSelectAll && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={handleSelectAll}
                    data-testid="button-select-all"
                  >
                    <CheckSquare className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Выделить все</TooltipContent>
              </Tooltip>
            )}
            {onClearSelection && selectedFeatureIds.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={handleClearSelection}
                    data-testid="button-clear-selection"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Снять выделение</TooltipContent>
              </Tooltip>
            )}
            {onBatchDelete && selectedFeatureIds.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={handleDeleteSelected}
                    data-testid="button-delete-selected"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Удалить выбранные ({selectedFeatureIds.length})</TooltipContent>
              </Tooltip>
            )}
            {hasPendingChanges && (
              <div className="flex items-center gap-1 border-l pl-2 ml-1">
                <Badge variant="secondary" className="text-xs">
                  Изменено: {pendingEdits.size}
                </Badge>
                {onBatchUpdate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="default"
                        className="h-7 w-7 shrink-0"
                        onClick={handleSaveAllChanges}
                        disabled={isSaving}
                        data-testid="button-save-all"
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Сохранить все изменения</TooltipContent>
                  </Tooltip>
                )}
                {canUndo && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={handleUndo}
                        data-testid="button-undo"
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Отменить изменение</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск..."
                className="h-7 w-40 pl-7 text-xs"
                data-testid="input-search"
              />
              {searchQuery && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0 h-7 w-7"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            {selectedFeatureIds.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={scrollToNextSelected}
                    data-testid="button-scroll-to-selected"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {selectedFeatureIds.length > 1 
                    ? `К следующему (${currentSelectedIndex + 1}/${selectedFeatureIds.length})`
                    : "Перейти к выбранному"}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setShowSchemaDialog(true)}
                  data-testid="button-edit-schema"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Настройка атрибутов</TooltipContent>
            </Tooltip>
          </div>
        </div>
        
        <div 
          ref={parentRef}
          className="flex-1 overflow-auto"
          style={{ minHeight: 0 }}
          data-testid="table-scroll-container"
        >
          <div style={{ width: totalWidth, minWidth: "100%" }}>
            <div className="flex border-b bg-background sticky top-0 z-10">
              <div 
                className="px-2 py-2 text-center font-medium text-muted-foreground text-xs border-r select-none flex-shrink-0 flex items-center justify-center"
                style={{ width: columnWidths._checkbox }}
                data-testid="header-checkbox"
              >
              </div>
              {renderColumnHeader("_id", "ID", columnWidths._id)}
              {renderColumnHeader("_type", "Тип", columnWidths._type)}
              {fields.map((field) => (
                <div key={field.name}>
                  {renderColumnHeader(field.name, field.name + (field.required ? " *" : ""), columnWidths[field.name] || 120)}
                </div>
              ))}
            </div>

            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const feature = filteredFeatures[virtualRow.index];
                const isSelected = selectedFeatureIds.includes(feature.id);
                
                return (
                  <div
                    key={feature.id}
                    className={`absolute left-0 flex cursor-pointer border-b hover:bg-muted/50 ${
                      isSelected ? "bg-accent" : ""
                    }`}
                    style={{
                      top: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      height: `${virtualRow.size}px`,
                      width: "100%",
                    }}
                    onClick={(e) => {
                      // If clicking on checkbox area, don't trigger row click
                      const target = e.target as HTMLElement;
                      if (target.closest('[data-checkbox-cell]')) return;
                      onFeatureSelect(feature.id, e.ctrlKey || e.metaKey);
                    }}
                    data-testid={`row-feature-${feature.id}`}
                  >
                    <div 
                      className="px-2 py-1.5 border-r flex items-center justify-center flex-shrink-0"
                      style={{ width: columnWidths._checkbox }}
                      data-checkbox-cell
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleCheckboxChange(feature.id, !!checked)}
                        data-testid={`checkbox-feature-${feature.id}`}
                      />
                    </div>
                    <div 
                      className="px-2 py-1.5 font-mono border-r flex items-center flex-shrink-0"
                      style={{ width: columnWidths._id, fontSize: 12 }}
                    >
                      {feature.id}
                    </div>
                    <div 
                      className="px-2 py-1.5 border-r flex items-center flex-shrink-0"
                      style={{ width: columnWidths._type, fontSize: 12 }}
                    >
                      <Badge variant="outline" style={{ fontSize: 11 }}>
                        {feature.geometryType === "Point" ? "Точка" : 
                         feature.geometryType === "LineString" ? "Линия" : "Полигон"}
                      </Badge>
                    </div>
                    {fields.map((field) => (
                      <div 
                        key={field.name} 
                        className="px-2 py-1.5 border-r flex items-center flex-shrink-0 overflow-hidden"
                        style={{ width: columnWidths[field.name] || 120, fontSize: 12 }}
                      >
                        {renderCellValue(feature, field)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <DraggableModal
        isOpen={showSchemaDialog}
        onClose={() => setShowSchemaDialog(false)}
        title={`Настройка атрибутов: ${layerName}`}
        defaultWidth={700}
        defaultHeight={450}
        minWidth={500}
        minHeight={300}
      >
        <div className="flex flex-col h-full">
          <div className="px-4 py-2 border-b">
            <p className="text-sm text-muted-foreground">
              Определите поля атрибутивной таблицы для слоя "{layerName}"
            </p>
          </div>
          
          <ScrollArea className="flex-1 px-4">
            <div className="grid gap-4 py-4">
              {editingFields.map((field, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4">
                    <Label className="text-xs text-muted-foreground">Название</Label>
                    <Input
                      value={field.name}
                      onChange={(e) => handleFieldChange(index, { name: e.target.value })}
                      placeholder="Название поля"
                      data-testid={`input-field-name-${index}`}
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs text-muted-foreground">Тип</Label>
                    <Select
                      value={field.type}
                      onValueChange={(v) => handleFieldChange(index, { type: v as AttributeFieldType })}
                    >
                      <SelectTrigger data-testid={`select-field-type-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 flex items-end gap-2 h-full pb-1">
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(checked) => handleFieldChange(index, { required: checked })}
                        id={`required-${index}`}
                      />
                      <Label htmlFor={`required-${index}`} className="text-xs">Обяз.</Label>
                    </div>
                  </div>
                  {field.type === "select" && (
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">Варианты</Label>
                      <Input
                        value={field.options?.join(", ") || ""}
                        onChange={(e) => handleFieldChange(index, { 
                          options: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                        })}
                        placeholder="a, b, c"
                      />
                    </div>
                  )}
                  <div className="col-span-1 flex items-end h-full pb-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemoveField(index)}
                      data-testid={`button-remove-field-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              
              <Button
                variant="outline"
                className="w-full"
                onClick={handleAddField}
                data-testid="button-add-field"
              >
                <Plus className="h-4 w-4 mr-2" />
                Добавить поле
              </Button>
            </div>
          </ScrollArea>
          
          <div className="flex justify-end gap-2 px-4 py-3 border-t shrink-0">
            <Button variant="outline" onClick={() => setShowSchemaDialog(false)}>
              Отмена
            </Button>
            <Button onClick={handleSaveSchema} data-testid="button-save-schema">
              Сохранить
            </Button>
          </div>
        </div>
      </DraggableModal>

      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              У вас есть {pendingEdits.size} несохранённых изменений.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap gap-2">
            <AlertDialogCancel onClick={() => setShowCloseConfirm(false)}>
              Отмена
            </AlertDialogCancel>
            <Button variant="destructive" onClick={handleDiscardAndClose}>
              Не сохранять
            </Button>
            <AlertDialogAction onClick={handleSaveAndClose} disabled={isSaving}>
              {isSaving ? "..." : "Сохранить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
