import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exclusão de Dados | Vendeo",
  description: "Instruções para solicitar a exclusão de dados no Vendeo.",
};

export default function DataDeletionPage() {
  return (
    <main className="h-full overflow-y-auto bg-white px-5 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <article className="mx-auto w-full max-w-3xl space-y-7 pb-12">
        <header className="space-y-2 border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-sm font-semibold text-sky-600 dark:text-sky-400">Vendeo</p>
          <h1 className="text-3xl font-bold tracking-tight">Exclusão de dados do usuário</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Última atualização: 1º de outubro de 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Como solicitar a exclusão</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Para solicitar a exclusão de dados pessoais relacionados ao Vendeo, envie um e-mail para{" "}
            <a className="font-medium text-sky-600 underline underline-offset-4 dark:text-sky-400" href="mailto:larissapaivar98@gmail.com?subject=Exclus%C3%A3o%20de%20dados%20Vendeo">
              larissapaivar98@gmail.com
            </a>{" "}
            com o assunto <strong>“Exclusão de dados Vendeo”</strong>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Inclua na solicitação</h2>
          <ul className="list-disc space-y-2 pl-5 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>nome ou nome de usuário associado à conta;</li>
            <li>plataforma vinculada, quando aplicável, como Instagram;</li>
            <li>informações suficientes para localizar os dados corretos sem enviar senhas ou tokens de acesso.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">O que acontece depois</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Após a confirmação da identidade e da solicitação, os dados elegíveis serão removidos dos sistemas do Vendeo ou anonimizados,
            salvo quando a retenção for necessária para cumprimento de obrigação legal, prevenção a fraude, segurança ou exercício regular de direitos.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Revogação de acesso à Meta/Instagram</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Além da solicitação ao Vendeo, o usuário pode remover ou revogar permissões do aplicativo diretamente nas configurações da conta
            ou da plataforma Meta/Instagram quando esse recurso estiver disponível.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="font-semibold">Importante</h2>
          <p className="mt-2 leading-7 text-zinc-700 dark:text-zinc-300">
            Nunca envie senha, token de acesso ou chave secreta do aplicativo por e-mail.
          </p>
        </section>

        <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <a className="underline underline-offset-4" href="/privacy">Política de Privacidade</a>
          <span className="px-2">·</span>
          <a className="underline underline-offset-4" href="/terms">Termos de Serviço</a>
        </footer>
      </article>
    </main>
  );
}
