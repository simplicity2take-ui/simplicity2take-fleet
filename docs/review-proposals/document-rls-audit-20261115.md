# Auditoria de acesso a documentos — 15/11/2026

## Âmbito e método
Consulta **apenas de leitura** das políticas RLS do projeto Supabase associado ao SIMPLICITY2TAKE Fleet, sem abrir ficheiros de motoristas, alterar linhas, executar migrações ou publicar o portal.

## Constatação: regra atual em produção
A política de seleção `s2t documents select` atualmente permite, além do administrador:
- documentos com `driver_id = s2t_driver_id()`;
- documentos de uma viatura atribuída ao motorista na data avaliada pelo PostgreSQL;
- documentos com `driver_id IS NULL` e uma autorização em `document_viewers`.

**Essa política não testa `expiry_date`**. Um motorista autenticado pode por isso receber metadados de documentos expirados através da Data API do Supabase, mesmo quando a interface os oculta e a Edge Function `document-access` impede a entrega do ficheiro. Os metadados disponíveis na tabela incluem nome, tipo, data de validade e identificadores de ficheiros; a acessibilidade direta de um ficheiro no Drive dependeria de outra configuração, não verificada aqui.

O ramo de desenvolvimento já exige a data local de Lisboa no leitor de documentos, mas esta defesa não substitui a RLS do banco.

## Alteração preparada (sem aplicação)
O ficheiro [documents-driver-read-policy.sql](./documents-driver-read-policy.sql) contém uma política candidata que:
1. mantém acesso administrativo a documentos expirados;
2. aplica ao motorista um filtro de validade na data civil de `Europe/Lisbon`;
3. exige a titularidade para documentos pessoais;
4. exige uma atribuição ativa e a exclusividade da associação a viatura para documentos da frota;
5. exige autorização explícita para documentos da empresa;
6. não concede acesso a linhas inconsistentes que associem simultaneamente motorista e viatura.

Os testes [document-rls-proposal.test.cjs](../../tests/document-rls-proposal.test.cjs) verificam as condições essenciais na proposta de código. **Estes testes são verificações estáticas e não demonstram o comportamento real da RLS em PostgreSQL.**

## Antes de qualquer publicação
- Rever a política e simular num ambiente descartável os perfis administrador, motorista titular, motorista alheio e utilizador sem sessão.
- Testar datas na mudança do dia em Lisboa e em dias de alteração da hora.
- Confirmar documentos pessoais, de viatura e da empresa, com e sem autorização, incluindo expirados.
- Confirmar as políticas em vigor nas tabelas `document_viewers` e `vehicle_assignments`.
- Fazer a aplicação apenas após aprovação explícita; verificar o efeito real com duas sessões de testes independentes.

**Estado:** proposta em GitHub; nenhuma alteração aplicada à base de dados de produção.
