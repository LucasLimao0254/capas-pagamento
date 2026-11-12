# Capas de Pagamento

PWA para iPhone que lê fotos das capas de processo de pagamento da Prefeitura de Maracaçumé, gera a lista em PDF agrupada por credor (com subtotais e conferência de valores) e acompanha o status de cada processo (Recebido, Pendente pagamento, Pendente certidão, Pago, Devolvido).

## Leitura das fotos

- **No aparelho (padrão):** OCR com Tesseract.js, grátis e sem chave. Melhor com texto impresso; confira as capas escritas à mão.
- **Claude API (opcional):** mais precisa com letra de mão; exige chave em Ajustes.

## Uso

Publique a pasta em qualquer endereço https (ex.: GitHub Pages), abra no Safari do iPhone → Compartilhar → "Adicionar à Tela de Início".

Os dados ficam salvos só no aparelho; use Ajustes → Exportar backup.
