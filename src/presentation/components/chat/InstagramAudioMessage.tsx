"use client";

import React, { useRef, useState, useEffect } from "react";
import { Download, Loader2, Pause, Play, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { getApiUrl } from "@/infrastructure/http/network";
import { apiFetch } from "@/infrastructure/http/apiFetch";
import { toast } from "sonner";

interface InstagramAudioMessageProps {
  audioUrl: string;
  isMine?: boolean;
  transcript?: string;
  messageId?: string;
  onForward?: () => void;
  onDurationLoaded?: (duration: number) => void;
  onTranscribed?: (transcript: string) => void;
}

const DEFAULT_WAVEFORM = [
  8, 14, 22, 10, 24, 18, 28, 14, 22, 30, 18, 26, 12, 22, 28, 16, 24, 18, 28,
  14, 20, 26, 16, 10,
];

const SPEEDS = [1, 1.5, 2];

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function InstagramAudioMessage({
  audioUrl,
  isMine = false,
  transcript,
  messageId,
  onForward,
  onDurationLoaded,
  onTranscribed,
}: InstagramAudioMessageProps) {
  if (!audioUrl || audioUrl.trim().length === 0) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-zinc-300 select-none">
        <span>🎙️ Mensagem de voz</span>
      </div>
    );
  }

  const audioRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState<string | undefined>(transcript);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (transcript) {
      setCurrentTranscript(transcript);
    }
  }, [transcript]);

  async function handleTranscribe(event: React.MouseEvent) {
    event.stopPropagation();
    if (isTranscribing) return;
    setIsTranscribing(true);

    try {
      const res = await apiFetch(getApiUrl("/api/ai/transcribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          mediaUrl: audioUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.text) {
        throw new Error(data.error || "Não foi possível transcrever o áudio.");
      }

      setCurrentTranscript(data.text);
      setIsExpanded(true);
      onTranscribed?.(data.text);
      toast.success(data.cached ? "Transcrição carregada do cache!" : "Áudio transcrito na nuvem com sucesso!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro na transcrição.";
      toast.error(msg);
    } finally {
      setIsTranscribing(false);
    }
  }
  async function handleDownload(event: React.MouseEvent) {
    event.stopPropagation();
    if (!audioUrl || downloading) return;
    setDownloading(true);
    const toastId = toast.loading("Iniciando download do áudio...");
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error("Falha na resposta do servidor.");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const extension = audioUrl.includes(".wav")
        ? "wav"
        : audioUrl.includes(".m4a")
          ? "m4a"
          : audioUrl.includes(".aac")
            ? "aac"
            : audioUrl.includes(".ogg")
              ? "ogg"
              : "mp3";
      a.download = `audio_${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      toast.success("Áudio baixado com sucesso!", { id: toastId });
    } catch (err) {
      console.warn("Falha no download via blob (possível CORS), disparando download direto:", err);
      try {
        const a = document.createElement("a");
        a.href = audioUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.download = `audio_${Date.now()}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success("Download iniciado via navegador!", { id: toastId });
      } catch {
        window.open(audioUrl, "_blank");
        toast.info("Áudio aberto para salvar.", { id: toastId });
      }
    } finally {
      setDownloading(false);
    }
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const currentSpeed = SPEEDS[speedIndex];

  async function togglePlayback(event?: React.MouseEvent) {
    if (event) event.stopPropagation();
    const mediaEl = audioRef.current;
    if (!mediaEl) return;

    if (mediaEl.paused) {
      try {
        await mediaEl.play();
      } catch (err) {
        console.warn("Reprodução de áudio bloqueada ou falhou:", err);
      }
    } else {
      mediaEl.pause();
    }
  }

  function cycleSpeed(event: React.MouseEvent) {
    event.stopPropagation();
    const nextIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIndex);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[nextIndex];
    }
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    const mediaEl = audioRef.current;
    if (!mediaEl || !duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - bounds.left;
    const newRatio = Math.max(0, Math.min(1, clickX / bounds.width));
    mediaEl.currentTime = newRatio * duration;
    setCurrentTime(mediaEl.currentTime);
  }

  return (
    <div className="flex flex-col min-w-[190px] max-w-[280px] sm:max-w-[320px] w-full py-1 px-1 select-none">
      {/* Player de Áudio Nativo */}
      <div
        onClick={() => void togglePlayback()}
        className="flex items-center gap-3 cursor-pointer group"
        title={playing ? "Pausar nota de voz" : "Tocar nota de voz"}
      >
        {/* Elemento de vídeo playsInline oculto para garantir reprodução em todos os navegadores */}
        <video
          ref={audioRef}
          preload="metadata"
          playsInline
          src={audioUrl}
          className="hidden"
          onLoadedMetadata={(event) => {
            const d = event.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) {
              setDuration(d);
              onDurationLoaded?.(d);
            }
          }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
        />

        {/* Botão de Reprodução / Pausa */}
        <button
          type="button"
          onClick={(e) => void togglePlayback(e)}
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-md transition-all active:scale-90 cursor-pointer ${
            isMine
              ? "bg-white text-[#0095f6] hover:bg-white/95"
              : "bg-gradient-to-tr from-[#0095f6] to-[#0081d6] text-white hover:opacity-95"
          }`}
          aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        >
          {playing ? (
            <Pause className="w-4 h-4 fill-current stroke-none" />
          ) : (
            <Play className="w-4 h-4 fill-current stroke-none ml-0.5" />
          )}
        </button>

        {/* Corpo com Waveform e Informações de Tempo / Velocidade */}
        <div className="flex-1 flex flex-col justify-center gap-1.5 min-w-0">
          <div
            className="flex items-center gap-0.5 h-6 cursor-pointer py-1"
            onClick={seek}
            title="Avançar ou retroceder no áudio"
          >
            {DEFAULT_WAVEFORM.map((height, index) => {
              const isPlayed = index / DEFAULT_WAVEFORM.length <= progress;
              return (
                <div
                  key={`${height}-${index}`}
                  style={{ height: `${(height / 30) * 100}%` }}
                  className={`w-[3px] rounded-full transition-colors ${
                    isPlayed
                      ? isMine
                        ? "bg-white"
                        : "bg-[#0095f6]"
                      : isMine
                        ? "bg-white/40"
                        : "bg-zinc-600"
                  }`}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[10px] font-medium leading-none">
            <span
              className={
                isMine
                  ? "text-white/85 font-mono"
                  : "text-zinc-400 font-mono"
              }
            >
              {formatDuration(playing || currentTime > 0 ? currentTime : duration)}
            </span>

            <div className="flex items-center gap-2">
              {/* Seletor de Velocidade */}
              <button
                type="button"
                onClick={cycleSpeed}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight transition-colors cursor-pointer ${
                  isMine
                    ? "bg-white/20 text-white hover:bg-white/30"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                title="Alterar velocidade de reprodução"
              >
                {currentSpeed.toFixed(1)}x
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Ações Rápidas: Baixar Áudio + Transcrever */}
      <div
        className={`mt-2 pt-1.5 border-t ${
          isMine ? "border-white/15" : "border-zinc-800"
        } flex items-center justify-between gap-1.5`}
      >
        {/* Botão de Download em Destaque */}
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className={`text-[10px] font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
            isMine
              ? "bg-white/20 text-white hover:bg-white/30"
              : "bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 border border-zinc-700/50"
          }`}
          title="Baixar arquivo de áudio"
          aria-label="Baixar áudio"
        >
          {downloading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-[#0095f6]" />
              <span>Baixando...</span>
            </>
          ) : (
            <>
              <Download className={`w-3 h-3 ${isMine ? "text-white" : "text-[#0095f6]"}`} />
              <span>Baixar áudio</span>
            </>
          )}
        </button>

        {/* Botão de Transcrição se ainda não transcrito e não transcrevendo */}
        {!currentTranscript && !isTranscribing && (
          <button
            type="button"
            onClick={handleTranscribe}
            className={`text-[10px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md transition-all active:scale-95 cursor-pointer ${
              isMine
                ? "bg-white/20 text-white hover:bg-white/30"
                : "bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 border border-zinc-700/50"
            }`}
            title="Transcrever áudio na nuvem com Groq Whisper Large v3"
          >
            <Sparkles className="w-2.5 h-2.5 text-[#0095f6]" />
            <span>Transcrever</span>
          </button>
        )}
      </div>

      {/* Bloco de Transcrição de Áudio (Groq Whisper v3 Cloud) */}
      {currentTranscript && (
        <div
          className={`mt-1.5 pt-1.5 border-t ${
            isMine ? "border-white/15" : "border-zinc-800/60"
          } text-left select-text`}
        >
          <div className="flex items-center justify-between gap-1 mb-1">
            <span
              className={`text-[10px] font-semibold flex items-center gap-1 ${
                isMine ? "text-white/85" : "text-[#0095f6]"
              }`}
            >
              <Sparkles className="w-2.5 h-2.5" />
              Transcrição
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={`p-0.5 rounded transition-colors cursor-pointer ${
                isMine
                  ? "hover:bg-white/20 text-white/80"
                  : "hover:bg-zinc-800 text-zinc-400"
              }`}
              title={isExpanded ? "Ocultar texto" : "Exibir texto"}
            >
              {isExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
          {isExpanded && (
            <p
              className={`text-[11px] leading-relaxed italic break-words [word-break:break-word] ${
                isMine ? "text-white/95" : "text-zinc-200"
              }`}
            >
              &ldquo;{currentTranscript}&rdquo;
            </p>
          )}
        </div>
      )}

      {isTranscribing && (
        <div
          className={`mt-1.5 pt-1.5 border-t ${
            isMine ? "border-white/15" : "border-zinc-800/60"
          } flex items-center gap-1.5 text-[10px] ${
            isMine ? "text-white/80" : "text-[#0095f6]"
          }`}
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Transcrevendo áudio na nuvem...</span>
        </div>
      )}
    </div>
  );
}
