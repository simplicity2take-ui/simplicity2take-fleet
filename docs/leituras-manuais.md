# Leitura manual do odómetro

Na administração em **Veículos → Leituras manuais**, o administrador consegue ver a indicação CarTrack e as últimas dez leituras manuais da viatura. Introduz os quilómetros inteiros que vê no painel nesse momento. O servidor fixa a hora de registo e a identidade do autor. Uma medição histórica, o odómetro de aquisição e uma distância percorrida têm significados diferentes e ficam fora deste formulário.

O registo manual mantém a sua origem numa tabela própria. Um valor inesperado continua disponível para investigação. O portal apresenta as duas origens em paralelo. A deteção automática de divergências entre origens e o registo de retificações são trabalho subsequente.

## Dependência e verificação

O SQL proposto em `supabase/sql/vehicle-manual-odometer.sql` depende de `vehicles.id`, `profiles.id/role/status`, de `auth.uid()` e das políticas de visibilidade das viaturas. A instalação é uma operação separada. Sem a tabela, o formulário mostra o histórico indisponível e a restante ficha continua funcional.

A base só aceita novos valores para viaturas visíveis por um administrador ativo. Um pedido repetido pelo mesmo autor conserva a hora e o resultado originais. Os identificadores históricos de autor e viatura permanecem na tabela caso o objeto original seja eliminado. O acesso pelo portal depende sempre da viatura visível. A futura edição multiempresa exige revalidar as políticas de veículos e de perfis antes de disponibilizar o módulo a uma segunda empresa.

Os testes `node --test tests/manual-odometer-*.test.cjs` usam PGlite e um cliente simulado. Cobrem repetição do pedido, valores inválidos, indisponibilidade da ligação, leitura atrasada após fechar o diálogo, permissões e imutabilidade para utilizadores autenticados. O teste de recuperação exporta a base sintética em memória, abre outra instância a partir da cópia e verifica valor, autor, hora e restrição do motorista. A recuperação de PostgreSQL alojado, documentos privados e segredos necessita de ensaio próprio.
