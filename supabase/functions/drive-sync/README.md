# S2T Google Drive Sync

This worker scans the configured Google Drive **Entrada** folder and imports new files into the S2T portal.

## Required Supabase secrets

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_DRIVE_INBOX_FOLDER_ID`
- `DRIVE_SYNC_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

The worker is protected by the `x-s2t-sync-secret` header and must never expose the service role key or Google credentials to the browser.

## Filename convention

Examples:

- `IPO-AA11BB-2027-05-31.pdf` → vehicle document
- `Seguro-AA11BB-2027-12-31.pdf` → vehicle document
- `Contrato-Joao Silva.pdf` → private driver document
- `Carta-Conducao-Joao Silva-2030-01-10.pdf` → private driver document
- `Cartao-Cidadao-Joao Silva-2031-02-20.pdf` → private driver document

The worker matches vehicle plates and driver names against the portal database. Documents without a match are still imported without an owner so the administrator can review them.

## Automation

After deployment, call the function periodically with:

`POST /functions/v1/drive-sync`

Header:

`x-s2t-sync-secret: <DRIVE_SYNC_SECRET>`

A 5–15 minute interval is appropriate for operational document ingestion.
