# Capas de Pagamento

PWA para iPhone que lê fotos das capas de processo de pagamento da Prefeitura de Maracaçumé, gera a lista em PDF agrupada por credor (com subtotais e conferência de valores) e acompanha o status de cada processo (Recebido, Pendente pagamento, Pendente certidão, Pago, Devolvido).

## Leitura das fotos

- **Claude API (padrão):** lê a letra de mão; exige chave em Ajustes (console.anthropic.com). Custa de US$ 0,001 a US$ 0,03 por capa, conforme o modelo.
- **No aparelho (opcional):** OCR com Tesseract.js, grátis e sem chave, mas não lê bem letra de mão.

## Uso

Publique a pasta em qualquer endereço https (ex.: GitHub Pages), abra no Safari do iPhone → Compartilhar → "Adicionar à Tela de Início".

Os dados ficam salvos só no aparelho; use Ajustes → Exportar backup.
