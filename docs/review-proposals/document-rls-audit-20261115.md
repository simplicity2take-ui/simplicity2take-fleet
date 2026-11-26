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

## Verificação adicional dos estados de acesso
Em consulta apenas de leitura, confirmei que `s2t_is_admin()` já exige um perfil administrativo com estado `Ativo` e que `s2t_driver_id()` exige um perfil com estado `Ativo`, mas **não valida `drivers.status`**. Assim, inativar apenas o registo `drivers` pode não impedir a seleção de metadados enquanto as regras antigas de RLS estiverem ativas.

No ramo de revisão, a Edge Function `document-access` passou a exigir tanto `profiles.status = 'Ativo'` como `drivers.status = 'Ativo'`. O carregamento `drive-upload` também passou a exigir administrador com perfil ativo. A proposta SQL de RLS foi atualizada para exigir o estado ativo do próprio motorista. Estes controlos **ainda não estão em produção**.

## Alteração preparada (sem aplicação)
O ficheiro [documents-driver-read-policy.sql](./documents-driver-read-policy.sql) contém uma política candidata que:
1. mantém acesso administrativo a documentos expirados;
2. aplica ao motorista um filtro de validade na data civil de `Europe/Lisbon` e exige `drivers.status = 'Ativo'`;
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

## Validação isolada em 26/11/2026

A migração inicial do repositório e a política descrita na auditoria usam nomes diferentes para a leitura de documentos. No PostgreSQL, uma política permissiva de leitura pode conceder acesso mesmo quando outra o recusa. A proposta substitui os dois nomes conhecidos e adiciona uma política restritiva para as leituras de utilizadores autenticados. A regra verifica também o papel e o estado do perfil e mantém a consulta de documentos expirados pelo administrador ativo.

O teste `tests/document-rls-database.test.cjs` cria uma base PGlite em memória com os auxiliares e as políticas da migração inicial. Aplica duas vezes o SQL candidato, mantém uma permissão de leitura concorrente e verifica os resultados com identidades fictícias. Cobre documentos pessoais, partilhas concedidas e revogadas, atribuições que começam e terminam no próprio dia, documentos expirados, perfis e motoristas inativos, utilizadores sem motorista e acesso anónimo. Para repetir com Node 24, executar `npm ci --prefix tools/driver-lifecycle-tests` e depois `node --test tests/document-rls-database.test.cjs`.

A validação cobre a seleção de metadados no esquema de teste. Continuam pendentes a comparação com o esquema instalado e a verificação das permissões efetivas no Google Drive.
