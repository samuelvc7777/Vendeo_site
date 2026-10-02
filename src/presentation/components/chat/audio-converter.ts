import { FFmpeg } from "@ffmpeg/ffmpeg";

/**
 * Converte qualquer arquivo de áudio recebido (.mp3, .ogg, .webm, etc.)
 * para o formato WAV / PCM padrão do Instagram Direct usando a Web Audio API.
 */

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /* RIFF identifier */
  writeString(0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + length, true);
  /* RIFF type */
  writeString(8, "WAVE");
  /* format chunk identifier */
  writeString(12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(36, "data");
  /* data chunk length */
  view.setUint32(40, length, true);

  // Escreve amostras de áudio intercaladas
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = Math.max(-1, Math.min(1, channels[channel][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

export interface ConvertedAudioResult {
  file: File;
  duration: number; // Em segundos
}

/**
 * Converte qualquer arquivo de áudio (ou vídeo com áudio como .mp4, .webm, .ogg)
 * para um arquivo WAV padrão de alta fidelidade compatível com a Meta Graph API,
 * calculando com precisão a duração total.
 */
export async function convertAndAnalyzeAudio(file: File): Promise<ConvertedAudioResult> {
  let calculatedDuration = 0;

  // 1. Tenta aferir duração rapidamente via elemento de áudio HTML5
  try {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    await new Promise<void>((resolve) => {
      audio.onloadedmetadata = () => {
        calculatedDuration = Math.round(audio.duration || 0);
        resolve();
      };
      audio.onerror = () => resolve();
      setTimeout(resolve, 1500);
    });
    URL.revokeObjectURL(url);
  } catch {
    // Segue para tentativa com Web Audio
  }

  // A Meta Graph API no Instagram Direct aceita apenas WAV, M4A, AAC e MP4.
  // MP3, OGG, WEBM e OPUS NÃO são aceitos como anexos de áudio e causam erro 502 ("Esse formato de anexo não é aceito").
  const lowerName = file.name.toLowerCase();
  const lowerType = (file.type || "").toLowerCase();
  const isAlreadyStandard =
    lowerName.endsWith(".wav") ||
    lowerName.endsWith(".m4a") ||
    lowerName.endsWith(".aac") ||
    lowerType.includes("wav") ||
    lowerType.includes("m4a") ||
    lowerType.includes("aac");

  if (isAlreadyStandard) {
    // Se a duração ainda não foi aferida, tenta decodificar para obter a duração exata
    if (!calculatedDuration) {
      try {
        const arrayBuffer = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          calculatedDuration = Math.round(audioBuffer.duration || 0);
        }
      } catch {
        // Usa fallback
      }
    }

    return {
      file,
      duration: Math.max(1, calculatedDuration || 5),
    };
  }

  // 2. Se for formato mp3/webm/ogg/raw, decodifica e converte para WAV PCM 16-bit padrão da Meta
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (AudioContextClass) {
      const audioCtx = new AudioContextClass();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      calculatedDuration = Math.round(audioBuffer.duration || 0);

      const wavBlob = audioBufferToWavBlob(audioBuffer);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const convertedFile = new File([wavBlob], `${baseName}.wav`, {
        type: "audio/wav",
      });

      return {
        file: convertedFile,
        duration: Math.max(1, calculatedDuration),
      };
    }
  } catch (err) {
    console.warn("Aviso na conversão Web Audio:", err);
  }

  return {
    file,
    duration: Math.max(1, calculatedDuration || 5),
  };
}

let whatsappVoiceEncoderPromise: Promise<any> | null = null;

async function getWhatsAppVoiceEncoder() {
  if (typeof window === "undefined") {
    throw new Error("Conversão de voz do WhatsApp só está disponível no navegador.");
  }

  if (!whatsappVoiceEncoderPromise) {
    whatsappVoiceEncoderPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      });
      return ffmpeg;
    })().catch((error) => {
      whatsappVoiceEncoderPromise = null;
      throw error;
    });
  }

  return whatsappVoiceEncoderPromise;
}

export async function convertToWhatsAppVoiceNote(file: File): Promise<File> {
  const ffmpeg = await getWhatsAppVoiceEncoder();
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inputExt = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
  const inputName = `input_${token}.${inputExt}`;
  const outputName = `voice_${token}.ogg`;

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const exitCode = await ffmpeg.exec([
      "-i", inputName,
      "-vn",
      "-ac", "1",
      "-ar", "48000",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-application", "voip",
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg encerrou com código ${exitCode}`);
    }

    const output = await ffmpeg.readFile(outputName);
    if (typeof output === "string") {
      throw new Error("FFmpeg retornou uma saída de áudio inválida.");
    }

    const bytes = new Uint8Array(output);
    return new File([bytes.slice().buffer], outputName, {
      type: "audio/ogg; codecs=opus",
    });
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
  }
}

export async function ensureInstagramCompatibleAudio(file: File): Promise<File> {
  const result = await convertAndAnalyzeAudio(file);
  return result.file;
}

/**
 * Garante que uma URL remota de áudio seja compatível com a Meta Graph API.
 * Se a URL for .mp3 ou formato incompatível, baixa os bytes, converte para WAV PCM 16-bit
 * e sobe para o Supabase Storage, retornando a nova URL 100% válida.
 */
export async function ensureCompatibleAudioUrl(
  audioUrl: string,
  uploadEndpoint = "/api/instagram/upload"
): Promise<string> {
  if (!audioUrl) return audioUrl;
  const lower = audioUrl.toLowerCase();

  // Se já for WAV, M4A ou MP4, está aprovado pela Meta
  if (lower.includes(".wav") || lower.includes(".m4a") || lower.includes(".mp4")) {
    return audioUrl;
  }

  try {
    const res = await fetch(audioUrl);
    if (!res.ok) return audioUrl;

    const arrayBuffer = await res.arrayBuffer();
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return audioUrl;

    const audioCtx = new AudioContextClass();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const wavBlob = audioBufferToWavBlob(audioBuffer);

    const fileName = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`;
    const formData = new FormData();
    formData.append("file", wavBlob, fileName);
    formData.append("type", "audio");

    const upRes = await fetch(uploadEndpoint, {
      method: "POST",
      body: formData,
    });

    if (upRes.ok) {
      const upData = await upRes.json();
      if (upData?.url) {
        return upData.url;
      }
    }
  } catch (err) {
    console.warn("[audio-converter] Aviso na auto-conversão de URL de áudio incompatível:", err);
  }

  return audioUrl;
}
