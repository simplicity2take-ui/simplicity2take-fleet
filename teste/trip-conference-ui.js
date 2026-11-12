(function(root){
  'use strict';
  function create({client,getUser,escapeHtml,changed,getRange,today,getCartrack}){
    let version=0,busy=false,error='',result=null,day='',filter='',ownerId=null;
    const h=escapeHtml,norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const date=v=>new Date(v).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon'});
    const shownDate=v=>v===null?'Sem registo':date(v);
    function serviceDetails(row){
      const services=row.services||[];
      return `<details><summary>Ver ${services.length} ${services.length===1?'serviço':'serviços'}</summary><ol>${services.map(s=>`<li><strong>${s.platform==='uber'?'Uber':'Bolt'}</strong><br>Aceitação: ${h(shownDate(s.acceptedAt))}<br>Recolha: ${h(shownDate(s.pickupAt))}<br>Fim: ${h(shownDate(s.endedAt))}<p class="section-copy">${s.state==='partial'?'Consulta parcial: declaração por confirmar.':s.matches.length?s.acceptedAt===null&&s.pickupAt===null?'Declaração compatível com as horas disponíveis; início do serviço por confirmar.':'Declaração compatível com as horas disponíveis.':'Declaração por confirmar.'}</p>${s.matches.map(m=>`<p class="section-copy"><strong>${m.source==='app'?'Aplicação':'Formulário'}</strong><br>Entrada declarada: ${h(shownDate(m.entry))}<br>Saída declarada: ${h(shownDate(m.exit))}</p>`).join('')}</li>`).join('')}</ol></details>`;
    }
    function clear(){version++;busy=false;error='';result=null;day='';filter='';ownerId=null;}
    function render(){
      if(getUser()?.role!=='admin')return '';
      if(ownerId&&ownerId!==getUser()?.id)clear();
      const query=norm(filter),rows=(result?.groups||[]).filter(r=>!query||norm(r.driverName).includes(query)||norm(r.plate).includes(query));
      return `<article id="activity-conference" class="panel activity-section" tabindex="-1">
        <h2>Conferência de motoristas e viaturas</h2>
        <p class="section-copy">Serviços concluídos Uber/Bolt cruzados com as declarações de turno. Primeiro e último registo mostram atividade observada; não são horas de entrada e saída.</p>
        <div class="row-actions"><label>Dia em Lisboa <input id="tripConferenceDay" type="date" value="${h(day||today())}" max="${h(today())}"></label><label>Motorista ou matrícula <input id="tripConferenceFilter" type="search" value="${h(filter)}" placeholder="Ex.: Álvaro ou AC-85-ZT"></label><button type="button" class="secondary-button" data-trip-conference ${busy?'disabled':''}>${busy?'A conferir…':'Conferir viagens e turnos'}</button></div>
        ${error?`<p role="alert">${h(error)}</p>`:''}
        ${result?`<p class="section-copy" role="status">${result.completed} serviços concluídos identificados · ${rows.length} combinações apresentadas. ${result.partial?'Consulta parcial: há dados por receber.':'Todas as páginas da consulta recebidas.'} A cobertura das importações Uber/Bolt continua por confirmar.</p>
          ${result.excludedNonCompleted?`<p class="section-copy">${result.excludedNonCompleted} registos de pedidos, recusas ou cancelamentos não contam como serviços concluídos.</p>`:''}
          ${result.identityPending.length||result.undated||result.invalidTimes?`<p class="section-copy">${result.identityPending.length} serviços/registos com identidade por confirmar; ${result.undated} registos sem horas de serviço suficientes; ${result.invalidTimes} com horas inconsistentes.</p>`:''}
          <div class="table-wrap"><table><thead><tr><th>Motorista</th><th>Matrícula</th><th>Uber</th><th>Bolt</th><th>Primeiro registo de serviço</th><th>Último registo de serviço</th><th>Declarações</th><th>Cartrack</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${h(r.driverName)}</td><td><strong>${h(r.plate)}</strong></td><td>${r.uber}</td><td>${r.bolt}</td><td>${h(date(r.firstObserved))}</td><td>${h(date(r.lastObserved))}</td><td>${r.compatibleDeclarations} serviços com declaração compatível<br>${r.declarationPending} por confirmar${r.missingServiceStart?`<br><small>${r.missingServiceStart} sem hora de início do serviço</small>`:''}${r.missingServiceEnd?`<br><small>${r.missingServiceEnd} sem hora de fim do serviço</small>`:''}${serviceDetails(r)}</td><td>${r.cartrackMatches===1?'<a href="#activity-cartrack">Consultar leituras Cartrack</a>':r.cartrackMatches>1?'Correspondência Cartrack por confirmar':'Sem leituras na lista sincronizada'}<br><small>Quilómetros por turno na consulta Cartrack</small></td></tr>`).join('')||'<tr><td colspan="8">Sem serviços concluídos identificados nesta consulta e pesquisa. A ausência de registos não prova inatividade.</td></tr>'}</tbody></table></div>
          <p class="section-copy">Compatibilidade considera os dados horários disponíveis e declarações completas, sem conflitos, com tolerância de cinco minutos. Sem hora de início do serviço, a comparação cobre apenas os registos existentes. Declarações incompletas e turnos de teste não confirmam utilização operacional. Uma declaração por confirmar não prova um erro nem uma falta ao trabalho. As distâncias das viagens não são usadas como quilómetros da viatura.</p>`:''}
      </article>`;
    }
    async function load(options){
      const user=getUser();if(ownerId&&ownerId!==user?.id)clear();if(user?.role!=='admin'||!user.id||busy)return;
      const period=getRange(options.day);
      if(!period){error='Escolhe um dia válido até hoje.';changed();return;}
      ownerId=user.id;const epoch=++version;day=options.day;filter=String(options.filter||'').slice(0,200);busy=true;error='';result=null;changed();
      const current=()=>version===epoch&&getUser()?.id===user.id&&getUser()?.role==='admin';
      async function read(make){
        const rows=[],ids=new Set();let expected=null,partial=false;
        while(rows.length<5000){
          if(!current())throw Error('stale');
          const page=await make().range(rows.length,Math.min(rows.length+500,5000)-1);
          if(!current())throw Error('stale');
          if(page.error||!Array.isArray(page.data))throw Error('read_failed');
          if(Number.isInteger(page.count)){if(expected!==null&&expected!==page.count)partial=true;expected=page.count;}
          else partial=true;
          for(const r of page.data){if(ids.has(r.id))partial=true;ids.add(r.id);}
          rows.push(...page.data);
          if(!page.data.length||expected!==null&&rows.length>=expected)break;
        }
        return {rows,partial:partial||expected===null||expected!==rows.length};
      }
      try{
        const start=new Date(period.start).toISOString(),end=new Date(period.end).toISOString();
        const paddedStart=new Date(period.start-2*86400000).toISOString(),paddedEnd=new Date(period.end+2*86400000).toISOString();
        const tripDateFilter=['accepted_at','pickup_at','dropoff_at','finished_at','observed_at'].map(f=>`and(${f}.gte.${start},${f}.lt.${end})`).join(',');
        const [trips,events,native,drivers,vehicles]=await Promise.all([
          read(()=>client.from('platform_trip_records').select('id,platform,source_trip_id,driver_id,vehicle_id,platform_driver_uuid,platform_vehicle_uuid,vehicle_plate,order_status,accepted_at,pickup_at,dropoff_at,finished_at,observed_at',{count:'exact'}).in('platform',['uber','bolt']).or(tripDateFilter).order('id')),
          read(()=>client.from('vehicle_shift_events').select('id,driver_id,vehicle_id,driver_name,vehicle_plate,event_kind,registered_at,source_row,review_flags',{count:'exact'}).gte('registered_at',paddedStart).lt('registered_at',paddedEnd).order('registered_at').order('id')),
          read(()=>client.from('driver_shift_sessions').select('id,driver_id,vehicle_id,started_at,ended_at,closure_kind,is_test',{count:'exact'}).gte('started_at',paddedStart).lt('started_at',paddedEnd).order('id')),
          read(()=>client.from('drivers').select('id,full_name,uber_driver_uuid,bolt_driver_uuid',{count:'exact'}).order('id')),
          read(()=>client.from('vehicles').select('id,plate,uber_vehicle_uuid,bolt_vehicle_uuid',{count:'exact'}).order('id'))
        ]);
        if(!current())return;
        result=root.TripConference.summarize({trips:trips.rows,events:events.rows,nativeSessions:native.rows,drivers:drivers.rows,vehicles:vehicles.rows,cartrack:getCartrack(),start:period.start,end:period.end,partial:[trips,events,native,drivers,vehicles].some(p=>p.partial)});
      }catch{if(current())error='Não foi possível conferir os dados. Atualiza a consulta para tentar novamente.';}
      finally{if(current()){busy=false;changed();}}
    }
    return {render,load,clear};
  }
  root.TripConferencePortal={create};
})(typeof globalThis==='undefined'?this:globalThis);
