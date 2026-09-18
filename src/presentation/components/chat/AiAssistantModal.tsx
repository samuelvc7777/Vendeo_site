"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  X,
  Copy,
  Check,
  Send,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  HelpCircle,
  CheckCircle2,
  Trash2,
  ClipboardPaste,
  Camera,
  Zap,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
import { AiStructuredResponse, AiMessageItem } from "@/domain/entities/AiPrompt";
import { GenerateAiPromptUseCase } from "@/application/use-cases/GenerateAiPromptUseCase";
import { getMessageTimestampMs, cn } from "@/lib/utils";
import { getApiUrl } from "@/infrastructure/http/network";
import { GroqChatService } from "@/infrastructure/ai/GroqChatService";
import { normalizeIndices, sanitizeResponsesPunctuation, extractUsedEmojis } from "@/lib/aiResponseNormalizer";

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  conversationName: string;
  contactUsername?: string;
  platform: "tinder" | "instagram";
  currentMessages?: any[];
  onSendMessages: (messages: string[], completedChecklistIds?: string[]) => void;
  onAudioTranscribed?: (messageId: string, transcript: string) => void;
  initialTargetMessageId?: string | null;
  stageContext?: any;
}

export function AiAssistantModal({
  isOpen,
  onClose,
  conversationId,
  conversationName,
  contactUsername,
  platform,
  currentMessages = [],
  onSendMessages,
  onAudioTranscribed,
  initialTargetMessageId,
  stageContext,
}: AiAssistantModalProps) {
  const [activeTab, setActiveTab] = useState<"generate" | "prompt" | "response">("generate");
  const [selectedModel, setSelectedModel] = useState<string>("Atria-Dawn-Preview");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("vendeo_ai_model");
      if (saved) setSelectedModel(saved);
    }
  }, []);

  const handleSelectModel = (modelName: string) => {
    setSelectedModel(modelName);
    if (typeof window !== "undefined") {
      localStorage.setItem("vendeo_ai_model", modelName);
    }
  };
  const [selectedTargetMessageId, setSelectedTargetMessageId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [regeneratingGroupKey, setRegeneratingGroupKey] = useState<string | null>(null);
  const [aiCompletedIds, setAiCompletedIds] = useState<string[]>([]);

  // Estados da barra de progresso da IA
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [generationElapsedSec, setGenerationElapsedSec] = useState<number>(0);
  const [generationStatusText, setGenerationStatusText] = useState<string>("Iniciando conexão...");

  // Controla a barra de progresso realista durante a inferência do modelo
  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const isSol = selectedModel.includes("sol") || selectedModel === "gpt-5-6-sol";
    const isTerra = selectedModel.includes("terra");
    const isPro = selectedModel.includes("pro");
    const isAtria = /atria/i.test(selectedModel);
    const modelLabel = isAtria
      ? "Atria Dawn (Atria-ASI)"
      : isSol
      ? "ChatGPT Sol (Kie.ai)"
      : isTerra
      ? "ChatGPT Terra (Kie.ai)"
      : isPro
      ? "DeepSeek V4.0 Pro"
      : "DeepSeek V4.1 Flash";

    setGenerationProgress(8);
    setGenerationElapsedSec(0);
    setGenerationStatusText(`Conectando ao ${modelLabel}...`);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setGenerationElapsedSec(parseFloat(elapsed.toFixed(1)));

      let progress = 8;
      let status = `Conectando ao ${modelLabel}...`;

      if (elapsed < 2) {
        progress = 8 + (elapsed / 2) * 32;
        status = `Conectando ao ${modelLabel}...`;
      } else if (elapsed < 5) {
        progress = 40 + ((elapsed - 2) / 3) * 32;
        status = "Analisando contexto da conversa e perfil...";
      } else if (elapsed < 8) {
        progress = 72 + ((elapsed - 5) / 3) * 17;
        status = "Construindo respostas no tom autêntico da Larissa...";
      } else {
        const extra = elapsed - 8;
        progress = Math.min(97, 89 + (1 - Math.exp(-extra / 3)) * 8);
        status = "Quase pronto, finalizando balões de mensagem...";
      }
      // Atria é um reasoning model: a barra precisa respirar além dos 8s
      if (isAtria) {
        if (elapsed < 15) {
          progress = Math.max(progress, 72 + ((elapsed - 5) / 10) * 15);
          status = "Raciocinando sobre o histórico e a personalidade da Larissa...";
        } else if (elapsed < 30) {
          progress = Math.max(progress, 87 + ((elapsed - 15) / 15) * 7);
          status = "Atria elaborando os balões no tom autêntico...";
        } else if (elapsed < 60) {
          progress = Math.max(progress, 94 + ((elapsed - 30) / 30) * 3);
          status = "Finalizando a fala, quase aí...";
        } else {
          progress = Math.max(progress, 97);
          status = "Recebendo os últimos balões da Atria...";
        }
      }

      setGenerationProgress(Math.round(progress));
      setGenerationStatusText(status);
    }, 100);

    return () => clearInterval(interval);
  }, [isGenerating]);

  const [promptText, setPromptText] = useState("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [isTranscribingAudios, setIsTranscribingAudios] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [newMessages, setNewMessages] = useState<{ index: number; text: string; id?: string }[]>([]);

  // Estados da resposta da IA
  const [jsonInput, setJsonInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<AiStructuredResponse | null>(null);
  const [editableResponses, setEditableResponses] = useState<string[]>([]);
  const [copiedResponseIdx, setCopiedResponseIdx] = useState<number | null>(null);
  const [isCopiedAll, setIsCopiedAll] = useState(false);
  // Snippet amigável do balão alvo para exibição em tempo real na barra de progresso
  const targetMessageSnippet = React.useMemo(() => {
    if (!selectedTargetMessageId) return null;
    const msg = (currentMessages || []).find((m: any) => String(m.id) === String(selectedTargetMessageId));
    if (!msg) return null;
    const t = msg.text || "";
    if (t.startsWith("[audio:")) return "🎙️ Mensagem de voz";
    if (t.startsWith("[image:")) return "📷 Foto recebida";
    if (t.length > 55) return `"${t.slice(0, 52)}..."`;
    return `"${t}"`;
  }, [selectedTargetMessageId, currentMessages]);

  // Gera o prompt contextualizado instantaneamente via Caso de Uso (Persona Grounding e sem raffle_readiness)
  const fetchPrompt = async () => {
    setIsLoadingPrompt(true);
    setPromptError(null);

    try {
      let parsedName = conversationName || "Pretendente";
      let parsedAge: number | undefined;

      const ageMatch = parsedName.match(/^(.*?)(?:,\s*(\d+))?$/);
      if (ageMatch) {
        if (ageMatch[1] && ageMatch[1].trim()) parsedName = ageMatch[1].trim();
        if (ageMatch[2]) parsedAge = parseInt(ageMatch[2], 10);
      }

      const formattedHistory: AiMessageItem[] = (currentMessages || [])
        .map((m: any) => ({
          id: m.id || String(Date.now()),
          sender: (m.isMine || m.is_mine || m.senderId === "me" || m.sender_id === "me" || m.sender === "me" ? "me" : "them") as "me" | "them",
          text: m.text || "",
          timestamp: m.sentDate || (m.timestamp && !/^\d{2}:\d{2}$/.test(String(m.timestamp)) ? m.timestamp : m.createdAt) || new Date().toISOString(),
          sentDate: m.sentDate || (m.timestamp && !/^\d{2}:\d{2}$/.test(String(m.timestamp)) ? m.timestamp : m.createdAt) || new Date().toISOString(),
          audioTranscript: m.audioTranscript,
          mediaType: m.mediaType,
          mediaUrl: m.mediaUrl,
        }))
        .sort((a, b) => getMessageTimestampMs(a.timestamp) - getMessageTimestampMs(b.timestamp));

      // 1. Auto-transcrição de áudios pendentes que ainda não tenham transcrição
      const pendingAudios = formattedHistory.filter(
        (m) =>
          (m.mediaType === "audio" || (typeof m.text === "string" && m.text.startsWith("[audio:"))) &&
          !m.audioTranscript
      );

      if (pendingAudios.length > 0) {
        setIsTranscribingAudios(true);
        await Promise.all(
          pendingAudios.map(async (pa) => {
            const audioUrl =
              pa.mediaUrl ||
              pa.text.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] ||
              "";
            if (!audioUrl) return;

            try {
              const res = await fetch(getApiUrl("/api/ai/transcribe"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messageId: pa.id,
                  mediaUrl: audioUrl,
                }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data?.text) {
                  pa.audioTranscript = data.text;
                  onAudioTranscribed?.(pa.id, data.text);
                }
              }
            } catch (tErr) {
              console.warn("Aviso na auto-transcrição de áudio para a IA:", tErr);
            }
          })
        );
        setIsTranscribingAudios(false);
      }

      // Recarrega o contexto real no backend (incluindo novas mensagens do Supabase).
      // O fallback local mantém a tela funcionando mesmo quando a API estiver indisponível.
      let result: any;
      try {
        const apiRes = await fetch(getApiUrl(`/api/ai/prompt/${encodeURIComponent(conversationId)}`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            conversationName,
            city: "não informada",
            bio: "sem bio",
            currentMessages: formattedHistory,
            stageContext,
          }),
        });
        const apiData = await apiRes.json().catch(() => ({}));
        if (!apiRes.ok || !apiData?.success || typeof apiData.prompt !== "string") {
          throw new Error(apiData?.error || "Não foi possível recarregar o prompt.");
        }
        result = apiData;
      } catch (apiErr) {
        console.warn("Falha ao recarregar prompt no backend; usando geração local:", apiErr);
        const useCase = new GenerateAiPromptUseCase();
        result = useCase.execute({
          pretendente: {
            id: conversationId,
            name: parsedName,
            age: parsedAge,
            platform: platform === "instagram" ? "instagram" : "tinder",
            username: contactUsername,
          },
          tinderHistory: platform === "tinder" ? formattedHistory : [],
          instagramHistory: platform === "instagram" ? formattedHistory : [],
          stageContext,
          mode: "markdown",
        });
      }

      setPromptText(result.prompt);
      setNewMessagesCount(result.newMessagesCount || 0);
      setNewMessages(result.newMessages || []);
    } catch (err: any) {
      console.error("Erro ao obter prompt de IA:", err);
      setPromptError(err.message || "Não foi possível gerar o prompt contextual.");
    } finally {
      setIsLoadingPrompt(false);
      setIsTranscribingAudios(false);
    }
  };

  // Gera a resposta instantânea via TokenHarbor / Groq no backend
  const handleGenerateAi = async (targetMsgId?: string | null, modelOverride?: string) => {
    setIsGenerating(true);
    setGenerateError(null);

    const effectiveTargetId = targetMsgId !== undefined ? targetMsgId : selectedTargetMessageId;
    setSelectedTargetMessageId(effectiveTargetId || null);

    try {
      const formattedHistory: AiMessageItem[] = (currentMessages || [])
        .map((m: any) => ({
          id: m.id || String(Date.now()),
          sender: (m.isMine || m.is_mine || m.senderId === "me" || m.sender_id === "me" || m.sender === "me" ? "me" : "them") as "me" | "them",
          text: m.text || "",
          timestamp: m.sentDate || (m.timestamp && !/^\d{2}:\d{2}$/.test(String(m.timestamp)) ? m.timestamp : m.createdAt) || new Date().toISOString(),
          sentDate: m.sentDate || (m.timestamp && !/^\d{2}:\d{2}$/.test(String(m.timestamp)) ? m.timestamp : m.createdAt) || new Date().toISOString(),
          audioTranscript: m.audioTranscript,
          mediaType: m.mediaType,
          mediaUrl: m.mediaUrl,
        }))
        .sort((a, b) => getMessageTimestampMs(a.timestamp) - getMessageTimestampMs(b.timestamp));

      // Auto-transcrição de áudios pendentes se houver
      const pendingAudios = formattedHistory.filter(
        (m) =>
          (m.mediaType === "audio" || (typeof m.text === "string" && m.text.startsWith("[audio:"))) &&
          !m.audioTranscript
      );

      if (pendingAudios.length > 0) {
        setIsTranscribingAudios(true);
        await Promise.all(
          pendingAudios.map(async (pa) => {
            const audioUrl =
              pa.mediaUrl ||
              pa.text.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] ||
              "";
            if (!audioUrl) return;

            try {
              const res = await fetch(getApiUrl("/api/ai/transcribe"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messageId: pa.id,
                  mediaUrl: audioUrl,
                }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data?.text) {
                  pa.audioTranscript = data.text;
                  onAudioTranscribed?.(pa.id, data.text);
                }
              }
            } catch (tErr) {
              console.warn("Aviso na auto-transcrição de áudio para a IA:", tErr);
            }
          })
        );
        setIsTranscribingAudios(false);
      }

      const modelToUse = modelOverride || selectedModel;
      const isAtriaModel = /atria/i.test(modelToUse);
      const res = await fetch(getApiUrl("/api/ai/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          platform,
          conversationName,
          contactUsername,
          currentMessages: formattedHistory,
          stageContext,
          model: modelToUse,
          targetMessageId: effectiveTargetId || undefined,
          temperature: isAtriaModel ? 0.6 : 0.65,
        }),
        signal: AbortSignal.timeout(isAtriaModel ? 180000 : 90000),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao gerar resposta com a IA.");
      }

      const themMessagesList = newMessages.length > 0
        ? newMessages
        : (currentMessages || []).filter((m: any) => !m.isMine).map((m: any, i: number) => ({ index: i, text: m.text || "" }));

      const recentUsedEmojis = extractUsedEmojis(currentMessages);
      // Atria (vLLM) pode devolver quebras de linha \r\n; normalizamos antes de sanitizar
      const rawResponses: string[] = Array.isArray(data.responses) ? data.responses : [];
      const normalizedResponses = rawResponses.map((r: string) =>
        typeof r === "string" ? r.replace(/\r\n/g, "\n").replace(/\r/g, "") : r
      );
      const cleanResponses = sanitizeResponsesPunctuation(normalizedResponses, recentUsedEmojis);

      const normalizedIndices = normalizeIndices(
        cleanResponses,
        data.indices,
        themMessagesList
      );

      setParsedData({
        responses: cleanResponses,
        indices: normalizedIndices,
        analise_do_pretendente: data.analise_do_pretendente,
      });
      setEditableResponses(cleanResponses);
      setAiCompletedIds(Array.isArray(data.completedChecklistIds) ? data.completedChecklistIds : []);
      setLastLatencyMs(data.latencyMs);
      setGenerationProgress(100);
      setGenerationStatusText("✅ Resposta gerada com sucesso!");
      await new Promise((r) => setTimeout(r, 260));
      toast.success(
        effectiveTargetId
          ? `Resposta gerada para o balão em ${(data.latencyMs / 1000).toFixed(1)}s!`
          : `Resposta gerada em ${(data.latencyMs / 1000).toFixed(1)}s! (${data.responses.length} balões)`
      );
    } catch (err: any) {
      console.error("Erro ao gerar com IA:", err);
      setGenerationProgress(0);
      setGenerateError(err.message || "Não foi possível gerar a resposta.");
      toast.error(err.message || "Erro ao gerar resposta com a IA.");
    } finally {
      setIsGenerating(false);
      setIsTranscribingAudios(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedTargetMessageId(initialTargetMessageId || null);
      fetchPrompt();
      setJsonInput("");
      setParseError(null);
      setParsedData(null);
      setEditableResponses([]);
      setGenerateError(null);
      setLastLatencyMs(null);
      setActiveTab("generate");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conversationId, initialTargetMessageId]);

  // Copia o prompt para o clipboard
  const handleCopyPrompt = async () => {
    if (!promptText) return;
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error("Erro ao copiar para clipboard:", err);
    }
  };

  const [pasteSuccess, setPasteSuccess] = useState(false);

  // Parser inteligente do JSON retornado pela IA externa (resiliente a markdown, links e múltiplos blocos)
  const handleParseJson = (customText?: string) => {
    setParseError(null);
    const textToProcess = (customText !== undefined ? customText : jsonInput).trim();

    if (!textToProcess) {
      setParseError("Por favor, cole a resposta retornada pela IA.");
      return;
    }

    try {
      let rawText = textToProcess;

      // 1. Tenta extrair o bloco explicitamente marcado como ```json ... ```
      const jsonExplicitBlockMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
      // 2. Se não houver ```json, tenta extrair o bloco que contém a propriedade "responses"
      const jsonWithResponsesMatch = rawText.match(/\{[\s\S]*?"responses"[\s\S]*?\}/);

      if (jsonExplicitBlockMatch && jsonExplicitBlockMatch[1]) {
        rawText = jsonExplicitBlockMatch[1].trim();
      } else if (jsonWithResponsesMatch) {
        rawText = jsonWithResponsesMatch[0];
      } else {
        // Fallback: Procura primeiro caractere { e último }
        const firstBrace = rawText.indexOf("{");
        const lastBrace = rawText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          rawText = rawText.slice(firstBrace, lastBrace + 1);
        }
      }

      const parsed = JSON.parse(rawText) as AiStructuredResponse;

      if (!parsed.responses || !Array.isArray(parsed.responses)) {
        throw new Error("O JSON precisa conter a propriedade 'responses' como uma lista de textos.");
      }

      const recentUsedEmojis = extractUsedEmojis(currentMessages);
      const cleanResponses = sanitizeResponsesPunctuation(parsed.responses, recentUsedEmojis);

      setParsedData({
        ...parsed,
        responses: cleanResponses,
      });
      setEditableResponses([...cleanResponses]);
    } catch (err: any) {
      console.error("Erro no parse de JSON:", err);
      setParseError(`Não foi possível extrair as mensagens da resposta: ${err.message || "verifique o formato."}`);
    }
  };

  // Cola o conteúdo diretamente da área de transferência e já interpreta se for JSON válido
  const handlePasteFromClipboard = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setJsonInput(text.trim());
          setPasteSuccess(true);
          setTimeout(() => setPasteSuccess(false), 2000);
          handleParseJson(text.trim());
        }
      }
    } catch (err) {
      console.error("Erro ao ler clipboard:", err);
      setParseError("Não foi possível acessar a área de transferência automaticamente. Use o atalho Ctrl+V no campo acima.");
    }
  };

  // Atualiza um balão específico na edição
  const handleResponseChange = (index: number, newText: string) => {
    setEditableResponses((prev) => {
      const copy = [...prev];
      copy[index] = newText;
      return copy;
    });
  };

  // Copia uma resposta específica
  const handleCopySingleResponse = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedResponseIdx(index);
      setTimeout(() => setCopiedResponseIdx(null), 2000);
    } catch (err) {
      console.error("Erro ao copiar balão:", err);
    }
  };

  // Envia um único balão imediatamente para o chat
  const handleSendSingleResponse = (indexToSend: number, textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    onSendMessages([trimmed], aiCompletedIds);
    toast.success(`Balão ${indexToSend + 1} enviado com sucesso!`);

    if (editableResponses.length <= 1) {
      onClose();
    } else {
      setEditableResponses((prev) => prev.filter((_, i) => i !== indexToSend));
    }
  };

  // Envia todas as respostas para a conversa e fecha o modal
  const handleConfirmSend = () => {
    const validMessages = editableResponses.map((r) => r.trim()).filter(Boolean);
    if (validMessages.length === 0) return;

    onSendMessages(validMessages, aiCompletedIds);
    onClose();
  };

  // Resolve o @ de destino do Instagram com base na plataforma e conversa
  const resolveTargetInstagramHandle = (): string => {
    let targetHandle = "";
    if (platform === "instagram") {
      const candidate = contactUsername || conversationName || "";
      targetHandle = candidate.replace(/^@/, "").trim();
    } else if (platform === "tinder") {
      const allText = currentMessages.map((m) => m.text).join(" ");
      const match = allText.match(/(?:^|\s)@([a-zA-Z0-9._]{2,30})/);
      if (match && match[1]) {
        targetHandle = match[1].trim();
      } else {
        targetHandle = "lariresende_0611";
      }
    }
    return targetHandle || "lariresende_0611";
  };

  // Monta a URL otimizada para forçar abertura no APP nativo do Instagram no Android e iOS
  const getInstagramDirectAppUrl = (handle: string): string => {
    const cleanHandle = handle.replace(/^@/, "").trim();
    const webUrl = `https://ig.me/m/${cleanHandle}`;
    const fallbackEncoded = encodeURIComponent(webUrl);

    if (typeof window !== "undefined") {
      const ua = navigator.userAgent || "";
      const isAndroid = /Android/i.test(ua);
      const isIOS = /iPhone|iPad|iPod/i.test(ua);
      if (isAndroid) {
        // No Android, intent:// com package=com.instagram.android força a abertura direta do aplicativo nativo
        return `intent://ig.me/m/${cleanHandle}#Intent;scheme=https;package=com.instagram.android;S.browser_fallback_url=${fallbackEncoded};end`;
      }
      if (isIOS) {
        // No iOS (iPhone/iPad), o scheme nativo instagram:// força o sistema a abrir o aplicativo do Instagram imediatamente
        return `instagram://user?username=${cleanHandle}`;
      }
    }
    // Fallback para Desktop / Universal Link
    return webUrl;
  };

  // Copia o texto para a área de transferência e notifica o usuário
  const handleOpenInstagramForResponse = (responseText: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(responseText);
      }
    } catch {}

    const targetHandle = resolveTargetInstagramHandle();
    toast.success(`Resposta copiada! Abrindo app do Instagram com @${targetHandle}...`);
  };

  // Agrupa os balões por pergunta / mensagem recebida do cliente
  const getMatchedMessagesForIdx = (idx: number): string[] => {
    // 1. Se foi selecionado um balão específico do cliente
    if (selectedTargetMessageId) {
      const specific = currentMessages.find((m) => String(m.id) === String(selectedTargetMessageId));
      if (specific?.text) return [specific.text.trim()];
    }

    let targetIndices: number[] = Array.isArray(parsedData?.indices?.[idx])
      ? parsedData!.indices[idx]
      : [];

    if (targetIndices.length === 0) {
      targetIndices = [0];
    }

    const themList = newMessages.length > 0
      ? newMessages
      : currentMessages.filter((m) => !m.isMine);
    const msgs = targetIndices
      .map((targetIdx) => {
        const matched = themList.find((message: any, position: number) =>
          (typeof message.index === "number" ? message.index : position) === targetIdx
        );
        if (matched?.text) return matched.text.trim();
        return null;
      })
      .filter(Boolean) as string[];

    if (msgs.length === 0 && themList.length > 0) {
      msgs.push(themList[themList.length - 1].text.trim());
    }

    return msgs;
  };

  // Envia todos os balões pertencentes a um mesmo card de pergunta
  const handleSendGroupResponses = (items: { globalIdx: number; response: string }[]) => {
    const validTexts = items
      .map((item) => item.response.trim())
      .filter(Boolean);
    if (validTexts.length === 0) return;

    onSendMessages(validTexts, aiCompletedIds);
    toast.success(
      validTexts.length === 1
        ? "Balão enviado com sucesso!"
        : `${validTexts.length} balões enviados com sucesso!`
    );

    const indicesToRemove = new Set(items.map((it) => it.globalIdx));
    const remaining = editableResponses.filter((_, i) => !indicesToRemove.has(i));

    if (remaining.length === 0) {
      onClose();
    } else {
      setEditableResponses(remaining);
    }
  };

  // Copia todos os balões da mesma pergunta e abre o Instagram
  const handleOpenInstagramForGroup = (items: { globalIdx: number; response: string }[]) => {
    const allTexts = items
      .map((item) => item.response.trim())
      .filter(Boolean)
      .join("\n\n");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(allTexts);
      }
    } catch {}

    const targetHandle = resolveTargetInstagramHandle();
    toast.success(
      items.length > 1
        ? `${items.length} balões copiados! Abrindo app do Instagram com @${targetHandle}...`
        : `Resposta copiada! Abrindo app do Instagram com @${targetHandle}...`
    );
  };

  // Copia todos os balões gerados juntos
  const handleCopyAllResponses = () => {
    if (editableResponses.length === 0) return;
    const allTexts = editableResponses
      .map((r) => r.trim())
      .filter(Boolean)
      .join("\n\n");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(allTexts);
      }
    } catch {}

    setIsCopiedAll(true);
    setTimeout(() => setIsCopiedAll(false), 2000);
    toast.success(
      editableResponses.length > 1
        ? `${editableResponses.length} balões copiados com sucesso!`
        : "Balão copiado com sucesso!"
    );
  };

  // Copia todos os balões e abre o Instagram Direct de uma só vez
  const handleOpenInstagramWithAll = () => {
    if (editableResponses.length === 0) return;
    const allTexts = editableResponses
      .map((r) => r.trim())
      .filter(Boolean)
      .join("\n\n");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(allTexts);
      }
    } catch {}

    const targetHandle = resolveTargetInstagramHandle();
    toast.success(
      editableResponses.length > 1
        ? `${editableResponses.length} balões copiados! Abrindo Direct com @${targetHandle}...`
        : `Resposta copiada! Abrindo Direct com @${targetHandle}...`
    );
  };

  // Regera cirurgicamente apenas a resposta pertencente a um card/pergunta específico
  const handleRegenerateGroup = async (group: {
    groupKey: string;
    matchedThemMessages: string[];
    items: { globalIdx: number; response: string }[];
  }) => {
    if (regeneratingGroupKey || isGenerating) return;

    setRegeneratingGroupKey(group.groupKey);

    try {
      // Identifica o ID da mensagem do cliente se existir
      let targetId = selectedTargetMessageId;
      if (!targetId && group.matchedThemMessages.length > 0) {
        const foundNm = newMessages.find((nm) =>
          group.matchedThemMessages.some((tm) => tm.trim() === nm.text.trim())
        );
        if (foundNm?.id) {
          targetId = foundNm.id;
        } else {
          const foundCurrent = (currentMessages || []).find(
            (m: any) =>
              !m.isMine &&
              group.matchedThemMessages.some((tm) => tm.trim() === (m.text || "").trim())
          );
          if (foundCurrent?.id) {
            targetId = foundCurrent.id;
          }
        }
      }

      const formattedHistory: AiMessageItem[] = (currentMessages || [])
        .map((m: any) => ({
          id: m.id || String(Date.now()),
          sender: (m.isMine || m.senderId === "me" || m.sender === "me" ? "me" : "them") as "me" | "them",
          text: m.text || "",
          timestamp: m.timestamp || m.sentDate || m.createdAt,
          audioTranscript: m.audioTranscript,
          mediaType: m.mediaType,
          mediaUrl: m.mediaUrl,
        }))
        .sort((a, b) => getMessageTimestampMs(a.timestamp) - getMessageTimestampMs(b.timestamp));

      // Monta SEMPRE as mensagens do grupo alvo para a IA focar exclusivamente nelas!
      const messagesToRespondPayload =
        group.matchedThemMessages.length > 0
          ? group.matchedThemMessages.map((text, idx) => ({
              id: `group_target_${idx}`,
              sender: "them" as const,
              text,
              timestamp: "Recente",
            }))
          : undefined;

      const res = await fetch(getApiUrl("/api/ai/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          platform,
          conversationName,
          contactUsername,
          currentMessages: formattedHistory,
          model: selectedModel,
          targetMessageId: targetId || undefined,
          messagesToRespond: messagesToRespondPayload,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(/atria/i.test(selectedModel) ? 180000 : 90000),
      });

      const data = await res.json();

      if (!res.ok || !data.success || !Array.isArray(data.responses) || data.responses.length === 0) {
        throw new Error(data?.error || "Falha ao regerar este balão.");
      }

      // Substitui cirurgicamente apenas as respostas deste grupo sem afetar os outros balões
      const groupGlobalIndices = group.items.map((it) => it.globalIdx).sort((a, b) => a - b);
      const minIdx = groupGlobalIndices[0];
      const countToRemove = groupGlobalIndices.length;

      const recentUsedEmojis = extractUsedEmojis(currentMessages);
      const cleanRegenerated = sanitizeResponsesPunctuation(data.responses, recentUsedEmojis);

      let updatedResponses: string[] = [];
      setEditableResponses((prev) => {
        const next = [...prev];
        next.splice(minIdx, countToRemove, ...cleanRegenerated);
        updatedResponses = next;
        return next;
      });

      setParsedData((prev) => {
        if (!prev) return prev;
        const nextIndices = prev.indices ? [...prev.indices] : [];
        const originalGroupIndices = prev.indices?.[minIdx] || [0];
        const replacementIndices = cleanRegenerated.map(() => originalGroupIndices);
        nextIndices.splice(minIdx, countToRemove, ...replacementIndices);
        return {
          ...prev,
          responses: updatedResponses.length > 0 ? updatedResponses : cleanRegenerated,
          indices: nextIndices,
        };
      });

      toast.success("Nova resposta deste balão gerada com sucesso!");
    } catch (err: any) {
      console.error("Erro ao regerar balão individual:", err);
      toast.error(err.message || "Erro ao regerar resposta.");
    } finally {
      setRegeneratingGroupKey(null);
    }
  };

  // Renderiza os balões de resposta agrupados por pergunta com edição e envio rápido em layout estilo Chat Direct
  const renderBalloonCards = () => {
    if (editableResponses.length === 0) return null;

    interface BalloonItem {
      globalIdx: number;
      response: string;
    }

    interface QuestionGroup {
      groupKey: string;
      matchedThemMessages: string[];
      items: BalloonItem[];
    }

    // Agrupamento determinístico: balões que respondem à mesma pergunta ficam no mesmo fluxo
    const groups: QuestionGroup[] = [];
    editableResponses.forEach((resp, globalIdx) => {
      const matched = getMatchedMessagesForIdx(globalIdx);
      const key = matched.join(" | ") || `fallback_${globalIdx}`;

      const existingGroup = groups.find((g) => g.groupKey === key);
      if (existingGroup) {
        existingGroup.items.push({ globalIdx, response: resp });
      } else {
        groups.push({
          groupKey: key,
          matchedThemMessages: matched,
          items: [{ globalIdx, response: resp }],
        });
      }
    });

    return (
      <div className="space-y-3.5 pt-1">
        {/* Insight da IA sobre a intenção do pretendente (se disponível) */}
        {parsedData?.analise_do_pretendente && (
          <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-zinc-900/60 border border-purple-800/35 flex items-start gap-2.5 shadow-sm">
            <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed min-w-0 flex-1">
              <span className="font-bold text-purple-300 mr-1.5">Intenção dele:</span>
              <span className="text-zinc-300">{parsedData.analise_do_pretendente}</span>
            </div>
          </div>
        )}

        {/* Container Estilo Conversa Nativa do Instagram Direct */}
        <div className="rounded-3xl bg-[#0d0d10] border border-[#232328] p-3.5 sm:p-4.5 space-y-4 shadow-inner">
          <div className="flex items-center justify-between px-1 text-[11px] text-zinc-400 border-b border-white/5 pb-2.5">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
              <span className="font-semibold text-zinc-200">Preview do Chat Direct</span>
              <span className="text-zinc-500">•</span>
              <span className="text-zinc-400">{conversationName}</span>
            </div>
            <span className="text-zinc-400 font-mono text-[10px]">
              {editableResponses.length} {editableResponses.length === 1 ? "balão pronto" : "balões prontos"}
            </span>
          </div>

          <div className="space-y-4">
            {groups.map((group, gIdx) => (
              <div key={gIdx} className="space-y-3">
                {/* Balões Recebidos (Pretendente) - Alinhados à Esquerda */}
                {group.matchedThemMessages.length > 0 && (
                  <div className="flex flex-col items-start space-y-1.5 max-w-[88%] sm:max-w-[78%]">
                    <span className="text-[10px] font-semibold text-zinc-400 px-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                      {conversationName || "Ele"} disse:
                    </span>
                    {group.matchedThemMessages.map((mText, mIdx) => (
                      <div
                        key={mIdx}
                        className="bg-[#202025] hover:bg-[#25252b] border border-white/[0.06] text-zinc-100 text-xs sm:text-sm px-3.5 py-2.5 rounded-2xl rounded-tl-xs shadow-sm select-text leading-relaxed font-sans transition-colors"
                      >
                        {mText}
                      </div>
                    ))}
                  </div>
                )}

                {/* Feedback se estiver regerando especificamente este balão */}
                {regeneratingGroupKey === group.groupKey && (
                  <div className="flex justify-end">
                    <div className="p-2.5 rounded-2xl bg-purple-950/50 border border-purple-700/50 text-xs text-purple-200 animate-pulse flex items-center gap-2 shadow-md">
                      <Sparkles className="w-3.5 h-3.5 text-purple-300 animate-spin" />
                      <span>Regerando balão da Larissa...</span>
                    </div>
                  </div>
                )}

                {/* Balões de Resposta Sugeridos (Larissa / IA) - Alinhados à Direita */}
                <div className="flex flex-col items-end space-y-2 mt-1">
                  {group.items.map(({ globalIdx, response }) => {
                    const words = response.trim().split(/\s+/).filter(Boolean).length;
                    return (
                      <div
                        key={globalIdx}
                        className="w-full max-w-[92%] sm:max-w-[84%] flex flex-col items-end"
                      >
                        <div className="w-full rounded-2xl rounded-tr-xs bg-[#29252f] p-3 sm:p-3.5 shadow-md border border-[#51475f] transition-all focus-within:ring-2 focus-within:ring-[#8f7aa3]/50 relative overflow-hidden">
                          {/* Contexto de resposta, igual ao \"Respondendo a\" do Instagram */}
                          {group.matchedThemMessages.length > 0 && (
                            <div className="mb-2 rounded-lg border-l-2 border-[#a995b8]/70 bg-black/20 px-2.5 py-1.5 text-[10px] leading-snug text-[#d7cde0]">
                              <div className="font-semibold text-[#eee8f2]">Respondendo a:</div>
                              <div className="truncate" title={group.matchedThemMessages.join(" | ")}>
                                {group.matchedThemMessages.join(" | ")}
                              </div>
                            </div>
                          )}

                          {/* Mini-header do Balão: Indicador + Ações Rápidas */}
                          <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-white/15 text-[10px] text-white/90">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded-full bg-black/30 font-bold tracking-wide text-white border border-white/10 shadow-xs">
                                Balão {globalIdx + 1}
                              </span>
                              <span className="text-[10px] text-purple-200/80 hidden xs:inline">
                                {words} {words === 1 ? "palavra" : "palavras"}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Copiar este balão individual */}
                              <button
                                type="button"
                                onClick={() => handleCopySingleResponse(globalIdx, response)}
                                className="px-2 py-1 rounded-lg bg-black/25 hover:bg-black/45 text-white/90 hover:text-white flex items-center gap-1 active:scale-95 transition-all cursor-pointer font-medium"
                                title="Copiar apenas este balão"
                              >
                                {copiedResponseIdx === globalIdx ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-300" />
                                    <span className="text-emerald-300">Copiado</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copiar</span>
                                  </>
                                )}
                              </button>

                              {/* Enviar este balão individual */}
                              {editableResponses.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleSendSingleResponse(globalIdx, response)}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-200 hover:text-white flex items-center gap-1 active:scale-95 transition-all cursor-pointer font-medium"
                                  title="Enviar apenas este balão para a conversa"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Enviar</span>
                                </button>
                              )}

                              {/* Regerar apenas esta resposta */}
                              <button
                                type="button"
                                onClick={() => handleRegenerateGroup(group)}
                                disabled={regeneratingGroupKey === group.groupKey || isGenerating}
                                className="p-1 rounded-lg bg-black/25 hover:bg-black/45 text-white/80 hover:text-white flex items-center justify-center active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                                title="Regerar apenas esta resposta com a IA"
                              >
                                <RefreshCw className={`w-3 h-3 ${regeneratingGroupKey === group.groupKey ? "animate-spin" : ""}`} />
                              </button>
                            </div>
                          </div>

                          {/* Textarea Inline Transparente e Confortável */}
                          <textarea
                            value={response}
                            disabled={regeneratingGroupKey === group.groupKey}
                            onChange={(e) => handleResponseChange(globalIdx, e.target.value)}
                            rows={Math.max(2, Math.min(5, Math.ceil(response.length / 38)))}
                            className="w-full bg-transparent text-white text-xs sm:text-sm leading-relaxed placeholder-white/40 resize-none outline-none font-sans select-text selection:bg-white/30 selection:text-white disabled:opacity-50"
                            placeholder="Ajuste a fala da Larissa..."
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Barra de Ações Unificada (Limpa, Direta e Sem Poluição) */}
        <div className="space-y-2.5 pt-1">
          {/* Botões de Ação Principais em Grid (Touch target >= 44px) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleConfirmSend}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all min-h-[44px]"
            >
              <Send className="w-4 h-4" />
              <span>
                {editableResponses.length === 1
                  ? "Enviar Balão no Chat"
                  : `Enviar todos os ${editableResponses.length} balões`}
              </span>
            </button>

            <a
              href={getInstagramDirectAppUrl(resolveTargetInstagramHandle())}
              onClick={handleOpenInstagramWithAll}
              target={typeof window !== "undefined" && /Android/i.test(navigator.userAgent || "") ? undefined : "_blank"}
              rel="noopener noreferrer"
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] hover:opacity-95 active:scale-[0.98] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all min-h-[44px]"
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <Camera className="w-3 h-3 text-white stroke-[2.5]" />
              </span>
              <span>Copiar e Abrir no Instagram</span>
            </a>
          </div>

          {/* Ações Rápidas de Apoio: Copiar Todos e Regerar Tudo */}
          <div className="flex items-center justify-between gap-2 px-1 text-xs">
            <button
              type="button"
              onClick={handleCopyAllResponses}
              className="text-zinc-400 hover:text-white flex items-center gap-1.5 py-2 px-3 rounded-xl hover:bg-white/5 active:scale-95 transition-all cursor-pointer font-medium"
            >
              {isCopiedAll ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Tudo Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Todos os Balões</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleGenerateAi(selectedTargetMessageId)}
              disabled={isGenerating}
              className="text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1.5 py-2 px-3 rounded-xl hover:bg-rose-500/10 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
              <span>Regerar Nova Resposta</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#121212] border border-[#262626] rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header do Modal */}
        <div className="px-4 py-3.5 border-b border-[#262626] bg-[#161616] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Assistente de IA Contextual
                <span className="text-[10px] bg-rose-500/15 text-rose-300 px-2 py-0.5 rounded-full border border-rose-500/30">
                  {platform === "tinder" ? "Tinder" : "Instagram"}
                </span>
              </h3>
              <p className="text-[11px] text-[#a8a8a8]">
                Conversa com <span className="text-white font-medium">{conversationName}</span>
                {newMessagesCount > 0 && (
                  <span className="text-amber-400 font-semibold ml-1">
                    • {newMessagesCount} {newMessagesCount === 1 ? "nova mensagem" : "novas mensagens"}
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#8e8e8e] hover:text-white hover:bg-[#262626] active:scale-95 transition-all cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas de Navegação Estilo Segmented Control Moderno (Mobile-First) */}
        <div className="px-3 sm:px-4 py-2.5 border-b border-[#26262a] bg-[#141416] shrink-0">
          <div className="p-1 rounded-2xl bg-[#1c1c20] border border-white/5 flex gap-1.5 items-center">
            {/* Aba 0: Responder de Cara (Geração Instantânea Atria) */}
            <button
              type="button"
              onClick={() => setActiveTab("generate")}
              className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none min-h-[38px] ${
                activeTab === "generate"
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-white border border-emerald-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
              }`}
            >
              <Zap className={`w-3.5 h-3.5 shrink-0 ${activeTab === "generate" ? "text-emerald-400" : "text-zinc-400"}`} />
              <span className="truncate whitespace-nowrap">
                <span className="inline sm:hidden">Responder</span>
                <span className="hidden sm:inline">Responder de Cara</span>
              </span>
            </button>

            {/* Aba 1: Copiar Prompt */}
            <button
              type="button"
              onClick={() => setActiveTab("prompt")}
              className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none min-h-[38px] ${
                activeTab === "prompt"
                  ? "bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-white border border-amber-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
              }`}
            >
              <Copy className={`w-3.5 h-3.5 shrink-0 ${activeTab === "prompt" ? "text-amber-400" : "text-zinc-400"}`} />
              <span className="truncate whitespace-nowrap">
                <span className="inline sm:hidden">Prompt</span>
                <span className="hidden sm:inline">1. Copiar Prompt</span>
              </span>
            </button>

            {/* Aba 2: Colar Manual */}
            <button
              type="button"
              onClick={() => setActiveTab("response")}
              className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none min-h-[38px] ${
                activeTab === "response"
                  ? "bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-white border border-purple-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
              }`}
            >
              <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${activeTab === "response" ? "text-purple-400" : "text-zinc-400"}`} />
              <span className="truncate whitespace-nowrap">
                <span className="inline sm:hidden">Manual</span>
                <span className="hidden sm:inline">2. Colar Manual</span>
              </span>
            </button>
          </div>
        </div>

        {/* Barra de Progresso no Topo do Modal quando gerando */}
        {isGenerating && (
          <div className="w-full h-1 bg-zinc-900 overflow-hidden relative shrink-0">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-purple-500 transition-all duration-200 ease-out"
              style={{ width: `${generationProgress}%` }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
          </div>
        )}

        {/* Conteúdo com Scroll */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-none min-h-[300px]">
          {/* ================= ABA 1: GERAR COM IA (INSTANTÂNEO) ================= */}
          {activeTab === "generate" && (
            <div className="space-y-4">
                {/* Motor de IA Ativo Exclusivo */}
                {/* Seletor de Motor de IA */}
                <div className="p-3 rounded-2xl bg-[#161619] border border-[#26262a] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 transition-colors",
                      selectedModel.includes("sol")
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                        : selectedModel.includes("terra")
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    )}>
                      <Brain className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white tracking-wide">
                          {/atria/i.test(selectedModel)
                            ? "Atria Dawn (Atria-ASI)"
                            : selectedModel.includes("sol")
                            ? "ChatGPT Sol (Kie.ai)"
                            : selectedModel.includes("terra")
                            ? "ChatGPT Terra (Kie.ai)"
                            : selectedModel.includes("pro")
                            ? "DeepSeek V4.0 Pro"
                            : "DeepSeek V4.1 Flash"}
                        </span>
                        <span className={cn(
                          "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                          /atria/i.test(selectedModel)
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : selectedModel.includes("sol")
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                            : selectedModel.includes("terra")
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-purple-500/20 text-purple-300 border-purple-500/40"
                        )}>
                          {/atria/i.test(selectedModel)
                            ? "Raciocínio Profundo • Padrão"
                            : selectedModel.includes("sol")
                            ? "Oficial Larissa • Raciocínio Alto"
                            : selectedModel.includes("terra")
                            ? "Profundo"
                            : "Pro"}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400">
                        {/atria/i.test(selectedModel)
                          ? "Atria-Dawn-Preview • Motor de raciocínio autêntico, fala natural e humana"
                          : selectedModel.includes("sol")
                          ? "Kie.ai gpt-5-6-sol • Personalidade humana autêntica, pausas inteligentes e funil"
                          : selectedModel.includes("terra")
                          ? "Kie.ai gpt-5-6-terra • Raciocínio estendido avançado"
                          : "NVIDIA NIM / Groq • Motor secundário"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    <div className="flex bg-[#0f0f11] p-1 rounded-xl border border-[#26262a]">
                      <button
                        type="button"
                        onClick={() => handleSelectModel("Atria-Dawn-Preview")}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 min-h-[32px] active:scale-95",
                          /atria/i.test(selectedModel)
                            ? "bg-emerald-600/35 text-emerald-200 border border-emerald-500/40 shadow-sm"
                            : "text-zinc-400 hover:text-white"
                        )}
                      >
                        <Zap className="w-3 h-3 text-emerald-400" />
                        Atria
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectModel("gpt-5-6-terra")}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 min-h-[32px] active:scale-95",
                          selectedModel === "gpt-5-6-terra"
                            ? "bg-emerald-600/35 text-emerald-200 border border-emerald-500/40 shadow-sm"
                            : "text-zinc-400 hover:text-white"
                        )}
                      >
                        <Sparkles className="w-3 h-3 text-emerald-400" />
                        Terra (Alto)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectModel("gpt-5-6-sol")}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 min-h-[32px] active:scale-95",
                          selectedModel === "gpt-5-6-sol"
                            ? "bg-amber-600/35 text-amber-200 border border-amber-500/40 shadow-sm"
                            : "text-zinc-400 hover:text-white"
                        )}
                      >
                        Sol
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectModel("deepseek-v4.1-flash:free")}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 min-h-[32px] active:scale-95",
                          selectedModel.includes("deepseek")
                            ? "bg-purple-600/35 text-purple-200 border border-purple-500/40 shadow-sm"
                            : "text-zinc-400 hover:text-white"
                        )}
                      >
                        DeepSeek
                      </button>
                    </div>

                    {lastLatencyMs && (
                      <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full shrink-0">
                        {(lastLatencyMs / 1000).toFixed(2)}s
                      </span>
                    )}
                  </div>
                </div>

              {/* Estado de Carregamento com Barra de Progresso Realista */}
              {isGenerating ? (
                <div className="rounded-3xl bg-gradient-to-b from-[#1c1c22] via-[#16161a] to-[#121214] border border-rose-500/30 p-5 sm:p-7 flex flex-col items-center justify-center gap-4 text-center shadow-2xl relative overflow-hidden">
                  {/* Glow sutil de fundo */}
                  <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-br from-rose-500/15 via-amber-500/10 to-purple-600/15 rounded-full blur-3xl pointer-events-none" />

                  {/* Anel animado com ícone */}
                  <div className="relative z-10">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 animate-spin flex items-center justify-center opacity-90 shadow-[0_0_24px_rgba(244,63,94,0.4)]" />
                    <Sparkles className="w-6 h-6 text-white absolute inset-0 m-auto animate-pulse" />
                  </div>

                  {/* Status Text & Descrição */}
                  <div className="space-y-1.5 z-10 max-w-md">
                    <h4 className="text-sm sm:text-base font-bold text-white flex items-center justify-center gap-2">
                      <span>
                        {isTranscribingAudios
                          ? "🎙️ Transcrevendo áudio recebido..."
                          : generationStatusText}
                      </span>
                    </h4>
                    {targetMessageSnippet ? (
                      <p className="text-xs text-purple-300 bg-purple-950/40 border border-purple-800/40 px-2.5 py-1 rounded-full inline-block mt-0.5">
                        🎯 Focado no balão: <span className="font-semibold text-white">{targetMessageSnippet}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {/atria/i.test(selectedModel)
                          ? "Atria-Dawn-Preview • Raciocinando sobre o histórico e o estilo autêntico da Larissa"
                          : selectedModel.includes("sol")
                          ? "ChatGPT Sol (Kie.ai) • Elaborando balões autênticos no estilo meigo da Larissa"
                          : selectedModel.includes("terra")
                          ? "ChatGPT Terra (Kie.ai) • Raciocínio profundo e natural"
                          : "DeepSeek • Elaborando balões autênticos no estilo meigo da Larissa"}
                      </p>
                    )}
                  </div>

                  {/* Barra de Progresso Realista */}
                  <div className="w-full max-w-md space-y-2.5 z-10 pt-1">
                    {/* Linha de Indicadores Superiores: Status + Cronômetro ao vivo + % */}
                    <div className="flex items-center justify-between text-xs px-0.5">
                      <span className="text-zinc-400 flex items-center gap-1.5 font-medium text-[11px]">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
                        <span>Inferência ao vivo</span>
                      </span>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-zinc-300 font-semibold bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/50">
                          ⏱️ {generationElapsedSec.toFixed(1)}s
                        </span>
                        <span className="font-bold text-amber-300 bg-amber-950/70 border border-amber-500/30 px-2 py-0.5 rounded-md shadow-xs">
                          {generationProgress}%
                        </span>
                      </div>
                    </div>

                    {/* Trilho da Barra de Progresso */}
                    <div className="w-full h-3.5 bg-zinc-900/95 border border-zinc-700/70 rounded-full p-0.5 overflow-hidden shadow-inner relative">
                      {/* Barra Preenchida com Gradiente Vivo */}
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-purple-500 transition-all duration-200 ease-out relative overflow-hidden shadow-[0_0_14px_rgba(244,63,94,0.7)]"
                        style={{ width: `${generationProgress}%` }}
                      >
                        {/* Shimmer animado correndo na barra */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                      </div>
                    </div>

                    {/* 4 Etapas Visuais (Checkpoints) */}
                    <div className="grid grid-cols-4 gap-1 pt-1 text-[10px] text-zinc-400">
                      <div className={`flex flex-col items-center text-center gap-0.5 ${generationProgress >= 15 ? "text-amber-300 font-semibold" : "opacity-40"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${generationProgress >= 15 ? "bg-amber-400" : "bg-zinc-600"}`} />
                        <span>1. Conexão</span>
                      </div>
                      <div className={`flex flex-col items-center text-center gap-0.5 ${generationProgress >= 40 ? "text-amber-300 font-semibold" : "opacity-40"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${generationProgress >= 40 ? "bg-amber-400" : "bg-zinc-600"}`} />
                        <span>2. Contexto</span>
                      </div>
                      <div className={`flex flex-col items-center text-center gap-0.5 ${generationProgress >= 72 ? "text-rose-300 font-semibold" : "opacity-40"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${generationProgress >= 72 ? "bg-rose-400" : "bg-zinc-600"}`} />
                        <span>3. Estilometria</span>
                      </div>
                      <div className={`flex flex-col items-center text-center gap-0.5 ${generationProgress >= 90 ? "text-purple-300 font-semibold" : "opacity-40"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${generationProgress >= 90 ? "bg-purple-400" : "bg-zinc-600"}`} />
                        <span>4. Balões</span>
                      </div>
                    </div>

                    {/* Estimativa de Tempo de Espera */}
                    <p className="text-[11px] text-zinc-400 text-center pt-1">
                      {generationProgress < 85
                        ? "Analisando contexto, rotina da Larissa e regras do funil..."
                        : "Quase pronto! Recebendo e validando os balões..."}
                    </p>
                  </div>
                </div>
              ) : generateError ? (
                <div className="p-4 rounded-2xl bg-red-950/30 border border-red-800/40 text-red-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4" />
                    <span>Erro na geração</span>
                  </div>
                  <p>{generateError}</p>
                  <button
                    onClick={() => handleGenerateAi()}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-white font-medium cursor-pointer"
                  >
                    Tentar Novamente
                  </button>
                </div>
              ) : editableResponses.length === 0 ? (
                /* Card inicial quando ainda não gerou */
                <div className="space-y-3">
                  <div className="p-5 rounded-2xl bg-gradient-to-b from-[#1c1c20] to-[#141416] border border-[#2a2a30] space-y-4 shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 via-rose-500/20 to-purple-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          Resposta da Larissa ({/atria/i.test(selectedModel) ? "Atria Dawn" : selectedModel.includes("sol") ? "ChatGPT Sol" : selectedModel.includes("terra") ? "ChatGPT Terra" : "DeepSeek"})
                        </h3>
                        <p className="text-xs text-zinc-400">
                          {selectedTargetMessageId
                            ? "Focando exclusivamente no balão selecionado do cliente."
                            : `Pronto para analisar e responder a ${conversationName}.`}
                        </p>
                      </div>
                    </div>

                    {/* Botão Principal: Gerar para todas as mensagens juntas */}
                    <button
                      type="button"
                      onClick={() => handleGenerateAi(null)}
                      disabled={isGenerating}
                      className="w-full py-3.5 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:opacity-95 active:scale-[0.99] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>
                        {newMessages.length > 1
                          ? `✨ Gerar resposta para todas as ${newMessages.length} mensagens juntos`
                          : "✨ Gerar Resposta Agora"}
                      </span>
                    </button>

                    {/* Botões Individuais por Balão do Cliente */}
                    {newMessages.length > 1 && (
                      <div className="pt-3 border-t border-white/5 space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                            Ou gerar resposta por balão individual:
                          </span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {newMessages.length} balões recebidos
                          </span>
                        </div>

                        <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5 scrollbar-none">
                          {newMessages.map((msgItem) => (
                            <div
                              key={msgItem.index}
                              className="p-3 rounded-xl bg-[#141416] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:border-purple-500/30 transition-all"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="text-[10px] text-purple-400 font-semibold block mb-0.5">
                                  Balão {msgItem.index + 1}:
                                </span>
                                <p className="text-xs text-zinc-200 line-clamp-2 leading-relaxed font-sans select-text">
                                  "{msgItem.text}"
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleGenerateAi(msgItem.id || null)}
                                disabled={isGenerating}
                                className="px-3 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-200 text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                                title="Gerar resposta focada apenas neste balão do cliente"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                                <span>Gerar só este balão</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Balões já gerados: permite regerar e exibe os cards */
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">
                        {selectedTargetMessageId ? (
                          <span className="text-purple-300 font-semibold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                            Respondendo ao balão específico
                          </span>
                        ) : (
                          "Balões gerados com sucesso:"
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedTargetMessageId && (
                        <button
                          type="button"
                          onClick={() => handleGenerateAi(null)}
                          disabled={isGenerating}
                          className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          title="Gerar resposta respondendo a todas as mensagens do cliente"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          <span>Gerar para todas as mensagens</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Se gerou para um balão específico e há outros balões recebidos, mostra botões rápidos para os outros */}
                  {selectedTargetMessageId && newMessages.length > 1 && (
                    <div className="p-2.5 rounded-xl bg-purple-950/20 border border-purple-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <span className="text-zinc-300 text-[11px] font-medium">
                        Gerar resposta para outro balão de {conversationName}:
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {newMessages
                          .filter((nm) => String(nm.id) !== String(selectedTargetMessageId))
                          .map((nm) => (
                            <button
                              key={nm.index}
                              type="button"
                              onClick={() => handleGenerateAi(nm.id || null)}
                              disabled={isGenerating}
                              className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-[11px] font-semibold transition-all cursor-pointer border border-purple-500/30"
                              title={`Gerar para balão ${nm.index + 1}: "${nm.text}"`}
                            >
                              Balão {nm.index + 1}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {renderBalloonCards()}
                </div>
              )}
            </div>
          )}

          {/* ================= ABA 2: COPIAR PROMPT ================= */}
          {activeTab === "prompt" && (

            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#a8a8a8]">
                  Prompt contextualizado gerado com o histórico do Supabase e DNA da Larissa:
                </p>
                <button
                  onClick={fetchPrompt}
                  disabled={isLoadingPrompt}
                  className="text-[11px] text-[#0095f6] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Atualizar histórico e prompt"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingPrompt ? "animate-spin" : ""}`} />
                  Recarregar
                </button>
              </div>

              {isLoadingPrompt ? (
                <div className="h-56 rounded-2xl bg-[#181818] border border-[#262626] flex flex-col items-center justify-center gap-2.5 text-[#a8a8a8]">
                  <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                  <p className="text-xs font-medium">
                    {isTranscribingAudios
                      ? "🎙️ Transcrevendo áudio recebido na nuvem..."
                      : "Montando contexto e prompt da Larissa..."}
                  </p>
                </div>
              ) : promptError ? (
                <div className="p-4 rounded-2xl bg-red-950/30 border border-red-800/40 text-red-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4" />
                    <span>Erro ao gerar prompt</span>
                  </div>
                  <p>{promptError}</p>
                  <button
                    onClick={fetchPrompt}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-white font-medium cursor-pointer"
                  >
                    Tentar Novamente
                  </button>
                </div>
              ) : (
                <>
                  {/* Card elegante e limpo sem expor o texto cru do prompt */}
                  <div className="p-3.5 rounded-xl bg-gradient-to-b from-[#1c1c20] to-[#141416] border border-[#2a2a30] flex flex-col items-center text-center space-y-1.5 shadow-md">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500/20 via-rose-500/20 to-purple-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                      <Sparkles className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white">Prompt Pronto para Copiar</h3>
                      <p className="text-[10px] text-zinc-400 mt-0.5 max-w-sm">
                        Contexto completo montado com o histórico sincronizado desta conversa e a persona oficial da Larissa.
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400 bg-black/40 px-2.5 py-0.5 rounded-full border border-white/5">
                      {promptText.length.toLocaleString()} caracteres prontos para a IA
                    </span>
                  </div>

                  {/* Ação de Cópia */}
                  <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                    <button
                      onClick={handleCopyPrompt}
                      className={`w-full sm:flex-1 py-3 px-4 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 shadow-md ${
                        copied
                          ? "bg-emerald-600 text-white shadow-emerald-950/40"
                          : "bg-gradient-to-r from-amber-500 to-rose-500 text-white hover:opacity-95"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          Prompt Copiado com Sucesso!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copiar Prompt Completo
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setActiveTab("response")}
                      className="w-full sm:w-auto py-3 px-4 rounded-2xl bg-[#222] border border-[#333] text-white text-xs font-semibold hover:bg-[#2a2a2a] active:scale-95 transition-all cursor-pointer"
                    >
                      Já copiei, ir para etapa 2 →
                    </button>
                  </div>

                  {/* Atalho rápido para abrir o chat diretamente */}
                  {platform === "instagram" ? (
                    <a
                      href={getInstagramDirectAppUrl(resolveTargetInstagramHandle())}
                      className="w-full py-2.5 px-4 rounded-2xl bg-[#16161a] hover:bg-[#202026] border border-[#2e2e38] text-xs font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#0095f6]" />
                      Abrir Direct de @{resolveTargetInstagramHandle()} no Instagram
                    </a>
                  ) : (
                    <a
                      href={`https://tinder.com/app/messages/${conversationId}`}
                      className="w-full py-2.5 px-4 rounded-2xl bg-[#16161a] hover:bg-[#202026] border border-[#2e2e38] text-xs font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#fd5068]" />
                      Abrir conversa no Tinder
                    </a>
                  )}

                </>
              )}
            </div>
          )}

          {/* ================= ABA 2: COLAR RESPOSTA ================= */}
          {activeTab === "response" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {/* Botão de Colar da Área de Transferência */}
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 border ${
                    pasteSuccess
                      ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm"
                      : "bg-[#1c1c1e] hover:bg-[#252528] border-[#333] text-white hover:border-amber-500/50"
                  }`}
                >
                  {pasteSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>JSON Colado e Processado com Sucesso!</span>
                    </>
                  ) : (
                    <>
                      <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />
                      <span>Colar JSON da Área de Transferência</span>
                    </>
                  )}
                </button>

              </div>

              {parseError && (
                <div className="p-3 rounded-xl bg-red-950/30 border border-red-900/50 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <p>{parseError}</p>
                </div>
              )}

              {/* Balões Interpretados e Editáveis */}
              {renderBalloonCards()}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
