import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import "./native-shifts.js";
import "./shift-mileage.js";

// A scoped server job invokes this endpoint. It never changes the declared shift.
Deno.serve(async(req)=>{
 const respond=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 if(req.method!=='POST')return respond(405,{success:false});
 const key=req.headers.get('x-cartrack-sync-key');
 if(!key)return respond(401,{success:false});
 const url=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const db=createClient(url,secret,{auth:{persistSession:false}});
 const allowed=await db.rpc('verify_cartrack_sync_key',{candidate:key});
 if(allowed.error||allowed.data!==true)return respond(403,{success:false});
 const since=new Date(Date.now()-7*86400000).toISOString();
 const began=Date.now();
 const queue=await db.from('driver_shift_sessions').select('*').or(`ended_at.gte.${since},ended_at.is.null,reviewed_at.is.null`)
   .lte('next_review_at',new Date().toISOString()).order('next_review_at').order('id').limit(10);
 if(queue.error)return respond(503,{success:false,error:'shift_queue_unavailable'});
 let reviewed=0,failed=0,skipped=0;
 for(const shift of queue.data||[]){
   if(Date.now()-began>120000)break;
   try{
     const checked=new Date().toISOString();
     if(!shift.ended_at){
       const flags=['platform_coverage_unconfirmed'];
       if(Date.now()-Date.parse(shift.started_at)>18*3600000)flags.push('open_shift_overdue');
       const next=new Date(Math.max(Date.now()+6*3600000,Date.parse(shift.started_at)+18*3600000)).toISOString();
       const saved=await db.from('driver_shift_sessions').update({trip_review:{state:'pending',flags},reviewed_at:checked,next_review_at:next}).eq('id',shift.id).eq('next_review_at',shift.next_review_at).is('ended_at',null).select('id');
       if(saved.error)throw Error('save_failed');if(saved.data?.length===1)reviewed++;else skipped++;continue;
     }
     const driver=await db.from('drivers').select('id,uber_driver_uuid,bolt_driver_uuid').eq('id',shift.driver_id).single();
     if(driver.error||!driver.data)throw Error('driver_unavailable');
     const a=new Date(Date.parse(shift.started_at)-15*60000).toISOString(),b=new Date(Date.parse(shift.ended_at)+15*60000).toISOString();
     const trips:any[]=[];let tripPartial=false;
     const filters=['accepted_at','pickup_at','dropoff_at','finished_at'].map(field=>`and(${field}.gte.${a},${field}.lte.${b})`);
     filters.push(`and(accepted_at.lte.${b},finished_at.gte.${a})`,`and(pickup_at.lte.${b},dropoff_at.gte.${a})`);
     let total:number|null=null;
     while(trips.length<5000){
       const page=await db.from('platform_trip_records').select('*',{count:'exact'}).in('platform',['uber','bolt']).or(filters.join(','))
         .order('id').range(trips.length,Math.min(trips.length+500,5000)-1);
       if(page.error)throw Error('trip_history_unavailable');total=page.count??total;
       if(!page.data?.length)break;trips.push(...page.data);if(total!==null&&trips.length>=total)break;
     }
     tripPartial=total===null||total>trips.length;
     const tripReview=(globalThis as any).NativeShifts.reviewTrips(shift,trips,driver.data,tripPartial);
     let cartrackReview:any={state:'pending',reason:'missing_history'};
     // Excessively old open/late shifts remain reviewable without an unbounded API query.
     if(Date.parse(b)-Date.parse(a)<=31*86400000){
       try{
         const history:any[]=[];let complete=false;let expected:number|null=null;
         for(let page=1;page<=3;page++){
           const response=await fetch(url+'/functions/v1/cartrack-history',{method:'POST',headers:{'Content-Type':'application/json','x-cartrack-sync-key':key},body:JSON.stringify({start:a,end:b,page}),signal:AbortSignal.timeout(50000)});
           if(!response.ok)throw Error('history_failed');const payload=await response.json();
           if(payload.success!==true||!Array.isArray(payload.trips))throw Error('invalid_history');
           history.push(...payload.trips);expected=Number.isInteger(payload.meta?.total)?payload.meta.total:expected;
           const last=Number(payload.meta?.last_page);
           if(Number.isInteger(last)&&last>0&&last===page){complete=true;break;}
         }
         const unique=new Set(history.map(t=>String(t.id)));
         if(unique.size!==history.length||(expected!==null&&expected!==history.length))complete=false;
         const result=(globalThis as any).ShiftMileage.mileage((globalThis as any).NativeShifts.session(shift),history,!complete);
         cartrackReview={...result,state:result.distance===null?'pending':'calculated',source:'cartrack',confirmed_at:result.distance===null?null:checked};
       }catch{cartrackReview={state:'pending',reason:'history_unavailable',source:'cartrack'};}
     }
     const old=shift.cartrack_review;
     if(['history_unavailable','partial_history'].includes(cartrackReview.reason)&&old?.state==='calculated'&&old.source==='cartrack'&&Number.isFinite(old.distance)&&shift.closure_kind!=='admin'){
       cartrackReview={...old,refresh_state:'pending',refresh_reason:cartrackReview.reason,refresh_checked_at:checked};
     }
     const delay=tripReview.state==='pending'||cartrackReview.state==='pending'||cartrackReview.refresh_state==='pending'?3600000:24*3600000;
     const saved=await db.from('driver_shift_sessions').update({trip_review:tripReview,cartrack_review:cartrackReview,reviewed_at:checked,next_review_at:new Date(Date.now()+delay).toISOString()})
       .eq('id',shift.id).eq('ended_at',shift.ended_at).eq('next_review_at',shift.next_review_at).select('id');
     if(saved.error)throw Error('save_failed');if(saved.data?.length===1)reviewed++;else skipped++;
   }catch{failed++;await db.from('driver_shift_sessions').update({next_review_at:new Date(Date.now()+3600000).toISOString()}).eq('id',shift.id).eq('next_review_at',shift.next_review_at);}
 }
 return respond(failed?503:200,{success:failed===0,reviewed,failed,skipped});
});
