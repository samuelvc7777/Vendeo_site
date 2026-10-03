"use client";

import {
  BarChart3,
  ExternalLink,
  Images,
  Link2,
  MapPin,
  Phone,
  UserRound,
  Users,
} from "lucide-react";
import type { WhatsApp2MessageMetadata } from "./whatsapp2-client";

function safeExternalUrl(value?: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function forwardedLabel(metadata: WhatsApp2MessageMetadata): string | null {
  if (!metadata.isForwarded) return null;
  return Number(metadata.forwardingScore || 0) >= 5
    ? "Encaminhada muitas vezes"
    : "Encaminhada";
}

function shellClass(isMine: boolean): string {
  return [
    "min-w-[220px] max-w-[320px] overflow-hidden rounded-[13px] border",
    isMine
      ? "border-white/15 bg-white/10 text-white"
      : "border-black/[0.07] bg-black/[0.035] text-[#111b21] dark:border-white/[0.08] dark:bg-white/[0.055] dark:text-[#e9edef]",
  ].join(" ");
}

export function WhatsAppNativeMessage({
  metadata,
  text,
  isMine,
}: {
  metadata: WhatsApp2MessageMetadata;
  text: string;
  isMine: boolean;
}) {
  const kind = String(metadata.nativeKind || "").toLowerCase();
  const forwarded = forwardedLabel(metadata);

  if (kind === "contact") {
    const contacts = Array.isArray(metadata.contacts) ? metadata.contacts.slice(0, 20) : [];
    return (
      <div className={shellClass(isMine)}>
        <div className="px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${isMine ? "bg-white/15" : "bg-[#e9edef] dark:bg-white/10"}`}>
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">
                {contacts.length > 1 ? `${contacts.length} contatos` : contacts[0]?.name || "Contato"}
              </div>
              <div className={`text-[11px] ${isMine ? "text-white/65" : "text-[#667781] dark:text-[#8696a0]"}`}>
                Cartão de contato
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {contacts.slice(0, 4).map((contact, index) => {
              const phone = contact.phones?.[0] || "";
              const email = contact.emails?.[0] || "";
              return (
                <div key={`${contact.name || "contact"}-${index}`} className={`rounded-lg px-2.5 py-2 ${isMine ? "bg-white/10" : "bg-white/75 dark:bg-black/10"}`}>
                  <div className="truncate text-[13px] font-semibold">{contact.name || `Contato ${index + 1}`}</div>
                  {phone ? (
                    <a
                      href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                      className={`mt-0.5 block truncate text-[12px] ${isMine ? "text-white/80" : "text-[#007aff] dark:text-[#5ac8fa]"}`}
                    >
                      {phone}
                    </a>
                  ) : null}
                  {email ? (
                    <a
                      href={`mailto:${email}`}
                      className={`mt-0.5 block truncate text-[11px] ${isMine ? "text-white/65" : "text-[#667781] dark:text-[#8696a0]"}`}
                    >
                      {email}
                    </a>
                  ) : null}
                </div>
              );
            })}
            {contacts.length > 4 ? (
              <div className={`text-center text-[11px] ${isMine ? "text-white/65" : "text-[#667781] dark:text-[#8696a0]"}`}>
                +{contacts.length - 4} contatos
              </div>
            ) : null}
          </div>
        </div>
        {forwarded ? (
          <div className={`border-t px-3 py-1.5 text-[10px] italic ${isMine ? "border-white/10 text-white/60" : "border-black/[0.05] text-[#667781] dark:border-white/[0.06] dark:text-[#8696a0]"}`}>
            ↪ {forwarded}
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === "location") {
    const location = metadata.location;
    const lat = Number(location?.latitude);
    const lng = Number(location?.longitude);
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
    const directUrl = safeExternalUrl(location?.url);
    const mapUrl = directUrl || (hasCoordinates
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
      : null);

    return (
      <div className={shellClass(isMine)}>
        <div className="flex items-start gap-3 px-3 py-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isMine ? "bg-white/15" : "bg-[#e9edef] text-[#25d366] dark:bg-white/10"}`}>
            <MapPin className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">
              {location?.name || (location?.isLive ? "Localização ao vivo" : "Localização")}
            </div>
            {location?.address ? (
              <div className={`mt-0.5 text-[12px] leading-4 ${isMine ? "text-white/75" : "text-[#667781] dark:text-[#8696a0]"}`}>
                {location.address}
              </div>
            ) : null}
            {location?.isLive ? (
              <div className={`mt-1 text-[10px] font-medium ${isMine ? "text-white/70" : "text-[#25d366]"}`}>
                Compartilhamento ao vivo
              </div>
            ) : null}
          </div>
        </div>
        {mapUrl ? (
          <a
            href={mapUrl}
            target="_blank"
            rel="noreferrer"
            className={`flex h-9 items-center justify-center gap-1.5 border-t text-[12px] font-semibold ${isMine ? "border-white/10 text-white/90" : "border-black/[0.05] text-[#007aff] dark:border-white/[0.06] dark:text-[#5ac8fa]"}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir no mapa
          </a>
        ) : null}
      </div>
    );
  }

  if (kind === "poll") {
    const poll = metadata.poll;
    const options = Array.isArray(poll?.options) ? poll!.options.slice(0, 20) : [];
    return (
      <div className={shellClass(isMine)}>
        <div className="flex items-center gap-2 px-3 pt-3">
          <BarChart3 className="h-4 w-4 shrink-0" />
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-65">Enquete</div>
        </div>
        <div className="px-3 pb-2 pt-1 text-[14px] font-semibold leading-5">
          {poll?.question || text || "Enquete"}
        </div>
        <div className={`border-t ${isMine ? "border-white/10" : "border-black/[0.05] dark:border-white/[0.06]"}`}>
          {options.map((option, index) => (
            <div
              key={`${option.id ?? index}-${option.name || ""}`}
              className={`flex items-center gap-2.5 px-3 py-2 text-[13px] ${index ? (isMine ? "border-t border-white/[0.07]" : "border-t border-black/[0.04] dark:border-white/[0.05]") : ""}`}
            >
              <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${isMine ? "border-white/70" : "border-[#00a884]"}`} />
              <span className="min-w-0 break-words">{option.name || `Opção ${index + 1}`}</span>
            </div>
          ))}
        </div>
        {poll?.allowMultipleAnswers ? (
          <div className={`border-t px-3 py-1.5 text-[10px] ${isMine ? "border-white/10 text-white/60" : "border-black/[0.05] text-[#667781] dark:border-white/[0.06] dark:text-[#8696a0]"}`}>
            Permite múltiplas respostas
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === "link") {
    const preview = metadata.linkPreview;
    const href = safeExternalUrl(preview?.url) || safeExternalUrl(metadata.links?.[0]?.url);
    return (
      <div className={shellClass(isMine)}>
        <div className="flex gap-2.5 px-3 py-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isMine ? "bg-white/15" : "bg-[#e9edef] dark:bg-white/10"}`}>
            <Link2 className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{preview?.title || "Link"}</div>
            {preview?.description ? (
              <div className={`mt-0.5 line-clamp-2 text-[11px] leading-4 ${isMine ? "text-white/70" : "text-[#667781] dark:text-[#8696a0]"}`}>
                {preview.description}
              </div>
            ) : null}
          </div>
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`flex h-9 items-center justify-center gap-1.5 border-t text-[12px] font-semibold ${isMine ? "border-white/10 text-white/90" : "border-black/[0.05] text-[#007aff] dark:border-white/[0.06] dark:text-[#5ac8fa]"}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir link
          </a>
        ) : null}
        {text && text !== preview?.url ? (
          <div className={`border-t px-3 py-2 text-[12px] break-words ${isMine ? "border-white/10" : "border-black/[0.05] dark:border-white/[0.06]"}`}>
            {text}
          </div>
        ) : null}
      </div>
    );
  }

  const genericMap: Record<string, { label: string; detail?: string; icon: React.ReactNode }> = {
    album: {
      label: "Álbum recebido",
      detail: metadata.album?.expectedItems ? `${metadata.album.expectedItems} itens` : undefined,
      icon: <Images className="h-5 w-5" />,
    },
    call: {
      label: "Chamada",
      detail: metadata.call?.summary || undefined,
      icon: <Phone className="h-5 w-5" />,
    },
    group_invite: {
      label: metadata.groupInvite?.groupName || "Convite de grupo",
      detail: "Convite para grupo",
      icon: <Users className="h-5 w-5" />,
    },
    interactive: {
      label: "Mensagem interativa",
      detail: metadata.interactive?.selectedButtonId || metadata.interactive?.selectedRowId || undefined,
      icon: <Link2 className="h-5 w-5" />,
    },
    order: { label: "Pedido recebido", icon: <Images className="h-5 w-5" /> },
    product: { label: "Produto recebido", icon: <Images className="h-5 w-5" /> },
    payment: { label: "Informação de pagamento", icon: <Images className="h-5 w-5" /> },
    revoked: { label: "Mensagem apagada", icon: <Link2 className="h-5 w-5" /> },
    unsupported: {
      label: "Mensagem do WhatsApp",
      detail: metadata.providerType ? `Tipo: ${metadata.providerType}` : "Tipo ainda não suportado",
      icon: <Link2 className="h-5 w-5" />,
    },
  };
  const generic = genericMap[kind];
  if (!generic) return null;

  return (
    <div className={shellClass(isMine)}>
      <div className="flex items-center gap-3 px-3 py-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isMine ? "bg-white/15" : "bg-[#e9edef] dark:bg-white/10"}`}>
          {generic.icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{generic.label}</div>
          {generic.detail ? (
            <div className={`mt-0.5 truncate text-[11px] ${isMine ? "text-white/65" : "text-[#667781] dark:text-[#8696a0]"}`}>
              {generic.detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WhatsAppForwardedLabel({
  metadata,
  isMine,
}: {
  metadata?: WhatsApp2MessageMetadata;
  isMine: boolean;
}) {
  const label = metadata ? forwardedLabel(metadata) : null;
  if (!label) return null;
  return (
    <div className={`mb-1 flex items-center gap-1 text-[10px] italic ${isMine ? "text-white/65" : "text-[#667781] dark:text-[#8696a0]"}`}>
      ↪ <span>{label}</span>
    </div>
  );
}
