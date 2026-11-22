# SIMPLICITY2TAKE — Recrutamento independente (pré-visualização)

Esta pasta contém uma primeira interface independente para o futuro subdomínio `recrutamento.simplicity2take.com`.

## Estado atual

- Interface responsiva em Português de Portugal.
- Modalidades: viatura da empresa e viatura própria.
- Campos para contacto, requisitos TVDE, experiência e disponibilidade.
- Pré-visualização no browser para demonstração.
- **Não existe backend nesta fase. Não recebe nem guarda candidaturas. Não usar dados pessoais reais.**
- Nenhuma alteração foi feita à produção do Fleet nem aos domínios atuais.

## Próximas etapas antes de abrir ao público

1. Criar backend e base de dados isolados para recrutamento, com permissões mínimas e proteção contra acesso indevido.
2. Implementar armazenamento seguro de documentos e limites de tamanho/tipo, validação do lado do servidor e proteção contra spam.
3. Preparar informação de privacidade e base legal adequadas antes de recolher dados pessoais.
4. Criar painel privado de administração com autenticação forte, estados de candidatura e notas internas.
5. Testar em ambiente de staging com dados fictícios, incluindo submissão, anexos e permissões.
6. Configurar DNS e alojamento do subdomínio `recrutamento.simplicity2take.com`.
7. Só depois encaminhar o website principal e o portal Fleet para este processo, inicialmente através de ligações/redirects controlados.

## Testar localmente

Abrir `index.html` num browser. O formulário apenas gera uma pré-visualização local; não submete dados.