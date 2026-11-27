// Import reviewed official observations into an append-only local review log.
const fs = require('node:fs');
const crypto = require('node:crypto');
const sources = {
  DR:['diariodarepublica.pt'], AT:['portaldasfinancas.gov.pt'], SS:['seg-social.pt'],
  IMT:['imt-ip.pt'], ACT:['act.gov.pt'], AR:['parlamento.pt'], GAIA:['cm-gaia.pt']
};
const states = ['proposta','aprovada','publicada','em_vigor','agendada'];
function day(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(value+'T00:00:00Z').toJSON()?.slice(0,10) === value;
}
function normalize(row) {
  const url = new URL(row.fonte);
  const domains = Object.hasOwn(sources,row.entidade) && sources[row.entidade];
  if (!domains || url.protocol !== 'https:' || url.username || url.password || url.port ||
    !domains.some(domain=>url.hostname === domain || url.hostname.endsWith('.'+domain))) {
    throw Error('Fonte oficial incompatível com a entidade.');
  }
  if (!states.includes(row.estado) || !day(row.dataEvento) || (row.efeitosDesde != null && !day(row.efeitosDesde))) throw Error('Estado ou data inválidos.');
  for (const key of ['referencia','impacto']) if (typeof row[key] !== 'string' || !row[key].trim()) throw Error('Falta '+key);
  return {entidade:row.entidade,referencia:row.referencia.trim(),estado:row.estado,dataEvento:row.dataEvento,
    efeitosDesde:row.efeitosDesde ?? null,impacto:row.impacto.trim(),fonte:url.href};
}
function importObservations(previous, observations) {
  if (!Array.isArray(previous) || !Array.isArray(observations)) throw Error('São necessárias duas listas de observações.');
  const history = [];
  const seen = new Set();
  function identify(input) {
    const row = normalize(input);
    const id = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
    if (input.id !== undefined && input.id !== id) throw Error('Identificador incompatível com a observação.');
    return {id, ...row};
  }

  for (const input of previous) {
    if (typeof input?.id !== 'string') throw Error('Identificador em falta no histórico.');
    const record = identify(input);
    if (Object.keys(record).some(key => record[key] !== input[key])) {
      throw Error('Observação incompleta ou alterada no histórico.');
    }
    if (seen.has(record.id)) throw Error('Identificador duplicado no histórico.');
    seen.add(record.id);
    history.push({...input});
  }
  for (const input of observations) {
    const record = identify(input);
    if (!seen.has(record.id)) {
      seen.add(record.id);
      history.push(record);
    }
  }
  return history;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw Error('Uso: node scripts/alteracoes-legislativas.cjs historico.json observacoes.json');
    const load = file=>JSON.parse(fs.readFileSync(file,'utf8'));
    console.log(JSON.stringify(importObservations(load(process.argv[2]),load(process.argv[3])),null,2));
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
module.exports={importObservations};
