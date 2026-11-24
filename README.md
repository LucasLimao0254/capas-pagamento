# Capas de Pagamento

PWA (iPhone e Android) usado pela equipe para acompanhar o processo de pagamento da Prefeitura de Maracaçumé, da montagem da capa até a volta à Contabilidade depois do pagamento.

- **Lançamento:** o Compras fotografa as capas; as fotos são lidas no servidor pela API do Claude.
- **Fluxo em 9 etapas:** 1 Montagem (Compras) → 2 Controle Interno → 3 Encaminhado à Contabilidade → 4 Devolvido pela Contabilidade → 7 Encaminhado p/ pagamento → 8 Controle após pagamento → 9 Contabilidade (final); com devolução opcional 5 ao Compras p/ correção e 6 volta ao Controle corrigido. Cada passo registra quem fez, quando e uma observação (obrigatória na devolução).
- **Setores:** todos veem tudo; só o setor responsável pela etapa (Compras ou Controle Interno) mexe no processo. O Controle registra os passos da Contabilidade e do Financeiro, que não usam o app. O administrador define os setores em Ajustes. As travas valem no banco, não só na tela.
- **Alertas:** processo parado na mesma etapa, ISS/IRRF retido em processo pago ainda não recolhido, conta Valor − ISS − IRRF ≠ Líquido, percentuais fora do padrão, dúvidas de leitura e duplicatas.
- **Lista (PDF):** marque os processos e gere o PDF agrupado por credor, com subtotais.

## Estrutura
- `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`: o app (publicado no GitHub Pages).
- `config.js`: endereço e chave pública do Supabase.
- `supabase/schema.sql`: banco, regras de acesso, histórico de status, fotos.
- `supabase/functions/ler-capa/`: função que lê a foto com o Claude (a chave da API fica só no servidor).

Para configurar o servidor, veja [CONFIGURAR.md](CONFIGURAR.md).

## Instalar no iPhone
Abra o endereço no Safari → Compartilhar → "Adicionar à Tela de Início".
