# Arquitetura técnica

## Componentes
- Dashboard: totais por etapa, pendências, erros e expedições recentes.
- Destinatários: cadastro, edição e validação de endereço.
- Pedidos: preparação, criação e consulta de status.
- Faturamento em lote: seleção explícita, pré-validação e confirmação.
- Expedição: etiqueta, DANFE e PDF combinado por envio.
- Auditoria: histórico cronológico de eventos e retornos do ERP.
- Configurações: conexões, mapeamentos e usuários internos.

## Backend
A camada Omie existe exclusivamente no servidor. Cada operação mutável requer validação, idempotência, confirmação e trilha de auditoria.

## Banco
PostgreSQL/Supabase mantém destinatários, controle de execução, histórico e arquivos. O ERP permanece como fonte oficial de pedidos, faturamento e documentos fiscais.
