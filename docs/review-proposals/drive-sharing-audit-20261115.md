# Auditoria de partilha Google Drive — 15/11/2026

## Objetivo
Verificar, **sem abrir conteúdos nem alterar documentos**, se as ligações a ficheiros da tabela `public.documents` do Fleet permitem acesso público ou através de partilha alargada.

## Verificações efetuadas
- Consulta de leitura no Supabase para identificar os documentos com `drive_file_id`: **2 ficheiros**.
- Consulta de **metadados** do Google Drive para cada ficheiro, sem baixar ficheiros e sem expor os seus identificadores neste relatório.
- Ambos os ficheiros devolveram `shared=false`, `source_visibility_status=permission_metadata_available` e apenas uma permissão `user:owner`; não surgiram permissões `anyone`, `domain` ou `group`.
- Também foram analisadas as respetivas pastas superiores, até à raiz acessível. As pastas consultadas não apresentaram partilhas públicas ou de domínio e devolveram apenas a permissão de proprietário. As duas cadeias de pastas partilham um antepassado, verificado uma única vez.

## Conclusão e limites
**Não foi encontrada partilha alargada nos dois ficheiros analisados nem nas respetivas cadeias de pastas.** Isto é uma constatação limitada aos metadados fornecidos pela conta Google Drive ligada à auditoria, no momento da consulta. Não comprova a privacidade de ficheiros adicionais, futuros uploads, contas de serviço distintas ou alterações posteriores às ACLs.

Uma URL direta de Google Drive não é, por si só, uma autorização de acesso; a visibilidade depende das ACLs do próprio Google Drive.

## Proteção preventiva preparada em código
A função `drive-upload` passa a enviar o parâmetro `ignoreDefaultVisibility=true` ao criar **novas pastas** e **novos ficheiros**. Segundo a documentação oficial `files.create`, este parâmetro impede aplicar a visibilidade padrão do domínio ao novo objeto, mas **não altera permissões herdadas da pasta principal**.

Esta proteção e os seus testes estão apenas no Pull Request #95 e **não foram aplicados à produção**.

## Proteção contra pastas homónimas e resultados incompletos
A função `drive-upload` já não seleciona a primeira pasta devolvida pelo Google Drive. Passa a pedir informação de paginação, nome, tipo e pai de cada pasta e:
- reutiliza apenas uma pasta cujo nome e diretório pai coincidam exatamente com o pretendido;
- interrompe o carregamento quando surgem duas pastas iguais, uma resposta incompleta, paginação adicional ou metadados incoerentes;
- confirma também o identificador, nome, tipo e diretório pai após criar uma pasta nova.

Nestes casos a operação falha de forma segura, **sem deslocar documentos nem escolher uma pasta por aproximação**. Se forem encontradas pastas duplicadas no ambiente real, será necessária revisão administrativa antes de voltar a carregar para essa localização. A deteção de respostas ambíguas e a validação do pai estão cobertas por testes isolados, não por carregamentos reais.

## Passos antes de publicar
1. Rever a configuração e as partilhas da pasta raiz efetivamente usada pela conta de serviço do Fleet, não apenas pela conta Google Drive da auditoria.
2. Testar a criação e leitura de um documento fictício numa pasta de testes, confirmando que nenhuma permissão de público/domínio foi herdada.
3. Verificar comportamento perante pastas partilhadas posteriormente e documentar como revogar acesso indevido sem perder ficheiros.
4. Obter aprovação explícita antes de publicação, alterações de permissões ou migrações.

**Nenhum ficheiro foi partilhado, modificado, movido, descarregado ou apagado nesta auditoria.**
