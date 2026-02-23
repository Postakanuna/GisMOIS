import { useLocation } from "wouter";
import { Map, Calculator, BarChart3 } from "lucide-react";
import coatOfArms from "@assets/Coat_of_arms_of_Moscow_Oblast.svg_1762498635678-BuEFViNI_1771751459252.png";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 md:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Map className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">ГИС МО «Инженерные сети»</span>
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
            <h1 className="md:text-3xl tracking-tight font-semibold text-[#5e5555] text-[16px]">Государственная информационная система<br />Московской области «Инженерные сети»</h1>
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
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group"
              onClick={() => {
                window.open("https://is.arki.mosreg.ru/Zuluweb/", "_blank");
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
                  <Badge variant="outline" className="text-xs">GIS Zulu</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">
              Оператор — Государственное казённое учреждение Московской области «Агентство развития коммунальной инфраструктуры»
            </p>
            <p className="text-xs text-muted-foreground">
              Распоряжение Министерства энергетики Московской области от 04.03.2015 № 33-Р
            </p>
            <p className="text-xs">
              <a href="https://t.me/ZULUSTP_bot" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-support-bot">Техническая поддержка: @ZULUSTP_bot</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
