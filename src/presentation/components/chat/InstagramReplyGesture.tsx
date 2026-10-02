"use client";

import React, { useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion";
import { Reply } from "lucide-react";

interface InstagramReplyGestureProps {
  enabled: boolean;
  isMine: boolean;
  onReply: () => void;
  onLongPress?: () => void;
  variant?: "instagram" | "whatsapp";
  children: React.ReactNode;
}

const REPLY_TRIGGER_PX = 48;
const MAX_DRAG_PX = 72;

export function InstagramReplyGesture({
  enabled,
  isMine,
  onReply,
  onLongPress,
  variant = "instagram",
  children,
}: InstagramReplyGestureProps) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whatsapp = variant === "whatsapp";
  const direction = whatsapp ? 1 : isMine ? -1 : 1;
  const directionalDistance = useTransform(x, (value) =>
    Math.max(0, Math.min(MAX_DRAG_PX, value * direction))
  );
  const iconOpacity = useTransform(directionalDistance, [8, 30, REPLY_TRIGGER_PX], [0, 0.55, 1]);
  const iconScale = useTransform(directionalDistance, [0, 30, REPLY_TRIGGER_PX], [0.72, 0.9, 1]);
  const iconRotate = useTransform(
    directionalDistance,
    [0, REPLY_TRIGGER_PX],
    [whatsapp ? -10 : isMine ? 18 : -18, 0]
  );

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    if (!whatsapp || !onLongPress) return;
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      onLongPress();
    }, 390);
  };

  const resetPosition = () => {
    animate(x, 0, reduceMotion
      ? { duration: 0 }
      : {
          type: "spring",
          stiffness: 690,
          damping: 42,
          mass: 0.46,
        }
    );
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    clearLongPress();
    const distance = info.offset.x * direction;
    const velocity = info.velocity.x * direction;

    if (enabled && (distance >= REPLY_TRIGGER_PX || velocity >= 520)) {
      onReply();
    }
    resetPosition();
  };
  const dragConstraints = whatsapp
    ? { left: 0, right: MAX_DRAG_PX }
    : isMine
    ? { left: -MAX_DRAG_PX, right: 0 }
    : { left: 0, right: MAX_DRAG_PX };

  return (
    <div className={`relative min-w-0 ${
      whatsapp ? "max-w-[88%] sm:max-w-[78%]" : "max-w-[84%] sm:max-w-[75%]"
    }`}>
      {enabled && (
        <motion.div
          aria-hidden="true"
          style={{ opacity: iconOpacity, scale: iconScale, rotate: iconRotate }}
          className={`pointer-events-none absolute top-1/2 z-0 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center shadow-sm ${
            whatsapp
              ? "-left-10 bg-white/95 text-[#00a884] ring-1 ring-black/[0.06] dark:bg-[#202c33] dark:text-[#25d366] dark:ring-white/[0.06]"
              : `bg-zinc-100 dark:bg-[#262626] border border-zinc-200 dark:border-[#363636] text-zinc-600 dark:text-zinc-300 ${
                  isMine ? "-right-10" : "-left-10"
                }`
          }`}
        >
          <Reply className="w-4 h-4" />
        </motion.div>
      )}

      <motion.div
        style={{ x, touchAction: enabled ? "pan-y" : "auto" }}
        drag={enabled ? "x" : false}
        dragConstraints={dragConstraints}
        dragElastic={0.12}
        dragMomentum={false}
        dragDirectionLock
        onDragStart={clearLongPress}
        onDragEnd={handleDragEnd}
        onPointerDown={startLongPress}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={(event) => {
          if (!whatsapp || !onLongPress) return;
          event.preventDefault();
          clearLongPress();
          onLongPress();
        }}
        className="relative z-[1] max-w-full min-w-0"
      >
        {children}
      </motion.div>
    </div>
  );
}
