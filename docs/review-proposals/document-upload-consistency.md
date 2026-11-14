# Revisão: consistência dos carregamentos documentais

## Situação observada
Em `app.js`, o ficheiro é carregado para o Google Drive antes da operação `documents.insert/update` no Supabase. Se a gravação SQL falhar, o ficheiro pode ficar sem referência. Depois de gravar o documento, a aplicação elimina e recria os registos `document_viewers` em pedidos separados. Uma falha entre essas operações pode deixar permissões incompletas. Na atualização de um documento existente, o ficheiro anterior pode continuar no Drive sem referência.

## Proposta para implementação futura (não aplicada)
1. Gerar um identificador de operação idempotente no cliente, preservado em cada tentativa.
2. Criar um registo de operação pendente numa tabela com RLS administrativa, antes do upload. Guardar `document_id`, `drive_file_id`, estado e timestamps; nunca guardar conteúdo ou tokens.
3. Efetuar a atualização do documento e dos visualizadores numa transação de base de dados, idealmente por uma função RPC com autorização administrativa e validação do contexto.
4. Marcar a operação como concluída só após a transação. Se falhar, preservar o ficheiro no Drive, registar a pendência e disponibilizar recuperação administrativa; **não apagar automaticamente**.
5. Para substituições, preservar o ficheiro antigo até confirmar a transação; a limpeza futura exige revisão humana e confirmação de inexistência de referências.
6. Incluir testes de falha de upload, falha de gravação, falha de visualizadores, reenvio duplicado e substituição, sem usar dados de produção.

## Restrições
Este documento é apenas uma proposta de revisão. Não contém migrações executáveis, não altera RLS, não elimina ficheiros e não autoriza publicação. A implementação requer revisão das tabelas reais e aprovação explícita antes de qualquer mudança em produção.
