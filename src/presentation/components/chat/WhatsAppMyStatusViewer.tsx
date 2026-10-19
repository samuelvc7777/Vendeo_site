"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Loader2, MoreVertical, Pause, Play, Plus, RefreshCw, UserRound,
  Volume2, VolumeX, X,
} from "lucide-react";
import {
  getWhatsApp2ActiveStatuses, getWhatsApp2MediaUrl, getWhatsApp2Status, getWhatsApp2StatusViews,
  type WhatsApp2ActiveStatus, type WhatsApp2StatusViews,
} from "./whatsapp2-client";
import styles from "./WhatsAppMyStatusViewer.module.css";
import { WhatsAppStatusAvatar } from "./WhatsAppStatusAvatar";

type Props = { open: boolean; onClose: () => void; onPublish: () => void };

function clockLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário indisponível";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Status";
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (itemDay === day) return "Hoje, " + clockLabel(value);
  if (itemDay === day - 86400000) return "Ontem, " + clockLabel(value);
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const PHOTO_DURATION_MS = 6500;

export function WhatsAppMyStatusViewer({ open, onClose, onPublish }: Props) {
  const [items, setItems] = useState<WhatsApp2ActiveStatus[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<WhatsApp2StatusViews | null>(null);
  const [loadingViews, setLoadingViews] = useState(false);
  const [viewsRevision, setViewsRevision] = useState(0);
  const [myWhatsAppWid, setMyWhatsAppWid] = useState<string | null>(null);
  const [mediaFailedId, setMediaFailedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartY = useRef<number | null>(null);
  const lastTick = useRef<number | null>(null);
  const imageProgress = useRef(0);

  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const selected = items[selectedIndex];
  const canAdvance = selectedIndex < items.length - 1;
  const paused = !playing || sheetOpen || menuOpen;

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await getWhatsApp2ActiveStatuses();
      const next = response.items || [];
      setItems((previous) => {
        const same = previous.length === next.length && previous.every((item, i) => item.id === next[i].id);
        return same ? previous : next;
      });
      setSelectedId((current) => next.some((item) => item.id === current) ? current : (next[0]?.id || ""));
      if (!quiet) setViewsRevision((value) => value + 1);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus status.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { cancelled = true; document.body.style.overflow = oldOverflow; };
  }, [open, refresh]);

  // WhatsApp Web can receive a status from the phone after a short sync delay.
  // Refresh quietly while the viewer is open, without restarting playback.
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getWhatsApp2Status()
      .then((status) => { if (!cancelled) setMyWhatsAppWid(status.me?.wid || null); })
      .catch(() => { if (!cancelled) setMyWhatsAppWid(null); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !selected?.id) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setViews(null);
      setLoadingViews(true);
      void getWhatsApp2StatusViews(selected.id)
        .then((result) => { if (!cancelled) setViews(result); })
        .catch(() => {
          if (!cancelled) setViews({
            ok: true, available: false, count: null, viewers: [],
            reason: "Não foi possível carregar as visualizações.",
          });
        })
        .finally(() => { if (!cancelled) setLoadingViews(false); });
    });
    return () => { cancelled = true; };
  }, [open, selected?.id, viewsRevision]);

  useEffect(() => {
    imageProgress.current = 0;
    lastTick.current = null;
    void Promise.resolve().then(() => {
      setProgress(0);
      setPlaying(true);
      setMenuOpen(false);
      setSheetOpen(false);
      setMediaFailedId(null);
    });
  }, [selected?.id]);

  const selectAt = useCallback((index: number) => {
    if (index < 0 || index >= items.length || items[index].id === selectedId) return;
    imageProgress.current = 0;
    setProgress(0);
    setPlaying(true);
    setSelectedId(items[index].id);
  }, [items, selectedId]);

  const next = useCallback(() => {
    if (canAdvance) selectAt(selectedIndex + 1);
    else { setProgress(1); setPlaying(false); }
  }, [canAdvance, selectAt, selectedIndex]);

  useEffect(() => {
    if (!open || !selected || selected.type === "video" || paused || mediaFailedId === selected.id) {
      lastTick.current = null;
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      const previous = lastTick.current;
      lastTick.current = now;
      if (previous !== null) {
        const value = Math.min(1, imageProgress.current + (now - previous) / PHOTO_DURATION_MS);
        imageProgress.current = value;
        setProgress(value);
        if (value >= 1) { next(); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); lastTick.current = null; };
  }, [open, selected, paused, mediaFailedId, next]);

  useEffect(() => {
    if (!open || selected?.type !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => { setPlaying(false); });
  }, [open, selected?.id, selected?.type, paused]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (sheetOpen) setSheetOpen(false);
        else if (menuOpen) setMenuOpen(false);
        else onClose();
      } else if (!sheetOpen && !menuOpen && event.key === "ArrowRight") selectAt(selectedIndex + 1);
      else if (!sheetOpen && !menuOpen && event.key === "ArrowLeft") selectAt(selectedIndex - 1);
      else if (!sheetOpen && !menuOpen && event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, sheetOpen, menuOpen, selectedIndex, selectAt, onClose]);

  if (!open) return null;

  const onTouchEnd = (event: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const distance = touchStartY.current - event.changedTouches[0].clientY;
    touchStartY.current = null;
    if (distance > 45) setSheetOpen(true);
    if (distance < -45 && sheetOpen) setSheetOpen(false);
  };

  return createPortal(
    <div className={styles.root} role="dialog" aria-modal="true" aria-label="Meu status do WhatsApp">
      {loading && items.length === 0 ? (
        <div className={styles.centerState}><Loader2 className={styles.spin} size={25} /> Carregando status...</div>
      ) : items.length === 0 ? (
        <div className={styles.centerState}>
          <button type="button" className={styles.emptyClose} onClick={onClose} aria-label="Fechar"><X size={24} /></button>
          <div className={styles.emptyIcon}><Plus size={36} /></div>
          <strong>Nenhum status ativo</strong>
          <span>Os status publicados nas últimas 24 horas aparecem aqui.</span>
          {error && <span role="alert">{error}</span>}
          <button type="button" className={styles.emptyPublish} onClick={onPublish}>Publicar status</button>
          <button type="button" className={styles.retry} onClick={() => void refresh()}>Tentar novamente</button>
        </div>
      ) : (
        <div className={styles.viewer} onTouchStart={(event) => { touchStartY.current = event.touches[0].clientY; }} onTouchEnd={onTouchEnd}>
          <section className={styles.stage} aria-label="Publicação atual">
            {selected.type === "text" ? (
              <div className={styles.textMedia}><p>{selected.text || "Status de texto"}</p></div>
            ) : selected.type === "image" && mediaFailedId !== selected.id ? (
              <img key={selected.id} src={getWhatsApp2MediaUrl(selected.id)}
                alt={selected.caption || "Foto do meu status"} className={styles.media}
                onError={() => setMediaFailedId(selected.id)} />
            ) : selected.type === "video" && mediaFailedId !== selected.id ? (
              <video key={selected.id} ref={videoRef} src={getWhatsApp2MediaUrl(selected.id)}
                className={styles.media} playsInline preload="metadata" muted={muted}
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  if (Number.isFinite(video.duration) && video.duration > 0) setProgress(Math.min(1, video.currentTime / video.duration));
                }}
                onEnded={next}
                onError={() => setMediaFailedId(selected.id)} />
            ) : (
              <div className={styles.mediaFallback}><ImageIcon size={26} /> Prévia indisponível
                <button type="button" onClick={() => { setMediaFailedId(null); setProgress(0); }}>Tentar novamente</button>
              </div>
            )}

            <div className={styles.topShade} aria-hidden="true" />
            <div className={styles.bottomShade} aria-hidden="true" />

            <div className={styles.topControls}>
              <nav className={styles.segments} aria-label="Publicações do status">
                {items.map((item, index) => (
                  <button key={item.id} type="button" className={styles.segment}
                    aria-label={`Visualizar status ${index + 1} de ${items.length}`}
                    aria-current={index === selectedIndex ? "step" : undefined}
                    onClick={() => selectAt(index)}>
                    <span style={{ width: index < selectedIndex ? "100%" : index > selectedIndex ? "0%" : `${progress * 100}%` }} />
                  </button>
                ))}
              </nav>
              <div className={styles.identity}>
                <button className={styles.roundButton} type="button" onClick={onClose} aria-label="Fechar status"><X size={24} /></button>
                <WhatsAppStatusAvatar wid={myWhatsAppWid} className={styles.avatar} label="Foto do perfil da Larissa" fallback={<UserRound size={22} />} eager />
                <div className={styles.identityText}><strong>Meu status</strong><span>{relativeDate(selected.createdAt)}</span></div>
                <button type="button" className={styles.roundButton} onClick={() => setPlaying((value) => !value)}
                  aria-label={paused ? "Reproduzir status" : "Pausar status"}>{paused ? <Play size={21} /> : <Pause size={21} />}</button>
                {selected.type === "video" && (
                  <button type="button" className={styles.roundButton} onClick={() => setMuted((value) => !value)}
                    aria-label={muted ? "Ativar som" : "Silenciar vídeo"}>{muted ? <VolumeX size={21} /> : <Volume2 size={21} />}</button>
                )}
                <div className={styles.menuWrap}>
                  <button type="button" className={styles.roundButton} onClick={() => setMenuOpen((value) => !value)}
                    aria-label="Opções do status" aria-expanded={menuOpen}><MoreVertical size={22} /></button>
                  {menuOpen && (
                    <div className={styles.menu} role="menu">
                      <button type="button" role="menuitem" onClick={onPublish}><Plus size={16} /> Publicar novo status</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void refresh(); }}><RefreshCw size={16} /> Atualizar</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!sheetOpen && !menuOpen && items.length > 1 && (
              <div className={styles.tapZones}>
                <button type="button" aria-label="Status anterior" onClick={() => selectAt(selectedIndex - 1)} disabled={selectedIndex === 0} />
                <button type="button" aria-label="Próximo status" onClick={next} />
              </div>
            )}
            {selected.caption && <p className={styles.caption}>{selected.caption}</p>}
            <button type="button" className={styles.viewsTrigger} onClick={() => setSheetOpen(true)}
              aria-label="Abrir visualizações do status">
              <ChevronUp size={21} />
              <span><Eye size={18} /> {loadingViews ? "..." : views?.available && views.count !== null ? views.count : "—"}</span>
            </button>
            {error && <div className={styles.toastError} role="alert">{error}</div>}
          </section>

          {sheetOpen && (
            <>
              <button type="button" className={styles.sheetScrim} onClick={() => setSheetOpen(false)} aria-label="Fechar visualizações" />
              <section className={styles.sheet} aria-label="Quem viu meu status">
                <button type="button" className={styles.sheetHandle} onClick={() => setSheetOpen(false)} aria-label="Fechar lista de visualizações"><span /></button>
                <div className={styles.sheetHeader}>
                  <div><Eye size={20} className={styles.eye} />
                    <strong>{loadingViews ? "Carregando visualizações..." : views?.available && views.count !== null ? `${views.count} ${views.count === 1 ? "visualização" : "visualizações"}` : "Visualizações"}</strong>
                  </div>
                  <button type="button" onClick={() => { setSheetOpen(false); setPlaying(true); }} aria-label="Recolher visualizações"><ChevronDown size={24} /></button>
                </div>
                <div className={styles.sheetBody}>
                  {loadingViews ? (
                    <div className={styles.sheetState}><Loader2 className={styles.spin} size={21} /> Consultando visualizações...</div>
                  ) : !views?.available ? (
                    <div className={styles.sheetState}>
                      <Eye size={28} />
                      <strong>Visualizações indisponíveis</strong>
                      <span>Não foi possível consultar quem viu este status. Pessoas com confirmação de leitura desativada podem não aparecer.</span>
                      <button type="button" onClick={() => setViewsRevision((value) => value + 1)}><RefreshCw size={16} /> Tentar novamente</button>
                    </div>
                  ) : views.viewers.length === 0 ? (
                    <div className={styles.sheetState}><Eye size={28} /><strong>Nenhuma visualização confirmada</strong><span>As visualizações aparecerão aqui quando estiverem disponíveis.</span></div>
                  ) : (
                    <ul className={styles.viewers}>
                      {views.viewers.map((person) => (
                        <li key={person.id}>
                          <WhatsAppStatusAvatar key={person.id} wid={person.id} className={styles.viewerAvatar} label={`Foto de ${person.name || "contato"}`} fallback={person.name?.charAt(0).toLocaleUpperCase("pt-BR") || <UserRound size={18} />} />
                          <span className={styles.viewerName}>{person.name || "Contato"}</span>
                          <span className={styles.viewerTime}>{clockLabel(person.viewedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>, document.body,
  );
}
