"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Bolt,
  Flame,
  Heart,
  Info,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  disconnectTinder,
  getTinderAccountState,
  getTinderLikesYou,
  getTinderMatches,
  getTinderRecommendations,
  getTinderStatus,
  swipeTinder,
  TinderAccountState,
  TinderLikesYouResult,
  TinderMatchItem,
  TinderPublicProfile,
  TinderSwipeAction,
} from "./tinder-client";
import { MatchChatModal } from "./MatchChatModal";
import { TinderConnectModal } from "./TinderConnectModal";

type TinderSection = "discover" | "likes" | "matches" | "profile";

function ActionButton({
  label,
  onClick,
  className,
  children,
  size = "md",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border bg-white shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-[#161618]",
        size === "sm" && "h-11 w-11",
        size === "md" && "h-14 w-14",
        size === "lg" && "h-[62px] w-[62px]",
        className,
      )}
    >
      {children}
    </button>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fd5068]/10 text-[#fd5068]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
      <p className="text-sm font-black text-zinc-900 dark:text-white">{label}</p>
      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
        Buscando dados em tempo real da conta Tinder conectada.
      </p>
    </div>
  );
}

function DisconnectedPanel({
  tokenExpired = false,
  error,
  onConnectClick,
}: {
  tokenExpired?: boolean;
  error?: string | null;
  onConnectClick: () => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div
        className={cn(
          "flex h-20 w-20 items-center justify-center rounded-full text-white shadow-xl",
          tokenExpired
            ? "bg-gradient-to-br from-amber-500 to-rose-600 shadow-rose-500/25"
            : "bg-gradient-to-br from-[#ff6036] via-[#fd5068] to-[#e8368f] shadow-[#fd5068]/30",
        )}
      >
        {tokenExpired ? (
          <AlertTriangle className="h-9 w-9 fill-current" />
        ) : (
          <Flame className="h-9 w-9 fill-current" />
        )}
      </div>

      <h2 className="mt-5 text-xl font-black tracking-tight text-zinc-950 dark:text-white">
        {tokenExpired ? "Sessão do Tinder Expirada" : "Conecte sua conta Tinder"}
      </h2>

      <p className="mt-2 text-xs leading-relaxed text-zinc-500 max-w-xs">
        {tokenExpired
          ? error ||
            "O Tinder renovou ou revogou o token de sessão web. Atualize seu token para continuar usando a área de Match."
          : "Conecte seu token de autenticação web do Tinder para ter acesso aos seus swipes, curtidas recebidas, matches e mensagens reais."}
      </p>

      <button
        type="button"
        onClick={onConnectClick}
        className="mt-5 flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#fd297b] to-[#ff5864] px-5 text-sm font-black text-white shadow-lg shadow-rose-500/20 active:scale-95 transition"
      >
        <Flame className="h-4 w-4 fill-current" />
        {tokenExpired ? "Atualizar Token Agora" : "Conectar Conta Tinder"}
      </button>

      <div className="mt-6 flex items-start gap-2 rounded-2xl bg-zinc-100 dark:bg-white/[0.04] p-3 text-left text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 max-w-xs">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <span>
          O token fica protegido no backend e a sessão do navegador é opaca e sincronizada entre seus dispositivos.
        </span>
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  onDecision,
  busy,
}: {
  profile: TinderPublicProfile;
  onDecision: (action: TinderSwipeAction) => void;
  busy: boolean;
}) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-12, 0, 12]);
  const likeOpacity = useTransform(x, [20, 110], [0, 1]);
  const nopeOpacity = useTransform(x, [-110, -20], [1, 0]);
  const photoUrl = profile.photos?.[photoIndex]?.url || profile.photos?.[0]?.url || "";

  useEffect(() => {
    setPhotoIndex(0);
  }, [profile.id]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    if (busy) return;
    if (info.offset.x > 105) onDecision("like");
    else if (info.offset.x < -105) onDecision("pass");
  };

  return (
    <motion.div
      key={profile.id}
      drag={busy ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.78}
      onDragEnd={handleDragEnd}
      style={{ x, rotate }}
      initial={{ scale: 0.985, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.97, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="absolute inset-0 overflow-hidden rounded-[26px] border border-black/5 bg-zinc-900 shadow-[0_20px_55px_rgba(0,0,0,0.22)] touch-pan-y select-none"
    >
      {photoUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center transition-[background-image] duration-300"
          style={{ backgroundImage: 'url("' + photoUrl + '")' }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-800 text-zinc-500">
          <UserRound className="h-20 w-20" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent via-45% to-black/85" />

      {profile.photos.length > 1 && (
        <div className="absolute left-3 right-3 top-3 flex gap-1 z-10">
          {profile.photos.map((photo, index) => (
            <span
              key={photo.id || index}
              className={cn(
                "h-1 flex-1 rounded-full shadow-sm",
                index === photoIndex ? "bg-white" : "bg-white/45",
              )}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        aria-label="Foto anterior"
        onClick={(event) => {
          event.stopPropagation();
          setPhotoIndex((current) => Math.max(0, current - 1));
        }}
        className="absolute bottom-0 left-0 top-8 w-1/2"
      />
      <button
        type="button"
        aria-label="Próxima foto"
        onClick={(event) => {
          event.stopPropagation();
          setPhotoIndex((current) => Math.min(profile.photos.length - 1, current + 1));
        }}
        className="absolute bottom-0 right-0 top-8 w-1/2"
      />

      <motion.div
        style={{ opacity: likeOpacity }}
        className="pointer-events-none absolute left-5 top-16 -rotate-12 rounded-lg border-[4px] border-[#21d07a] px-3 py-1 text-3xl font-black uppercase tracking-wider text-[#21d07a]"
      >
        Like
      </motion.div>
      <motion.div
        style={{ opacity: nopeOpacity }}
        className="pointer-events-none absolute right-5 top-16 rotate-12 rounded-lg border-[4px] border-[#ff4458] px-3 py-1 text-3xl font-black uppercase tracking-wider text-[#ff4458]"
      >
        Nope
      </motion.div>

      {busy && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <div className="flex items-center gap-2">
          <h2 className="text-[30px] font-black leading-none tracking-[-0.035em]">{profile.name}</h2>
          {profile.age ? <span className="text-[27px] font-medium leading-none">{profile.age}</span> : null}
          {profile.isVerified && <BadgeCheck className="h-5 w-5 fill-sky-500 text-white" />}
        </div>

        <div className="mt-2 space-y-1 text-[13px] font-medium text-white/95">
          {profile.job && <p>{profile.job}</p>}
          {profile.school && <p>{profile.school}</p>}
          {profile.distanceKm !== null && profile.distanceKm !== undefined ? (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />A {profile.distanceKm} km de distância
            </p>
          ) : profile.city ? (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {profile.city}
            </p>
          ) : null}
        </div>

        {profile.bio && (
          <p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-white/90">{profile.bio}</p>
        )}

        {profile.interests.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.interests.slice(0, 4).map((interest) => (
              <span
                key={interest}
                className="rounded-full border border-white/30 bg-black/20 px-2.5 py-1 text-[10px] font-bold backdrop-blur-sm"
              >
                {interest}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toast(profile.bio || "Sem biografia cadastrada", {
              description: profile.interests.join(" • ") || undefined,
            });
          }}
          className="absolute bottom-5 right-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-black/20 backdrop-blur active:scale-95"
          aria-label="Ver detalhes"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>
    </motion.div>
  );
}

function DiscoverView({
  profiles,
  loading,
  error,
  onReload,
}: {
  profiles: TinderPublicProfile[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [matchedProfile, setMatchedProfile] = useState<TinderPublicProfile | null>(null);

  useEffect(() => {
    setIndex(0);
  }, [profiles]);

  const profile = profiles[index] || null;

  const decide = async (action: TinderSwipeAction) => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const result = await swipeTinder(profile, action);
      if ((action === "like" || action === "superlike") && result.matched) {
        setMatchedProfile(profile);
      }
      setIndex((current) => current + 1);
    } catch (swipeError) {
      toast.error(swipeError instanceof Error ? swipeError.message : "Não foi possível registrar o swipe.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingPanel label="Buscando pessoas por perto..." />;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-black text-zinc-950 dark:text-white">Não foi possível carregar o Discovery</p>
        <p className="mt-2 max-w-xs text-xs leading-relaxed text-zinc-500">{error}</p>
        <button
          type="button"
          onClick={() => void onReload()}
          className="mt-4 flex min-h-11 items-center gap-2 rounded-full bg-[#fd5068] px-5 text-xs font-black text-white active:scale-95"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Flame className="h-10 w-10 text-[#fd5068]" />
        <h3 className="mt-3 text-base font-black text-zinc-950 dark:text-white">Não há novos perfis no momento</h3>
        <p className="mt-1 text-xs text-zinc-500 max-w-xs">
          O Tinder já exibiu todas as recomendações do raio atual. Atualize para buscar novos perfis.
        </p>
        <button
          type="button"
          onClick={() => void onReload()}
          className="mt-4 flex min-h-11 items-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-xs font-black text-zinc-800 dark:border-white/10 dark:bg-[#161618] dark:text-white active:scale-95 shadow-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar Discovery
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative mx-auto w-full max-w-[430px] flex-1 min-h-0 px-3 pt-2">
        <div className="relative h-full min-h-[430px] max-h-[690px]">
          <div className="absolute inset-2 translate-y-2 scale-[0.975] rounded-[26px] bg-zinc-200 dark:bg-zinc-800" />
          <AnimatePresence mode="popLayout">
            <ProfileCard key={profile.id} profile={profile} onDecision={decide} busy={busy} />
          </AnimatePresence>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[430px] shrink-0 items-center justify-center gap-3 px-4 pb-3 pt-3">
        <ActionButton
          label="Rewind"
          onClick={() => toast.info("Rewind é um recurso que reverte o último passe no Tinder.")}
          size="sm"
          disabled={busy}
          className="border-amber-300/60 text-amber-500"
        >
          <RotateCcw className="h-5 w-5" strokeWidth={2.5} />
        </ActionButton>

        <ActionButton
          label="Não curtir"
          onClick={() => void decide("pass")}
          size="lg"
          disabled={busy}
          className="border-[#ff4458]/50 text-[#ff4458]"
        >
          <X className="h-8 w-8" strokeWidth={2.6} />
        </ActionButton>

        <ActionButton
          label="Super Like"
          onClick={() => void decide("superlike")}
          size="md"
          disabled={busy}
          className="border-sky-400/50 text-sky-400"
        >
          <Star className="h-6 w-6 fill-current" />
        </ActionButton>

        <ActionButton
          label="Curtir"
          onClick={() => void decide("like")}
          size="lg"
          disabled={busy}
          className="border-[#21d07a]/50 text-[#21d07a]"
        >
          <Heart className="h-8 w-8 fill-current" />
        </ActionButton>

        <ActionButton
          label="Boost"
          onClick={() => toast.info("O Boost destaca seu perfil no topo da sua região.")}
          size="sm"
          disabled={busy}
          className="border-violet-400/50 text-violet-500"
        >
          <Bolt className="h-5 w-5 fill-current" />
        </ActionButton>
      </div>

      <AnimatePresence>
        {matchedProfile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.84, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm text-center text-white"
            >
              <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6036] via-[#fd5068] to-[#e8368f] shadow-[0_0_80px_rgba(253,80,104,0.45)]">
                <Heart className="h-14 w-14 fill-white" />
              </div>
              <h3 className="text-3xl font-black italic tracking-tight text-[#fd5068]">
                It&apos;s a Match!
              </h3>
              <p className="mt-2 text-sm text-white/80">
                Você e {matchedProfile.name} curtiram um ao outro.
              </p>
              <button
                type="button"
                onClick={() => setMatchedProfile(null)}
                className="mt-6 w-full rounded-full bg-gradient-to-r from-[#fd297b] to-[#ff5864] px-5 py-3.5 text-sm font-black shadow-lg active:scale-95"
              >
                Continuar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LikesView({
  likesData,
  loading,
  error,
  onReload,
}: {
  likesData: TinderLikesYouResult | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  if (loading) return <LoadingPanel label="Buscando curtidas recebidas..." />;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-black text-zinc-950 dark:text-white">Não foi possível carregar as curtidas</p>
        <p className="mt-2 max-w-xs text-xs text-zinc-500">{error}</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-4 flex min-h-11 items-center gap-2 rounded-full bg-[#fd5068] px-5 text-xs font-black text-white active:scale-95"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  const count = likesData?.count;
  const isLocked = likesData?.locked !== false;
  const profiles = likesData?.profiles || [];

  return (
    <div className="mx-auto h-full w-full max-w-lg overflow-y-auto px-4 pb-8 pt-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-black tracking-tight text-zinc-950 dark:text-white flex items-center gap-2">
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            Curtidas Recebidas
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Pessoas que já deram like no seu perfil
          </p>
        </div>

        <button
          type="button"
          onClick={onReload}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300 active:scale-95"
          aria-label="Atualizar curtidas"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Destaque com contagem real */}
      <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5 text-center mb-5">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/20 text-amber-500 mb-2">
          <Sparkles className="h-6 w-6" />
        </div>
        <h3 className="text-2xl font-black text-zinc-950 dark:text-white">
          {count !== null && count !== undefined ? `${count}${likesData?.isRange ? "+" : ""} Curtidas` : "Novas Curtidas"}
        </h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
          {isLocked
            ? "O Tinder mantém a identidade das fotos individuais bloqueada para contas sem assinatura Tinder Gold, mas confirma que você recebeu essas curtidas."
            : "Perfis que curtiram você e estão prontos para virar match instantâneo."}
        </p>
      </div>

      {/* Se não for bloqueado e tiver perfis */}
      {!isLocked && profiles.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {profiles.map((p) => {
            const photo = p.photos?.[0]?.url || "";
            return (
              <div
                key={p.id}
                className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-900 shadow-sm"
              >
                {photo ? (
                  <Image
                    src={photo}
                    alt={p.name}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-500">
                    <UserRound className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" />
                <div className="absolute bottom-2.5 left-2.5 right-2.5 text-white">
                  <p className="text-sm font-black truncate">{p.name}, {p.age}</p>
                  {p.city && <p className="text-[10px] text-zinc-300 truncate">{p.city}</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 p-6 text-center">
          <Lock className="h-7 w-7 text-zinc-400 mx-auto mb-2" />
          <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
            Likes You Privado
          </p>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">
            Assim que você der like nas pessoas correspondentes na aba Descobrir, o match acontece automaticamente!
          </p>
        </div>
      )}
    </div>
  );
}

function MatchesView({
  matches,
  loading,
  error,
  onReload,
  onSelectMatch,
}: {
  matches: TinderMatchItem[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onSelectMatch: (match: TinderMatchItem) => void;
}) {
  if (loading) return <LoadingPanel label="Carregando seus matches..." />;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-black text-zinc-950 dark:text-white">Não foi possível carregar os matches</p>
        <p className="mt-2 max-w-xs text-xs text-zinc-500">{error}</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-4 flex min-h-11 items-center gap-2 rounded-full bg-[#fd5068] px-5 text-xs font-black text-white active:scale-95"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full w-full max-w-lg overflow-y-auto px-4 pb-6 pt-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-black tracking-tight text-zinc-950 dark:text-white">Matches & Mensagens</h2>
          <p className="text-xs text-zinc-500">Toque em qualquer match para abrir a conversa real</p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300 active:scale-95"
          aria-label="Atualizar matches"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {matches.length === 0 ? (
        <div className="mt-16 text-center px-4">
          <MessageCircle className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-700" />
          <p className="mt-3 text-sm font-black text-zinc-900 dark:text-white">Nenhum match retornado</p>
          <p className="mt-1 text-xs text-zinc-500 max-w-xs mx-auto">
            Quando você curtir alguém que também curtiu seu perfil, o match aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-white/5 dark:border-white/10 dark:bg-[#111113]">
          {matches.map((match) => {
            const lastMessage = match.messages?.[match.messages.length - 1];
            const avatar = match.person.photos?.[0]?.url || "";
            return (
              <button
                key={match.id}
                type="button"
                onClick={() => onSelectMatch(match)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-zinc-50 dark:hover:bg-white/[0.04] transition active:scale-[0.99]"
              >
                <div
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                >
                  {avatar ? (
                    <Image
                      src={avatar}
                      alt={match.person.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-500">
                      <UserRound className="h-6 w-6" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-zinc-950 dark:text-white">
                    {match.person.name}
                    {match.person.age ? <span className="font-medium text-xs text-zinc-500">, {match.person.age}</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {lastMessage?.text || (match.isNewMatch ? "Novo match recente ✨" : "Sem mensagens ainda")}
                  </p>
                </div>

                {match.unreadCount > 0 && (
                  <span className="flex min-w-5 items-center justify-center rounded-full bg-[#fd5068] px-1.5 py-0.5 text-[9px] font-black text-white">
                    {match.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileView({
  profile,
  accountState,
  onDisconnect,
  onUpdateToken,
}: {
  profile: TinderPublicProfile | null;
  accountState: TinderAccountState | null;
  onDisconnect: () => void;
  onUpdateToken: () => void;
}) {
  if (!profile) return <LoadingPanel label="Carregando perfil do Tinder..." />;

  const avatar = profile.photos?.[0]?.url || "";
  const likesRemaining = accountState?.likes?.remaining_likes ?? accountState?.likes?.likes_remaining;

  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col items-center overflow-y-auto px-5 pb-8 pt-6">
      {/* Avatar e Badges */}
      <div className="relative h-28 w-28 overflow-hidden rounded-full bg-zinc-200 shadow-md dark:bg-zinc-800 border-2 border-[#fd5068]">
        {avatar ? (
          <Image
            src={avatar}
            alt={profile.name}
            fill
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-500">
            <UserRound className="h-12 w-12" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <h2 className="text-xl font-black text-zinc-950 dark:text-white">
          {profile.name}
          {profile.age ? <span className="font-medium">, {profile.age}</span> : null}
        </h2>
        {profile.isVerified && <BadgeCheck className="h-5 w-5 fill-sky-500 text-white" />}
      </div>

      {profile.city && (
        <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
          <MapPin className="h-3.5 w-3.5" />
          {profile.city}
        </p>
      )}

      {/* Cards de Recursos / Status */}
      <div className="mt-5 grid grid-cols-3 gap-2.5 w-full">
        <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-white/10 dark:bg-[#111113] p-3 text-center">
          <Heart className="h-4 w-4 text-[#21d07a] mx-auto mb-1 fill-current" />
          <p className="text-[10px] text-zinc-500 font-bold">Likes</p>
          <p className="text-xs font-black text-zinc-950 dark:text-white">
            {likesRemaining !== undefined && likesRemaining !== null ? likesRemaining : "Ativo"}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-white/10 dark:bg-[#111113] p-3 text-center">
          <Star className="h-4 w-4 text-sky-400 mx-auto mb-1 fill-current" />
          <p className="text-[10px] text-zinc-500 font-bold">Super Likes</p>
          <p className="text-xs font-black text-zinc-950 dark:text-white">
            {accountState?.superLikes?.remaining ?? "Disponível"}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-white/10 dark:bg-[#111113] p-3 text-center">
          <Bolt className="h-4 w-4 text-violet-500 mx-auto mb-1 fill-current" />
          <p className="text-[10px] text-zinc-500 font-bold">Boost</p>
          <p className="text-xs font-black text-zinc-950 dark:text-white">
            {accountState?.boost?.remaining ? `${accountState.boost.remaining}` : "0"}
          </p>
        </div>
      </div>

      {profile.bio && (
        <div className="mt-4 w-full rounded-2xl border border-zinc-200 bg-white p-3.5 text-xs leading-relaxed text-zinc-600 dark:border-white/10 dark:bg-[#111113] dark:text-zinc-300">
          <p className="text-[10px] font-black uppercase text-zinc-400 mb-1">Bio no Tinder</p>
          <p>{profile.bio}</p>
        </div>
      )}

      {profile.interests.length > 0 && (
        <div className="mt-3 flex w-full flex-wrap gap-1.5">
          {profile.interests.map((interest) => (
            <span
              key={interest}
              className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-700 dark:border-white/10 dark:bg-[#111113] dark:text-zinc-200"
            >
              {interest}
            </span>
          ))}
        </div>
      )}

      {/* Ações da Conta */}
      <div className="mt-6 w-full space-y-2">
        <button
          type="button"
          onClick={onUpdateToken}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-xs font-bold text-zinc-800 dark:border-white/10 dark:bg-[#161618] dark:text-white shadow-sm active:scale-95"
        >
          <Settings2 className="h-4 w-4 text-[#fd5068]" />
          Atualizar Token de Acesso
        </button>

        <button
          type="button"
          onClick={onDisconnect}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50/60 px-4 text-xs font-bold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 active:scale-95"
        >
          <LogOut className="h-4 w-4" />
          Desconectar Tinder
        </button>
      </div>
    </div>
  );
}

export function MatchView() {
  const [section, setSection] = useState<TinderSection>("discover");
  const [statusLoading, setStatusLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [profile, setProfile] = useState<TinderPublicProfile | null>(null);
  const [accountState, setAccountState] = useState<TinderAccountState | null>(null);

  const [recommendations, setRecommendations] = useState<TinderPublicProfile[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  const [matches, setMatches] = useState<TinderMatchItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const [likesData, setLikesData] = useState<TinderLikesYouResult | null>(null);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likesError, setLikesError] = useState<string | null>(null);

  const [selectedMatch, setSelectedMatch] = useState<TinderMatchItem | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const status = await getTinderStatus();
      setConnected(Boolean(status.connected));
      setTokenExpired(Boolean(status.tokenExpired));
      if (status.error) setStatusError(status.error);
      setProfile(status.profile || null);
      return status;
    } catch (err) {
      setConnected(false);
      setProfile(null);
      const msg = err instanceof Error ? err.message : "Erro ao verificar conexão.";
      setStatusError(msg);
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    setRecommendationsLoading(true);
    setRecommendationsError(null);
    try {
      const recs = await getTinderRecommendations();
      setRecommendations(recs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar o Discovery.";
      setRecommendationsError(message);
    } finally {
      setRecommendationsLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesError(null);
    try {
      const list = await getTinderMatches();
      setMatches(list);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar os matches.";
      setMatchesError(message);
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  const loadLikes = useCallback(async () => {
    setLikesLoading(true);
    setLikesError(null);
    try {
      const data = await getTinderLikesYou();
      setLikesData(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar curtidas.";
      setLikesError(message);
    } finally {
      setLikesLoading(false);
    }
  }, []);

  const loadAccount = useCallback(async () => {
    try {
      const state = await getTinderAccountState();
      setAccountState(state);
    } catch {
      // Ignora erro silencioso de perfil
    }
  }, []);

  useEffect(() => {
    void refreshStatus().then((status) => {
      if (status?.connected) {
        void loadRecommendations();
        void loadMatches();
      }
    });
  }, [refreshStatus, loadRecommendations, loadMatches]);

  useEffect(() => {
    if (!connected) return;

    if (section === "matches" && matches.length === 0 && !matchesLoading) {
      void loadMatches();
    } else if (section === "likes" && !likesData && !likesLoading) {
      void loadLikes();
    } else if (section === "profile" && !accountState) {
      void loadAccount();
    }
  }, [connected, section, matches.length, matchesLoading, likesData, likesLoading, accountState, loadMatches, loadLikes, loadAccount]);

  const handleDisconnect = async () => {
    try {
      await disconnectTinder();
      setConnected(false);
      setProfile(null);
      setTokenExpired(false);
      setMatches([]);
      setRecommendations([]);
      toast.success("Tinder desconectado.");
    } catch {
      toast.error("Erro ao desconectar.");
    }
  };

  const handleConnectedSuccess = (newProfile: TinderPublicProfile) => {
    setConnected(true);
    setTokenExpired(false);
    setProfile(newProfile);
    void loadRecommendations();
    void loadMatches();
  };

  const sections: Array<{ id: TinderSection; label: string; icon: React.ElementType }> = useMemo(
    () => [
      { id: "discover", label: "Descobrir", icon: Flame },
      { id: "likes", label: "Curtidas", icon: Star },
      { id: "matches", label: "Matches", icon: MessageCircle },
      { id: "profile", label: "Perfil", icon: UserRound },
    ],
    [],
  );

  let sectionContent: React.ReactNode;
  if (statusLoading) {
    sectionContent = <LoadingPanel label="Verificando sua conta Tinder..." />;
  } else if (!connected) {
    sectionContent = (
      <DisconnectedPanel
        tokenExpired={tokenExpired}
        error={statusError}
        onConnectClick={() => setIsConnectModalOpen(true)}
      />
    );
  } else if (section === "discover") {
    sectionContent = (
      <DiscoverView
        profiles={recommendations}
        loading={recommendationsLoading}
        error={recommendationsError}
        onReload={loadRecommendations}
      />
    );
  } else if (section === "likes") {
    sectionContent = (
      <LikesView
        likesData={likesData}
        loading={likesLoading}
        error={likesError}
        onReload={loadLikes}
      />
    );
  } else if (section === "matches") {
    sectionContent = (
      <MatchesView
        matches={matches}
        loading={matchesLoading}
        error={matchesError}
        onReload={loadMatches}
        onSelectMatch={(m) => setSelectedMatch(m)}
      />
    );
  } else {
    sectionContent = (
      <ProfileView
        profile={profile}
        accountState={accountState}
        onDisconnect={handleDisconnect}
        onUpdateToken={() => setIsConnectModalOpen(true)}
      />
    );
  }

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f7f7f8] dark:bg-black">
      {/* Header com Abas */}
      <header className="shrink-0 border-b border-zinc-200/80 bg-white/95 px-3 pt-[calc(0.35rem+env(safe-area-inset-top,0px))] backdrop-blur-xl dark:border-white/10 dark:bg-black/95">
        <nav className="mx-auto grid w-full max-w-lg grid-cols-4 gap-1 pb-2">
          {sections.map(({ id, label, icon: Icon }) => {
            const active = id === section;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "relative flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-[10px] font-bold transition active:scale-95",
                  active
                    ? "bg-[#fd5068]/10 text-[#fd5068]"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5",
                )}
              >
                <Icon className={cn("h-4 w-4", active && id === "discover" && "fill-current")} />
                <span className="hidden sm:inline">{label}</span>
                {id === "matches" && matches.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fd5068] px-1 text-[9px] font-black text-white">
                    {matches.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Conteúdo Principal */}
      <div className="relative flex-1 min-h-0 overflow-hidden">{sectionContent}</div>

      {/* Modal de Chat de Match */}
      {selectedMatch && (
        <MatchChatModal
          match={selectedMatch}
          onClose={() => setSelectedMatch(null)}
        />
      )}

      {/* Modal de Conexão Rápida */}
      <TinderConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onSuccess={handleConnectedSuccess}
      />
    </section>
  );
}
