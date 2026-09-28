import { useEffect, useMemo, useState } from "react";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";

export type BrainInboxOverviewItem = {
  status: "idle" | "waiting_delay" | "processing" | "sending" | "waiting_human" | "failed" | "uncertain";
  label: string;
  detail: string;
  active: boolean;
  turnId?: string | null;
  updatedAt?: string | null;
  scheduledResponseAt?: string | null;
  isEnabled: boolean;
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
    const load = async () => {
      let nextDelay = 10_000;
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
          nextDelay = 15_000;
          return;
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success !== true) return;
        const nextOverview = (result.overview || {}) as BrainInboxOverviewMap;
        if (!cancelled) {
          setOverview(nextOverview);
          setAvailable(true);
        }
        nextDelay = Object.values(nextOverview).some((item) => item.active) ? 2_500 : 7_000;
      } catch {
        nextDelay = 10_000;
      } finally {
        if (!cancelled) timer = window.setTimeout(() => { void load(); }, nextDelay);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [idsKey]);

  return { overview, available };
}
