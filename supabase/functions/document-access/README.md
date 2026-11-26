# Document Access — Supabase Edge Function

This function is the server-side gateway for portal document access.

## Rules

- Drivers must never receive a public Google Drive URL.
- The function must authenticate the Supabase user and query the document through RLS.
- A document with `driver_id` set is private to that driver (plus admin).
- A vehicle document can be visible to drivers currently assigned to that vehicle.
- Google Drive files should remain non-public.
- The function should return the file through a private, non-cacheable response.

## Required Supabase secret

`GOOGLE_SERVICE_ACCOUNT_JSON`

The value is the complete Google service-account JSON credential. Never commit it to GitHub.

## Google Drive permission

The service account only needs the minimum Drive permission required by the deployed functions. For reading existing documents, use Drive read-only access where possible.

## Deployment

This source is intentionally stored in GitHub first. It is not deployed to Supabase automatically.

Before production deployment, verify:
1. the live database schema matches the migration;
2. the access-control migration has been executed;
3. the Edge Function is deployed;
4. `GOOGLE_SERVICE_ACCOUNT_JSON` is configured as a Supabase secret;
5. Drive folders/files are private;
6. a driver cannot open another driver's contract, even when both drivers use the same vehicle.

## Validação da entrega ao portal

A função entrega ao portal uma resposta privada com o conteúdo integral recebido, até 12 MiB, após verificar o tipo de ficheiro e a assinatura inicial de PDF, JPEG ou PNG. Uma resposta parcial do Drive ou uma interrupção da leitura devolve HTTP 502. Quando o tamanho anunciado se refere aos bytes sem compressão, a função confirma também que recebeu esse número de bytes. O limite aplica-se aos bytes efetivamente lidos, mesmo quando falta o cabeçalho de tamanho. Uma transferência acima do limite é cancelada e devolve HTTP 413.

Com Node 24, executar `node --test tests/document-access-runtime.test.cjs`. O teste percorre a função de leitura dos dois portais com ficheiros fictícios e respostas locais que simulam o Drive. Valida os bytes entregues e os erros de transporte. A abertura visual num dispositivo e as permissões da conta de serviço utilizada pela empresa exigem validação própria.
