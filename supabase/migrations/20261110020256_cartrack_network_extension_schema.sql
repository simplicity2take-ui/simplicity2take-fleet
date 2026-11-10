drop extension pg_net;
create extension pg_net with schema extensions;
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;
