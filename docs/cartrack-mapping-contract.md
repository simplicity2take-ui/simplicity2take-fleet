# CarTrack — contrato de mapeamento canónico, ciclo de vida e testes

**Estado: especificação técnica; não é uma migração.** Este documento define regras para a futura implementação. Não executa SQL, não altera dados, não chama a API CarTrack e não faz deploy.

## 1. Objetivo e invariantes

O mapeamento tem de ligar, sem ambiguidade:

`empresa Fleet → conta CarTrack → viatura CarTrack → viatura Fleet → snapshots → quilometragem`

Invariantes obrigatórios:

1. Uma conta CarTrack pertence a uma única empresa Fleet.
2. Uma associação ativa liga uma viatura externa a uma única viatura Fleet dentro dessa conta.
3. O `provider_vehicle_id` é sempre o identificador externo CarTrack (`bigint`); o `fleet_vehicle_id` é sempre o UUID canónico de `public.vehicles`.
4. A empresa autorizada é determinada por relações persistidas e verificadas no servidor, nunca por um `company_id` enviado pelo browser ou pelo payload do fornecedor.
5. Matrícula é atributo mutável e auxiliar de revisão; não é chave de identidade nem autorização para associar.
6. Nenhum registo desconhecido, ambíguo, duplicado ou de outra empresa é associado automaticamente.
7. Repetir a mesma sincronização não pode duplicar snapshots nem leituras de odómetro.
8. Uma falha a meio da operação não pode deixar a associação e os factos parcialmente aplicados.

## 2. Modelo lógico e integridade referencial

Os nomes abaixo são propostas. Antes de DDL, confirmar os nomes e tipos reais das tabelas de empresas e viaturas e validar a estratégia em base de dados descartável.

### 2.1 `cartrack_accounts`

Campos propostos:

- `id uuid primary key`
- `company_id uuid not null`
- `provider_account_key text not null` — identificador não secreto da conta no fornecedor
- `credential_ref text not null` — referência opaca a segredo guardado exclusivamente no servidor
- `status text not null` — por exemplo `pending`, `active`, `suspended`, `retired`
- `created_at`, `updated_at`, `last_rotated_at`

Restrições:

- `unique (company_id, provider_account_key)`
- `unique (id, company_id)`, para permitir FKs compostas que provem a empresa da conta
- FK de `company_id` para a empresa Fleet
- CHECK de estados permitidos
- Sem SELECT/INSERT/UPDATE/DELETE direto por `anon` ou `authenticated`; gestão por função/serviço privilegiado com autorização explícita.

Não guardar utilizador, palavra-passe, token ou segredo em tabelas acessíveis ao cliente, `app_settings`, metadados de empresa ou logs. A referência opaca também não é autorização: o serviço tem de validar a empresa e o estado da conta antes de resolver o segredo.

### 2.2 `cartrack_vehicle_mappings`

Campos propostos:

- `id uuid primary key`
- `account_id uuid not null`
- `company_id uuid not null`
- `provider_vehicle_id bigint not null`
- `fleet_vehicle_id uuid not null`
- `mapping_status text not null` — `pending_review`, `active`, `quarantined`, `retired`
- `match_method text not null` — por exemplo `manual`, `provider_id`, `reviewed_registration`
- `reviewed_by uuid null`, `reviewed_at timestamptz null`
- `created_at`, `updated_at`, `retired_at timestamptz null`

Integridade proposta:

- FK composta `(account_id, company_id) → cartrack_accounts(id, company_id)`.
- FK composta `(fleet_vehicle_id, company_id) → vehicles(id, company_id)`; requer confirmar/criar uma chave UNIQUE compatível em `vehicles(id, company_id)`.
- UNIQUE `(account_id, provider_vehicle_id)`: o ID externo é único dentro da conta, não globalmente.
- Índice/constraint parcial para impedir duas associações ativas do mesmo veículo Fleet à mesma conta, caso o contrato CarTrack confirme relação 1:1.
- CHECK para estados e métodos de correspondência.
- Transições de estado e alterações de empresa protegidas no servidor; o cliente nunca altera `company_id`, `account_id` ou `provider_vehicle_id`.

Não impor unicidade global de matrícula. Duas empresas podem legitimamente ter matrículas iguais nos seus ambientes; a matrícula pode também mudar ao longo da vida do veículo.

### 2.3 Snapshots

Adicionar à tabela de snapshots uma referência nullable `cartrack_mapping_id uuid` para a associação canónica. Manter o `vehicle_id bigint` antigo como identificador externo durante a migração e período de auditoria.

- Novos snapshots só são persistidos depois de resolver uma associação ativa.
- Snapshot sem mapping válido vai para quarentena, não para uma viatura escolhida por aproximação.
- A empresa do snapshot deriva do mapping e da viatura Fleet.
- Preservar a ordem temporal do fornecedor; snapshot antigo não substitui o estado mais recente.
- Definir retenção e índices com base no volume real e nas consultas necessárias; não criar índices especulativos antes de medir.

### 2.4 Quilometragem

Manter `vehicle_odometer_readings.vehicle_id` como UUID canónico da viatura Fleet.

- Adicionar `cartrack` aos valores de origem apenas numa migração testada.
- Acrescentar uma chave de origem determinística, por exemplo `source_record_key`, com índice UNIQUE parcial por `(vehicle_id, source, source_record_key)`.
- Preferir o ID de observação fornecido pela CarTrack, se existir e for estável. Se não existir, definir e testar uma chave determinística com conta, ID externo, timestamp normalizado e valor de odómetro.
- Validar unidade, valor não negativo, timestamp e plausibilidade antes de inserir.
- Uma observação repetida é ignorada/idempotente; uma observação mais antiga não faz regredir o valor atual.
- Não converter ausência ou erro de leitura em zero.

## 3. Ciclo de vida do mapeamento

| Estado | Significado | Pode receber novos snapshots? |
|---|---|---|
| `pending_review` | Descoberto, ainda não validado | Não |
| `active` | Associação confirmada e consistente | Sim |
| `quarantined` | Conflito, duplicado, dados incompletos ou suspeita | Não |
| `retired` | Associação terminada, preservada para histórico | Não |

Transições permitidas:

- descoberta → `pending_review`
- `pending_review` → `active`, após revisão autorizada e validação de empresa/viatura
- qualquer estado não terminal → `quarantined`, perante conflito
- `active` → `retired`, quando a associação deixa de ser válida
- `quarantined` → `pending_review`, apenas após corrigir a causa e manter auditoria

Não reativar uma associação antiga apagando o histórico. Criar uma nova versão/associação ou registar uma transição auditável, conforme o desenho final. Uma viatura transferida entre empresas exige terminar a associação anterior e validar a nova empresa; nunca alterar silenciosamente a empresa de um mapping histórico.

## 4. Regras de correspondência e revisão

Ordem de resolução:

1. Conta CarTrack autenticada e ativa, resolvida no servidor.
2. ID externo da viatura dentro dessa conta.
3. Mapping existente e ativo.
4. Verificação de que a viatura Fleet continua a pertencer à empresa da conta.
5. Só se não existir mapping: gerar candidato de revisão, sem o ativar.

A matrícula normalizada pode ajudar a apresentar candidatos, mas nunca deve confirmar sozinha a associação. A revisão tem de comparar informação operacional autorizada, confirmar a empresa e a viatura, registar o revisor e a data e preservar a origem da decisão.

Resultados possíveis da ingestão:

- `matched_active`: mapping ativo e consistente.
- `new_candidate`: novo ID externo, enviado para revisão.
- `unmatched`: sem candidato seguro.
- `ambiguous`: mais de um candidato possível.
- `duplicate_provider_id`: duplicação dentro da mesma conta.
- `cross_company_conflict`: a viatura Fleet não pertence à empresa da conta.
- `inactive_mapping`: associação retirada/suspensa.
- `invalid_observation`: dados inválidos ou timestamp/unidade não fiável.

A resposta da API deve devolver contagens e códigos estáveis, nunca payloads completos, credenciais, matrículas de outras empresas ou mensagens SQL.

## 5. Backfill dos dados existentes

Inventário atual registado na revisão de 30-10-2026:

- 23 linhas de viaturas CarTrack.
- 21 correspondências únicas por matrícula normalizada: apenas candidatas a revisão.
- 2 sem correspondência: manter em quarentena.
- 0 ambiguidades no agregado observado.
- 69 snapshots existentes sem FK canónica de mapping.

Plano conservador:

1. Exportar apenas o conjunto mínimo necessário para revisão autorizada, em ambiente controlado.
2. Confirmar conta de origem e identidade externa de cada viatura.
3. Rever individualmente os 21 candidatos; não assumir que matrícula igual prova identidade.
4. Não associar os 2 registos sem correspondência.
5. Associar snapshots antigos apenas quando a identidade externa e a conta estejam confirmadas; não fazer backfill por matrícula isolada.
6. Guardar auditoria da decisão e contagens antes/depois.
7. Executar backfill em transação, com validação de contagens e rollback ensaiado numa base de dados descartável.
8. Não apagar colunas antigas durante a fase de compatibilidade.

Nenhum dos passos acima foi executado; não foram alterados os 23 registos nem os 69 snapshots.

## 6. Contrato transacional do sync

A operação de escrita deverá ser uma única RPC/rotina server-side, com transação explícita:

1. Validar identidade/claim do chamador de serviço e contexto autorizado.
2. Resolver a conta e a empresa a partir de registos internos.
3. Confirmar conta ativa e referência de credencial válida.
4. Validar que cada ID externo pertence à conta selecionada.
5. Resolver mapping e verificar as duas FKs compostas/ownership.
6. Validar timestamp, unidade, odómetro e integridade do snapshot.
7. Fazer upsert idempotente do snapshot e leitura de odómetro.
8. Atualizar estado de sincronização apenas quando todas as páginas esperadas foram recebidas e validadas.
9. Confirmar a transação; perante erro, rollback total.
10. Devolver apenas resumo agregado e códigos de erro redigidos.

A sincronização deve suportar paginação, limites, retry e checkpoints. Uma resposta parcial do fornecedor nunca pode ser marcada como sincronização completa. Confirmar com a CarTrack o significado de IDs, estabilidade, paginação, ordenação temporal, unidades e identificadores de observação antes de fixar o contrato.

## 7. Matriz de testes obrigatórios

Todos os testes devem usar dados sintéticos e uma base de dados descartável, com sessões autenticadas distintas quando testarem RLS.

| Caso | Preparação | Resultado esperado |
|---|---|---|
| Empresa A | Conta A e viatura A | Mapping e leitura só em A |
| Empresa B | Conta B e viatura B | B não lê nem altera dados de A |
| Matrícula repetida | Mesma matrícula em A e B | Sem cruzamento entre empresas |
| ID externo repetido | Mesmo bigint em duas contas | Permitido em contas distintas; único dentro de cada conta |
| ID duplicado na conta | Duas linhas para o mesmo ID externo | Rejeição/quarentena, sem escolha arbitrária |
| Viatura desconhecida | ID sem mapping | Candidato/quarentena; não cria viatura Fleet |
| Mapping cruzado | Conta A aponta para viatura B | Rejeição transacional |
| Conta suspensa | Conta não ativa | Sync bloqueado |
| Mapping retirado | Estado `retired` | Sem novos snapshots |
| Matrícula alterada | ID externo estável, matrícula mudou | Mapping mantém identidade; matrícula atualiza como atributo |
| Dupla associação ativa | Duas viaturas externas apontam para a mesma viatura | Rejeição se a regra 1:1 for confirmada |
| Repetição | Mesmo snapshot enviado duas vezes | Uma observação lógica, sem duplicados |
| Fora de ordem | Snapshot antigo depois de novo | Estado atual não regride |
| Odómetro inválido | Null, negativo, unidade desconhecida | Rejeitado; valor anterior preservado |
| Paginação parcial | Falta uma página | Sync não marcado completo |
| Falha a meio | Erro durante persistência | Rollback integral |
| Concorrência | Duas sincronizações simultâneas | Sem mapping duplicado nem leituras duplicadas |
| RLS | Sessões A, B, driver e anon | Apenas linhas/campos autorizados |
| Service role | RPC com conta/empresa incompatível | Rejeição explícita; RLS não é a barreira |
| Erros | Fornecedor/SQL devolve detalhe sensível | Resposta redigida, sem payload/segredo/SQL |

## 8. Critérios de aceitação antes de produção

- [ ] DDL final validado numa base de dados descartável.
- [ ] FKs compostas e unicidades testadas, incluindo concorrência.
- [ ] Revisão manual dos 21 candidatos; os 2 não correspondidos permanecem em quarentena até prova.
- [ ] Snapshots antigos reconciliados com trilho de auditoria.
- [ ] Testes A/B e driver passam com sessões separadas.
- [ ] Testes de idempotência, paginação, ordem temporal e rollback passam.
- [ ] RPC não confia em IDs de empresa/conta enviados pelo browser.
- [ ] Leitura frontend substitui os SELECT globais por projeção allowlist com filtro por empresa.
- [ ] Privilégios TRUNCATE e RPCs SECURITY DEFINER revistos em separado.
- [ ] Logs e respostas não expõem payloads nem credenciais.
- [ ] Plano de rollback e reconciliação aprovado.
- [ ] Aprovação explícita antes de qualquer migração, alteração de permissões, deploy ou sincronização real.

## 9. Estado desta etapa

**Concluído:** contrato lógico, ciclo de vida, política de associação, backfill conservador, requisitos transacionais e matriz de testes documentados.

**Bloqueado:** execução dos testes de integração e implementação SQL, porque não existe atualmente ambiente descartável gratuito confirmado. Não será criado um projeto/branch Supabase que possa gerar custos.

**Sem alterações de produção:** nenhum DDL/DML, grant, RLS, RPC, Edge Function, deploy ou chamada à CarTrack foi executado nesta etapa.
