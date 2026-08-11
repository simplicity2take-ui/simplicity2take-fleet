# Simplicity2Take Fleet — palavras-passe controladas pelo administrador

Esta versão deixa a gestão das palavras-passe nas mãos do administrador:

- Ao criar um motorista, o administrador define a palavra-passe (mínimo 8 caracteres) e entrega-a diretamente.
- O motorista não vê botões de recuperação por e-mail.
- Se se esquecer, pode copiar uma mensagem para pedir ajuda ao administrador.
- O administrador abre a linha do motorista, escolhe **Definir passe** e cria uma nova palavra-passe.

## Publicar os ficheiros do site

No repositório GitHub `simplicity2take-fleet`, substitua na raiz os ficheiros:

`app.js`, `index.html` e `styles.css`.

Faça commit diretamente na branch `main`. O GitHub Pages fará a publicação automaticamente.

## Publicar as funções Supabase

Crie/publice estas duas Edge Functions no projeto Supabase, usando os ficheiros incluídos neste pacote:

- `admin-create-driver` → `supabase/functions/admin-create-driver/index.ts`
- `admin-reset-password` → `supabase/functions/admin-reset-password/index.ts`

Se usar a CLI:

```bash
supabase functions deploy admin-create-driver
supabase functions deploy admin-reset-password
```

As funções usam os segredos reservados do Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY`). Nunca coloque a `SERVICE_ROLE_KEY` no `app.js` ou no navegador.

## Teste rápido

1. Entre como administrador em `https://fleet.simplicity2take.com`.
2. Abra **Motoristas → Criar motorista** e defina a palavra-passe duas vezes.
3. Confirme que o motorista aparece na lista.
4. Na linha do motorista, use **Definir passe** para trocar a palavra-passe.
5. Abra a área de conta como motorista: deve aparecer apenas a opção para copiar a mensagem ao administrador.

Se aparecer um erro, veja **Edge Functions → Logs** no Supabase. O fluxo já não depende do envio de e-mails de recuperação, evitando o erro “email rate limit exceeded”.
