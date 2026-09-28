import { useEffect, useMemo, useState } from "react";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";

export type BrainInboxOverviewItem = {
  status:
    | "idle"
    | "waiting_delay"
    | "processing"
    | "sending"
    | "waiting_human"
    | "failed"
    | "uncertain"
    | "completed"
    | "disabled";
  label: string;
  detail: string;
  active: boolean;
  turnId?: string | null;
  updatedAt?: string | null;
  scheduledResponseAt?: string | null;
  isEnabled: boolean;
  objectiveId?: string | null;
  objectiveLabel?: string | null;
  sentCount?: number;
  totalCount?: number;
  actionTypes?: string[];
};

type BrainInboxOverviewMap = Record<string, BrainInboxOverviewItem>;

export function useBrainInboxOverview(conversationIds: string[]) {
  const idsKey = useMemo(
    () => [...new Set(conversationIds.filter(Boolean))].sort().join("|"),
    [conversationIds],
  );
  const [overview, setOverview] = useState<BrainInboxOverviewMap>({});
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    if (ids.length === 0) {
      setOverview({});
      setAvailable(false);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;

    const scheduleNext = (delay: number) => {
      if (cancelled) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, delay);
    };

    const load = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      let nextDelay = 3_000;
      try {
        const response = await brainOperatorFetch("/operator/brain/overview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationIds: ids }),
        });
        if (response.status === 401) {
          if (!cancelled) {
            setAvailable(false);
            setOverview({});
          }
          nextDelay = 10_000;
          return;
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success !== true) return;
        const nextOverview = (result.overview || {}) as BrainInboxOverviewMap;
        if (!cancelled) {
          setOverview(nextOverview);
          setAvailable(true);
        }
        nextDelay = Object.values(nextOverview).some((item) => item.active) ? 1_000 : 3_000;
      } catch {
        nextDelay = 5_000;
      } finally {
        inFlight = false;
        scheduleNext(nextDelay);
      }
    };

    const refreshNow = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) window.clearTimeout(timer);
      void load();
    };

    void load();
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", refreshNow);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [idsKey]);

  return { overview, available };
}
