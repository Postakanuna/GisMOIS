import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileArchive, Trash2, Eye, EyeOff, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseShapefileWithEncoding } from "@/lib/shapefile-parser";
import type { UploadedLayer } from "@shared/schema";

const LAYER_COLORS = [
  "#1976D2", "#D32F2F", "#388E3C", "#7B1FA2",
  "#F57C00", "#0097A7", "#C2185B", "#512DA8",
];

export function UploadedLayersPanel({ 
  onLayersChange 
}: { 
  onLayersChange?: (layers: UploadedLayer[]) => void 
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: layers = [] } = useQuery<UploadedLayer[]>({
    queryKey: ["/api/uploaded-layers"],
    refetchOnWindowFocus: false,
  });

  const createLayerMutation = useMutation({
    mutationFn: async (data: Omit<UploadedLayer, "id" | "createdAt">) => {
      const res = await apiRequest("POST", "/api/uploaded-layers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
      toast({
        title: "Слой загружен",
        description: "Shapefile успешно добавлен на карту",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить shapefile",
        variant: "destructive",
      });
    },
  });

  const createLayersBatchMutation = useMutation({
    mutationFn: async (data: Omit<UploadedLayer, "id" | "createdAt">[]) => {
      const res = await apiRequest("POST", "/api/uploaded-layers/batch", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
      toast({
        title: "Слои загружены",
        description: `Добавлено ${variables.length} слоёв из архива`,
      });
    },
    onError: () => {
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить слои",
        variant: "destructive",
      });
    },
  });

  const updateLayerMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<UploadedLayer>) => {
      const res = await apiRequest("PATCH", `/api/uploaded-layers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
    },
  });

  const deleteLayerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/uploaded-layers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploaded-layers"] });
      toast({
        title: "Слой удалён",
        description: "Shapefile удалён с карты",
      });
    },
  });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast({
        title: "Неверный формат",
        description: "Выберите ZIP-архив с shapefile файлами (.shp, .dbf, .shx, .prj)",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      console.log("=== SHAPEFILE UPLOAD ===");
      console.log("File:", file.name, `(${(file.size / 1024).toFixed(2)} KB)`);
      
      const arrayBuffer = await file.arrayBuffer();
      
      const parsedLayers = await parseShapefileWithEncoding(arrayBuffer, file.name);
      
      console.log(`Parsed ${parsedLayers.length} layer(s)`);
      
      if (parsedLayers.length === 0) {
        toast({
          title: "Ошибка формата",
          description: "В архиве не найдены shapefile данные",
          variant: "destructive",
        });
        return;
      }

      const hasReprojectionFailures = parsedLayers.some(p => p.reprojectionFailed);
      
      if (parsedLayers.length > 1) {
        const layersToCreate: Omit<UploadedLayer, "id" | "createdAt">[] = parsedLayers.map((parsed, i) => ({
          name: parsed.name,
          filename: file.name,
          visible: true,
          opacity: 1,
          color: LAYER_COLORS[(layers.length + i) % LAYER_COLORS.length],
          geojson: parsed.geojson,
          featureCount: parsed.geojson.features?.length || 0,
        }));
        
        await createLayersBatchMutation.mutateAsync(layersToCreate);
        console.log(`Created ${layersToCreate.length} layers`);
      } else {
        const parsed = parsedLayers[0];
        await createLayerMutation.mutateAsync({
          name: parsed.name,
          filename: file.name,
          visible: true,
          opacity: 1,
          color: LAYER_COLORS[layers.length % LAYER_COLORS.length],
          geojson: parsed.geojson,
          featureCount: parsed.geojson.features?.length || 0,
        });
        console.log("Created 1 layer");
      }
      
      if (hasReprojectionFailures) {
        toast({
          title: "Предупреждение о координатах",
          description: "Не удалось преобразовать координаты некоторых слоёв. Объекты могут отображаться в неправильном месте.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Shapefile parse error:", error);
      
      toast({
        title: "Ошибка парсинга",
        description: error?.message || "Не удалось прочитать shapefile",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const toggleVisibility = (layer: UploadedLayer) => {
    updateLayerMutation.mutate({ id: layer.id, visible: !layer.visible });
  };

  const setColor = (layer: UploadedLayer, color: string) => {
    updateLayerMutation.mutate({ id: layer.id, color });
  };

  return (
    <div className="space-y-4 min-w-0 w-full overflow-hidden">
      <div className="flex items-center gap-2 pb-2 border-b border-sidebar-border">
        <FileArchive className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium truncate">Загруженные слои</h2>
      </div>

      <div>
        <Input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-shapefile-upload"
        />
        <Button
          variant="outline"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || createLayerMutation.isPending || createLayersBatchMutation.isPending}
          data-testid="button-upload-shapefile"
        >
          <Upload className="h-4 w-4 mr-2" />
          {isUploading ? "Загрузка..." : "Загрузить Shapefile"}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          ZIP-архив должен содержать .shp, .shx, .dbf и .prj файлы
        </p>
      </div>

      {layers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <FileArchive className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-xs text-muted-foreground">
            Нет загруженных слоёв
          </p>
        </div>
      ) : (
        <div className="space-y-1 min-w-0 overflow-hidden">
          {layers.map((layer) => (
            <div
              key={layer.id}
              className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 min-w-0"
              data-testid={`uploaded-layer-item-${layer.id}`}
            >
              <div 
                className="h-2.5 w-2.5 rounded-full shrink-0" 
                style={{ backgroundColor: layer.color }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span 
                    className="text-xs font-medium min-w-0 cursor-default"
                  >
                    {layer.name.length > 40 ? `${layer.name.slice(0, 40)}...` : layer.name}
                  </span>
                </TooltipTrigger>
                {layer.name.length > 40 && (
                  <TooltipContent side="top" className="max-w-[300px]">
                    <p className="text-xs break-words">{layer.name}</p>
                  </TooltipContent>
                )}
              </Tooltip>
              <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                {layer.featureCount}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => toggleVisibility(layer)}
                data-testid={`button-toggle-visibility-${layer.id}`}
              >
                {layer.visible ? (
                  <Eye className="h-3 w-3" />
                ) : (
                  <EyeOff className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    data-testid={`button-color-picker-${layer.id}`}
                  >
                    <Palette className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="end">
                  <div className="grid grid-cols-4 gap-1">
                    {LAYER_COLORS.map((color) => (
                      <button
                        key={color}
                        className="h-6 w-6 rounded-md border hover:scale-110 transition-transform"
                        style={{ backgroundColor: color }}
                        onClick={() => setColor(layer, color)}
                        data-testid={`button-select-color-${color}`}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => deleteLayerMutation.mutate(layer.id)}
                disabled={deleteLayerMutation.isPending}
                data-testid={`button-delete-layer-${layer.id}`}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
