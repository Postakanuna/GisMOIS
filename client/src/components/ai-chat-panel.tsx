import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Play, BarChart3, Loader2, Zap, Search, Paperclip, X, ClipboardList } from "lucide-react";

export interface ChatAction {
  type:
    | "start_complaint_analysis"
    | "show_complaint_result"
    | "simulation_candidates"
    | "run_simulation"
    | "show_simulation_result"
    | "start_accident_analysis"
    | "show_accident_result"
    | "start_reconstruction_program"
    | "open_reconstruction_program";
  label: string;
  payload?: any;
  done?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  action?: ChatAction;
}

export interface AiProvider {
  id: string;
  name: string;
  available: boolean;
}

interface ProvidersResponse {
  enabled: boolean;
  providers: AiProvider[];
  default: string | null;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Здравствуйте! Я ИИ-ассистент ГИС МО \"Инженерные сети\". Задайте интересующий вас вопрос.",
  timestamp: new Date(),
};

interface AiChatPanelProps {
  onBack?: () => void;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  sceneId?: number | null;
  providers: AiProvider[];
  selectedProvider: string;
  onProviderChange: (id: string) => void;
  isDisabled: boolean;
  providersLoaded: boolean;
  onComplaintAnalysisResult?: (result: any) => void;
  onSimulationResult?: (result: any, featureInfo: { featureId: number; layerId: number; name: string; featureType: string }) => void;
  onAccidentAnalysisResult?: (result: any) => void;
}

const ACTION_MARKER_REGEX = /\[ACTION:COMPLAINT_ANALYSIS:(\d+):([^:\]]+):([^\]]*)\]/;
const SIMULATION_SEARCH_REGEX = /\[ACTION:SIMULATION_SEARCH:([^:\]]+):([^\]]*)\]/;
const ACCIDENT_ANALYSIS_REGEX = /\[ACTION:ACCIDENT_ANALYSIS:([^:\]]*):([^\]]*)\]/;
const RECONSTRUCTION_PROGRAM_REGEX = /\[ACTION:RECONSTRUCTION_PROGRAM:(\d+):([^:]+):(\d+):(\d+):(\d*):([^\]]*)\]/;

export function AiChatPanel({ onBack, messages, onMessagesChange, sceneId, providers, selectedProvider, onProviderChange, isDisabled, providersLoaded, onComplaintAnalysisResult, onSimulationResult, onAccidentAnalysisResult, onReconstructionProgramCreated }: AiChatPanelProps & { onReconstructionProgramCreated?: (programId: number) => void }) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 100 * 1024;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert(`Файл слишком большой. Максимальный размер — 100 КБ.`);
      e.target.value = "";
      return;
    }
    try {
      let content = "";
      if (file.name.endsWith(".docx")) {
        const mammoth = (await import("mammoth")).default;
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        content = result.value;
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsText(file, "UTF-8");
        });
      }
      setAttachedFile({ name: file.name, content: content.trim() });
    } catch {
      alert("Не удалось прочитать файл.");
    }
    e.target.value = "";
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || isLoading || isDisabled) return;

    let fullContent = text;
    if (attachedFile) {
      fullContent = `[Файл: ${attachedFile.name}]\n${attachedFile.content}${text ? `\n\nВопрос: ${text}` : ""}`;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: fullContent,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMsg];
    onMessagesChange(updatedMessages);
    setInput("");
    setAttachedFile(null);
    setIsLoading(true);

    try {
      const allMessages = updatedMessages.filter(m => m.id !== "welcome" && !m.action);
      const apiMessages = allMessages.map(m => ({ role: m.role, content: m.content }));

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, provider: selectedProvider, sceneId: sceneId || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(data.error || "ИИ-агент отключён администратором системы");
        }
        throw new Error(data.error || `Ошибка сервера: ${response.status}`);
      }

      let aiContent = data.content || "Нет ответа от модели";
      const complaintMatch = aiContent.match(ACTION_MARKER_REGEX);
      const simulationMatch = aiContent.match(SIMULATION_SEARCH_REGEX);
      const accidentMatch = aiContent.match(ACCIDENT_ANALYSIS_REGEX);
      const reconstructionMatch = aiContent.match(RECONSTRUCTION_PROGRAM_REGEX);

      const newMessages = [...updatedMessages];

      if (complaintMatch) {
        const layerId = parseInt(complaintMatch[1]);
        const dateField = complaintMatch[2];
        const addressField = complaintMatch[3] && complaintMatch[3] !== "_none_" ? complaintMatch[3] : "";
        aiContent = aiContent.replace(ACTION_MARKER_REGEX, "").trim();

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: aiContent,
          timestamp: new Date(),
        };
        newMessages.push(aiMsg);

        const actionMsg: ChatMessage = {
          id: `action-${Date.now()}`,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          action: {
            type: "start_complaint_analysis",
            label: "Начать анализ",
            payload: { layerId, dateField, addressField },
          },
        };
        newMessages.push(actionMsg);
      } else if (simulationMatch) {
        const searchQuery = simulationMatch[1].trim();
        const networkType = simulationMatch[2] && simulationMatch[2] !== "_any_" ? simulationMatch[2].trim() : "";
        aiContent = aiContent.replace(SIMULATION_SEARCH_REGEX, "").trim();

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: aiContent,
          timestamp: new Date(),
        };
        newMessages.push(aiMsg);
        onMessagesChange([...newMessages]);

        const searchingMsg: ChatMessage = {
          id: `searching-${Date.now()}`,
          role: "assistant",
          content: `Ищу объект: "${searchQuery}"...`,
          timestamp: new Date(),
        };
        onMessagesChange([...newMessages, searchingMsg]);

        try {
          const sid = sceneId || 0;
          const ntParam = networkType ? `&networkType=${encodeURIComponent(networkType)}` : "";
          const searchResp = await fetch(`/api/ai/search-features?sceneId=${sid}&query=${encodeURIComponent(searchQuery)}${ntParam}`);
          const candidates: Array<{ featureId: number; layerId: number; layerName: string; featureName: string; featureAddress: string }> = await searchResp.json();

          const finalMessages = [...newMessages].filter(m => m.id !== searchingMsg.id);

          if (!candidates || candidates.length === 0) {
            finalMessages.push({
              id: `notfound-${Date.now()}`,
              role: "assistant",
              content: `Объект не найден по запросу "${searchQuery}". Уточните название, адрес или тип объекта.`,
              timestamp: new Date(),
            });
            onMessagesChange(finalMessages);
          } else {
            const exactMatches = candidates.filter(c =>
              c.featureName.toLowerCase() === searchQuery.toLowerCase()
            );
            const displayCandidates = exactMatches.length > 0 ? exactMatches : candidates;

            if (exactMatches.length === 1) {
              const c = exactMatches[0];
              finalMessages.push({
                id: `autorun-${Date.now()}`,
                role: "assistant",
                content: `Найден объект: ${c.featureName} — ${c.layerName}. Запускаю симуляцию...`,
                timestamp: new Date(),
              });
              onMessagesChange(finalMessages);
              await runSimulation(c.featureId, c.layerId, c.featureName, c.layerName, finalMessages);
            } else if (displayCandidates.length === 1) {
              const c = displayCandidates[0];
              const label = c.featureName + (c.featureAddress ? ` (${c.featureAddress})` : "") + ` — ${c.layerName}`;
              finalMessages.push({
                id: `action-${Date.now()}`,
                role: "assistant",
                content: `Найден объект: ${label}`,
                timestamp: new Date(),
                action: {
                  type: "run_simulation",
                  label: "Запустить симуляцию",
                  payload: { featureId: c.featureId, layerId: c.layerId, featureName: c.featureName, layerName: c.layerName },
                },
              });
              onMessagesChange(finalMessages);
            } else {
              const candidateActions = displayCandidates.slice(0, 5).map((c, i) => {
                const label = c.featureName + (c.featureAddress ? ` (${c.featureAddress})` : "") + ` — ${c.layerName}`;
                return {
                  id: `candidate-${Date.now()}-${i}`,
                  role: "assistant" as const,
                  content: i === 0 ? `Найдено несколько объектов. Выберите нужный:` : "",
                  timestamp: new Date(),
                  action: {
                    type: "run_simulation" as const,
                    label,
                    payload: { featureId: c.featureId, layerId: c.layerId, featureName: c.featureName, layerName: c.layerName },
                  },
                };
              });
              finalMessages.push(...candidateActions);
              onMessagesChange(finalMessages);
            }
          }
        } catch {
          const finalMessages = [...newMessages].filter(m => m.id !== searchingMsg.id);
          finalMessages.push({
            id: `error-${Date.now()}`,
            role: "assistant",
            content: "Ошибка поиска объекта. Попробуйте ещё раз.",
            timestamp: new Date(),
          });
          onMessagesChange(finalMessages);
        }

        return;
      } else if (accidentMatch) {
        const zMode = accidentMatch[1] || "";
        const dpodMin = accidentMatch[2] || "";
        aiContent = aiContent.replace(ACCIDENT_ANALYSIS_REGEX, "").trim();

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: aiContent,
          timestamp: new Date(),
        };
        newMessages.push(aiMsg);

        const actionMsg: ChatMessage = {
          id: `action-${Date.now()}`,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          action: {
            type: "start_accident_analysis",
            label: "Запустить анализ аварийности",
            payload: { zMode, dpodMin },
          },
        };
        newMessages.push(actionMsg);
      } else if (reconstructionMatch) {
        const layerId = parseInt(reconstructionMatch[1]);
        const programName = reconstructionMatch[2].trim();
        const periodFrom = parseInt(reconstructionMatch[3]);
        const periodTo = parseInt(reconstructionMatch[4]);
        const annualBudgetThousands = reconstructionMatch[5] ? parseInt(reconstructionMatch[5]) : null;
        const workType = reconstructionMatch[6] || "overhaul";
        aiContent = aiContent.replace(RECONSTRUCTION_PROGRAM_REGEX, "").trim();

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: aiContent,
          timestamp: new Date(),
        };
        newMessages.push(aiMsg);

        const actionMsg: ChatMessage = {
          id: `action-${Date.now()}`,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          action: {
            type: "start_reconstruction_program",
            label: "Создать программу реконструкции",
            payload: { layerId, programName, periodFrom, periodTo, annualBudgetThousands, workType },
          },
        };
        newMessages.push(actionMsg);
      } else {
        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: aiContent,
          timestamp: new Date(),
        };
        newMessages.push(aiMsg);
      }

      onMessagesChange(newMessages);
    } catch (error: any) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Ошибка: ${error.message || "Не удалось получить ответ от ИИ"}`,
        timestamp: new Date(),
      };
      onMessagesChange([...updatedMessages, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const runSimulation = async (
    featureId: number,
    layerId: number,
    featureName: string,
    layerName: string,
    currentMessages: ChatMessage[],
  ) => {
    const loadingMsg: ChatMessage = {
      id: `simulating-${Date.now()}`,
      role: "assistant",
      content: `Симулирую отключение объекта "${featureName}"...`,
      timestamp: new Date(),
    };
    onMessagesChange([...currentMessages, loadingMsg]);
    setIsAnalyzing(true);

    try {
      const sid = sceneId || 0;
      const response = await fetch("/api/ai/run-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId, layerId, sceneId: sid }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка симуляции");
      }

      const consumers = data.stats?.totalConsumers ?? 0;
      const segments = data.stats?.totalSegments ?? 0;
      const ctps = data.stats?.totalCTPs ?? 0;

      const resultMsg: ChatMessage = {
        id: `sim-result-${Date.now()}`,
        role: "assistant",
        content: `Симуляция завершена. При отключении "${featureName}" (${layerName}) затронуто: потребителей — ${consumers}, участков сети — ${segments}, ЦТП — ${ctps}.`,
        timestamp: new Date(),
        action: {
          type: "show_simulation_result",
          label: "Показать результаты",
          payload: { result: data, featureId, layerId, featureName },
        },
      };

      const finalMessages = currentMessages.filter(m => m.id !== loadingMsg.id);
      onMessagesChange([...finalMessages, resultMsg]);
    } catch (error: any) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Ошибка симуляции: ${error.message}`,
        timestamp: new Date(),
      };
      const finalMessages = currentMessages.filter(m => m.id !== loadingMsg.id);
      onMessagesChange([...finalMessages, errorMsg]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleActionClick = async (msg: ChatMessage) => {
    if (!msg.action || msg.action.done) return;

    if (msg.action.type === "start_complaint_analysis") {
      const { layerId, dateField, addressField } = msg.action.payload;

      const updatedMsg = { ...msg, action: { ...msg.action, done: true } };
      const currentMessages = messages.map(m => m.id === msg.id ? updatedMsg : m);

      const loadingMsg: ChatMessage = {
        id: `analyzing-${Date.now()}`,
        role: "assistant",
        content: "Анализирую жалобы...",
        timestamp: new Date(),
      };
      onMessagesChange([...currentMessages, loadingMsg]);
      setIsAnalyzing(true);

      try {
        const response = await fetch("/api/ai/run-complaint-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layerId, dateField, addressField }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Ошибка анализа");
        }

        const clusterCount = data.clusters?.length || 0;
        const totalComplaints = data.totalComplaints || 0;

        const resultMsg: ChatMessage = {
          id: `result-${Date.now()}`,
          role: "assistant",
          content: `Анализ завершён. Обработано жалоб: ${totalComplaints}. Найдено кластеров: ${clusterCount}.`,
          timestamp: new Date(),
          action: {
            type: "show_complaint_result",
            label: "Показать результат",
            payload: data,
          },
        };

        const finalMessages = currentMessages.filter(m => m.id !== loadingMsg.id);
        onMessagesChange([...finalMessages, resultMsg]);
      } catch (error: any) {
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Ошибка анализа: ${error.message}`,
          timestamp: new Date(),
        };
        const finalMessages = currentMessages.filter(m => m.id !== loadingMsg.id);
        onMessagesChange([...finalMessages, errorMsg]);
      } finally {
        setIsAnalyzing(false);
      }
    } else if (msg.action.type === "show_complaint_result") {
      if (onComplaintAnalysisResult && msg.action.payload) {
        onComplaintAnalysisResult(msg.action.payload);
      }
    } else if (msg.action.type === "run_simulation") {
      const { featureId, layerId, featureName, layerName } = msg.action.payload;
      const updatedMsg = { ...msg, action: { ...msg.action, done: true } };
      const currentMessages = messages.map(m => m.id === msg.id ? updatedMsg : m);
      await runSimulation(featureId, layerId, featureName, layerName, currentMessages);
    } else if (msg.action.type === "show_simulation_result") {
      if (onSimulationResult && msg.action.payload) {
        const { result, featureId, layerId, featureName } = msg.action.payload;
        onSimulationResult(result, {
          featureId,
          layerId,
          name: featureName,
          featureType: result?.failurePoint?.type || "Point",
        });
      }
    } else if (msg.action.type === "start_accident_analysis") {
      const { zMode, dpodMin } = msg.action.payload || {};
      const updatedMsg = { ...msg, action: { ...msg.action, done: true } };
      const currentMessages = messages.map(m => m.id === msg.id ? updatedMsg : m);
      setIsAnalyzing(true);
      try {
        const res = await fetch("/api/ai/run-accident-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ zMode, dpodMin, sceneId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);

        const top = data.segments?.[0];
        const topInfo = top
          ? `. Наиболее проблемный участок: ${top.beginUch ?? "—"}–${top.endUch ?? "—"}, ${top.accidentCount} аварий`
          : "";
        const summaryText = `Анализ завершён. Аварий: ${data.totalAccidents}. Привязано: ${data.boundAccidents}${topInfo}.`;

        const summaryMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: summaryText,
          timestamp: new Date(),
        };
        const resultActionMsg: ChatMessage = {
          id: `action-${Date.now() + 1}`,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          action: {
            type: "show_accident_result",
            label: "Показать результаты",
            payload: data,
          },
        };
        onMessagesChange([...currentMessages, summaryMsg, resultActionMsg]);
      } catch (err: any) {
        const errMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Ошибка анализа аварийности: ${err.message}`,
          timestamp: new Date(),
        };
        onMessagesChange([...currentMessages, errMsg]);
      } finally {
        setIsAnalyzing(false);
      }
      return;
    } else if (msg.action.type === "show_accident_result") {
      if (onAccidentAnalysisResult && msg.action.payload) {
        onAccidentAnalysisResult(msg.action.payload);
      }
    } else if (msg.action.type === "start_reconstruction_program") {
      const { layerId, programName, periodFrom, periodTo, annualBudgetThousands, workType } = msg.action.payload;
      const updatedMsg = { ...msg, action: { ...msg.action, done: true } };
      const currentMessages = messages.map(m => m.id === msg.id ? updatedMsg : m);

      const loadingMsg: ChatMessage = {
        id: `reconstructing-${Date.now()}`,
        role: "assistant",
        content: `Создаю программу реконструкции "${programName}"...`,
        timestamp: new Date(),
      };
      onMessagesChange([...currentMessages, loadingMsg]);
      setIsAnalyzing(true);

      try {
        const res = await fetch("/api/ai/run-reconstruction-from-layer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ layerId, sceneId, programName, periodFrom, periodTo, annualBudgetThousands, workType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);

        const budgetInfo = data.annualBudgetThousands
          ? `, годовой лимит ${(data.annualBudgetThousands / 1000).toFixed(0)} млн руб.`
          : "";
        const excludedInfo = data.objectsExcluded > 0
          ? ` Не вошли в бюджет: ${data.objectsExcluded} уч. (исключены из расписания).`
          : "";
        const summaryText = `Программа реконструкции "${data.programName}" создана. Период: ${data.periodFrom}–${data.periodTo}${budgetInfo}. Всего участков: ${data.totalObjects}, запланировано (в рамках бюджета): ${data.objectsScheduled}.${excludedInfo} Базовая стоимость запланированных: ${data.totalBaseCostMln} млн руб. ${data.scheduleComment}`;

        const summaryMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: summaryText,
          timestamp: new Date(),
        };
        const openMsg: ChatMessage = {
          id: `action-${Date.now() + 1}`,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          action: {
            type: "open_reconstruction_program",
            label: "Открыть программу реконструкции",
            payload: { programId: data.programId },
          },
        };
        const finalMessages = currentMessages.filter(m => m.id !== loadingMsg.id);
        onMessagesChange([...finalMessages, summaryMsg, openMsg]);
      } catch (err: any) {
        const errMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Ошибка создания программы: ${err.message}`,
          timestamp: new Date(),
        };
        const finalMessages = currentMessages.filter(m => m.id !== loadingMsg.id);
        onMessagesChange([...finalMessages, errMsg]);
      } finally {
        setIsAnalyzing(false);
      }
    } else if (msg.action.type === "open_reconstruction_program") {
      if (onReconstructionProgramCreated && msg.action.payload?.programId) {
        onReconstructionProgramCreated(msg.action.payload.programId);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getActionIcon = (type: ChatAction["type"]) => {
    switch (type) {
      case "start_complaint_analysis": return isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />;
      case "show_complaint_result": return <BarChart3 className="h-3.5 w-3.5" />;
      case "run_simulation": return isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />;
      case "show_simulation_result": return <Search className="h-3.5 w-3.5" />;
      case "start_accident_analysis": return isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />;
      case "show_accident_result": return <BarChart3 className="h-3.5 w-3.5" />;
      case "start_reconstruction_program": return isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />;
      case "open_reconstruction_program": return <ClipboardList className="h-3.5 w-3.5" />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 flex-1">

      {isDisabled && providersLoaded ? (
        <div className="flex-1 flex items-center justify-center p-6" data-testid="ai-disabled-message">
          <div className="text-center space-y-3">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-xs text-muted-foreground max-w-xs">
              ИИ-агент отключён администратором системы, обратитесь в техническую поддержку.
            </p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 scrollbar-thin">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`chat-message-${msg.id}`}
            >
              {msg.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div className={`rounded-md px-3 py-2 text-xs max-w-[85%] ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                {msg.action && (
                  <div className={msg.content ? "mt-2" : ""}>
                    <Button
                      size="sm"
                      variant={msg.action.done ? "outline" : "default"}
                      disabled={msg.action.done || isAnalyzing}
                      onClick={() => handleActionClick(msg)}
                      className="gap-1.5 text-xs"
                      data-testid={`button-action-${msg.action.type}`}
                    >
                      {getActionIcon(msg.action.type)}
                      {msg.action.done ? "Выполнено" : msg.action.label}
                    </Button>
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2 justify-start" data-testid="chat-loading">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="rounded-md px-3 py-2 text-xs bg-muted">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="border-t p-3 shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,.md,.docx"
          className="hidden"
          onChange={handleFileSelect}
          data-testid="input-file-attach"
        />
        {attachedFile && (
          <div className="flex items-center gap-1 mb-2">
            <span className="flex items-center gap-1 text-xs bg-muted rounded px-2 py-1 max-w-[200px] truncate">
              <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{attachedFile.name}</span>
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => setAttachedFile(null)}
              data-testid="button-remove-attachment"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "ИИ-агент недоступен" : "Задайте вопрос..."}
            className="resize-none min-h-[80px] max-h-[200px] text-sm"
            rows={2}
            disabled={isLoading || isDisabled}
            data-testid="input-ai-chat"
          />
          <div className="flex flex-col gap-1 shrink-0">
            <Button
              size="icon"
              onClick={handleSend}
              disabled={(!input.trim() && !attachedFile) || isLoading || isDisabled}
              className="h-9 w-9"
              data-testid="button-send-ai-chat"
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isDisabled}
              className="h-9 w-9"
              title="Прикрепить файл (.txt, .csv, .md, .docx)"
              data-testid="button-attach-file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { WELCOME_MESSAGE };
