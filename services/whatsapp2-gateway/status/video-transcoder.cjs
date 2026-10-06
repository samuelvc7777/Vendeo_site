/**
 * Video Transcoder para Status do WhatsApp
 *
 * Reaproveita o binário do FFmpeg existente no projeto (ffmpeg-static)
 * para normalizar vídeos para o formato oficial do WhatsApp Web:
 * - Contêiner: MP4
 * - Codec de Vídeo: H.264 (AVC) yuv420p
 * - Codec de Áudio: AAC
 * - Duração máxima: 30 segundos
 * - Otimização web: movflags +faststart
 * - Limpeza garantida de arquivos temporários em qualquer cenário.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const MAX_STATUS_VIDEO_SECONDS = 30;
const MAX_STATUS_VIDEO_OUTPUT_BYTES = 16 * 1024 * 1024; // 16 MB

function getFfmpegPath() {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(__dirname, "..", "..", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(__dirname, "..", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    process.env.FFMPEG_PATH,
    "ffmpeg",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
}

/**
 * Transcodifica e/ou corta um vídeo para o padrão aceito pelo WhatsApp Status.
 */
async function transcodeVideoForStatus(inputBuffer, { maxSeconds = MAX_STATUS_VIDEO_SECONDS } = {}) {
  const ffmpegPath = getFfmpegPath();
  const id = crypto.randomBytes(8).toString("hex");
  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `wa_status_in_${id}.tmp`);
  const outputPath = path.join(tempDir, `wa_status_out_${id}.mp4`);

  try {
    fs.writeFileSync(inputPath, inputBuffer);

    const args = [
      "-y",
      "-i",
      inputPath,
      "-t",
      String(maxSeconds),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      "-maxrate",
      "2.5M",
      "-bufsize",
      "5M",
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { timeout: 60_000 }, (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || "").slice(-300);
          return reject(new Error(`Falha na conversão do vídeo pelo FFmpeg: ${detail}`));
        }
        resolve();
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Arquivo de vídeo convertido não foi gerado pelo FFmpeg.");
    }

    const outputBuffer = fs.readFileSync(outputPath);
    if (outputBuffer.length > MAX_STATUS_VIDEO_OUTPUT_BYTES) {
      throw new Error(
        `O vídeo transcodificado (${Math.round(outputBuffer.length / 1024 / 1024)}MB) excedeu o limite de 16MB do WhatsApp.`,
      );
    }

    return {
      buffer: outputBuffer,
      mimeType: "video/mp4",
      filename: "status.mp4",
      size: outputBuffer.length,
    };
  } finally {
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
  }
}

module.exports = {
  MAX_STATUS_VIDEO_SECONDS,
  MAX_STATUS_VIDEO_OUTPUT_BYTES,
  getFfmpegPath,
  transcodeVideoForStatus,
};
