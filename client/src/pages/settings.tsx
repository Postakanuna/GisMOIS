import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Settings() {
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

      <main className="px-6 py-6">
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
      </main>
    </div>
  );
}
