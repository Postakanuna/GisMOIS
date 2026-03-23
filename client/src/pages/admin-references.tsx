import { Link } from "wouter";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnitRatesAdminTable } from "@/components/unit-rates-admin-table";
import { FieldLabelsAdminTable } from "@/components/field-labels-admin-table";

export default function AdminReferencesPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <Link href="/gis/scenes">
          <Button variant="ghost" size="icon" data-testid="button-back-references">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Справочники</h1>
      </header>
      <div className="container mx-auto p-6">
        <Tabs defaultValue="unit-rates" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2" data-testid="references-tabs">
            <TabsTrigger value="unit-rates" data-testid="tab-unit-rates">Удельные стоимости</TabsTrigger>
            <TabsTrigger value="field-labels" data-testid="tab-field-labels">База данных полей</TabsTrigger>
          </TabsList>

          <TabsContent value="unit-rates">
            <Card>
              <CardHeader>
                <CardTitle>Удельные стоимости</CardTitle>
                <CardDescription>
                  Справочник удельных расценок для автоматического расчёта стоимости работ в программе реконструкции
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UnitRatesAdminTable />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="field-labels">
            <Card>
              <CardHeader>
                <CardTitle>База данных полей Zulu</CardTitle>
                <CardDescription>
                  Расшифровка технических наименований атрибутов SHP-файлов, экспортированных из системы Zulu.
                  Изменения вступают в силу немедленно — обновлённые названия отображаются в таблицах атрибутов и передаются во внешние системы.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldLabelsAdminTable />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
