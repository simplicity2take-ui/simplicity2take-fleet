# CarTrack — comparação entre função publicada e correção proposta

**Classificação: revisão de segurança prioritária.** Consulta read-only da Edge Function ativa em 30-10-2026. Não houve invocação da função, alteração de configuração, segredo ou deploy.

## 1. Função efetivamente publicada

A leitura da função Supabase cartrack-sync devolveu:

- Estado: ACTIVE.
- Versão publicada: 8.
- verify_jwt: true.
- CORS: Access-Control-Allow-Origin: *.
- A função usa SUPABASE_SERVICE_ROLE_KEY para escrever através de sync_cartrack_data.
- O código publicado não valida Authorization com auth.getUser(), não consulta profiles e não exige role=admin/status=Ativo antes de chamar o fornecedor e a RPC.
- O código publicado devolve corpos de erro HTTP da CarTrack, até 1.000 caracteres.
- O catch devolve a mensagem de erro da exceção ao cliente e responde com HTTP 200, mesmo quando success=false.

## 2. Impacto

verify_jwt=true valida a presença/validade do JWT na camada de gateway, mas não equivale a autorização de administrador. No código publicado consultado, não existe verificação adicional de perfil/role antes de usar a service role e as credenciais CarTrack.

Isto significa que a fronteira de autorização da função publicada é mais ampla do que a pretendida para uma operação administrativa. Um utilizador autenticado que consiga invocar a função poderá tentar desencadear uma sincronização CarTrack, embora não receba diretamente a service key.

CORS '*' permite chamadas a partir de qualquer origem de browser; CORS não é autenticação nem autorização e não bloqueia clientes não-browser. O problema principal é a falta de autorização por perfil dentro da função.

A exposição de corpos de erro do fornecedor e mensagens de exceção pode divulgar detalhes operacionais. O HTTP 200 em falhas também torna a monitorização e tratamento de erros ambíguos.

## 3. Comparação com o PR #38

O PR #38, ainda em draft e não publicado no momento da revisão, introduz melhorias relevantes:

- valida o JWT com auth.getUser();
- verifica em profiles que o utilizador é admin e Ativo;
- limita a origem browser ao domínio Fleet esperado;
- deixa de devolver corpos de erro do fornecedor e mensagens SQL/PostgREST;
- deixa de registar objetos de erro completos;
- devolve erro genérico e HTTP 500 para falhas internas.

O PR #38 é uma correção parcial importante para a fronteira de autorização e redação de erros, mas não corrige a integridade da sincronização: matrícula como chave, ausência de mapping canónico, possível regressão de odómetro, snapshots não idempotentes, payload raw e paginação/completude ainda por confirmar.

## 4. Ação segura recomendada

1. Tratar a diferença entre versão publicada e PR #38 como prioridade de segurança.
2. Rever o PR #38 e executar testes estáticos/runtime num ambiente seguro antes da publicação.
3. Confirmar que apenas o administrador global ativo consegue invocar a função e que utilizadores autenticados comuns recebem 403 sem qualquer chamada ao fornecedor ou RPC.
4. Confirmar que erros de fornecedor/SQL nunca aparecem no body nem nos logs.
5. Após aprovação explícita, publicar a correção isolada de autorização/redação, sem misturar a migração multiempresa.
6. Depois do deploy autorizado, voltar a ler a versão ativa e testar a autorização sem executar uma sincronização real.
7. Só numa fase separada redesenhar o writer, mapping, idempotência e isolamento multiempresa.

## 5. Limites e estado

- A função ativa foi apenas lida; não foi invocada.
- Nenhuma credencial foi lida ou apresentada.
- Nenhum segredo foi alterado.
- Nenhuma função foi publicada, desativada ou configurada.
- Nenhuma tabela, RPC, grant ou política foi alterada.
- O PR #38 continua draft e não foi publicado.

**Nota operacional:** até a correção ser revista, testada e publicada com aprovação, considerar que a função ativa não demonstra autorização por perfil no próprio código. Não partilhar o endpoint como funcionalidade administrativa aberta nem executar sincronizações a partir de sessões de utilizadores comuns.
