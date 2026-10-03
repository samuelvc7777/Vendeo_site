"use client";

import { useState } from "react";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import type { WhatsApp2Attachment } from "./whatsapp2-client";

function formatBytes(value?: number | null): string {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

function documentTypeLabel(attachment: WhatsApp2Attachment): string {
  const mime = String(attachment.mimeType || "").toLowerCase().split(";")[0].trim();
  const fileName = String(attachment.fileName || "");
  if (mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) return "PDF";
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()
    : "";
  return extension || "DOCUMENTO";
}

export function WhatsAppDocumentMessage({
  attachment,
  mediaUrl,
  isMine,
}: {
  attachment: WhatsApp2Attachment;
  mediaUrl?: string;
  isMine: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const url = String(mediaUrl || attachment.mediaUrl || "").trim();
  const fileName = String(attachment.fileName || "Documento").trim() || "Documento";
  const typeLabel = documentTypeLabel(attachment);
  const sizeLabel = formatBytes(attachment.fileSize);
  const meta = [typeLabel, sizeLabel].filter(Boolean).join(" • ");
  const caption = String(attachment.caption || "").trim();
  const visibleCaption = caption && caption !== fileName ? caption : "";

  const openDocument = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const downloadDocument = async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-w-0 max-w-[320px]">
      <div
        className={[
          "overflow-hidden rounded-[14px] border",
          isMine
            ? "border-white/15 bg-white/10"
            : "border-black/[0.08] bg-black/[0.035] dark:border-white/[0.08] dark:bg-white/[0.055]",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={openDocument}
          disabled={!url}
          className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left disabled:cursor-default"
          aria-label={url ? `Abrir ${fileName}` : fileName}
        >
          <span
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              isMine
                ? "bg-white/15 text-white"
                : "bg-white text-[#d73535] shadow-sm dark:bg-white/10 dark:text-[#ff6961]",
            ].join(" ")}
          >
            <FileText className="h-6 w-6" strokeWidth={1.8} />
          </span>

          <span className="min-w-0 flex-1">
            <span
              className={[
                "block truncate text-[14px] font-semibold leading-5",
                isMine ? "text-white" : "text-zinc-950 dark:text-white",
              ].join(" ")}
              title={fileName}
            >
              {fileName}
            </span>
            <span
              className={[
                "mt-0.5 block text-[11px] font-medium",
                isMine ? "text-white/70" : "text-zinc-500 dark:text-zinc-400",
              ].join(" ")}
            >
              {meta || "Documento"}
            </span>
          </span>

          {url ? (
            <ExternalLink
              className={isMine ? "h-4 w-4 shrink-0 text-white/75" : "h-4 w-4 shrink-0 text-zinc-400"}
              strokeWidth={2}
            />
          ) : null}
        </button>

        {url ? (
          <div
            className={[
              "border-t px-2 py-1.5",
              isMine ? "border-white/10" : "border-black/[0.06] dark:border-white/[0.06]",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={downloadDocument}
              disabled={downloading}
              className={[
                "flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold transition active:scale-[0.985]",
                isMine
                  ? "text-white/90 hover:bg-white/10"
                  : "text-[#007aff] hover:bg-black/[0.035] dark:text-[#0a84ff] dark:hover:bg-white/[0.05]",
              ].join(" ")}
              aria-label={`Baixar ${fileName}`}
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {downloading ? "Baixando…" : "Baixar"}
            </button>
          </div>
        ) : null}
      </div>

      {visibleCaption ? (
        <p
          className={[
            "px-1 pt-1.5 text-[13px] leading-[18px] whitespace-pre-wrap break-words",
            isMine ? "text-white/95" : "text-zinc-800 dark:text-white/95",
          ].join(" ")}
        >
          {visibleCaption}
        </p>
      ) : null}
    </div>
  );
}
