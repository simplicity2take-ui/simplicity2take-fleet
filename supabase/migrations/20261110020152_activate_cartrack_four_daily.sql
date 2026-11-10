revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;
select cron.schedule('s2t-cartrack-four-daily','0 * * * *','select private.enqueue_cartrack_sync();');
