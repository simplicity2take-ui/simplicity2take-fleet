# Revisão: consistência dos carregamentos documentais

## Situação observada
Em `app.js`, o ficheiro é carregado para o Google Drive antes da operação `documents.insert/update` no Supabase. Se a gravação SQL falhar, o ficheiro pode ficar sem referência. Depois de gravar o documento, a aplicação elimina e recria os registos `document_viewers` em pedidos separados. Uma falha entre essas operações podia deixar permissões incompletas. Na atualização de um documento existente, o ficheiro anterior pode continuar no Drive sem referência.

## Proteção já implementada no ramo de revisão
- Durante a edição de um documento, a interface mantém **apenas em memória** o identificador devolvido por um carregamento bem-sucedido no Drive. Se falhar a gravação no Supabase, um novo clique em «Guardar» no **mesmo formulário e com o mesmo ficheiro/destino** reutiliza o carregamento, sem enviar outra cópia.
- Se o registo `documents` já tiver sido criado mas a atualização dos visualizadores falhar, a repetição no mesmo formulário atualiza esse registo em vez de inserir outro.
- Se a resposta ao primeiro `documents.insert` se perder, uma nova tentativa consulta o identificador único `drive_file_id` antes de inserir de novo. Quando encontra o registo, atualiza-o; se a consulta falhar, interrompe a operação para não arriscar uma duplicação. Esta verificação só ocorre em novas tentativas do mesmo formulário e não substitui uma operação idempotente no servidor.
- A memória de tentativa é limpa quando o formulário volta a abrir ou quando a gravação e as permissões são concluídas. O limite do cliente está harmonizado com os 10 MB decimais do servidor.
- Esta recuperação **não é uma transação**, não persiste ao fechar/recarregar a página e não garante idempotência completa perante corridas, perda de sessão ou fecho da página. O ficheiro no Drive pode continuar sem referência nesses casos. As permissões de visualização são agora sincronizadas por diferenças: conservam-se os acessos inalterados, revogam-se apenas os acessos removidos e acrescentam-se apenas os novos ou anteriormente desativados. A tabela usa a chave `(document_id, driver_id)` e a escrita fica sujeita à RLS administrativa. Estas operações continuam separadas, pelo que uma falha pode deixar **parte** das alterações de acesso por concluir; a recuperação completa exige uma transação no servidor.

## Proposta para implementação futura (não aplicada)
1. Gerar um identificador de operação idempotente no cliente, preservado em cada tentativa.
2. Criar um registo de operação pendente numa tabela com RLS administrativa, antes do upload. Guardar `document_id`, `drive_file_id`, estado e timestamps; nunca guardar conteúdo ou tokens.
3. Efetuar a atualização do documento e dos visualizadores numa transação de base de dados, idealmente por uma função RPC com autorização administrativa e validação do contexto.
4. Marcar a operação como concluída só após a transação. Se falhar, preservar o ficheiro no Drive, registar a pendência e disponibilizar recuperação administrativa; **não apagar automaticamente**.
5. Para substituições, preservar o ficheiro antigo até confirmar a transação; a limpeza futura exige revisão humana e confirmação de inexistência de referências.
6. Incluir testes de falha de upload, falha de gravação, falha de visualizadores, reenvio duplicado e substituição, sem usar dados de produção.

## Restrições
Este documento é apenas uma proposta de revisão. Não contém migrações executáveis, não altera RLS, não elimina ficheiros e não autoriza publicação. A implementação requer revisão das tabelas reais e aprovação explícita antes de qualquer mudança em produção.
