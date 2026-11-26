// Offline review only. Amounts use integer euro cents and rates use basis points.
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const rules2027 = require('../config/fiscal/pt-2027-v1.json');

function cents(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Indica um montante não negativo em cêntimos inteiros.');
  return value;
}

function simulate(input) {
  if (!input || input.exercicio !== rules2027.exercicio || input.versao !== rules2027.versao) {
    throw Error('Exercício ou versão sem regras de simulação.');
  }
  const rules = rules2027;
  let result;
  if (input.tipo === 'iuc-anual') {
    if (input.ambito !== 'liquidacao-anual-por-sujeito-passivo') throw Error('Indica o total anual liquidado por sujeito passivo.');
    if (!['prestacoes','integral'].includes(input.modalidade)) throw Error('Indica a modalidade de pagamento a simular.');
    const total = cents(input.totalCentimos);
    const iuc = rules.iucAnual;
    let months = [];
    if (total > 0 && total <= iuc.limiteCentimos) months = [iuc.mesAteLimite];
    if (total > iuc.limiteCentimos) months = input.modalidade === 'integral' ? [iuc.mesIntegralOpcional] : [...iuc.mesesAcimaLimite];
    result = {totalAnualCentimos:total, mesesPrevistos:months, fonte:iuc.fonte};
  } else if (input.tipo === 'reserva-prestadores') {
    const base = cents(input.baseServicosCentimos);
    const rate = input.pontosBase === undefined ? rules.reservaPrestadores.pontosBasePorDefeito : input.pontosBase;
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw Error('Percentagem de reserva inválida.');
    const amount = (BigInt(base) * BigInt(rate) + 5000n) / 10000n;
    result = {baseServicosCentimos:base, pontosBase:rate, reservaTesourariaCentimos:Number(amount)};
  } else throw Error('Tipo de previsão desconhecido.');
  const ruleSnapshot = structuredClone(rules);
  return {
    modo:'simulacao', algoritmo:'pt-previsao-v1', parametros:structuredClone(input), regras:ruleSnapshot,
    regrasSha256:createHash('sha256').update(JSON.stringify(ruleSnapshot)).digest('hex'), resultado:result
  };
}

if (require.main === module) {
  try { console.log(JSON.stringify(simulate(JSON.parse(readFileSync(0,'utf8'))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode=1; }
}
module.exports = {simulate};
