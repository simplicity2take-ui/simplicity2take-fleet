# ADR 0001 · Organização do Fleet e independência empresarial

Decisão do proprietário nas issues #113 e #114, de 26 de novembro de 2026. O piloto é interno à SIMPLICITY2TAKE. A entrada de uma segunda empresa fica adiada.

## Estrutura do produto

O portal existente usa JavaScript, uma aplicação administrativa e móvel, funções no servidor e PostgreSQL. O desenvolvimento mantém este conjunto e separa a lógica de cada domínio à medida que lhe acrescenta comportamento. A navegação pode reunir ações de vários domínios necessárias a um mesmo papel. A autorização de cada ação reside no servidor.

| Área SIMPLICITY | Responsabilidade |
|---|---|
| FLEET | Viaturas, turnos, atribuições, viagens, quilometragem e conferência operacional das contas semanais. |
| DRIVER | Área móvel do motorista, recibos, extratos, documentos, avarias, sinistros, marcações e apoio. |
| WORKSHOP | Intervenções, manutenção, peças, consumíveis, ferramentas, fornecedores e garantias. |
| FINANCE | Faturação, custos, bancos, movimentos, contas conciliadas, impostos e tesouraria. |
| PEOPLE | Candidaturas, admissão, contratos, RH, salários e formação. |
| COMPLIANCE | Legislação, seguros, inspeções, prazos, documentação e proteção de dados. |
| INTELLIGENCE | Consultas autorizadas, previsões e cenários fundamentados, com indicação de fonte, atualidade e lacunas. |
| SYSTEM | Configuração, segurança, auditoria, limites de custo, integrações, recuperação e administração técnica. |

O Fleet opera com autenticação, base de dados, fornecedores, stocks, credenciais, administração e repositório próprios. A integração anteriormente descrita com SIMPLICITY EV PARTS foi cancelada. Esta decisão exclui partilha de identidade ou dados, API entre projetos, sincronização de stock, administração conjunta e dependências de código.

## Condições para reconsiderar a entrada de outra empresa

O #32 é uma proposta de fundação com empresas, vínculos e políticas de acesso. No commit `7c7ee56`, a função de pertença a empresa admite o administrador global. As políticas de viaturas, motoristas e atribuições também o admitem diretamente. A administração de vínculos aceita escrita do cliente autenticado sob essa política. Estes caminhos impedem tratar o ramo como isolamento verificado.

Antes de qualquer admissão, separar administração técnica de acesso operacional. Qualquer acesso de suporte exige autorização da empresa, âmbito, duração, revogação e auditoria. Uma empresa nova começa sem dados da empresa fundadora. O catálogo de módulos deve conservar histórico ao desativar funcionalidades e respeitar dependências.

A revisão futura abrangerá tabelas, APIs, anexos, pesquisa, exportações, credenciais, tarefas assíncronas, cache, IA e restauro. O ensaio exige empresas fictícias A/B, utilizador sem vínculo, mudança de contexto, convite expirado e revogação. Exigir evidência de limites no servidor antes de comercializar ou disponibilizar o onboarding. O trabalho atual mantém o foco no piloto interno.
