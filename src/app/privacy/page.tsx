import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade | Vendeo",
  description: "Política de Privacidade do Vendeo.",
};

export default function PrivacyPage() {
  return (
    <main className="h-full overflow-y-auto bg-white px-5 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <article className="mx-auto w-full max-w-3xl space-y-7 pb-12">
        <header className="space-y-2 border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-sm font-semibold text-sky-600 dark:text-sky-400">Vendeo</p>
          <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Última atualização: 1º de outubro de 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Sobre esta política</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Esta Política de Privacidade explica como o Vendeo trata informações necessárias para oferecer recursos de atendimento,
            organização e automação de conversas integradas a serviços como Instagram e Meta.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Dados que podemos tratar</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Conforme os recursos utilizados, podemos tratar identificadores de conta, nome de usuário, nome de exibição, foto de perfil,
            mensagens, anexos, áudios, imagens, dados técnicos de entrega e outras informações disponibilizadas pelas APIs autorizadas.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Finalidades</h2>
          <ul className="list-disc space-y-2 pl-5 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>exibir, organizar e responder conversas;</li>
            <li>sincronizar mensagens e status de atendimento;</li>
            <li>executar automações configuradas pelo operador;</li>
            <li>processar mídia e conteúdo quando necessário ao funcionamento do serviço;</li>
            <li>manter segurança, confiabilidade e histórico operacional.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Integrações e prestadores</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            O Vendeo pode utilizar serviços de terceiros estritamente para operar suas funcionalidades, incluindo Meta/Instagram,
            infraestrutura de banco de dados e armazenamento e provedores de inteligência artificial quando recursos de automação estiverem habilitados.
            Cada serviço também pode estar sujeito às suas próprias políticas.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Compartilhamento e venda de dados</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            O Vendeo não vende dados pessoais. Informações são compartilhadas somente quando necessário para executar os recursos solicitados,
            cumprir obrigações legais ou proteger a segurança do serviço.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Retenção e segurança</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Os dados são mantidos somente pelo período necessário às finalidades operacionais, legais e de segurança aplicáveis.
            Adotamos medidas técnicas e organizacionais razoáveis para proteger as informações contra acesso, alteração ou divulgação não autorizados.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Seus direitos e exclusão de dados</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Você pode solicitar informações, correção ou exclusão de dados relacionados ao Vendeo. As instruções estão disponíveis em{" "}
            <a className="font-medium text-sky-600 underline underline-offset-4 dark:text-sky-400" href="/data-deletion">
              Exclusão de dados
            </a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Contato</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Para dúvidas sobre privacidade ou dados pessoais, entre em contato pelo e-mail{" "}
            <a className="font-medium text-sky-600 underline underline-offset-4 dark:text-sky-400" href="mailto:larissapaivar98@gmail.com">
              larissapaivar98@gmail.com
            </a>.
          </p>
        </section>

        <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <a className="underline underline-offset-4" href="/terms">Termos de Serviço</a>
          <span className="px-2">·</span>
          <a className="underline underline-offset-4" href="/data-deletion">Exclusão de dados</a>
        </footer>
      </article>
    </main>
  );
}
