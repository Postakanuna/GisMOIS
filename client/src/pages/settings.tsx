import { useState } from "react";
import { ArrowLeft, Settings as SettingsIcon, Bug, Info, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type SettingsTab = "general" | "debug";

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const queryClient = useQueryClient();

  const { data: userSettings = {}, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/user-settings"],
  });

  const updateMutation = useMutation({
    mutationFn: async (settings: Record<string, string>) => {
      const res = await apiRequest("PUT", "/api/user-settings", settings);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/user-settings"], data);
      window.dispatchEvent(new CustomEvent("user-settings-changed", { detail: data }));
    },
  });

  const showLayerOverlay = userSettings["debug_layer_overlay"] === "1";

  const toggleLayerOverlay = (val: boolean) => {
    const newSettings = { ...userSettings, debug_layer_overlay: val ? "1" : "0" };
    queryClient.setQueryData(["/api/user-settings"], newSettings);
    window.dispatchEvent(new CustomEvent("user-settings-changed", { detail: newSettings }));
    updateMutation.mutate({ debug_layer_overlay: val ? "1" : "0" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex items-center gap-2">
          <Link href="/gis/app">
            <Button variant="ghost" size="icon" data-testid="button-back-to-map">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold">Настройки</span>
          </div>
        </div>
      </header>

      <div className="flex">
        <nav className="w-56 border-r min-h-[calc(100vh-3.5rem)] p-3 space-y-1">
          <button
            onClick={() => setActiveTab("general")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${activeTab === "general" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
            data-testid="tab-general"
          >
            <Info className="h-4 w-4" />
            Общие
          </button>
          <button
            onClick={() => setActiveTab("debug")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${activeTab === "debug" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
            data-testid="tab-debug"
          >
            <Bug className="h-4 w-4" />
            Режим отладки
          </button>
        </nav>

        <main className="flex-1 px-6 py-6">
          {activeTab === "general" && (
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-6">
                <h3 className="text-lg font-medium mb-2">Подсказки</h3>
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>• Подключение к серверу ГИС Zulu доступно в <strong>Менеджере данных → Подключения</strong></p>
                  <p>• Настройки геокодирования и API-ключи доступны администратору на <strong>странице «Сцены»</strong></p>
                  <p>• Проекция карты настраивается в <strong>Менеджере данных → Настройки</strong></p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "debug" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-1">Режим отладки</h3>
                <p className="text-sm text-muted-foreground">Инструменты диагностики для разработчиков</p>
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Загрузка настроек...</span>
                </div>
              ) : (
                <div className="rounded-lg border bg-card p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Диагностика слоёв на карте</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Показывает оверлей с информацией о загруженных слоях, количестве объектов, состоянии загрузки и проекции</p>
                    </div>
                    <button
                      onClick={() => toggleLayerOverlay(!showLayerOverlay)}
                      disabled={updateMutation.isPending}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showLayerOverlay ? "bg-primary" : "bg-input"} ${updateMutation.isPending ? "opacity-50" : ""}`}
                      role="switch"
                      aria-checked={showLayerOverlay}
                      data-testid="toggle-debug-layer-overlay"
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${showLayerOverlay ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
