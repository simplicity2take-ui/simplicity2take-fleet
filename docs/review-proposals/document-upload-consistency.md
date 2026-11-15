# Revisão: consistência dos carregamentos documentais

## Situação observada
Em `app.js`, o ficheiro é carregado para o Google Drive antes da operação `documents.insert/update` no Supabase. Se a gravação SQL falhar, o ficheiro pode ficar sem referência. Depois de gravar o documento, a aplicação elimina e recria os registos `document_viewers` em pedidos separados. Uma falha entre essas operações podia deixar permissões incompletas. Na atualização de um documento existente, o ficheiro anterior pode continuar no Drive sem referência.

## Proteção já implementada no ramo de revisão
- Durante a edição de um documento, a interface mantém **apenas em memória** o identificador devolvido por um carregamento bem-sucedido no Drive. Se falhar a gravação no Supabase, um novo clique em «Guardar» no **mesmo formulário e com o mesmo ficheiro/destino** reutiliza o carregamento, sem enviar outra cópia.
- Se o registo `documents` já tiver sido criado mas a atualização dos visualizadores falhar, a repetição no mesmo formulário atualiza esse registo em vez de inserir outro.
- Se a resposta ao primeiro `documents.insert` se perder, uma nova tentativa consulta o identificador único `drive_file_id` antes de inserir de novo. Quando encontra o registo, atualiza-o; se a consulta falhar, interrompe a operação para não arriscar uma duplicação. Esta verificação só ocorre em novas tentativas do mesmo formulário e não substitui uma operação idempotente no servidor.
- Se o administrador escolher **outro ficheiro ou destino** após uma tentativa de inserção de resultado incerto, o Fleet confirma primeiro, através do `drive_file_id` anterior, se o registo já existe. Uma falha nesta consulta impede iniciar um novo upload; um registo já criado passa a ser atualizado em vez de gerar um duplicado. O nome da pasta Google Drive também faz parte da verificação para reutilizar um upload anterior.
- Se um ficheiro anterior ficar sem ligação após uma substituição, é mantido no Drive para análise administrativa: o Fleet não o elimina automaticamente.
- Os novos carregamentos de motoristas usam uma pasta com **nome legível e identificador único do registo do motorista**, para que dois motoristas com nomes iguais não partilhem a mesma pasta do Drive. Separadores de caminhos e caracteres de controlo são substituídos e o comprimento do nome é limitado. **Os ficheiros existentes não são movidos ou renomeados**. Se o nome de um motorista mudar, um carregamento posterior poderá criar outra pasta para o mesmo identificador; essa organização de pastas não concede, por si só, acesso aos documentos.
- A memória de tentativa é limpa quando o formulário volta a abrir ou quando a gravação e as permissões são concluídas. O limite do cliente está harmonizado com os 10 MB decimais do servidor.
- Esta recuperação **não é uma transação**, não persiste ao fechar/recarregar a página e não garante idempotência completa perante corridas, perda de sessão ou fecho da página. O ficheiro no Drive pode continuar sem referência nesses casos. As permissões de visualização são agora sincronizadas por diferenças: conservam-se os acessos inalterados, revogam-se apenas os acessos removidos e acrescentam-se apenas os novos ou anteriormente desativados. A tabela usa a chave `(document_id, driver_id)` e a escrita fica sujeita à RLS administrativa. Estas operações continuam separadas, pelo que uma falha pode deixar **parte** das alterações de acesso por concluir; a recuperação completa exige uma transação no servidor.

## Ligações diretas ao Google Drive — revisão 15/11/2026
- Numa consulta SQL **apenas de contagem**, os dois registos atualmente existentes em `public.documents` apresentavam tanto `drive_file_id` como `drive_web_view_link`. **Não foram consultados os conteúdos nem alteradas linhas**.
- Os novos carregamentos do Fleet já não pedem nem devolvem `webViewLink` na Edge Function `drive-upload`; os novos documentos ou substituições guardam `drive_web_view_link = NULL`. Editar apenas metadados preserva, por precaução, a ligação antiga sem a eliminar.
- A visualização do portal continua a usar `document-access`, que verifica sessão, estado e autorização antes de devolver o ficheiro. Uma ligação Google Drive antiga não é usada para abrir o documento na interface.
- **Limite importante:** eliminar a ligação textual de novos registos não prova que os ficheiros sejam privados: a partilha de cada ficheiro e pasta do Google Drive tem de ser auditada, e um identificador de ficheiro pode permitir reconstruir uma ligação direta. Não há neste PR alterações às ACLs/permissões do Drive nem limpeza dos registos existentes.
- Antes de qualquer alteração em produção, confirmar permissões de ficheiros e pastas e preparar revisão administrativa dos `drive_web_view_link` legados; não eliminar os URLs ou os ficheiros sem confirmação.

## Confirmar gravação não é o mesmo que atualizar o ecrã
Os portais distinguem agora a fase de **gravação** da atualização posterior dos dados. Se o Supabase ou o Google Drive já tiver confirmado a gravação, mas `loadBackendData()` ou `renderApp()` falharem, a interface indica que **as alterações foram guardadas, mas a lista não pôde ser atualizada**, recomendando atualizar a página. Não apresenta uma mensagem enganadora de falha na gravação, que poderia incentivar um novo carregamento duplicado.

O teste `document-modal-concurrency.test.cjs` simula falhas de atualização e de renderização para os dois portais, além das falhas de gravação genuínas. Não substitui reconciliação transacional no servidor.

## Proteção do formulário durante gravações assíncronas
As tentativas de gravação podem demorar enquanto o ficheiro segue para o Google Drive e os metadados e permissões são registados. Se o administrador abrisse outro formulário ou fechasse o anterior durante esse intervalo, a resposta tardia poderia fechar o formulário errado e perder o recibo de recuperação.

No ramo de revisão, enquanto `state.modalSaveInFlight` estiver ativo:
- `openModal` não substitui o formulário, nem apaga o recibo pendente;
- os botões de fechar/cancelar não dispensam o modal;
- o evento de `cancel` do diálogo (por exemplo, tecla Escape) é impedido;
- uma falha ao localizar o botão de guardar também liberta o bloqueio e mostra um erro controlado.

Terminada a tentativa, com sucesso ou erro, o formulário pode voltar a ser aberto e fechado normalmente. Os testes de concorrência cobrem estes estados para `app.js` e `teste/app.js`. **Limite:** esta proteção apenas cobre o mesmo portal e não evita duplicações entre browsers/sessões, nem substitui transações no servidor. O fecho completo da página ou perda de rede ainda podem deixar um carregamento por reconciliar.

## Prevenção de carregamentos simultâneos no formulário
O tratamento do envio de formulários passou a usar `state.modalSaveInFlight`, definido **sincronamente antes de ler o formulário e antes de qualquer pedido de rede**. Isto impede que uma segunda submissão do mesmo modal inicie outro carregamento enquanto o primeiro decorre; a mera desativação do botão não era suficiente para garantir essa exclusão.

O bloqueio é libertado tanto após sucesso como perante falha na gravação ou na própria leitura do formulário, permitindo uma nova tentativa explícita do administrador. A proteção foi implementada no portal principal e no portal de testes, com simulações de submissões concorrentes em `tests/document-modal-concurrency.test.cjs`. Não substitui idempotência do servidor, não abrange outras sessões/dispositivos e não impede duplicações após fechar e reabrir uma tentativa.

## Confirmação dos dados devolvidos pelo Google Drive
A Edge Function de upload passou a solicitar também `parents` e `size` no resultado de `files.create`. Antes de informar o navegador de que o carregamento teve sucesso, compara o nome, MIME, identificador, pasta principal e número exato de bytes com os valores submetidos. Em caso de divergência ou campos em falta devolve erro genérico (502) e **não confirma o carregamento ao Fleet**.

Esta medida evita registar um documento para uma pasta errada ou com tamanho inesperado. **Limite:** caso o Google tenha efetivamente criado o ficheiro antes de devolver metadados inesperados, pode ficar um ficheiro sem referência. A função não o elimina automaticamente. A recuperação administrativa e uma transação idempotente continuam pendentes.

Os testes `drive-upload-edge-runtime.test.cjs` simulam a resposta da API do Google, incluindo pasta e tamanho corretos, pasta errada, tamanho errado e metadados omissos. Não usam conta Google real nem comprovam o comportamento efetivo da conta de serviço do Fleet.

## Recuperar um carregamento quando a resposta do Google Drive se perde
O cliente e a Edge Function `drive-upload` utilizam agora um **identificador aleatório único por tentativa de ficheiro/destino**, criado no navegador antes de contactar o Drive. É enviado como `uploadId` e guardado no ficheiro pela conta de serviço na propriedade **privada** `appProperties.s2tUploadId`, sem tokens ou dados pessoais.

- Antes de efetuar um upload com `uploadId`, o servidor pesquisa se já existe **exatamente um ficheiro** com esse identificador na pasta correta. Se existir e coincidir o nome, formato e tamanho, devolve a referência anterior.
- Se o navegador não receber a resposta, mantém o identificador da operação **em memória no mesmo formulário**. Ao premir «Guardar» novamente, envia `recoverOnly=true`: o servidor procura o ficheiro anterior e **não cria outro ficheiro nem outra pasta**.
- Quando a pesquisa recupera um ficheiro único e coerente, prossegue a gravação SQL normal. Se não encontrar o ficheiro, houver duplicados, erro de pesquisa ou metadados incoerentes, a operação é interrompida. A escolha de outro ficheiro ou pasta durante essa incerteza também é bloqueada.
- Mantém-se suporte a pedidos antigos sem `uploadId`, que **não beneficiam desta proteção**. Os novos portais enviam o identificador.
- O índice de pesquisa do Drive pode ter atrasos; uma recuperação pode não encontrar de imediato um ficheiro efetivamente criado. Para não duplicar, o servidor **não repete automaticamente o upload**. O administrador deve rever a situação. O fecho/recarregamento da página perde o identificador em memória; esta solução **não é idempotência transacional entre browsers, sessões ou dispositivos**.

**Proteção contra abandono acidental:** se uma tentativa de upload ao Drive tiver uma resposta incerta, ou se já existir um ficheiro no Drive com gravação de metadados/visualizadores ainda pendente, os portais avisam antes de fechar o formulário (incluindo Escape e Cancelar) ou abrir outro. Recusar mantém o formulário e os identificadores temporários; confirmar abandona explicitamente a recuperação em memória e limpa as referências. A gravação em curso continua sempre bloqueada, sem possibilidade de interromper a meio. Os testes em `tests/document-modal-concurrency.test.cjs` cobrem ambos os tipos de pendência e os dois portais. **Limite:** o navegador não consegue garantir aviso em todos os casos de fecho forçado, falha ou recarregamento da página.

Não se criaram tabelas, migrações ou permissões adicionais. Os testes simulam perda de resposta, recuperação, ausência ou duplicação de ficheiros e verificação do identificador privado; não foram carregados ficheiros reais. Antes de publicar, deve validar-se a pesquisa por `appProperties` com a conta de serviço do Fleet num ambiente isolado.

## Proposta para implementação futura (não aplicada)
1. Gerar um identificador de operação idempotente no cliente, preservado em cada tentativa.
2. Criar um registo de operação pendente numa tabela com RLS administrativa, antes do upload. Guardar `document_id`, `drive_file_id`, estado e timestamps; nunca guardar conteúdo ou tokens.
3. Efetuar a atualização do documento e dos visualizadores numa transação de base de dados, idealmente por uma função RPC com autorização administrativa e validação do contexto.
4. Marcar a operação como concluída só após a transação. Se falhar, preservar o ficheiro no Drive, registar a pendência e disponibilizar recuperação administrativa; **não apagar automaticamente**.
5. Para substituições, preservar o ficheiro antigo até confirmar a transação; a limpeza futura exige revisão humana e confirmação de inexistência de referências.
6. Incluir testes de falha de upload, falha de gravação, falha de visualizadores, reenvio duplicado e substituição, sem usar dados de produção.

## Restrições
Este documento é apenas uma proposta de revisão. Não contém migrações executáveis, não altera RLS, não elimina ficheiros e não autoriza publicação. A implementação requer revisão das tabelas reais e aprovação explícita antes de qualquer mudança em produção.
