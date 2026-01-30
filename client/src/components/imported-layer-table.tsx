import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DraggableModal } from "@/components/ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";

interface DatasetFeature {
  id: number;
  datasetId: number;
  geometryType: string;
  coordinates: unknown;
  properties: Record<string, unknown>;
}

interface ImportedLayerTableProps {
  layerId: number;
  layerName: string;
  onClose: () => void;
}

type SortDirection = "asc" | "desc" | null;

export function ImportedLayerTable({ layerId, layerName, onClose }: ImportedLayerTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const { data: features = [], isLoading } = useQuery<DatasetFeature[]>({
    queryKey: ["/api/datasets", layerId, "features"],
    enabled: !!layerId,
  });

  const columns = useMemo(() => {
    if (features.length === 0) return [];
    const propKeys = new Set<string>();
    features.forEach(f => {
      if (f.properties) {
        Object.keys(f.properties).forEach(k => propKeys.add(k));
      }
    });
    return Array.from(propKeys);
  }, [features]);

  const filteredAndSortedFeatures = useMemo(() => {
    let result = [...features];
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(f => {
        if (!f.properties) return false;
        return Object.values(f.properties).some(v => 
          String(v).toLowerCase().includes(term)
        );
      });
    }
    
    if (sortColumn && sortDirection) {
      result.sort((a, b) => {
        const aVal = a.properties?.[sortColumn] ?? "";
        const bVal = b.properties?.[sortColumn] ?? "";
        const aStr = String(aVal);
        const bStr = String(bVal);
        const comparison = aStr.localeCompare(bStr, undefined, { numeric: true });
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }
    
    return result;
  }, [features, searchTerm, sortColumn, sortDirection]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      } else {
        setSortDirection("asc");
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    if (sortDirection === "asc") return <ArrowUp className="h-3 w-3" />;
    if (sortDirection === "desc") return <ArrowDown className="h-3 w-3" />;
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  return (
    <DraggableModal
      isOpen={true}
      onClose={onClose}
      title={`Таблица атрибутов: ${layerName}`}
      defaultWidth={800}
      defaultHeight={400}
      minWidth={400}
      minHeight={200}
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 p-2 border-b shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск..."
              className="h-7 pl-7 text-xs"
              data-testid="input-search-attributes"
            />
          </div>
          <Badge variant="secondary" className="text-xs">
            {filteredAndSortedFeatures.length} из {features.length}
          </Badge>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Загрузка...
            </div>
          ) : features.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Нет данных
            </div>
          ) : columns.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Нет атрибутов
            </div>
          ) : (
            <div className="min-w-max">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b w-12">
                      #
                    </th>
                    {columns.map(col => (
                      <th
                        key={col}
                        className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b cursor-pointer hover:bg-muted/80"
                        onClick={() => handleSort(col)}
                      >
                        <div className="flex items-center gap-1">
                          <span className="truncate max-w-[150px]">{col}</span>
                          {getSortIcon(col)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedFeatures.map((feature, idx) => (
                    <tr
                      key={feature.id}
                      className="border-b hover:bg-muted/30"
                      data-testid={`row-feature-${feature.id}`}
                    >
                      <td className="px-2 py-1 text-muted-foreground">
                        {idx + 1}
                      </td>
                      {columns.map(col => (
                        <td key={col} className="px-2 py-1 max-w-[200px] truncate">
                          {formatValue(feature.properties?.[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ScrollArea>
      </div>
    </DraggableModal>
  );
}
