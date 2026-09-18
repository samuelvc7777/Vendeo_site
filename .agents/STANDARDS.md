# Padrões de Código e Diretrizes de Engenharia

## 1. Princípios Gerais
* **Clean Code & SOLID:** Módulos pequenos, coesos e desacoplados.
* **Senior Craftsmanship:** Código autoexplicativo, com tipagem completa e sem supressão de erros (`any` é expressamente evitado).
* **Mobile First Absoluto:** Todo componente deve ser pensado primeiro na tela de um smartphone (360px a 430px de largura) e depois adaptado para telas maiores.

## 2. Padrões de TypeScript
* Modo estrito ativado (`strict: true`).
* Tipagem explícita em props de componentes e retornos de funções assíncronas.
* Centralização de tipos em `src/types/`.

## 3. Padrões de UI & Estilização (Tailwind)
* Utilizar `clsx` e `tailwind-merge` através da função utilitária `cn()`.
* Evitar valores mágicos arbitrários quando houver classes padrão do Tailwind.
* Sempre prever áreas seguras do dispositivo:
  * Topo: `pt-[env(safe-area-inset-top,0px)]`
  * Rodapé: `pb-[env(safe-area-inset-bottom,0px)]`
* Touch targets com tamanho mínimo de `44x44px` para botões e itens clicáveis em mobile.
* Efeitos de clique táteis: `active:scale-95 transition-transform`.

## 4. Performance e Fluidez
* Transições suaves usando hardware acceleration (`transform`, `opacity`).
* Carregamento de imagens com Next/Image e placeholders otimizados.
* Componentes pesados carregados sob demanda (`dynamic` import).
