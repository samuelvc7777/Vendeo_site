"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getWhatsApp2ProfilePhoto,
  refreshWhatsApp2ProfilePhoto,
} from "./whatsapp2-client";

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

function lookupPhoto(wid: string): Promise<string | null> {
  const stored = photos.get(wid);
  if (stored && stored.expiresAt > Date.now()) return Promise.resolve(stored.url);
  const pending = inflight.get(wid);
  if (pending) return pending;
  const result = queued(async () => {
    try {
      const response = await getWhatsApp2ProfilePhoto(wid);
      const url = safePhotoUrl(response.avatarUrl);
      remember(wid, url);
      return url;
    } catch {
      remember(wid, null);
      return null;
    }
  }).finally(() => inflight.delete(wid));
  inflight.set(wid, result);
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
  const container = useRef<HTMLSpanElement>(null);
  const retried = useRef(false);
  const [url, setUrl] = useState<string | null>(() =>
    wid ? (photos.get(wid)?.url || null) : null,
  );

  useEffect(() => {
    if (!wid || !/^\d+@(c\.us|lid)$/.test(wid)) return;
    let cancelled = false;
    const load = () => {
      void lookupPhoto(wid).then((photo) => {
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
  }, [wid, eager]);

  const onPhotoError = () => {
    if (!wid || !url) return;
    const rejected = url;
    setUrl(null);
    remember(wid, null);
    if (retried.current) return;
    retried.current = true;
    void refreshWhatsApp2ProfilePhoto(wid, rejected)
      .then((response) => {
        const fresh = safePhotoUrl(response.avatarUrl);
        if (fresh && fresh !== rejected) {
          remember(wid, fresh);
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
