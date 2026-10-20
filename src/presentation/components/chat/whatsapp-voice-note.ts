"use client";

import { getApiUrl } from "@/infrastructure/http/network";
import { convertToWhatsAppVoiceNote } from "./audio-converter";

// Reutiliza uma conversao bem-sucedida durante a sessao, sem repetir uploads.
const preparedVoiceUrls = new Map<string, Promise<string>>();

/**
 * Notas de voz manuais precisam ser OGG/Opus antes de chegar ao gateway.
 * Audios antigos do cofre (WAV/MP3/M4A) sao preparados automaticamente.
 * Nunca retorna o audio comum como fallback, pois isso quebraria o PTT.
 */
export function prepareWhatsAppVoiceNoteUrl(sourceUrl: string): Promise<string> {
  const url = sourceUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    return Promise.reject(new Error("A nota de voz nao possui uma URL HTTP valida."));
  }

  const pending = preparedVoiceUrls.get(url);
  if (pending) return pending;

  const job = (async () => {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".ogg") || pathname.endsWith(".opus")) {
      // O gateway confere os bytes antes do envio, nao somente a extensao.
      return url;
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error("Nao foi possivel baixar o audio original para converter em nota de voz.");
    }
    if (!response.ok) {
      throw new Error("Audio original indisponivel (" + response.status + ").");
    }
    const audioBlob = await response.blob();
    if (audioBlob.size === 0) throw new Error("O audio original esta vazio.");

    const rawExt = pathname.split("/").pop()?.split(".").pop()?.replace(/[^a-z0-9]/g, "") || "bin";
    const input = new File([audioBlob], "voz_original." + rawExt, {
      type: audioBlob.type || "application/octet-stream",
    });
    const ogg = await convertToWhatsAppVoiceNote(input);
    const form = new FormData();
    form.append("file", ogg, ogg.name);
    form.append("type", "audio");

    const upload = await fetch(getApiUrl("/api/instagram/upload"), {
      method: "POST",
      body: form,
    });
    const data = await upload.json().catch(() => ({}));
    if (!upload.ok || typeof data.url !== "string" || !data.url) {
      throw new Error(data.error || "Falha ao salvar a nota de voz OGG/Opus.");
    }
    return data.url as string;
  })().catch((error) => {
    preparedVoiceUrls.delete(url);
    throw error;
  });

  preparedVoiceUrls.set(url, job);
  return job;
}
