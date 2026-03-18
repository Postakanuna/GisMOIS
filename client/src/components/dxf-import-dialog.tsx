import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileUp, Info, ChevronLeft, RefreshCw } from 'lucide-react';
import { parseDxfContent, CRS_OPTIONS, getEntityTypeIcon, type DxfLayerInfo, type DxfFeature } from '@/lib/dxf-parser-util';
import { useDxfLayers } from '@/contexts/dxf-layers-context';

const COLOR_OPTIONS = [
  { value: '#e53935', label: 'Красный' },
  { value: '#1e88e5', label: 'Синий' },
  { value: '#43a047', label: 'Зелёный' },
  { value: '#f4511e', label: 'Оранжевый' },
  { value: '#8e24aa', label: 'Фиолетовый' },
  { value: '#00acc1', label: 'Голубой' },
  { value: '#fdd835', label: 'Жёлтый' },
  { value: '#6d4c41', label: 'Коричневый' },
];

interface DxfImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'upload' | 'layers';

export function DxfImportDialog({ open, onOpenChange }: DxfImportDialogProps) {
  const { toast } = useToast();
  const { addSurveyLayer } = useDxfLayers();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [layerName, setLayerName] = useState('');
  const [crs, setCrs] = useState('MSK50-1');
  const [swapXY, setSwapXY] = useState(false);
  const [color, setColor] = useState('#e53935');
  const [dragOver, setDragOver] = useState(false);

  const [rawContent, setRawContent] = useState<string | null>(null);
  const [parsedLayers, setParsedLayers] = useState<DxfLayerInfo[]>([]);
  const [parsedFeatures, setParsedFeatures] = useState<DxfFeature[]>([]);
  const [selectedLayers, setSelectedLayers] = useState<string[]>([]);
  const [coordHint, setCoordHint] = useState<string>('');

  const resetState = useCallback(() => {
    setStep('upload');
    setIsParsing(false);
    setFileName('');
    setLayerName('');
    setCrs('MSK50-1');
    setSwapXY(false);
    setColor('#e53935');
    setDragOver(false);
    setRawContent(null);
    setParsedLayers([]);
    setParsedFeatures([]);
    setSelectedLayers([]);
    setCoordHint('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onOpenChange(false);
  }, [resetState, onOpenChange]);

  const doParseContent = useCallback(async (text: string, currentCrs: string, currentSwapXY: boolean) => {
    setIsParsing(true);
    try {
      const result = await parseDxfContent(text, currentCrs, currentSwapXY);
      setParsedLayers(result.layers);
      setParsedFeatures(result.features);

      const lineLayerNames = result.layers
        .filter(l => l.types.some(t => ['LINE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'].includes(t)))
        .map(l => l.name);
      setSelectedLayers(prev => {
        if (prev.length === 0 || prev.every(p => !result.layers.find(l => l.name === p))) {
          return lineLayerNames.length > 0 ? lineLayerNames : result.layers.map(l => l.name);
        }
        return prev;
      });

      if (result.features.length > 0 && result.features[0].coordinates.length > 0) {
        const [lon, lat] = result.features[0].coordinates[0];
        const lonV = lon.toFixed(4);
        const latV = lat.toFixed(4);
        const isValid = Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
        setCoordHint(isValid
          ? `Первая точка: lon=${lonV}, lat=${latV} ✓`
          : `Первая точка: x=${lonV}, y=${latV} — координаты могут быть некорректны`
        );
      } else {
        setCoordHint('');
      }

      return result;
    } catch (err: any) {
      toast({ title: 'Ошибка чтения файла', description: err?.message || 'Не удалось разобрать DXF файл', variant: 'destructive' });
      return null;
    } finally {
      setIsParsing(false);
    }
  }, [toast]);

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.dxf')) {
      toast({ title: 'Неверный формат', description: 'Пожалуйста, выберите файл с расширением .dxf', variant: 'destructive' });
      return;
    }
    setFileName(file.name);
    if (!layerName) setLayerName(file.name.replace(/\.dxf$/i, ''));

    const text = await file.text();
    setRawContent(text);
    const result = await doParseContent(text, crs, swapXY);
    if (result) setStep('layers');
  }, [crs, swapXY, layerName, doParseContent, toast]);

  const handleReparse = useCallback(async () => {
    if (!rawContent) return;
    await doParseContent(rawContent, crs, swapXY);
  }, [rawContent, crs, swapXY, doParseContent]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const toggleLayer = useCallback((name: string) => {
    setSelectedLayers(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedLayers(parsedLayers.map(l => l.name));
  }, [parsedLayers]);

  const handleSelectNone = useCallback(() => {
    setSelectedLayers([]);
  }, []);

  const handleAdd = useCallback(() => {
    if (selectedLayers.length === 0) {
      toast({ title: 'Выберите слои', description: 'Необходимо выбрать хотя бы один слой DXF', variant: 'destructive' });
      return;
    }
    const name = layerName.trim() || fileName.replace(/\.dxf$/i, '') || 'Съёмка';
    addSurveyLayer({
      name,
      crs,
      color,
      opacity: 0.8,
      visible: true,
      selectedLayers,
      allLayers: parsedLayers,
      allFeatures: parsedFeatures,
    });
    toast({ title: '✅ Подложка добавлена', description: `«${name}» отображается на карте` });
    handleClose();
  }, [selectedLayers, layerName, fileName, crs, color, parsedLayers, parsedFeatures, addSurveyLayer, toast, handleClose]);

  const selectedFeatureCount = parsedFeatures.filter(f => selectedLayers.includes(f.layer)).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md" data-testid="dxf-import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>📐</span>
            {step === 'upload' ? 'Загрузить файл топосъёмки (DXF)' : 'Выбор слоёв DXF'}
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="dxf-dropzone"
            >
              {isParsing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Читаем файл...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <FileUp className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Перетащите .dxf файл сюда</p>
                  <p className="text-xs text-muted-foreground">или нажмите для выбора</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".dxf"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-dxf-file"
            />

            <div className="space-y-1.5">
              <Label htmlFor="dxf-layer-name">Название подложки</Label>
              <Input
                id="dxf-layer-name"
                placeholder="Съёмка ул. Ленина, март 2026"
                value={layerName}
                onChange={(e) => setLayerName(e.target.value)}
                data-testid="input-dxf-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dxf-crs">Система координат файла</Label>
              <Select value={crs} onValueChange={setCrs}>
                <SelectTrigger id="dxf-crs" data-testid="select-dxf-crs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer" onClick={() => setSwapXY(v => !v)}>
              <Checkbox
                checked={swapXY}
                onCheckedChange={(v) => setSwapXY(!!v)}
                data-testid="checkbox-dxf-swapxy"
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">Поменять X/Y</p>
                <p className="text-xs text-muted-foreground">Включить, если объекты не отображаются (российская геодезическая конвенция)</p>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Принимается формат <strong>.dxf</strong>. Из AutoCAD: Файл → Сохранить как → AutoCAD DXF</span>
            </div>
          </div>
        )}

        {step === 'layers' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Файл: <strong>{fileName}</strong> — найдено слоёв: {parsedLayers.length}, объектов: {parsedFeatures.length}
            </p>

            {coordHint && (
              <div className={`rounded-md px-3 py-2 text-xs font-mono ${
                coordHint.includes('✓') ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300' : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
              }`}>
                {coordHint}
              </div>
            )}

            <div className="rounded-md border p-3 space-y-3 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Настройки координат</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Система координат</Label>
                  <Select value={crs} onValueChange={setCrs}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-dxf-crs-step2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CRS_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 flex flex-col justify-end">
                  <div className="flex items-center gap-2 h-8 cursor-pointer" onClick={() => setSwapXY(v => !v)}>
                    <Checkbox
                      checked={swapXY}
                      onCheckedChange={(v) => setSwapXY(!!v)}
                      data-testid="checkbox-dxf-swapxy-step2"
                    />
                    <Label className="text-xs cursor-pointer">Поменять X/Y</Label>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 h-7 text-xs"
                onClick={handleReparse}
                disabled={isParsing}
                data-testid="button-dxf-reparse"
              >
                {isParsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Применить настройки и пересчитать
              </Button>
            </div>

            <div className="space-y-1.5 max-h-44 overflow-y-auto border rounded-md p-2">
              {parsedLayers.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Линейные объекты не найдены</p>
              ) : (
                parsedLayers.map(layer => (
                  <div key={layer.name} className="flex items-center gap-2 py-1 px-1 hover:bg-accent/40 rounded-sm">
                    <Checkbox
                      id={`dxf-layer-${layer.name}`}
                      checked={selectedLayers.includes(layer.name)}
                      onCheckedChange={() => toggleLayer(layer.name)}
                      data-testid={`checkbox-dxf-layer-${layer.name}`}
                    />
                    <label htmlFor={`dxf-layer-${layer.name}`} className="flex-1 cursor-pointer flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-4 text-center shrink-0">{getEntityTypeIcon(layer.types)}</span>
                      <span className="font-medium truncate max-w-[160px]" title={layer.name}>{layer.name}</span>
                      <span className="text-muted-foreground shrink-0 ml-auto">{layer.count}</span>
                    </label>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleSelectAll} data-testid="button-select-all-layers">Выбрать всё</Button>
              <Button variant="ghost" size="sm" onClick={handleSelectNone} data-testid="button-select-none-layers">Снять всё</Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dxf-name-step2">Название подложки</Label>
                <Input
                  id="dxf-name-step2"
                  value={layerName}
                  onChange={(e) => setLayerName(e.target.value)}
                  placeholder="Съёмка"
                  data-testid="input-dxf-name-step2"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dxf-color">Цвет на карте</Label>
                <Select value={color} onValueChange={setColor}>
                  <SelectTrigger id="dxf-color" data-testid="select-dxf-color">
                    <SelectValue>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span>{COLOR_OPTIONS.find(c => c.value === color)?.label ?? 'Цвет'}</span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: opt.value }} />
                          {opt.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedLayers.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Будет отображено объектов: <strong>{selectedFeatureCount}</strong>
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'upload' ? (
            <>
              <Button variant="outline" onClick={handleClose} data-testid="button-dxf-cancel">Отмена</Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('upload')}
                className="gap-1"
                data-testid="button-dxf-back"
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </Button>
              <Button
                onClick={handleAdd}
                disabled={selectedLayers.length === 0 || isParsing}
                data-testid="button-dxf-add"
              >
                Добавить на карту
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
