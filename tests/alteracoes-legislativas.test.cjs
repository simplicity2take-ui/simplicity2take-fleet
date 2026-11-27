const {test}=require('node:test');
const assert=require('node:assert/strict');
const {importObservations}=require('../scripts/alteracoes-legislativas.cjs');
const observed={entidade:'GAIA',referencia:'fixture',estado:'agendada',dataEvento:'2026-11-27',impacto:'Caso fictício',fonte:'https://assembleia.cm-gaia.pt/'};
test('reimports are idempotent and retain previous stages and rule corrections',()=>{
  const old=importObservations([], [observed,observed]);
  assert.equal(old.length,1);
  const newer={...observed,estado:'aprovada'};
  const result=importObservations(old,[newer]);
  assert.deepEqual(result[0],old[0]);
  assert.equal(result.length,2);
  assert.deepEqual(importObservations(result,[newer,observed]),result);
  assert.throws(()=>importObservations([{...old[0],estado:'publicada'}],[]));
});
test('rejects unverified domains and malformed dates or states',()=>{
  for(const bad of [{fonte:'https://cm-gaia.pt.example.test/'},{entidade:'DR'},{dataEvento:'2026-02-30'},{estado:'rascunho'},{impacto:''}])
    assert.throws(()=>importObservations([], [{...observed,...bad}]));
});

test('rejects an incomplete or repeated historical record before importing a new stage', () => {
  const [original] = importObservations([], [observed]);
  const {id, ...withoutId} = original;
  const next = {...observed, estado:'publicada'};
  for (const history of [[withoutId], [{...withoutId, impacto:'Correção sem origem'}]]) {
    assert.throws(() => importObservations(history, [next]), /identificador/i);
  }
  const {efeitosDesde, ...missingDateField} = original;
  assert.throws(() => importObservations([missingDateField], [next]), /incompleta/i);
  const annotated = {...original, notaRevisao:'Caso fictício'};
  assert.deepEqual(importObservations([annotated], [observed])[0], annotated);
  assert.throws(() => importObservations([original, original], [next]), /duplicad/i);
  assert.deepEqual(importObservations([original], [original, observed, next]).map(row => row.id),
    [id, importObservations([], [next])[0].id]);
});
