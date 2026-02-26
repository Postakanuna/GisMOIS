import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, ArrowLeft, ChevronDown, Trash2, Play, BarChart3, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ChatAction {
  type: "start_complaint_analysis" | "show_complaint_result";
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

interface AiProvider {
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
  content: "Здравствуйте! Я ИИ-агент ГИС МО \"Инженерные сети\". Задайте интересующий вас вопрос.",
  timestamp: new Date(),
};

interface AiChatPanelProps {
  onBack: () => void;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  sceneId?: number | null;
  onComplaintAnalysisResult?: (result: any) => void;
}

const ACTION_MARKER_REGEX = /\[ACTION:COMPLAINT_ANALYSIS:(\d+):([^:\]]+):([^\]]*)\]/;

export function AiChatPanel({ onBack, messages, onMessagesChange, sceneId, onComplaintAnalysisResult }: AiChatPanelProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/ai/providers")
      .then(r => r.json())
      .then((data: ProvidersResponse) => {
        setAiEnabled(data.enabled);
        if (data.providers) setProviders(data.providers);
        if (data.default) setSelectedProvider(data.default);
        setProvidersLoaded(true);
      })
      .catch(() => {
        setProvidersLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const isDisabled = !aiEnabled || providers.length === 0;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading || isDisabled) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMsg];
    onMessagesChange(updatedMessages);
    setInput("");
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
      const actionMatch = aiContent.match(ACTION_MARKER_REGEX);

      const newMessages = [...updatedMessages];

      if (actionMatch) {
        const layerId = parseInt(actionMatch[1]);
        const dateField = actionMatch[2];
        const addressField = actionMatch[3] && actionMatch[3] !== "_none_" ? actionMatch[3] : "";
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
    }
  };

  const handleClearChat = () => {
    onMessagesChange([WELCOME_MESSAGE]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentProvider = providers.find(p => p.id === selectedProvider);
  const hasHistory = messages.some(m => m.id !== "welcome");

  return (
    <div className="flex flex-col h-full min-h-0 flex-1">
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <Button size="icon" variant="ghost" onClick={onBack} data-testid="button-back-to-layers">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">ИИ-ассистент</span>
        {!isDisabled && (
          <div className="ml-auto flex items-center gap-1">
            {hasHistory && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleClearChat}
                className="h-7 w-7"
                title="Очистить чат"
                data-testid="button-clear-chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2" data-testid="button-provider-selector">
                  {currentProvider?.name || "Модель"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {providers.map(p => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    disabled={!p.available}
                    data-testid={`provider-option-${p.id}`}
                  >
                    <span className={selectedProvider === p.id ? "font-semibold" : ""}>
                      {p.name}
                    </span>
                    {!p.available && <span className="ml-2 text-muted-foreground text-xs">(не настроен)</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {isDisabled && providersLoaded ? (
        <div className="flex-1 flex items-center justify-center p-6" data-testid="ai-disabled-message">
          <div className="text-center space-y-3">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground max-w-xs">
              ИИ-агент отключён администратором системы, обратитесь в техническую поддержку.
            </p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
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
              <div className={`rounded-md px-3 py-2 text-sm max-w-[85%] ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
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
                      {msg.action.type === "start_complaint_analysis" && (
                        isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />
                      )}
                      {msg.action.type === "show_complaint_result" && <BarChart3 className="h-3.5 w-3.5" />}
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
              <div className="rounded-md px-3 py-2 text-sm bg-muted">
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
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "ИИ-агент недоступен" : "Задайте вопрос..."}
            className="resize-none min-h-[40px] max-h-[120px] text-sm"
            rows={1}
            disabled={isLoading || isDisabled}
            data-testid="input-ai-chat"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isLoading || isDisabled}
            data-testid="button-send-ai-chat"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export { WELCOME_MESSAGE };
