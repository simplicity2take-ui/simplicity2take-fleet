(function(root){
 'use strict';
 function create({client,getUser,escapeHtml,changed,visible=()=>true}){
   let rows=[],selected=null,error='',busy=false,loaded=false,loadVersion=0;
   const h=escapeHtml,date=value=>value?new Date(value).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon'}):'Em curso';
   const active=()=>rows.find(r=>!r.ended_at);
   const notices={test_shift:'Turno de teste',admin_closure_requires_review:'Encerramento administrativo: saída real por confirmar',trip_identity_conflict:'Identificadores do motorista em conflito',trip_vehicle_identity_conflict:'Identificadores da viatura em conflito',shift_duration_review:'Duração do turno a rever',trip_vehicle_mismatch:'Viatura diferente nas viagens',trip_driver_mismatch:'Outro motorista nas viagens da viatura',trip_driver_unconfirmed:'Motorista de viagem por confirmar',trip_crosses_shift_boundary:'Viagem atravessa o limite do turno',undated_driver_trips:'Viagens sem hora confirmada',partial_trip_history:'Histórico de viagens parcial',platform_coverage_unconfirmed:'Cobertura Uber/Bolt por confirmar',open_shift_overdue:'Turno aberto há mais de 18 horas'};
   function checks(row){
     const review=row.trip_review||{},km=row.cartrack_review||{};
     const flags=(review.flags||[]).map(f=>notices[f]||'Dados por conferir');
     const distance=typeof km.distance==='number'?`${km.distance.toFixed(2)} km entre leituras Cartrack`:'Quilómetros Cartrack por confirmar';
     return `<strong>${h(distance)}</strong>${km.start&&km.end?`<p class="section-copy">Desvio das leituras: ${Math.round(km.start.gapSeconds)} s / ${Math.round(km.end.gapSeconds)} s.</p>`:''}${km.refresh_state==='pending'?'<p class="section-copy">Leituras Cartrack anteriores; atualização pendente.</p>':''}<p class="section-copy">${h(review.state==='review'?'Requer revisão':review.state==='checked_available_data'?'Dados recebidos conferidos':'Conferência automática pendente')}. ${h(flags.join(' · '))}</p>`;
   }
   async function load(){
     const user=getUser(),version=++loadVersion;if(!user?.id)return;
     let result;
     try{result=await client.from('driver_shift_sessions').select('*').order('started_at',{ascending:false}).limit(user.role==='admin'?100:20);}
     catch{result={error:true};}
     if(getUser()?.id!==user.id||version!==loadVersion)return;
     if(result.error||!Array.isArray(result.data)){error='Não foi possível consultar os turnos. Tenta atualizar novamente.';rows=[];loaded=false;}
     else{rows=result.data||[];loaded=true;error='';}
     changed();
   }
   async function lookup(value){
     if(busy)return;const user=getUser();if(user?.role!=='driver')return;
     selected=null;
     const token=NativeShifts.qrToken(value,window.location.origin);
     if(!token){error='Lê o QR da viatura ou cola o endereço completo do QR.';changed();return;}
     busy=true;error='';changed();
     try{const {data,error:e}=await client.rpc('fleet_shift_vehicle',{p_token:token});if(e||!data?.id||!data?.plate)throw Error('Invalid vehicle');if(getUser()?.id!==user.id)return;selected={...data,token};}
     catch(e){if(getUser()?.id===user.id)error=e?.message==='SHIFT_ACCESS_REQUIRED'?'O acesso aos turnos ainda não foi ativado para esta conta.':'Não foi possível reconhecer a viatura. Confirma o QR e a ligação.';}
     finally{busy=false;changed();}
   }
   function request(action,token,shiftId){
     const key='fleet-shift-request:'+getUser().id;let saved;
     try{saved=JSON.parse(sessionStorage.getItem(key));}catch{}
     if(saved?.action!==action||saved?.token!==token||saved?.shiftId!==shiftId)saved={action,token,shiftId,id:crypto.randomUUID()};
     try{sessionStorage.setItem(key,JSON.stringify(saved));}catch{}return {key,id:saved.id};
   }
   async function submit(action){
     const user=getUser();if(busy||user?.role!=='driver'||!loaded)return;
     if(!navigator.onLine){error='Sem ligação. O turno só fica registado após confirmação do servidor.';changed();return;}
     const open=active();if(action==='start'&&(!selected||open))return;if(action==='end'&&!open)return;
     const pending=request(action,action==='start'?selected.token:null,action==='end'?open.id:null);
     busy=true;error='';changed();
     try{
       const {data,error:e}=await client.rpc(action==='start'?'fleet_shift_start':'fleet_shift_end',action==='start'?{p_token:selected.token,p_request_id:pending.id}:{p_shift_id:open.id,p_request_id:pending.id});
       if(e)throw e;if(!data?.id)throw Error('Missing confirmation');
       try{sessionStorage.removeItem(pending.key);}catch{}if(getUser()?.id!==user.id)return;
       await load();
     }catch{if(getUser()?.id===user.id){await load();error='O pedido não foi confirmado. Atualiza os turnos antes de tentar novamente. Pode existir um turno já aberto ou a viatura estar ocupada.';}}
     finally{busy=false;changed();}
   }
   async function adminClose(shiftId,note){
     const user=getUser();if(busy||user?.role!=='admin')return;
     if(!note||note.trim().length<8||note.trim().length>500){error='Indica um motivo entre 8 e 500 caracteres.';changed();return;}
     const pending=request('admin_close',null,shiftId);busy=true;error='';changed();
     try{
       const {data,error:e}=await client.rpc('fleet_shift_admin_close',{p_shift_id:shiftId,p_request_id:pending.id,p_note:note.trim()});
       if(e||!data?.id)throw Error('not_confirmed');
       try{sessionStorage.removeItem(pending.key);}catch{}
       if(getUser()?.id===user.id)await load();
     }catch{if(getUser()?.id===user.id){await load();error='Encerramento não confirmado. Confirma os registos apresentados antes de repetir.';}}
     finally{busy=false;changed();}
   }
   function render(){
     const open=active();
     const overdue=open&&Date.now()-Date.parse(open.started_at)>18*3600000;
     const instruction=/\/teste\//.test(window.location.pathname||'')?'No piloto, cola aqui a ligação do QR existente. O QR impresso continua a abrir a aplicação principal.':'Abre a câmara do telemóvel e lê o QR da viatura. Também podes colar aqui o endereço do QR.';
     return `<section class="panel native-shift-panel"><span class="eyebrow">O meu turno</span><h2>${!loaded?'Turno por confirmar':open?'Turno em curso':'Pronto para começar'}</h2>
       <p class="section-copy">Regista a entrada e a saída no momento da troca. Os quilómetros são consultados exclusivamente na Cartrack.</p>
       ${error?`<p role="alert">${h(error)}</p>`:''}
       ${open?`<h3>${h(open.vehicle_plate)}</h3>${open.is_test?'<p class="section-copy">Turno de teste</p>':''}<p>Entrada confirmada: <strong>${h(date(open.started_at))}</strong></p>${overdue?'<p role="alert">Este turno está aberto há mais de 18 horas. Confirma a saída com o administrador se não corresponde à situação atual.</p>':''}<button class="primary-button" type="button" data-native-shift-end ${busy?'disabled':''}>${busy?'A confirmar…':'Terminar turno'}</button>`:
       `<p>${h(instruction)}</p><label>QR da viatura<input id="nativeShiftQr" type="text" inputmode="url" autocomplete="off" placeholder="Colar endereço do QR" value="${h(selected?.token||'')}"></label><button class="secondary-button" type="button" data-native-shift-lookup ${busy?'disabled':''}>Reconhecer viatura</button>${selected?`<h3>${h(selected.plate)}</h3>${selected.is_test?'<p class="section-copy">Registo em modo de teste</p>':''}<p>${h(selected.brand||'')} ${h(selected.model||'')}</p><button class="primary-button" type="button" data-native-shift-start ${busy||!loaded?'disabled':''}>${busy?'A confirmar…':'Iniciar turno'}</button>`:''}`}
       <button class="secondary-button" type="button" data-native-shift-refresh ${busy?'disabled':''}>Atualizar turnos</button>
       <p class="section-copy">A hora é confirmada pelo servidor. Se a ligação falhar, atualiza para confirmar se o pedido ficou registado. Não introduzas quilómetros manualmente.</p></section>
       <section class="panel"><h2>Os meus últimos turnos</h2>${history()}</section>`;
   }
   function history(){return `<div class="table-wrap"><table><thead><tr><th>Motorista / viatura</th><th>Entrada</th><th>Saída</th><th>Conferência automática</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${h(r.driver_name)}${r.is_test?'<p class="section-copy">Turno de teste</p>':''}<br><strong>${h(r.vehicle_plate)}</strong></td><td>${h(date(r.started_at))}</td><td>${h(date(r.ended_at))}${r.closure_kind==='admin'?`<p class="section-copy">Encerramento administrativo; não confirma a saída real.<br>${h(r.closure_note||'')}</p>`:''}</td><td>${checks(r)}${getUser()?.role==='admin'&&!r.ended_at?`<button class="secondary-button" type="button" data-native-shift-admin-close="${h(r.id)}" ${busy?'disabled':''}>Encerrar com motivo</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">Sem turnos carregados.</td></tr>'}</tbody></table></div>`;}
   function adminPanel(){return `<article class="panel"><h2>Turnos registados no Fleet</h2><p class="section-copy">Últimos 100 turnos da aplicação. Conferência automática de viagens Uber/Bolt e leituras Cartrack; dados incompletos ficam por confirmar. Os registos do formulário Google mantêm-se separados.</p><button class="secondary-button" type="button" data-native-shift-refresh>Atualizar turnos Fleet</button>${error?`<p role="alert">${h(error)}</p>`:''}${history()}</article>`;}
   function clear(){loadVersion++;rows=[];selected=null;error='';busy=false;loaded=false;}
   if(typeof root.setInterval==='function')root.setInterval(()=>{if(!busy&&getUser()?.id&&visible()&&root.document?.visibilityState==='visible')void load();},60000);
   return {load,lookup,submit,adminClose,render,adminPanel,clear};
 }
 root.NativeShiftPortal={create};
})(globalThis);
