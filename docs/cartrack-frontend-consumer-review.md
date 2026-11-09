# CarTrack — revisão dos consumidores no frontend

**Estado: revisão estática do branch `feature/company-fleet-foundation`; sem execução nem alterações de produção.**

## Âmbito

Foi lido o `app.js` do branch que serve de base ao PR #36. Esta revisão complementa o inventário de esquema e o contrato de mapping. Não substitui a pesquisa de todos os consumidores externos nem uma revisão runtime.

## Consumidores confirmados

### 1. Carregamento dos dados

Em `app.js`, função `loadBackendData()`:

- Linhas 220–250: para utilizadores que não são administradores globais, a branch faz apenas a leitura de documentos e limpa `state.cartrackVehicles` e `state.cartrackSnapshots`; não solicita tabelas CarTrack. É uma proteção de redução de superfície de acesso.
- Linhas 253–269: no caminho administrativo global, faz SELECT direto de `cartrack_vehicles` e `cartrack_vehicle_snapshots`, ambos com `select("*")`; snapshots limitados a 5.000.
- Linhas 348–366: os dados são copiados para estado frontend, incluindo ID externo, matrícula, odómetro, velocidade, ignição e estado de ralenti. A projeção atual não é uma allowlist mínima controlada por endpoint.

### 2. Filtragem por empresa no cliente

Em `app.js`, linhas 400–420:

- O administrador global escolhe uma empresa.
- O frontend constrói a lista de matrículas das viaturas dessa empresa.
- CarTrack é filtrada no browser por matrícula normalizada.
- O próprio comentário do código reconhece que o `vehicle_id` CarTrack é um ID numérico do fornecedor, não o UUID Fleet.

**Conclusão de segurança:** esta filtragem é apenas apresentação. Os dados globais já foram lidos pelo browser antes do filtro. Não constitui isolamento por tenant, não protege os payloads descarregados e não resolve matrículas duplicadas/alteradas. Não deve ser reutilizada como controlo de autorização multiempresa.

### 3. Associação usada no painel

Em `app.js`, linhas 1364–1377, o painel constrói um Map indexado pela matrícula e procura a leitura CarTrack pela matrícula da viatura Fleet. Isto confirma a dependência atual da matrícula e deve ser substituído pelo `fleet_vehicle_id` canónico resolvido através de mapping persistente e autorizado no servidor.

### 4. Sincronização manual

Em `app.js`, linhas 1450–1461, o botão chama a Edge Function `cartrack-sync` sem parâmetros de empresa/conta no body e depois volta a carregar os dados. É adequado não confiar num ID de conta fornecido pelo browser; a futura implementação deve resolver conta e credenciais no servidor. O contrato novo não deve aceitar um seletor de empresa como autorização.

## Alterações necessárias antes do acesso multiempresa

1. Não executar SELECT direto às tabelas CarTrack no browser para empresas ou administradores com contexto de empresa.
2. Substituir o SELECT global por endpoint/RPC com autenticação, memberships e empresa autorizada resolvidas no servidor.
3. Retornar apenas campos allowlist, por viatura Fleet canónica: `fleet_vehicle_id`, odómetro, timestamp, estado operacional aprovado e indicador de atualidade.
4. Omitir payload raw, credenciais, IDs internos de conta, dados de outras empresas e diagnósticos do fornecedor.
5. Fazer o join pelo mapping canónico validado no servidor, nunca por matrícula no cliente.
6. Para o administrador global, manter a visão multiempresa apenas através de endpoint privilegiado explícito, auditável e com resposta mínima; a UI não deve descarregar todas as linhas brutas para filtrar localmente.
7. Rever exports, relatórios e quaisquer consumidores externos antes de remover ou restringir as tabelas/RPCs antigas.
8. Testar empresa A, empresa B, driver e administrador global com sessões distintas; testar também a ausência de acesso sem membership.

## Testes estáticos e limites

- A revisão confirma os SELECT diretos e os locais de filtragem/associação acima no branch `feature/company-fleet-foundation`.
- O endpoint de leitura substituto ainda não existe nesta revisão.
- A pesquisa de código GitHub devolveu zero resultados para os identificadores pesquisados; por isso, a revisão de consumidores fora do `app.js` permanece incompleta. Não se conclui que não existam outros consumidores.
- Não foram revogadas permissões nem alteradas políticas/RPCs, precisamente porque o inventário de consumidores ainda não está completo.
- Não foi feita sincronização real nem chamada à API CarTrack.

## Critério de saída

A leitura direta e a filtragem por matrícula só podem ser removidas numa alteração coordenada que já inclua o endpoint substituto, testes de acesso e plano de rollback. Não remover o caminho antigo antes de o substituto estar validado, mas também não ativar multiempresa enquanto o caminho global antigo continuar acessível a utilizadores não autorizados.
