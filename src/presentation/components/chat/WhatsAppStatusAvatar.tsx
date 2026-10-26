"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWhatsApp2Client } from "./WhatsAppAccountContext";
import type { WhatsApp2Client } from "./whatsapp2-client";

type CachedPhoto = { url: string | null; expiresAt: number };
const photos = new Map<string, CachedPhoto>();
const inflight = new Map<string, Promise<string | null>>();
const photoQueue: Array<() => void> = [];
const MAX_CONCURRENT_LOOKUPS = 4;
const POSITIVE_TTL = 10 * 60_000;
const NEGATIVE_TTL = 2 * 60_000;
let activeLookups = 0;

function safePhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "pps.whatsapp.net" || parsed.hostname.endsWith(".whatsapp.net"))
      ? parsed.href : null;
  } catch {
    return null;
  }
}

function remember(wid: string, url: string | null) {
  photos.set(wid, {
    url,
    expiresAt: Date.now() + (url ? POSITIVE_TTL : NEGATIVE_TTL),
  });
  if (photos.size > 500) photos.delete(photos.keys().next().value!);
}

function pump() {
  while (activeLookups < MAX_CONCURRENT_LOOKUPS && photoQueue.length) {
    const next = photoQueue.shift();
    if (!next) break;
    activeLookups++;
    next();
  }
}

function queued<T>(action: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    photoQueue.push(() => {
      void action().then(resolve, reject).finally(() => {
        activeLookups--;
        pump();
      });
    });
    pump();
  });
}

function lookupPhoto(wid: string, client: WhatsApp2Client): Promise<string | null> {
  const key = `${client.connectionId || "legacy"}:${wid}`;
  const stored = photos.get(key);
  if (stored && stored.expiresAt > Date.now()) return Promise.resolve(stored.url);
  const pending = inflight.get(key);
  if (pending) return pending;
  const result = queued(async () => {
    try {
      const response = await client.getWhatsApp2ProfilePhoto(wid);
      const url = safePhotoUrl(response.avatarUrl);
      remember(key, url);
      return url;
    } catch {
      remember(key, null);
      return null;
    }
  }).finally(() => inflight.delete(key));
  inflight.set(key, result);
  return result;
}

export function WhatsAppStatusAvatar({
  wid, className, fallback, label, eager = false,
}: {
  wid: string | null | undefined;
  className: string;
  fallback: ReactNode;
  label: string;
  eager?: boolean;
}) {
  const client = useWhatsApp2Client();
  const photoKey = `${client.connectionId || "legacy"}:${wid}`;
  const container = useRef<HTMLSpanElement>(null);
  const retried = useRef(false);
  const [url, setUrl] = useState<string | null>(() =>
    wid ? (photos.get(photoKey)?.url || null) : null,
  );

  useEffect(() => {
    if (!wid || !/^\d+@(c\.us|lid)$/.test(wid)) return;
    let cancelled = false;
    const load = () => {
      void lookupPhoto(wid, client).then((photo) => {
        if (!cancelled) setUrl(photo);
      });
    };
    const element = container.current;
    if (eager || !element || typeof IntersectionObserver === "undefined") {
      load();
    } else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      }, { rootMargin: "180px" });
      observer.observe(element);
      return () => { cancelled = true; observer.disconnect(); };
    }
    return () => { cancelled = true; };
  }, [wid, eager, client]);

  const onPhotoError = () => {
    if (!wid || !url) return;
    const rejected = url;
    setUrl(null);
    remember(photoKey, null);
    if (retried.current) return;
    retried.current = true;
    void client.refreshWhatsApp2ProfilePhoto(wid, rejected)
      .then((response) => {
        const fresh = safePhotoUrl(response.avatarUrl);
        if (fresh && fresh !== rejected) {
          remember(photoKey, fresh);
          setUrl(fresh);
        }
      })
      .catch(() => {});
  };

  return (
    <span className={className} ref={container} aria-label={label}>
      {url ? (
        // URLs temporárias do CDN do WhatsApp precisam de fallback se expirarem.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading={eager ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
          onError={onPhotoError}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
        />
      ) : fallback}
    </span>
  );
}
