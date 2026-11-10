Cartrack sincroniza manualmente com sessão de administrador ativo, ou por tarefa interna autenticada.

O agendamento s2t-cartrack-four-daily verifica a hora de Lisboa a cada hora e envia pedidos apenas às 07h, 12h, 17h e 21h. A conversão Europe/Lisbon mantém estes horários nas mudanças de hora.

A credencial específica é gerada no servidor e guardada no Vault como cartrack_sync_job_key. Não é uma palavra-passe de utilizador nem a credencial Cartrack e não deve ser copiada para código, logs ou navegador. Só service_role pode chamar o verificador; apenas postgres pode executar o emissor private.enqueue_cartrack_sync.

A função faz duas consultas Cartrack por execução e guarda a lista e o estado atual. Isto não reconstrói percursos nem garante medições contínuas de tempo online/offline. A sincronização Bolt permanece independente.

Para verificar: consultar cron.job pelo nome da tarefa, cron.job_run_details para a execução SQL e net._http_response para o resultado HTTP (sem consultar cabeçalhos das filas). Confirmar success=true e last_synced_at atualizado. Uma execução SQL concluída apenas confirma o envio; é necessário verificar também a resposta HTTP.

Para pausar, um administrador da base pode usar cron.alter_job com active=false. A sincronização manual continua disponível.
