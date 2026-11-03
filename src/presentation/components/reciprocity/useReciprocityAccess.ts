"use client";
import { useSyncExternalStore } from "react";
import { readReciprocityAccess, RECIPROCITY_ACCESS_EVENT } from "./reciprocity-client";
const subscribe = (onChange: () => void) => {
  window.addEventListener(RECIPROCITY_ACCESS_EVENT, onChange);
  return () => window.removeEventListener(RECIPROCITY_ACCESS_EVENT, onChange);
};
export function useReciprocityAccess() { return useSyncExternalStore(subscribe, readReciprocityAccess, () => ""); }
