(function (root) {
  'use strict';
  const plateKey = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function timestamp(value) {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) return null;
    const time=Date.parse(value.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
    return Number.isFinite(time) ? time : null;
  }
  function sessions(events) {
    const open=new Map(), result=[];
    const rows=[...events].sort((a,b)=>(timestamp(a.registered_at)??Infinity)-(timestamp(b.registered_at)??Infinity)||Number(a.source_row)-Number(b.source_row));
    for (const row of rows) {
      const key=row.driver_id && row.vehicle_id ? `${row.driver_id}|${row.vehicle_id}` : null;
      if (!key || timestamp(row.registered_at)===null || !['entry','exit'].includes(row.event_kind)) {
        result.push({entry:row.event_kind==='entry'?row:null,exit:row.event_kind==='exit'?row:null,flags:['unconfirmed_identity_or_date']}); continue;
      }
      if (row.event_kind==='entry') {
        if (open.has(key)) result.push({entry:open.get(key),exit:null,flags:['missing_exit','repeated_entry']});
        open.set(key,row);
      } else if (open.has(key)) {
        const entry=open.get(key);open.delete(key);
        const duration=timestamp(row.registered_at)-timestamp(entry.registered_at);
        result.push({entry,exit:row,flags:duration<=0||duration>36*3600000?['invalid_or_long_shift']:[]});
      } else result.push({entry:null,exit:row,flags:['missing_entry']});
    }
    for (const entry of open.values()) result.push({entry,exit:null,flags:['missing_exit']});
    // A new entry can contradict an earlier pair even if it has no closing exit.
    // Keep the declared events, but withhold mileage until the conflict is reviewed.
    for (const session of result) {
      if (session.entry?.review_flags?.length || session.exit?.review_flags?.length) {
        session.flags.push('source_review_pending');
      }
      if (!session.entry || !session.exit) continue;
      const start=timestamp(session.entry.registered_at), end=timestamp(session.exit.registered_at);
      const conflict=rows.some(row=>{
        const at=timestamp(row.registered_at);
        if(row.event_kind!=='entry'||at===null||at<start||at>=end)return false;
        const sameDriver=row.driver_id && row.driver_id===session.entry.driver_id;
        const plate=plateKey(row.vehicle_plate);
        const sameVehicle=(row.vehicle_id && row.vehicle_id===session.entry.vehicle_id) || (plate && plate===plateKey(session.entry.vehicle_plate));
        return (sameDriver && !sameVehicle) || (sameVehicle && row.driver_id!==session.entry.driver_id);
      });
      if(conflict)session.flags.push('conflicting_entry');
    }
    const intervals = result.filter(session => session.entry && session.exit).map(session => ({
      session,
      start: timestamp(session.entry.registered_at),
      end: timestamp(session.exit.registered_at),
      driver: session.entry.driver_id,
      vehicle: session.entry.vehicle_id,
      plate: plateKey(session.entry.vehicle_plate)
    })).filter(interval => interval.start < interval.end).sort((a, b) => a.start - b.start);
    for (let i = 0; i < intervals.length; i++) {
      const a = intervals[i];
      for (let j = i + 1; j < intervals.length; j++) {
        const b = intervals[j];
        if (b.start >= a.end) break;
        if (a.driver !== b.driver && a.vehicle !== b.vehicle && !(a.plate && a.plate === b.plate)) continue;
        for (const { session } of [a, b]) {
          if (!session.flags.includes('overlapping_shift')) session.flags.push('overlapping_shift');
        }
      }
    }
    return result.sort((a,b)=>(timestamp(a.entry?.registered_at||a.exit?.registered_at)??Infinity)-(timestamp(b.entry?.registered_at||b.exit?.registered_at)??Infinity));
  }
  function vehicleReadings(trips, registration) {
    const readings = [];
    if (!registration) return readings;
    for (const trip of trips) {
      if (plateKey(trip.registration) !== registration) continue;
      for (const [date, km] of [[trip.start, trip.startOdometerKm], [trip.end, trip.endOdometerKm]]) {
        const at = timestamp(date);
        if (at !== null && Number.isFinite(km) && km >= 0) readings.push({at, km});
      }
    }
    return readings;
  }

  function nearestReading(readings, target, toleranceMs = 15 * 60000) {
    const time = timestamp(target);
    if (time === null) return null;
    let nearest = null, ambiguous = false;
    for (const {at, km} of readings) {
      const gap = Math.abs(at - time);
      if (gap > toleranceMs) continue;
      if (!nearest || gap < nearest.gap) {
        nearest = {at, km, gap};
        ambiguous = false;
      } else if (gap === nearest.gap && (at !== nearest.at || km !== nearest.km)) {
        ambiguous = true;
      }
    }
    if (!nearest || ambiguous) return null;
    return {at: nearest.at, km: nearest.km, gapSeconds: nearest.gap / 1000};
  }

  function reading(trips, plate, target, toleranceMs) {
    return nearestReading(vehicleReadings(trips, plateKey(plate)), target, toleranceMs);
  }
  function mileage(session,trips,partial=false) {
    if(partial||session.flags.length||!session.entry||!session.exit)return {start:null,end:null,distance:null,reason:partial?'partial_history':'incomplete_shift'};
    const entryPlate = plateKey(session.entry.vehicle_plate);
    const exitPlate = plateKey(session.exit.vehicle_plate);
    if (entryPlate && exitPlate && entryPlate !== exitPlate) {
      return {start:null,end:null,distance:null,reason:'inconsistent_readings'};
    }
    const readings = vehicleReadings(trips, entryPlate || exitPlate);
    const start = entryPlate ? nearestReading(readings, session.entry.registered_at) : null;
    const end = exitPlate ? nearestReading(readings, session.exit.registered_at) : null;
    if (!start || !end) return {start, end, distance:null, reason:'missing_reading'};
    const interval = readings.filter(sample => sample.at >= start.at && sample.at <= end.at)
      .sort((a, b) => a.at - b.at);
    const inconsistent = interval.some((sample, i) => {
      if (i === 0) return false;
      const previous = interval[i - 1];
      return sample.km < previous.km || (sample.at === previous.at && sample.km !== previous.km);
    });
    if (end.at <= start.at || inconsistent) return {start, end, distance:null, reason:'inconsistent_readings'};
    return {start,end,distance:end.km-start.km,reason:null};
  }
  // Track one CarTrack query across pages before trusting either odometer boundary.
  function historyPagination() {
    const ids = new Set();
    let lastPage, total;
    function integer(value) {
      if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return NaN;
      const n = Number(value);
      return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
    }
    return function check(page, payload, allowShortPage = false) {
      const meta = payload.meta || {};
      const last = meta.last_page == null ? null : integer(meta.last_page);
      if (page === 1) lastPage = last;
      if (last !== lastPage || (last !== null && last < page)) return 'partial';
      if (meta.current_page != null && integer(meta.current_page) !== page) return 'partial';
      if (meta.total != null) {
        const count = integer(meta.total);
        if (!Number.isFinite(count) || (total !== undefined && total !== count)) return 'partial';
        total = count;
      }
      for (const trip of payload.trips) {
        const id = trip?.id;
        if (!(typeof id === 'string' && id.trim()) && !Number.isSafeInteger(id)) return 'partial';
        const key = String(id).trim();
        if (ids.has(key)) return 'partial';
        ids.add(key);
      }
      if (total !== undefined && ids.size > total) return 'partial';
      if (last === null && !allowShortPage) return 'partial';
      const finished = last === null ? payload.trips.length < 1000 : page === last;
      if (finished) return total === undefined || ids.size === total ? 'complete' : 'partial';
      return payload.trips.length ? 'next' : 'partial';
    };
  }
  const api={sessions,reading,mileage,timestamp,historyPagination};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ShiftMileage=api;
})(typeof globalThis==='undefined'?this:globalThis);

