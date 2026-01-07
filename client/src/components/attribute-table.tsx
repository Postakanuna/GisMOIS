import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Settings2, 
  Plus, 
  Trash2, 
  Save,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { DrawnFeature, AttributeField, AttributeFieldType, LayerSchemaDefinition } from "@shared/schema";

interface AttributeTableProps {
  features: DrawnFeature[];
  selectedFeatureIds: number[];
  layerSchema: LayerSchemaDefinition | null;
  onFeatureSelect: (featureId: number, multi?: boolean) => void;
  onFeatureUpdate: (featureId: number, properties: Record<string, unknown>) => void;
  onSchemaUpdate: (fields: AttributeField[]) => void;
  layerName: string;
}

const FIELD_TYPE_LABELS: Record<AttributeFieldType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  boolean: "Да/Нет",
  select: "Список",
};

export function AttributeTable({
  features,
  selectedFeatureIds,
  layerSchema,
  onFeatureSelect,
  onFeatureUpdate,
  onSchemaUpdate,
  layerName,
}: AttributeTableProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [editingFields, setEditingFields] = useState<AttributeField[]>([]);
  const [editingCell, setEditingCell] = useState<{ featureId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const fields = layerSchema?.fields || [];

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

  const saveEdit = () => {
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

    onFeatureUpdate(editingCell.featureId, {
      ...feature.properties,
      [editingCell.field]: parsedValue,
    });
    
    setEditingCell(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const renderCellValue = (feature: DrawnFeature, field: AttributeField) => {
    const value = feature.properties[field.name];
    const isEditing = editingCell?.featureId === feature.id && editingCell?.field === field.name;

    if (isEditing) {
      if (field.type === "boolean") {
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={editValue === "true"}
              onCheckedChange={(checked) => setEditValue(checked.toString())}
            />
            <Button size="sm" variant="ghost" onClick={saveEdit}>
              <Save className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      }
      
      if (field.type === "select" && field.options) {
        return (
          <div className="flex items-center gap-1">
            <Select value={editValue} onValueChange={setEditValue}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveEdit}>
              <Save className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-1">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-7 text-xs"
            type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            autoFocus
          />
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveEdit}>
            <Save className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    // Display value
    if (field.type === "boolean") {
      return (
        <Badge 
          variant={value ? "default" : "secondary"} 
          className="cursor-pointer"
          onClick={() => startEditing(feature.id, field.name, value)}
        >
          {value ? "Да" : "Нет"}
        </Badge>
      );
    }

    return (
      <span 
        className="cursor-pointer hover:bg-muted px-1 rounded"
        onClick={() => startEditing(feature.id, field.name, value)}
      >
        {value?.toString() || "-"}
      </span>
    );
  };

  if (features.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="absolute bottom-4 left-4 right-4 z-10 max-h-[40vh] bg-background/95 backdrop-blur-sm">
        <CardHeader className="py-2 px-3 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">{layerName}</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {features.length} объектов
            </Badge>
            {selectedFeatureIds.length > 0 && (
              <Badge variant="outline" className="text-xs">
                Выбрано: {selectedFeatureIds.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setShowSchemaDialog(true)}
              data-testid="button-edit-schema"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setIsExpanded(!isExpanded)}
              data-testid="button-toggle-table"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        
        {isExpanded && (
          <CardContent className="p-0">
            <ScrollArea className="max-h-[30vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead className="w-[80px]">Тип</TableHead>
                    {fields.map((field) => (
                      <TableHead key={field.name}>
                        {field.name}
                        {field.required && <span className="text-destructive ml-1">*</span>}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {features.map((feature) => (
                    <TableRow
                      key={feature.id}
                      className={`cursor-pointer ${
                        selectedFeatureIds.includes(feature.id) ? "bg-accent" : ""
                      }`}
                      onClick={(e) => onFeatureSelect(feature.id, e.ctrlKey || e.metaKey)}
                      data-testid={`row-feature-${feature.id}`}
                    >
                      <TableCell className="font-mono text-xs">{feature.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {feature.geometryType === "Point" ? "Точка" : 
                           feature.geometryType === "LineString" ? "Линия" : "Полигон"}
                        </Badge>
                      </TableCell>
                      {fields.map((field) => (
                        <TableCell key={field.name} className="text-sm">
                          {renderCellValue(feature, field)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        )}
      </Card>

      {/* Schema Editor Dialog */}
      <Dialog open={showSchemaDialog} onOpenChange={setShowSchemaDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Настройка атрибутов слоя</DialogTitle>
            <DialogDescription>
              Определите поля атрибутивной таблицы для слоя "{layerName}"
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh]">
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
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSchemaDialog(false)}>
              Отмена
            </Button>
            <Button onClick={handleSaveSchema} data-testid="button-save-schema">
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
