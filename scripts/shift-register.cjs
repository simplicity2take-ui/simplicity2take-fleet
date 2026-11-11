const { createHash } = require('node:crypto');
const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizePlate = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function registeredTime(value, flags, timezone='Atlantic/Canary') {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
  const match = String(value).match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) { flags.push('invalid_timestamp'); return null; }
  const [, y,m,d,h,min,s] = match.map(Number);
  const base = Date.UTC(y,m-1,d,h,min,s);
  const target = `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const candidates = [base, base-3600000].filter(time => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(part=>[part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}` === target;
  });
  if (candidates.length !== 1) { flags.push(candidates.length ? 'ambiguous_timestamp' : 'invalid_timestamp'); return null; }
  return new Date(candidates[0]).toISOString();
}

function parseRows(rows, drivers, vehicles, firstRow=2, source) {
  if (!source?.fileId || !source?.sheetId || !source?.url || !source?.timezone) throw new Error("Source metadata is required");
  const byName = new Map();
  for (const driver of drivers) {
    const key=normalizeName(driver.full_name);
    if (!byName.has(key)) byName.set(key,[]);
    byName.get(key).push(driver.id);
  }
  const byPlate = new Map(vehicles.map(vehicle=>[normalizePlate(vehicle.plate),vehicle.id]));
  return rows.map((row,index) => {
    const flags=[];
    const [timestamp='',kind='',name='',plate=''] = row.map(value=>String(value ?? ''));
    const event = normalizeName(kind);
    const eventKind = event==='entradaturno' ? 'entry' : event==='saidaturno' ? 'exit' : null;
    if (!eventKind) flags.push('unknown_event_kind');
    const matches=byName.get(normalizeName(name)) || [];
    if (matches.length!==1) flags.push(matches.length ? 'ambiguous_driver' : 'unmatched_driver');
    const vehicleId=byPlate.get(normalizePlate(plate)) || null;
    if (!vehicleId) flags.push('unmatched_vehicle');
    return {
      source_file_id:source.fileId,source_sheet_id:source.sheetId,source_row:firstRow+index,
      source_url:source.url,source_timezone:source.timezone,
      source_hash:createHash('sha256').update(JSON.stringify(row.slice(0,4).map(value=>String(value ?? '')))).digest('hex'),
      source_timestamp:timestamp,registered_at:registeredTime(timestamp,flags,source.timezone),event_kind:eventKind,
      driver_name:name,vehicle_plate:plate,driver_id:matches.length===1?matches[0]:null,vehicle_id:vehicleId,
      review_flags:flags
    };
  });
}

module.exports={parseRows,registeredTime,normalizeName,normalizePlate};
