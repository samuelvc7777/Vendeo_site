"use client";

import React, { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsGroup({
  title,
  description,
  children,
  className = "",
}: SettingsGroupProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {title && (
        <div className="px-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-zinc-200/90 dark:border-white/10 bg-white dark:bg-[#111113] shadow-sm divide-y divide-zinc-100 dark:divide-white/[0.06]">
        {children}
      </div>
    </div>
  );
}

export interface SettingsItemRowProps {
  icon: ReactNode;
  iconBgClassName?: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export function SettingsItemRow({
  icon,
  iconBgClassName = "bg-violet-500 text-white",
  title,
  subtitle,
  badge,
  onClick,
  disabled = false,
}: SettingsItemRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.04] active:bg-zinc-100 dark:active:bg-white/[0.07] disabled:opacity-50 select-none min-h-[52px]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm shadow-sm ${iconBgClassName}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold tracking-tight text-zinc-950 dark:text-white truncate">
              {title}
            </span>
          </div>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {badge && <div>{badge}</div>}
        <ChevronRight className="h-4 w-4 text-zinc-400 dark:text-zinc-600 shrink-0" />
      </div>
    </button>
  );
}

export interface SettingsToggleRowProps {
  icon: ReactNode;
  iconBgClassName?: string;
  title: string;
  subtitle?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SettingsToggleRow({
  icon,
  iconBgClassName = "bg-sky-500 text-white",
  title,
  subtitle,
  checked,
  onChange,
  disabled = false,
}: SettingsToggleRowProps) {
  return (
    <div className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left select-none min-h-[52px]">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm shadow-sm ${iconBgClassName}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <span className="text-[13px] font-bold tracking-tight text-zinc-950 dark:text-white truncate">
            {title}
          </span>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
          checked ? "bg-[#34c759]" : "bg-zinc-200 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
