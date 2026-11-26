# Plano de desenvolvimento interno do Fleet

## Ponto de situação em 26 de novembro de 2026

A base observada foi `main@709f942`. O inventário anterior às alterações desta auditoria abrangia 107 ramos remotos, 1 155 commits alcançáveis, 259 caminhos distintos nas pontas dos ramos e 595 versões distintas de ficheiros de texto de código, testes, configuração e documentação nas extensões pesquisadas. A árvore de main continha 128 ficheiros e sete migrações. A leitura dos títulos e descrições dos 99 PRs, das nove issues e dos comentários foi cruzada com os diffs relevantes, SQL, fluxos do portal e testes. Dos 19 PRs então abertos, nenhum apresentava conversa de revisão em linha. As issues #99–#107 estavam abertas e sem comentários.

A existência de um ramo identifica trabalho a recuperar. As verificações abaixo indicam onde o comportamento foi exercitado. O inventário abrange o esquema versionado, funções SQL, migrações e bases sintéticas. Não confirma a correspondência integral com a base alojada, políticas efetivas no Drive, configuração de MFA, cópias do fornecedor ou estado das credenciais. Esses pontos exigem evidência do ambiente autorizado.

## Núcleo operacional

| Área | Evidência de comportamento | Limite e próxima verificação |
|---|---|---|
| Viaturas, motoristas, QR e turnos | Em main existem gestão, identificação por QR, registo de turno e conferência de serviços. Os testes de ciclo de vida verificam autenticação, exclusividade de turno, passagem da viatura e preservação do estado do motorista. | Verificar fluxo com conta piloto e dispositivo físico. Rever o #98 antes de integrar os acertos de quilometragem e conferência. |
| Viagens e telemetria | Importações Uber/Bolt, consulta de registos e quilómetros observados CarTrack têm testes. No ramo exato do #96 passaram os 12 testes de validação de lotes CarTrack. | Confirmar a cobertura com relatórios autorizados. A ausência de serviços ou leituras deixa o período por confirmar. |
| Documentos | Existem upload, leitura de imagens/PDF, OCR e regras de partilha. No #97 passaram cinco testes selecionados de política e titularidade, com PostgreSQL isolado e utilizadores simulados. | Rever #95/#97 e verificar as permissões reais do arquivo antes de o reutilizar para faturas, sinistros ou recibos. |
| Odómetro administrativo | #108 apresenta fonte, data e divergências do CarTrack. #109 acrescenta introdução manual por administrador, histórico, autoria de servidor e repetição segura do pedido. | #109 depende de #108 e do SQL proposto. Testar em ambiente intermédio com a configuração de acesso que será usada no lançamento. |

## Mapa das nove issues

| Issue | Estado verificado e trabalho recuperável | Entrega seguinte e dependências |
|---|---|---|
| #99 · Património, oficina, Tesla | Parcial. Há ficha de viatura, VIN, documentos, CarTrack e os PRs #108/#109. | Aquisição/venda e histórico de medições com origem, autor e hora. Depois, planos por viatura/componente, intervalos configuráveis, intervenções e alertas por km ou data. Criar papel de mecânico com acesso apenas aos trabalhos autorizados. Para Tesla, validar autorização, custo, adormecimento do veículo e fonte do odómetro. O horário solicitado é 00h/08h/20h de Lisboa. |
| #100 · Sinistros | Pendente. A ficha do veículo, apólice e pré-validação de anexos podem ser reutilizadas. | Dossier interno, intervenientes, evidências privadas, imobilização, franquia e reparação. Validar o modelo, assinaturas, retenção e aceitação pela seguradora antes da declaração amigável digital. |
| #101 · Oficina e stock | Pendente. Falta um livro de movimentos de materiais associado às intervenções. | Catálogo, unidades, referências, fornecedores e consumos antes de mínimos e reposição. Testar bidão de 5 L parcialmente utilizado, receção duplicada e artigo por encomenda. WhatsApp começa por rascunho e autorização de Ruben por envio e encomenda. Separar stock Fleet e EV PARTS. |
| #102 · Operação e reconciliação | Parcial na base de viagens, atribuições e turnos. As contas reconciliadas, garantias, ocorrências e fecho semanal ainda carecem de fluxo próprio. | Cruzar condutor, viatura e hora antes de imputar portagens ou multas. Relacionar avarias, carregamentos, substituições, garantia e custos. Reconciliação de ficheiros bancários com evidência e decisão humana. Só depois ligar relatório de segunda-feira e assistente de texto/voz com permissões. |
| #103 · Recibos e admissão | Parcial no arquivo de documentos. A gestão fiscal dos recibos por motorista/semana está pendente. | Suportar fotografia, captura e PDF, parciais e várias semanas. Separar emissão, entrega, validação e pagamento. Só avançar para contratos de trabalho e prestação de serviços com modelos juridicamente validados, versão, dados aprovados e assinatura apropriada. O processamento salarial completo exige especificação própria. |
| #104 · Direção e recrutamento | Parcial. Main tem candidaturas e gestão no portal. #28 propõe intake e função de submissão; #29 é uma pré-visualização; #30 acrescenta relatório operacional. | Recuperar a candidatura e testar ponta a ponta em ambiente intermédio. Admissão, comunicações internas, seguros/financiamentos, saúde de baterias, simuladores, comparador de ofertas e painel de direção ficam faseados. Preparar MFA, perfis e recuperação antes dos novos dados sensíveis. |
| #105 · Rentabilidade | Parcial nas fontes operacionais e na simulação offline de reserva. Relatório operacional do #30 não demonstra um fecho financeiro. | Contrato de dados por empresa, motorista, viatura, modelo e período. Reconciliar faturação sem IVA, custos, cauções, dívidas, saldo e reservas. Validar o layout CGD tabulado com especificação/amostra fictícia antes de disponibilizar a exportação. Rentabilidade e tesouraria requerem movimentos identificados. |
| #106 · Motor fiscal | Protótipo offline para o calendário transitório do IUC de 2027 e reserva prudencial configurável. Cada simulação devolve exercício, versão, parâmetros, fonte ou origem e hash SHA-256 do conjunto de regras. | Submeter regras ao contabilista. Acrescentar IVA por linha, dedutibilidade, retenções, Segurança Social, salários/gerência, IRC, derramas, tributação autónoma, pagamentos por conta e demais impostos por enquadramento. Começar integrações AT, e-Fatura e SSD por importação de ficheiros autorizados. |
| #107 · Vigilância legislativa | A monitorização diária externa está ativa. Esta proposta acrescenta um registo local de observações oficiais, com histórico e importação deduplicada. | Integrar a entrada e revisão no painel interno com acesso restrito. Conservar propostas, aprovações, publicação e efeitos como factos distintos. Decisão contabilística e autorização precedem uma nova versão operacional. |

## Sequência para entrada em funcionamento

1. **Operação interna.** Rever os PRs de documentos, sincronização, turnos e odómetro. Repetir num ambiente intermédio o percurso do administrador e do motorista, com dados de teste e evidência de permissões e recuperação. A aquisição de viaturas, o portal do mecânico, sinistros ou fiscalidade não bloqueiam o piloto existente.
2. **Oficina.** Consolidar identidade da viatura, quilometragem aceite e histórico de retificações. Implementar manutenção e intervenções. Ligar materiais, consumos, faturas e garantias por identificador de intervenção. A fatura fica pendente até validação de fornecedor, número, montantes, matrícula e duplicados.
3. **Financeiro.** Implementar central de autorizações e eventos auditáveis; introduzir recibos, contas semanais e reconciliação antes de CGD, cauções, rentabilidade e previsões. Exportar exige validação e não executa pagamentos. Prever o estado “dados insuficientes”.
4. **Fiscal e laboral.** Fazer revisão por exercício e jurisdição; proteger os cálculos antigos com versão e parâmetros fixos. Colocar os modelos jurídicos e as suas versões sob aprovação. Tratar salário, retenções e contribuições de trabalhadores/gerência separadamente dos prestadores. Submissão fiscal e emissão de documentos não fazem parte do simulador.
5. **Expansão.** Recuperar #32/#36 para fronteiras entre empresas. Exigir testes com empresas A/B, utilizadores sem vínculo e documentos privados antes de admitir outro cliente. A ligação EV PARTS fica por contrato de interface com stocks e dados separados, dentro deste repositório. O assistente consulta apenas dados acessíveis ao utilizador e propõe ações à central de autorizações.

## Segurança e continuidade

As políticas de main privilegiam os papéis de administrador e motorista. O modelo multiempresa tem migrações e preflights próprios no #32; credenciais do serviço em funções de integração exigem revisão de âmbito por empresa. O portal do mecânico e a área do contabilista precisam de autorização no servidor, com casos negativos por papel e empresa. A autenticação por telefone já existente pode ser aproveitada; MFA, recuperação de conta e desativação de sessões privilegiadas precisam de validação independente. Contratos, recibos, IBANs, assinaturas e fotografias de sinistros exigem arquivo privado, limites de retenção, auditoria de leitura e autorização individual das exportações.

O ensaio de #109 exporta uma base sintética e restaura-a numa nova instância PGlite, onde verifica o conteúdo e a política de leitura. Para o serviço alojado, inventariar base, funções, documentos e configuração de segredos, definir objetivos de perda de dados e tempo de recuperação com Ruben, restaurar para ambiente segregado e exercitar autenticação e anexos. A cobertura e os custos do fornecedor estão por confirmar. A aceitação depende de evidência de restauro, além do estado do agendamento de cópias.

## Ensaios desta revisão

| Ramo e ensaio | Resultado |
|---|---|
| Base #108, suíte local com dados fictícios | 69 testes passaram antes da nova funcionalidade. |
| #109, suíte completa | 71 testes passaram, incluindo regras SQL, recuperação de cópia e comportamento do diálogo após falha de rede. Os dois workflows GitHub passaram no commit `96e873c`. |
| #109, testes isolados adicionais | Passaram ciclo de turnos, preservação Bolt e ciclo de vida de motoristas durante a sincronização. |
| #96 em `ee66e3e` e #97 em `235929d` | Passaram os 12 casos de lotes CarTrack e cinco casos selecionados de documentos e permissões. |
| Proposta fiscal sobre main | Passaram 71 testes, incluindo IUC nos dois lados do limiar, opção integral, montantes inválidos, versão/ano, reserva e importação idempotente. As quatro observações oficiais foram importadas duas vezes e o histórico permaneceu idêntico. Ver comandos e exemplos em [revisão fiscal](revisao-fiscal-2027.md). |

As integrações alojadas com Tesla, seguradoras, WhatsApp, AT, SSD, CGD e um fornecedor de voz continuam por validar. A decisão sobre custos, acessos e transmissão externa só é necessária na fase de ativação correspondente.

## Expansão registada durante a auditoria

As issues #110 e #111 entraram depois do inventário inicial. A matriz seguinte agrupa entregas que partilham os mesmos dados e explicita ensaios de aceitação futuros. Os PRs propostos por área só devem avançar após a dependência indicada. A prioridade imediata continua a ser concluir os testes de acesso, turnos, documentos e quilometragem do piloto.

| Requisitos do #110 | Dependência | Critérios de aceitação com dados fictícios |
|---|---|---|
| Grupo 1 · Preços e negociação de fornecedores, durabilidade e custo de pneus por posição, agenda da oficina, ferramentas e calibração | Intervenções, catálogo e movimentos do #101 | Comparar duas propostas em unidades iguais, seguir um pneu entre eixos e oficina externa, sinalizar conflito de horário e ferramenta com calibração expirada. |
| Grupo 1 · Anomalias de consumo, cartões combustível/carregamento, alertas Cartrack e privacidade, custo/km, ocupação e simulador de poupança | Quilometragem aceite, turnos e custos conciliados | Detetar lançamento duplicado, ocultar trajeto a papel sem permissão, indicar indisponibilidade com zero km, distinguir tempo ocupado de tempo sem telemetria e reproduzir o cenário com os mesmos pressupostos. |
| Grupo 1 · Mapa de danos com fotos e recalls por VIN | Arquivo privado do #100 e fonte de recalls autorizada | Impedir consulta cruzada de anexos, apresentar data da última consulta e distinguir consulta falhada de ausência confirmada de recall. |
| Grupo 2 · Manutenção preditiva, despesas recorrentes e renegociação, ciclo compra/venda e anúncios de venda em rascunho | Histórico de manutenção, custos e aquisição | Com histórico insuficiente, indicar a lacuna. Projetar recorrências sem duplicar despesa paga, fechar o custo do ciclo com valor de venda e guardar anúncio como rascunho. |
| Grupo 2 · Atividade e descanso por regime, faturação em falta, custo de recrutamento, simulador de aluguer | Turnos, regime laboral validado, admissão e fechos semanais | Tratar interrupção no turno, conciliar viagem sem fatura, apurar custo por admissão e conservar o mínimo semanal e referência de 2 000 km ao variar a tarifa. |
| Grupo 2 · Portal do contabilista, assistente de direção, comparações entre períodos, modo offline e sincronização | Papéis por empresa, histórico versionado e idempotência | Bloquear acesso entre empresas, mostrar datas e fontes na resposta, comparar períodos equivalentes e sincronizar duas vezes uma operação offline sem a duplicar. |
| Grupo 3 · RH e salários, recuperação do investimento, orçamentos da oficina, banco em leitura/importação e cobranças | Modelos laborais aprovados, custos e reconciliação | Separar trabalhador e prestador, explicar retorno acumulado, comparar orçamento e intervenção, reimportar extrato sem duplicados e descontar pagamento parcial de uma cobrança. |
| Grupo 3 · Carregadores próprios e solar, garantias de viaturas, produtividade da oficina, manual digital | Medições por equipamento, intervenções e documentos | Distinguir cenário solar de energia medida, verificar garantia por data e km, apurar horas por intervenção e recuperar a versão do manual consultada. |
| Grupo 3 · Saúde das integrações, atualidade dos dados, objetivos financeiros e centro de controlo | Estado de sincronização por fonte e indicadores reconciliados | Com uma integração atrasada, apresentar a última leitura válida e assinalar objetivos e indicadores que dependem dela. |
| Grupo 4 · Voz na oficina, peças por VIN, previsão de material, índice económico por viatura | Catálogos autorizados, consumos e custos | Pedir confirmação da transcrição antes de registar, mostrar ambiguidade de referência, descontar óleo de um bidão de 5 L e tratar pneus externos separadamente. Decompor o índice nas suas parcelas. |
| Grupo 4 · Pedidos de apoio, serviços subcontratados, gestão ambiental e incentivos oficiais | Intervenções, evidência privada e registo de fontes | Seguir pedido até resolução, comparar serviço contratado e recebido, associar comprovativo de resíduo e distinguir incentivo anunciado de candidatura oficialmente aberta. |
| Grupo 4 · Cenários de risco, tarefas administrativas, formação, resumo diário áudio e limites da IA | Previsões, papéis por empresa e central de autorizações | Reproduzir um cenário, impedir conclusão de tarefa por papel indevido, conservar versão da formação, excluir dados privados do áudio e bloquear operação acima do limite aprovado. |

| Requisito do #111 | Depende de | Ensaio de aceitação proposto |
|---|---|---|
| 1. Dossier de negociação de seguros | Sinistros, apólices e documentos | Comparar dois prémios com franquias e coberturas diferentes e produzir um dossier interno com as fontes. |
| 2. Reserva para grandes reparações | Histórico por modelo e movimentos de tesouraria | Aumentar a reserva e registar depois uma reparação. A despesa aparece uma vez e o saldo reservado é rastreável. |
| 3. QR para chaves, ferramentas, cartões e cabos | QR existente e custódia autenticada | Repetir a leitura, negar levantamento simultâneo e conservar autor e hora da devolução. |
| 4. Resíduos da oficina e comprovativos | Intervenções, tipos de resíduos e regras ambientais validadas | Ligar lote, operador e comprovativo. Sinalizar documentação aplicável em falta, incluindo e-GAR quando exigível. |
| 5. Benefícios e campanhas de retenção | Admissão e enquadramento laboral/fiscal validado | Respeitar a vigência da campanha, contar cada adesão uma vez e decompor custo por motorista. |
| 6. Comparação de oficina interna e externa | Intervenções e registos de custos | Comparar peças, horas e imobilização com pressupostos visíveis e indicar dados de capacidade ou qualidade em falta. |
| 7. Indicadores de saúde empresarial | Documentos, operação, disponibilidade, manutenção e finanças | Explicar cada indicador, datar as fontes e assinalar valor desconhecido quando faltar evidência. |
| 8. Renovação de frota a cinco anos | Valor residual, financiamento, regras de plataforma e previsão | Comparar substituição e manutenção da mesma viatura, com impacto anual e hipótese de elegibilidade identificada. |
| 9. Automatizações configuráveis | Permissões, auditoria, eventos fiáveis e aprovação | Simular revisão a 1 000 km, recibo pendente, stock mínimo, seguro, limite de despesa, falha de integração e imobilização. Repetir o evento sem duplicar ações e exigir aprovação nas sensíveis. |
| 10. Capacidade de investimento a 90 dias por voz/texto | Tesouraria conciliada, dívidas, reservas e cenários | Obter a mesma previsão por texto e voz, apresentar pressupostos e lacunas, conservar consulta e respeitar permissões. |
