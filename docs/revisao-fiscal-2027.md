# Caderno de revisão fiscal e legislativa

## Simulação local

O protótipo funciona fora do portal e não tem ligação a contas, bancos ou plataformas públicas. Recebe um cenário em JSON pela entrada padrão. A configuração `config/fiscal/pt-2027-v1.json` está pendente de revisão contabilística. A saída conserva o exercício, parâmetros originais, definição da regra, versão do algoritmo e hash da configuração. Guardar o resultado e a revisão de código em qualquer ensaio que seja usado para comparação histórica. Uma alteração de regra exige nova versão, casos de fronteira e revisão; persistência imutável de cálculos por empresa ainda está pendente.

Exemplo fictício com uma liquidação anual de 500,01 € por sujeito passivo:

```sh
node scripts/previsao-fiscal.cjs <<'JSON'
{"tipo":"iuc-anual","ambito":"liquidacao-anual-por-sujeito-passivo","modalidade":"prestacoes","exercicio":2027,"versao":"PT-2027-v1","totalCentimos":50001}
JSON
```

O resultado indica julho e outubro. Até 500 € inclusive, o mês previsto é outubro. Acima desse limiar, a opção `integral` indica julho. O valor de entrada é o total anual já liquidado ao sujeito passivo. O simulador não apura IUC individual, valores de prestações, isenções, primeiras matrículas ou reativações. [Decreto-Lei n.º 161/2026, artigos 6.º e 7.º](https://diariodarepublica.pt/dr/detalhe/decreto-lei/161-2026-1154275218)

Para a reserva interna, usar `tipo: "reserva-prestadores"` com exercício, versão e `baseServicosCentimos`. O campo opcional `pontosBase` permite mudar a reserva de referência de 1 000 pontos base (10%). A simulação calcula o montante a reservar em tesouraria. Para apurar um encargo contributivo é necessário confirmar elegibilidade, dependência e bases relevantes por prestador/ano, e depois reconciliar com a notificação. A retenção do motorista e as contribuições de trabalhadores e gerência exigem registos distintos. [Guia oficial das entidades contratantes](https://sisscontent.seg-social.pt/documents/10152/5896679/2034_entidades_contratantes/f7b1e0ce-bf6e-43bd-95a4-bf88b7345c6f)

## Observações verificadas em 26 de novembro de 2026

| Tema | Constatação e tratamento no Fleet |
|---|---|
| OE 2027 | A Assembleia aprovou a PPL 110/XVII/2.ª em votação final global a 24 de novembro. Registou-se a aprovação parlamentar. Falta associar o diploma publicado e verificar a vigência de cada alteração antes de a traduzir em cálculos. A ligação à folha oficial de votação consta do registo JSON. [Processo parlamentar](https://www.parlamento.pt/Paginas/2026/outubro/Orcamento-do-Estado-para-2026.aspx) |
| IRC | A Lei 64/2025 já prevê 19% para os períodos iniciados em 2026 e 18% para os iniciados em 2027 nos casos previstos nos n.os 1 e 5 do artigo 87.º do CIRC. A elegibilidade para taxas reduzidas, escalões, ajustamentos, derramas, tributações autónomas e alterações posteriores são verificações próprias. O protótipo não calcula IRC sobre faturação. [Lei 64/2025, artigo 3.º](https://diariodarepublica.pt/dr/detalhe/lei/64-2025-944874408) |
| IUC | O Decreto-Lei 161/2026 foi publicado a 4 de agosto e produz efeitos a partir de 1 de janeiro de 2027. O artigo 6.º tem um calendário transitório próprio para 2027. É a regra utilizada na simulação acima. [Diário da República](https://diariodarepublica.pt/dr/detalhe/decreto-lei/161-2026-1154275218) |
| Derrama de Gaia | A ordem do dia da Assembleia Municipal para **27 de novembro de 2026** inclui a derrama para 2027 no ponto 3.3. A taxa, os limites, as isenções e o exercício a que se aplicam aguardam confirmação na deliberação e na informação oficial correspondente. [Assembleia Municipal](https://assembleia.cm-gaia.pt/sessoes/111) |
| Segurança Social | O guia das entidades contratantes distingue dependência superior a 80% e superior a 50% até 80%, com taxas de 10% e 7% quando o regime é aplicável. Para trabalho por conta de outrem, o novo modelo de comunicação contributiva tem transição em 2026 e abrangência obrigatória prevista para 1 de janeiro de 2027. Registar eventuais alterações antes de desenvolver a comunicação de remunerações. [Guia](https://sisscontent.seg-social.pt/documents/10152/5896679/2034_entidades_contratantes/f7b1e0ce-bf6e-43bd-95a4-bf88b7345c6f) · [Decreto regulamentar, artigo 6.º](https://files.diariodarepublica.pt/1s/2025/12/23600/0000600012.pdf) |
| IVA e calendário AT | Guardar operação, documento, linhas, base, taxa, dedução justificada e período. Verificar transporte, recibos isentos ou tributados, peças, combustíveis/eletricidade, locação e comissões internacionais individualmente. Usar os factos específicos da informação vinculativa e a redação aplicável ao período. A página de pagamentos de 2026 não determina os prazos de 2027. [Artigo 21.º CIVA](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/civa_rep/Pages/iva21.aspx) · [Ficha vinculativa 13090](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/informacoes_vinculativas/despesa/civa/documents/informacao_13090.pdf) · [Calendário AT 2026](https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/calendario_fiscal/Pages/Quadro_res_Pag_2026.aspx) |

## Entrada de alterações e revisão

A monitorização diária existente serve de ponto de recolha. O importador local aceita observações confirmadas com entidade, referência, estado, data do evento, data de efeitos quando conhecida, impacto e URL oficial. Usa os domínios de DR, AT, Segurança Social, IMT, ACT, AR e município de Gaia. Há quatro observações iniciais em `config/fiscal/observacoes-2026-11-26.json`. Uma mudança de estado produz novo registo; reimportar a mesma observação conserva o histórico. O hash permite detetar uma edição acidental ao comparar com a versão guardada. A verificação do conteúdo da fonte continua a ser humana.

```sh
node scripts/alteracoes-legislativas.cjs historico.json config/fiscal/observacoes-2026-11-26.json > historico-revisto.json
```

O histórico inicial contém `[]`. Cada registo anterior deve conservar os campos normalizados e o identificador único produzido na importação. Se faltar um campo ou houver identificadores repetidos ou incompatíveis, a importação termina com erro antes de emitir resultados. Nesse caso, recuperar o histórico da última versão revista. Observações novas repetidas continuam a ser ignoradas. Guardar o novo ficheiro em controlo de versões após revisão. A recolha nativa agendada, o armazenamento por empresa, a notificação interna e o registo persistente da aprovação contabilística ainda são dependências do painel. As observações nunca ativam regras por si mesmas.

Para requisitos TVDE e laborais, acompanhar o licenciamento de operadores, a certificação dos motoristas e as comunicações da ACT. O acesso direto ao portal ACT não foi confirmado nesta consulta; o diretório da Administração Pública identifica a entidade e os seus serviços. [IMT](https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/tvde/licenciamento-de-operadores-de-tvde/) · [ACT no gov.pt](https://www.gov.pt/servicos/pedir-informacoes-a-autoridade-para-as-condicoes-do-trabalho-act-)

## Validação

`node --test tests/previsao-fiscal.test.cjs tests/alteracoes-legislativas.test.cjs` corre casos fictícios de limiar, opção integral, versão errada, montantes inválidos, reserva configurável, repetição de importação e conservação das versões anteriores. A revisão fiscal para utilização operacional e a geração de contratos com modelos juridicamente validados estão pendentes.

Os controlos automáticos do Fleet abrangem alterações isoladas aos ficheiros JSON de configuração fiscal. Reimportam os lotes de observações e comparam a configuração PT-2027-v1 com o hash da simulação de referência. Uma revisão das regras requer uma nova versão para conservar o resultado histórico.
