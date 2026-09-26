"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole } from "lucide-react";

export default function BrainOperatorPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void fetch("/api/operator/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        setIsConfigured(result.enabled === true);
        setIsAuthenticated(result.authenticated === true);
      })
      .catch(() => setIsConfigured(false));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/operator/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível iniciar a sessão de operador.");
      setPassword("");
      const returnTo = new URLSearchParams(window.location.search).get("returnTo") || "/";
      router.replace(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao autenticar operador.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/operator/session", { method: "DELETE", cache: "no-store" });
    setIsAuthenticated(false);
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-zinc-950 px-5 py-10 text-zinc-100">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold">Operações do Brain</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Acesso administrativo global à timeline e às ações manuais das conversas desta instância.
        </p>

        {isConfigured === false && (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            O operador ainda não foi configurado no servidor. Defina <code>BRAIN_OPERATOR_PASSWORD</code> e <code>BRAIN_OPERATOR_SESSION_SECRET</code> no ambiente privado da aplicação.
          </div>
        )}

        {isAuthenticated ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-emerald-300">Sessão de operador ativa neste navegador.</p>
            <button type="button" onClick={() => router.replace("/")} className="w-full rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-zinc-950">
              Voltar ao Vendeo
            </button>
            <button type="button" onClick={handleLogout} className="w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300">
              Encerrar sessão de operador
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <label htmlFor="operator-password" className="block text-xs font-medium text-zinc-300">Senha de operador</label>
            <input
              id="operator-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={1024}
              disabled={isConfigured !== true || isSubmitting}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-amber-300 disabled:opacity-50"
            />
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            <button type="submit" disabled={isConfigured !== true || isSubmitting || !password} className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-50">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Entrar como operador
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
