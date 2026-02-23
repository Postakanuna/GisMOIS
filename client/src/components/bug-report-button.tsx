import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bug, Paperclip, X, Loader2, Send, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("message", message);
      if (file) {
        formData.append("screenshot", file);
      }
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Ошибка отправки");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Отчёт отправлен", description: "Спасибо за обратную связь!" });
      resetForm();
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setMessage("");
    setFile(null);
    setPreview(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (selected.size > 10 * 1024 * 1024) {
      toast({ title: "Файл слишком большой", description: "Максимальный размер: 10 МБ", variant: "destructive" });
      return;
    }
    setFile(selected);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(selected);
  }

  function removeFile() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="button-bug-report"
            variant="outline"
            size="icon"
            className="fixed bottom-4 right-4 z-[9999] h-10 w-10 rounded-full shadow-lg bg-background border-destructive/30 hover:bg-destructive/10 hover:border-destructive"
            onClick={() => setOpen(true)}
          >
            <Bug className="h-5 w-5 text-destructive" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Сообщить об ошибке</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="sm:max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-destructive" />
              Сообщить об ошибке
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bug-message">Описание проблемы</Label>
              <Textarea
                id="bug-message"
                data-testid="input-bug-message"
                placeholder="Опишите обнаруженную проблему..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>Скриншот (необязательно)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-bug-screenshot"
              />
              {!file ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach-screenshot"
                >
                  <Paperclip className="h-4 w-4 mr-2" />
                  Прикрепить изображение
                </Button>
              ) : (
                <div className="relative rounded-md border overflow-hidden">
                  {preview && (
                    <img
                      src={preview}
                      alt="Предпросмотр"
                      className="block w-full h-auto max-h-36 object-contain bg-muted"
                      style={{ maxWidth: '100%' }}
                      data-testid="img-bug-preview"
                    />
                  )}
                  <div className="flex items-center justify-between p-2 bg-muted/50">
                    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0 flex items-center gap-1">
                      <ImageIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{file.name}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={removeFile}
                      data-testid="button-remove-screenshot"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { resetForm(); setOpen(false); }}
              data-testid="button-cancel-bug-report"
            >
              Отмена
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!message.trim() || submitMutation.isPending}
              data-testid="button-submit-bug-report"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
