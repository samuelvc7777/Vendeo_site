import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Serviço | Vendeo",
  description: "Termos de Serviço do Vendeo.",
};

export default function TermsPage() {
  return (
    <main className="h-full overflow-y-auto bg-white px-5 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <article className="mx-auto w-full max-w-3xl space-y-7 pb-12">
        <header className="space-y-2 border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-sm font-semibold text-sky-600 dark:text-sky-400">Vendeo</p>
          <h1 className="text-3xl font-bold tracking-tight">Termos de Serviço</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Última atualização: 1º de outubro de 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Aceitação</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Ao utilizar o Vendeo, você concorda com estes Termos de Serviço e com a Política de Privacidade aplicável ao serviço.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. O serviço</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            O Vendeo oferece ferramentas para organização, atendimento e automação de conversas e fluxos comerciais,
            incluindo integrações autorizadas com plataformas de terceiros como Instagram e Meta.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Uso autorizado</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            O usuário deve utilizar o Vendeo de forma lícita, respeitando direitos de terceiros, regras das plataformas integradas e permissões concedidas.
            É proibido usar o serviço para fraude, abuso, acesso não autorizado, spam ou qualquer atividade ilegal.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Contas e integrações</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Algumas funcionalidades dependem de contas, permissões, tokens ou APIs de terceiros. O funcionamento dessas integrações pode depender
            da disponibilidade e das políticas das respectivas plataformas.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Automação</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Recursos automatizados podem auxiliar na preparação, organização ou envio de respostas conforme as configurações do operador.
            O responsável pela conta continua responsável pelo uso do serviço e pelo conteúdo enviado em seu nome.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Disponibilidade</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Buscamos manter o serviço disponível e seguro, mas não garantimos operação ininterrupta. Manutenções, falhas de rede ou mudanças
            em serviços de terceiros podem afetar temporariamente algumas funcionalidades.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Privacidade e exclusão</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            O tratamento de dados é descrito na{" "}
            <a className="font-medium text-sky-600 underline underline-offset-4 dark:text-sky-400" href="/privacy">Política de Privacidade</a>.
            Solicitações de exclusão podem ser feitas conforme as{" "}
            <a className="font-medium text-sky-600 underline underline-offset-4 dark:text-sky-400" href="/data-deletion">instruções de exclusão de dados</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Contato</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Dúvidas sobre estes termos podem ser encaminhadas para{" "}
            <a className="font-medium text-sky-600 underline underline-offset-4 dark:text-sky-400" href="mailto:larissapaivar98@gmail.com">
              larissapaivar98@gmail.com
            </a>.
          </p>
        </section>

        <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <a className="underline underline-offset-4" href="/privacy">Política de Privacidade</a>
          <span className="px-2">·</span>
          <a className="underline underline-offset-4" href="/data-deletion">Exclusão de dados</a>
        </footer>
      </article>
    </main>
  );
}
