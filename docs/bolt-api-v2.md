# Integração Bolt Fleet API v2

A sincronização usa apenas a Fleet API v2 documentada pela Bolt. A função Edge autentica no servidor com OAuth Client Credentials, confirma que a empresa configurada está ativa e acessível e importa todas as páginas de motoristas e viaturas.

## Secrets necessários

Configurar no ambiente Supabase, sem os guardar no código:

- `BOLT_CLIENT_ID`
- `BOLT_CLIENT_SECRET`
- `BOLT_COMPANY_ID` (opcional se as credenciais tiverem acesso a uma única empresa ativa): identificador numérico `company_id` da Bolt. Não é o UUID interno da tabela `companies`. Se as credenciais puderem ver várias empresas, configurar este secret para selecionar a empresa correta.

A função chama `getCompanies` para confirmar as empresas acessíveis. Se houver exatamente uma empresa ativa, usa-a automaticamente; com várias, exige `BOLT_COMPANY_ID` e valida que corresponde a uma empresa ativa acessível. A importação consulta `getDrivers` e `getVehicles` com `company_id`, `limit` e `offset`, seguindo `total_rows` até carregar a coleção completa. Respostas Bolt com código de erro, paginação incompleta, empresa inacessível ou dados malformados são rejeitadas.

Os registos importados ficam associados no servidor à empresa local `simplicity2take`. A RPC de atribuição Bolt mantém o histórico, valida o estado da frota e comunica conflitos para revisão sem substituir associações existentes.

## Validação offline

O CI usa respostas JSON simuladas. Testa configuração do identificador, acesso à empresa, envelopes de erro, paginação, integração de campos e o caminho transacional da atribuição. Não usa credenciais, não chama a API Bolt, nem altera uma base Supabase hosted.

## Conflitos de estado da frota

Se a Bolt marcar como inativo um motorista ou viatura que ainda tem associações ativas/futuras, a regra da frota impede que a sincronização altere o estado à força. A função mantém os dados de identidade atualizados, preserva o estado e o histórico existentes, não cria uma associação Bolt nesse caso e devolve `statusConflictsRequiringReview` para revisão manual.
