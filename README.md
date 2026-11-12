# Capas de Pagamento

PWA para iPhone usado pela equipe para lançar as capas de processo de pagamento da Prefeitura de Maracaçumé, acompanhar o status de cada processo e imprimir listas em PDF.

- **Processos:** cada pessoa fotografa as capas; as fotos são lidas no servidor pela API do Claude e os processos aparecem na hora para toda a equipe. Status (Recebido, Pendente pagamento, Pendente certidão, Pago, Devolvido) com histórico de quem mudou e quando.
- **Lista (PDF):** marque os processos desejados e gere o PDF agrupado por credor, com subtotais.
- **Avisos:** conta Valor − ISS − IRRF ≠ Valor Líquido, percentuais fora do padrão, dúvidas de leitura e duplicatas (mesma foto ou mesmo credor/valor/empenho/referente).

## Estrutura
- `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`: o app (publicado no GitHub Pages).
- `config.js`: endereço e chave pública do Supabase.
- `supabase/schema.sql`: banco, regras de acesso, histórico de status, fotos.
- `supabase/functions/ler-capa/`: função que lê a foto com o Claude (a chave da API fica só no servidor).

Para configurar o servidor, veja [CONFIGURAR.md](CONFIGURAR.md).

## Instalar no iPhone
Abra o endereço no Safari → Compartilhar → "Adicionar à Tela de Início".
