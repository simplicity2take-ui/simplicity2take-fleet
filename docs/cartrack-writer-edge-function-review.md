# CarTrack — revisão da Edge Function e RPC de escrita

**Estado: auditoria estática e leitura de catálogo em 30-10-2026.** Não houve chamadas à API CarTrack, escrita na base de dados, alteração de permissões ou deploy.

## 1. Âmbito e versões revistas

- Edge Function supabase/functions/cartrack-sync/index.ts no branch feature/company-fleet-foundation.
- Alteração de redação de erros no PR #38, branch fix/cartrack-redact-integration-errors, commit fb383cb3e1c1ee5e008b35aca3c287503ddb56ce.
- Definição real de public.sync_cartrack_data(jsonb,jsonb) e EXECUTE grants consultados no projeto Supabase de produção através de SELECT de catálogo/definição. Nenhum DDL/DML foi executado.

## 2. O que já está protegido

- A Edge Function valida o JWT do utilizador com auth.getUser().
- Consulta profiles pelo ID autenticado e exige role = admin e status = Ativo.
- As credenciais CarTrack são lidas de variáveis de ambiente do servidor, não do body do browser.
- A RPC de escrita só tem EXECUTE concedido a service_role e postgres no catálogo observado.
- A RPC verifica o claim request.jwt.claim.role = service_role antes de escrever.
- O PR #38 remove os corpos de erro do fornecedor e as mensagens SQL/PostgREST da resposta ao cliente; também deixa de registar o objeto de erro completo.

Isto protege a integração atual de utilizadores não-admin, mas **não implementa multiempresa**.

## 3. Problemas confirmados na RPC atual

A definição de produção observada é SECURITY DEFINER, propriedade de postgres, com search_path=public. A rotina faz:

1. Upsert em cartrack_vehicles usando ON CONFLICT (registration).
2. Atualiza os campos atuais diretamente com os valores recebidos, incluindo odometer_km = excluded.odometer_km e event_ts = excluded.event_ts.
3. Insere cada snapshot recebido sem chave de idempotência nem deduplicação temporal.
4. Devolve contagens de linhas.

Consequências:

- A chave de conflito é matrícula global, não conta + ID externo. Não suporta com segurança duas contas/empresas e matrículas repetidas.
- A rotina não associa o ID externo CarTrack a um UUID Fleet nem valida a empresa da viatura.
- Uma leitura sem odómetro (null) pode apagar o odómetro atual válido.
- Uma observação atrasada pode substituir uma leitura mais recente.
- Repetir a mesma sincronização volta a inserir snapshots duplicados.
- O body JSON não tem limites explícitos de tamanho, número de linhas ou validação semântica antes dos casts.
- O teste do claim service_role é uma barreira útil para a chamada atual, mas não substitui validação de conta, empresa, mapping e propriedade do veículo. Qualquer serviço com service role é uma fronteira de confiança.

A função usa nomes qualificados para as tabelas públicas, mas mantém search_path=public. Na revisão da futura função, preferir search_path = '' e qualificar todos os objetos não pertencentes a pg_catalog, com revisão de funções auxiliares e operadores. Não alterar a função atual sem validar dependências e consumidores.

## 4. Limitações da Edge Function, mesmo com PR #38

O PR #38 melhora a redação de erros, mas mantém a lógica de sincronização original:

- GET /vehicles?limit=1000 não demonstra que toda a frota foi recebida. Não foi confirmada a paginação nem o limite máximo do fornecedor.
- /vehicles/status é tratado como uma única resposta; a completude e paginação não estão documentadas neste código.
- O cruzamento entre lista de viaturas e estados é feito por matrícula em memória, não por ID externo estável.
- Se houver matrículas repetidas ou alterações de matrícula, o Map pode selecionar um registo arbitrário ou não associar o estado correto.
- Não há validação explícita de IDs duplicados, datas inválidas, odómetros negativos, valores não finitos ou coerência do ID externo entre endpoints.
- Os campos raw completos do fornecedor continuam a ser enviados para a base de dados em viaturas e snapshots. A redação de erros não reduz a exposição/retensão do payload normal.
- O sucesso devolve o número de linhas recebidas/pedidas para gravação, não prova que todas as páginas da conta foram sincronizadas.
- A função continua a usar uma única conta global e o perfil de administrador global.

Não se deve implementar paginação por tentativa ou inferência: primeiro confirmar o contrato oficial CarTrack para paginação, cursores, limites, ordenação e completude.

## 5. Contrato recomendado para o futuro writer

A nova RPC deve ser desenhada para uma operação transacional e idempotente:

1. Receber uma referência de conta interna ou contexto de execução que só o servidor pode resolver; não aceitar company_id do browser como autoridade.
2. Resolver a conta ativa e empresa a partir do registo interno.
3. Validar que todos os IDs externos pertencem à conta e que o mapping ativo liga a uma viatura Fleet da mesma empresa.
4. Validar arrays, número máximo de elementos, campos permitidos, tipos, unidades, timestamps e limites numéricos antes de qualquer persistência.
5. Rejeitar IDs duplicados na mesma carga ou classificá-los de forma determinística; nunca escolher arbitrariamente.
6. Atualizar estado atual apenas se a observação for válida e não mais antiga; null não substitui uma leitura válida.
7. Inserir snapshots com chave única/idempotente baseada no identificador estável de observação do fornecedor, se existir. Se não existir, aprovar e testar uma chave derivada antes de a adotar.
8. Marcar sync completo apenas após confirmar todas as páginas e um checkpoint/manifesto de ingestão.
9. Fazer mapping, snapshot, odómetro e checkpoint na mesma transação, ou usar um desenho de staging + aplicação transacional com recuperação documentada.
10. Devolver apenas contagens e códigos estáveis; sem payload raw, credenciais, SQL ou identificadores internos.

A futura função privilegiada deve ter EXECUTE concedido apenas ao papel de integração necessário, não a PUBLIC, anon ou authenticated. Rever explicitamente privilégios por defeito e grants herdados. A função deve estar em schema não exposto se possível; se ficar em schema exposto, manter ACL mínima e testes de chamada direta.

## 6. Sequência segura de implementação

- [ ] Confirmar documentação oficial CarTrack sobre IDs, paginação, limites, status e identificadores de observação.
- [ ] Criar testes unitários puros para normalização/validação com fixtures sintéticas, sem credenciais nem chamadas de rede.
- [ ] Desenhar staging e RPC nova em SQL separado de qualquer migração aplicável.
- [ ] Validar FKs compostas, concorrência, rollback e idempotência numa base de dados descartável.
- [ ] Testar conta A, conta B, admin global, company_admin, driver e chamadas sem autenticação.
- [ ] Fazer análise de impacto dos consumidores antigos, incluindo frontend, RPC, dashboards e jobs.
- [ ] Planear migração/backfill sem associação automática dos 21 candidatos; manter 2 não correspondidos em quarentena.
- [ ] Só depois propor migração e deploy, com aprovação explícita.

## 7. Estado e limites

**Concluído nesta revisão:** inspeção estática da Edge Function no branch base e na alteração do PR #38; leitura read-only da definição e grants da RPC de produção; identificação dos riscos de chave, regressão de odómetro, duplicação de snapshots, ausência de mapping e completude de sync.

**Não executado:** nenhum SQL de alteração, nenhum teste integrado, nenhuma sincronização, nenhuma chamada à CarTrack, nenhum deploy, nenhuma alteração de segredo/grant/RLS.

**Bloqueio:** não existe ambiente descartável gratuito confirmado. Não será criado projeto/branch Supabase que possa gerar custos. A multiempresa continua bloqueada até existir mapping canónico, writer transacional e testes reais isolados.
