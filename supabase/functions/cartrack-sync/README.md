Cartrack sincroniza manualmente com sessão de administrador ativo, ou por tarefa interna autenticada.

O agendamento s2t-cartrack-four-daily verifica a hora de Lisboa a cada hora e envia pedidos apenas às 07h, 12h, 17h e 21h. A conversão Europe/Lisbon mantém estes horários nas mudanças de hora.

A credencial específica é gerada no servidor e guardada no Vault como cartrack_sync_job_key. Não é uma palavra-passe de utilizador nem a credencial Cartrack e não deve ser copiada para código, logs ou navegador. Só service_role pode chamar o verificador; apenas postgres pode executar o emissor private.enqueue_cartrack_sync.

A função consulta a lista de viaturas e a lista de estados. Quando a CarTrack indica várias páginas em `meta.last_page`, percorre cada lista antes de guardar os dados. Isto não reconstrói percursos nem garante medições contínuas de tempo online/offline. A sincronização Bolt permanece independente.

Para verificar: consultar cron.job pelo nome da tarefa, cron.job_run_details para a execução SQL e net._http_response para o resultado HTTP (sem consultar cabeçalhos das filas). Confirmar success=true e last_synced_at atualizado. Uma execução SQL concluída apenas confirma o envio; é necessário verificar também a resposta HTTP.

Para pausar, um administrador da base pode usar cron.alter_job com active=false. A sincronização manual continua disponível.

## Validação da resposta CarTrack

O limite é de 100 páginas por lista. Uma página em falta, contagens contraditórias ou uma indicação de continuação sem página final confirmada interrompem a sincronização antes da gravação. As respostas simples com `data` continuam a ser aceites quando não há indicação de continuação. As páginas seguintes são pedidas ao mesmo endpoint CarTrack, mantendo os parâmetros de unidades e limite.

A sincronização compara as matrículas em maiúsculas e sem espaços nas extremidades. Uma matrícula repetida na mesma lista, ou identificadores de viatura contraditórios para a mesma matrícula, interrompem o lote antes da chamada a `sync_cartrack_data`. Uma lista vazia com `data: []` é válida. Uma resposta sem lista ou com formato inválido interrompe a sincronização.

A quilometragem e a velocidade aceitam números finitos não negativos, incluindo zero e representações decimais em texto. Uma leitura ausente ou em branco fica sem valor. Uma leitura malformada ou negativa interrompe o lote antes da gravação, incluindo quando pertence a uma matrícula presente apenas na lista de estados.

Um estado sem hora de leitura mantém os valores recebidos na viatura, com `event_ts` nulo. Só os estados com hora de observação entram no histórico usado para calcular os quilómetros diários. A resposta indica em `statusesWithoutEventTime` quantos estados com matrícula foram omitidos do histórico por falta dessa hora. Uma data inválida interrompe o lote. `last_synced_at` regista a hora da sincronização.

As falhas de leitura do fornecedor devolvem HTTP 502. Uma falha de gravação devolve HTTP 500. O campo `stage` identifica a etapa conhecida (`vehicles`, `status`, `validation` ou `database`). O corpo da resposta do fornecedor e os detalhes internos da base de dados ficam excluídos da mensagem.

Para verificar a sincronização manual, a agendada e a validação dos lotes com dados fictícios, executar `node --test tests/cartrack-{scheduler-auth,sync-validation}.test.cjs` em Bash com Node 24.
