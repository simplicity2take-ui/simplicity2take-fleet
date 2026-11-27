const {test} = require('node:test');
const assert = require('node:assert/strict');
const {simulate} = require('../scripts/previsao-fiscal.cjs');
const base={exercicio:2027,versao:'PT-2027-v1'};
const annual={...base,tipo:'iuc-anual',ambito:'liquidacao-anual-por-sujeito-passivo',modalidade:'prestacoes'};
test('IUC annual forecast selects the transitional months using the taxpayer total',()=>{
  for(const [total,months] of [[0,[]],[1,[10]],[50000,[10]],[50001,[7,10]]]) {
    assert.deepEqual(simulate({...annual,totalCentimos:total}).resultado.mesesPrevistos,months);
  }
  assert.deepEqual(simulate({...annual,totalCentimos:50001,modalidade:'integral'}).resultado.mesesPrevistos,[7]);
  for(const wrong of [{ambito:'por-viatura'},{ambito:'primeira-matricula'},{exercicio:2026},{versao:'ultima'},{modalidade:null},{totalCentimos:-2},{totalCentimos:2.3}])
    assert.throws(()=>simulate({...annual,totalCentimos:200,...wrong}));
});
test('prudential reserve is configurable, rounded once, and preserves the rule and inputs used',()=>{
  const input={...base,tipo:'reserva-prestadores',baseServicosCentimos:105};
  const draft=simulate(input);
  assert.equal(draft.resultado.reservaTesourariaCentimos,11);
  assert.equal(draft.regras.revisaoContabilistica,'pendente');
  assert.equal(simulate({...input,pontosBase:0}).resultado.reservaTesourariaCentimos,0);
  assert.equal(simulate({...input,pontosBase:500}).resultado.reservaTesourariaCentimos,5);
  for(const points of [null,-1,10001,0.5]) assert.throws(()=>simulate({...input,pontosBase:points}));
  const hash=draft.regrasSha256;
  draft.regras.reservaPrestadores.pontosBasePorDefeito=9000;
  input.baseServicosCentimos=200;
  assert.equal(draft.parametros.baseServicosCentimos,105);
  assert.equal(simulate(input).regrasSha256,hash);
  assert.equal(simulate(input).resultado.reservaTesourariaCentimos,20);
});

test('the historical PT-2027-v1 simulation retains its original rule snapshot', () => {
  const result = simulate({...annual, totalCentimos:50000});
  assert.equal(result.regrasSha256, 'dd4c41c930608b3876893a2fdfe181228a68f1b1d6ead0363f808d41147c54fd',
    'Preservar PT-2027-v1 e atribuir uma nova versão às regras alteradas.');
});
