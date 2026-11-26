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
