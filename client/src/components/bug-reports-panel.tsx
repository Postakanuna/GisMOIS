import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bug, Image, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface BugReport {
  id: number;
  userId: string;
  username: string | null;
  message: string;
  screenshotPath: string | null;
  status: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: "Новое",
  rejected: "Отклонено",
  in_progress: "В работе",
  fixed: "Исправлено",
  paused: "Приостановлено",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  rejected: "destructive",
  in_progress: "secondary",
  fixed: "outline",
  paused: "secondary",
};

export function BugReportsPanel() {
  const { toast } = useToast();
  const [screenshotDialog, setScreenshotDialog] = useState<{ open: boolean; reportId: number | null; }>({ open: false, reportId: null });

  const { data: reports, isLoading } = useQuery<BugReport[]>({
    queryKey: ["/api/bug-reports"],
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/bug-reports/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bug-reports"] });
      toast({ title: "Статус обновлён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Bug className="h-10 w-10 mb-3 opacity-50" />
        <p className="text-sm">Сведений об ошибках пока нет</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead className="w-[140px]">Пользователь</TableHead>
              <TableHead className="w-[160px]">Дата</TableHead>
              <TableHead>Сообщение</TableHead>
              <TableHead className="w-[80px] text-center">Скриншот</TableHead>
              <TableHead className="w-[180px]">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id} data-testid={`row-bug-report-${report.id}`}>
                <TableCell className="font-mono text-xs">{report.id}</TableCell>
                <TableCell className="text-sm">{report.username || report.userId}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(report.createdAt), "dd MMM yyyy, HH:mm", { locale: ru })}
                </TableCell>
                <TableCell className="text-sm max-w-[300px]">
                  <p className="whitespace-pre-wrap break-words" data-testid={`text-bug-message-${report.id}`}>
                    {report.message}
                  </p>
                </TableCell>
                <TableCell className="text-center">
                  {report.screenshotPath ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setScreenshotDialog({ open: true, reportId: report.id })}
                      data-testid={`button-view-screenshot-${report.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={report.status}
                    onValueChange={(value) => statusMutation.mutate({ id: report.id, status: value })}
                    data-testid={`select-status-${report.id}`}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue>
                        <Badge variant={STATUS_VARIANTS[report.status] || "default"} className="text-xs">
                          {STATUS_LABELS[report.status] || report.status}
                        </Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Новое</SelectItem>
                      <SelectItem value="rejected">Отклонено</SelectItem>
                      <SelectItem value="in_progress">В работе</SelectItem>
                      <SelectItem value="fixed">Исправлено</SelectItem>
                      <SelectItem value="paused">Приостановлено</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={screenshotDialog.open}
        onOpenChange={(v) => setScreenshotDialog({ open: v, reportId: v ? screenshotDialog.reportId : null })}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="h-5 w-5" />
              Скриншот к отчёту #{screenshotDialog.reportId}
            </DialogTitle>
          </DialogHeader>
          {screenshotDialog.reportId && (
            <div className="flex items-center justify-center">
              <img
                src={`/api/bug-reports/${screenshotDialog.reportId}/screenshot`}
                alt="Скриншот ошибки"
                className="max-w-full max-h-[70vh] rounded-md object-contain"
                data-testid={`img-screenshot-${screenshotDialog.reportId}`}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
