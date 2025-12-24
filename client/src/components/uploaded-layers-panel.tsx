import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileArchive, Trash2, Eye, EyeOff, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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

    if (!file.name.endsWith(".zip") && !file.name.endsWith(".shp")) {
      toast({
        title: "Неверный формат",
        description: "Выберите ZIP-архив с shapefile или .shp файл",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      console.log("=== SHAPEFILE UPLOAD DEBUG ===");
      console.log("File name:", file.name);
      console.log("File size:", file.size, "bytes", `(${(file.size / 1024).toFixed(2)} KB)`);
      console.log("File type:", file.type || "unknown");
      
      const arrayBuffer = await file.arrayBuffer();
      console.log("ArrayBuffer size:", arrayBuffer.byteLength, "bytes");
      
      // Analyze ZIP structure if it's a ZIP file
      if (file.name.toLowerCase().endsWith(".zip")) {
        try {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(arrayBuffer);
          
          console.log("=== ZIP ARCHIVE CONTENTS ===");
          const fileList: string[] = [];
          const fileDetails: { name: string; size: number; ext: string }[] = [];
          
          zip.forEach((relativePath: string, zipEntry: any) => {
            fileList.push(relativePath);
            const ext = relativePath.split('.').pop()?.toLowerCase() || '';
            fileDetails.push({
              name: relativePath,
              size: zipEntry._data?.uncompressedSize || 0,
              ext: ext
            });
          });
          
          console.log("Total files in ZIP:", fileList.length);
          console.log("Files:", fileList);
          
          // Check for required shapefile components
          const extensions = fileDetails.map(f => f.ext);
          const hasShp = extensions.includes('shp');
          const hasShx = extensions.includes('shx');
          const hasDbf = extensions.includes('dbf');
          const hasPrj = extensions.includes('prj');
          
          console.log("=== SHAPEFILE COMPONENTS ===");
          console.log(".shp (geometry):", hasShp ? "FOUND" : "MISSING");
          console.log(".shx (index):", hasShx ? "FOUND" : "MISSING");
          console.log(".dbf (attributes):", hasDbf ? "FOUND" : "MISSING");
          console.log(".prj (projection):", hasPrj ? "FOUND" : "optional, missing");
          
          if (!hasShp) {
            console.error("ERROR: No .shp file found in archive!");
            toast({
              title: "Ошибка формата",
              description: "В архиве не найден .shp файл. Проверьте содержимое ZIP.",
              variant: "destructive",
            });
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
          }
          
          if (!hasDbf) {
            console.warn("WARNING: No .dbf file - attributes may be missing");
          }
          
          // List all files with sizes
          console.log("=== FILE DETAILS ===");
          fileDetails.forEach(f => {
            console.log(`  ${f.name}: ${f.size} bytes (${f.ext})`);
          });
          
        } catch (zipError) {
          console.error("ZIP analysis error:", zipError);
          console.log("Continuing with shpjs parsing anyway...");
        }
      }
      
      console.log("=== PARSING WITH SHPJS ===");
      const shpjs = await import("shpjs");
      
      let geojson;
      try {
        geojson = await shpjs.default(arrayBuffer);
        console.log("shpjs parse SUCCESS");
      } catch (parseError: any) {
        console.error("shpjs parse FAILED:", parseError);
        console.error("Error name:", parseError?.name);
        console.error("Error message:", parseError?.message);
        console.error("Error stack:", parseError?.stack);
        throw parseError;
      }
      
      console.log("=== GEOJSON RESULT ===");
      console.log("Result type:", typeof geojson);
      console.log("Is array:", Array.isArray(geojson));
      
      if (Array.isArray(geojson)) {
        console.log("Number of layers:", geojson.length);
        geojson.forEach((layer: any, i: number) => {
          console.log(`Layer ${i}:`, {
            type: layer?.type,
            featureCount: layer?.features?.length || 0,
            crs: (layer as any)?.crs
          });
        });
      } else if (geojson) {
        console.log("GeoJSON type:", geojson.type);
        console.log("Feature count:", geojson.features?.length || 0);
        console.log("CRS:", (geojson as any).crs);
        if (geojson.features?.length > 0) {
          console.log("First feature geometry type:", geojson.features[0]?.geometry?.type);
          console.log("First feature properties:", Object.keys(geojson.features[0]?.properties || {}));
        }
      }

      const features = Array.isArray(geojson)
        ? geojson.flatMap((g: any) => g.features || [])
        : geojson.features || [];

      console.log("Total features extracted:", features.length);
      
      const layerName = file.name.replace(/\.(zip|shp)$/i, "");

      await createLayerMutation.mutateAsync({
        name: layerName,
        filename: file.name,
        visible: true,
        opacity: 1,
        color: LAYER_COLORS[layers.length % LAYER_COLORS.length],
        geojson: Array.isArray(geojson) ? geojson : geojson,
        featureCount: features.length,
      });
      
      console.log("=== UPLOAD COMPLETE ===");
    } catch (error: any) {
      console.error("=== SHAPEFILE PARSE ERROR ===");
      console.error("Error object:", error);
      console.error("Error name:", error?.name);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      
      let errorDescription = "Не удалось прочитать shapefile.";
      if (error?.message) {
        errorDescription += ` Ошибка: ${error.message}`;
      }
      
      toast({
        title: "Ошибка парсинга",
        description: errorDescription,
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

  const setOpacity = (layer: UploadedLayer, opacity: number) => {
    updateLayerMutation.mutate({ id: layer.id, opacity });
  };

  const setColor = (layer: UploadedLayer, color: string) => {
    updateLayerMutation.mutate({ id: layer.id, color });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-sidebar-border">
        <FileArchive className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium">Загруженные слои</h2>
      </div>

      <div>
        <Input
          ref={fileInputRef}
          type="file"
          accept=".zip,.shp"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-shapefile-upload"
        />
        <Button
          variant="outline"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || createLayerMutation.isPending}
          data-testid="button-upload-shapefile"
        >
          <Upload className="h-4 w-4 mr-2" />
          {isUploading ? "Загрузка..." : "Загрузить Shapefile"}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          Поддерживается ZIP-архив с .shp, .shx, .dbf файлами
        </p>
      </div>

      {layers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <FileArchive className="h-10 w-10 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            Нет загруженных слоёв
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {layers.map((layer) => (
            <div
              key={layer.id}
              className="space-y-3 rounded-md border border-sidebar-border p-3"
              data-testid={`uploaded-layer-item-${layer.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div 
                    className="h-3 w-3 rounded-full shrink-0" 
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className="text-sm font-medium truncate">
                    {layer.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    ({layer.featureCount})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => toggleVisibility(layer)}
                    data-testid={`button-toggle-visibility-${layer.id}`}
                  >
                    {layer.visible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-color-picker-${layer.id}`}
                      >
                        <Palette className="h-4 w-4" />
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
                    onClick={() => deleteLayerMutation.mutate(layer.id)}
                    disabled={deleteLayerMutation.isPending}
                    data-testid={`button-delete-layer-${layer.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              {layer.visible && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground shrink-0">
                    Непрозрачность
                  </span>
                  <Slider
                    value={[layer.opacity * 100]}
                    onValueChange={([value]) => setOpacity(layer, value / 100)}
                    max={100}
                    step={1}
                    className="flex-1"
                    data-testid={`slider-opacity-uploaded-${layer.id}`}
                  />
                  <span className="text-xs text-muted-foreground w-8 text-right font-mono">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
