import { useState } from "react";
import { useLocation } from "wouter";
import { Map, Calculator, BarChart3, HelpCircle, ExternalLink, CheckCircle2, Link2, Shield, Smartphone, Globe, Cpu, Puzzle, Settings2, Plug, Flame, Droplets, Waves, Wind, Thermometer } from "lucide-react";
import coatOfArms from "@assets/Coat_of_arms_of_Moscow_Oblast.svg_1762498635678-BuEFViNI_1771751459252.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";

const SUBSYSTEMS = [
  {
    id: 1,
    name: "Организация многопользовательской работы и мониторинга системы",
    shortName: "Многопользовательская работа",
    description: "Управление доступом, ролями пользователей и контроль работы системы",
    source: "analytics" as const,
    status: "active" as const,
    location: "Панель администратора, управление пользователями",
    icon: Shield,
  },
  {
    id: 2,
    name: "Работа системы в мобильных устройствах через веб-службы",
    shortName: "Мобильный доступ",
    description: "Адаптивный интерфейс для работы на мобильных устройствах",
    source: "analytics" as const,
    status: "active" as const,
    location: "Адаптивный веб-интерфейс (все страницы)",
    icon: Smartphone,
  },
  {
    id: 3,
    name: "Удалённый доступ (работа через веб-службы)",
    shortName: "Удалённый доступ",
    description: "Доступ к системе извне через веб-службы и внешний API",
    source: "analytics" as const,
    status: "active" as const,
    location: "Внешний API с управлением ключами доступа",
    icon: Globe,
  },
  {
    id: 4,
    name: "Обмен данными с устройствами в промышленной автоматизации",
    shortName: "Интеграция с АСУ ТП",
    description: "Обмен данными с устройствами промышленной автоматизации через API",
    source: "analytics" as const,
    status: "active" as const,
    location: "Настройки, раздел API-ключей",
    icon: Cpu,
  },
  {
    id: 5,
    name: "Разработка геоинформационных плагинов (библиотека интернет-компонентов)",
    shortName: "Геоинформационные плагины",
    description: "Управление слоями, импорт/экспорт данных, менеджер данных",
    source: "analytics" as const,
    status: "active" as const,
    location: "Менеджер данных, управление слоями",
    icon: Puzzle,
  },
  {
    id: 6,
    name: "Настройка пользовательского интерфейса для веб-версии",
    shortName: "Настройка интерфейса",
    description: "Настройка тем, стилизация слоёв, конфигурация отображения",
    source: "analytics" as const,
    status: "active" as const,
    location: "Настройки, стилизация слоёв, переключение тем",
    icon: Settings2,
  },
  {
    id: 7,
    name: "Внешние подключения (стандартные интерфейсы к внутренним подсистемам расчётов схем)",
    shortName: "Внешние подключения",
    description: "Стандартные интерфейсы к расчётным модулям инженерных сетей",
    source: "zulu" as const,
    status: "active" as const,
    location: "Модуль «Инженерные расчёты» (GIS Zulu)",
    icon: Plug,
  },
  {
    id: 8,
    name: "Работа со схемами станционных и перекачивающих систем теплоснабжения",
    shortName: "Теплоснабжение",
    description: "Схемы станционных и перекачивающих систем теплоснабжения и водоснабжения",
    source: "zulu" as const,
    status: "active" as const,
    location: "Модуль «Инженерные расчёты» (GIS Zulu)",
    icon: Flame,
  },
  {
    id: 9,
    name: "Работа со схемами систем водоснабжения",
    shortName: "Водоснабжение",
    description: "Моделирование и расчёт систем водоснабжения",
    source: "zulu" as const,
    status: "active" as const,
    location: "Модуль «Инженерные расчёты» (GIS Zulu)",
    icon: Droplets,
  },
  {
    id: 10,
    name: "Работа со схемами систем водоотведения",
    shortName: "Водоотведение",
    description: "Моделирование и расчёт систем водоотведения",
    source: "zulu" as const,
    status: "active" as const,
    location: "Модуль «Инженерные расчёты» (GIS Zulu)",
    icon: Waves,
  },
  {
    id: 11,
    name: "Работа со схемами систем газоснабжения",
    shortName: "Газоснабжение",
    description: "Моделирование и расчёт систем газоснабжения",
    source: "zulu" as const,
    status: "active" as const,
    location: "Модуль «Инженерные расчёты» (GIS Zulu)",
    icon: Wind,
  },
  {
    id: 12,
    name: "Работа с данными тепловых пунктов",
    shortName: "Тепловые пункты",
    description: "Учёт и управление данными тепловых пунктов",
    source: "zulu" as const,
    status: "active" as const,
    location: "Модуль «Инженерные расчёты» (GIS Zulu)",
    icon: Thermometer,
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 md:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Map className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">ГИС МО «Инженерные сети»</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHelp(true)}
            data-testid="button-help"
          >
            <HelpCircle className="h-4 w-4 mr-2" />
            Справка
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-4xl space-y-8">
          <div className="text-center space-y-3">
            <div className="flex justify-center mb-4">
              <img
                src={coatOfArms}
                alt="Герб Московской области"
                className="h-28 w-auto"
                data-testid="img-coat-of-arms"
              />
            </div>
            <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-muted-foreground">
              Министерство энергетики Московской области
            </p>
            <h1 className="md:text-3xl tracking-tight text-[16px] font-semibold">Государственная информационная система Московской области «Инженерные сети»</h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <Card
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group"
              onClick={() => setLocation("/scenes")}
              data-testid="card-analytics"
            >
              <CardContent className="p-6 flex flex-col items-center text-center space-y-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <BarChart3 className="h-7 w-7 text-primary" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Аналитические инструменты</h2>
                  <p className="text-sm text-muted-foreground">
                    Геоинформационная платформа: карты, слои, анализ данных, мониторинг
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 justify-center">
                  <Badge variant="secondary" className="text-xs">Подсистемы 1–6</Badge>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group"
              onClick={() => {
                window.open("about:blank", "_blank");
              }}
              data-testid="card-engineering"
            >
              <CardContent className="p-6 flex flex-col items-center text-center space-y-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Calculator className="h-7 w-7 text-primary" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Инженерные расчёты</h2>
                  <p className="text-sm text-muted-foreground">
                    Расчёт и моделирование инженерных сетей: тепло-, водо-, газоснабжение
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 justify-center">
                  <Badge variant="secondary" className="text-xs">Подсистемы 7–12</Badge>
                  <Badge variant="outline" className="text-xs">GIS Zulu</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Распоряжение Министерства энергетики Московской области от 04.03.2015 № 33-Р
          </p>
        </div>
      </main>
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Подсистемы ГИС МО «Инженерные сети»</DialogTitle>
            <DialogDescription>
              Модульная структура системы включает 12 подсистем
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Аналитические инструменты</h3>
                  <Badge variant="default" className="text-xs">Подсистемы 1–6</Badge>
                </div>
                <div className="space-y-2">
                  {SUBSYSTEMS.filter(s => s.source === "analytics").map((sub) => {
                    const Icon = sub.icon;
                    return (
                      <div key={sub.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card" data-testid={`subsystem-card-${sub.id}`}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-muted-foreground">#{sub.id}</span>
                            <span className="text-sm font-medium">{sub.shortName}</span>
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Реализовано
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{sub.description}</p>
                          <p className="text-xs text-primary/70 mt-1">{sub.location}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Calculator className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Инженерные расчёты</h3>
                  <Badge variant="secondary" className="text-xs">Подсистемы 7–12</Badge>
                  <Badge variant="outline" className="text-xs">
                    <Link2 className="h-3 w-3 mr-1" />
                    GIS Zulu
                  </Badge>
                </div>
                <div className="space-y-2">
                  {SUBSYSTEMS.filter(s => s.source === "zulu").map((sub) => {
                    const Icon = sub.icon;
                    return (
                      <div key={sub.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card" data-testid={`subsystem-card-${sub.id}`}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <Icon className="h-4 w-4 text-secondary-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-muted-foreground">#{sub.id}</span>
                            <span className="text-sm font-medium">{sub.shortName}</span>
                            <Badge variant="outline" className="text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Интеграция GIS Zulu
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{sub.description}</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">{sub.location}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
