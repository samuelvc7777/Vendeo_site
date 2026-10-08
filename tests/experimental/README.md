# Testes de protótipos fora da produção

O teste e o módulo de ativação do Tinder foram preservados juntos a partir do snapshot `backup/pre-production-unification-20261008`. Esse módulo não está no frontend publicado e não deve ser importado pela aplicação.

Os quatro testes verificam o protótipo preservado, não comprovam a ativação do Tinder no release atual. Execute separadamente:

```powershell
node --import ./scripts/register-loader.mjs --test tests/experimental/test_tinder_autopilot_activation.mjs
```
