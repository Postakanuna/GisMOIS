import { DraggableModal } from "@/components/ui/draggable-modal";
import type { SelectedFeatureData } from "@/components/map-viewer";
import { getFieldLabel } from "@shared/field-labels";

interface FeatureInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: SelectedFeatureData | null;
}

export function FeatureInfoModal({ isOpen, onClose, feature }: FeatureInfoModalProps) {
  const title = feature
    ? `Объект: ${feature.layerName}`
    : "Информация об объекте";

  const entries = feature
    ? Object.entries(feature.properties).filter(
        ([key]) => key !== "geometry" && key !== "_geometry"
      )
    : [];

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      defaultWidth={480}
      defaultHeight={420}
      minWidth={320}
      minHeight={220}
    >
      <div className="flex flex-col h-full">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-6">
            Атрибуты отсутствуют
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-sm border-collapse" data-testid="feature-info-table">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b w-2/3">
                    Атрибут
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b w-1/3">
                    Значение
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([key, value], index) => (
                  <tr
                    key={key}
                    className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}
                    data-testid={`feature-info-row-${key}`}
                  >
                    <td className="px-3 py-2 font-medium text-foreground align-top break-words border-b border-border/50">
                      {getFieldLabel(key)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground align-top break-words border-b border-border/50">
                      {value === null || value === undefined
                        ? <span className="italic text-muted-foreground/60">—</span>
                        : String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DraggableModal>
  );
}
