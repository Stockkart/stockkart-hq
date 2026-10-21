# Restoring a database backup

The nightly workflow (`.github/workflows/backup.yml`, SPEC §9.3) keeps plain-SQL `pg_dump`
files in the private R2 bucket:

- `backups/daily/<YYYY-MM-DD>.sql.gz`: the last 7 nights
- `backups/weekly/<YYYY-MM-DD>.sql.gz`: the last 4 Sundays

**Always restore into a new, empty Neon branch or database first**, never straight over
`main`. Check the data there, then point the app at it (or copy what you need back).

## 1. Create an empty target

Neon console → your project → **Branches → Create branch**. Pick "No data" / schema-less if
offered (for example name it `restore-2026-03-14`); otherwise create a new empty database in
that branch. Copy its **direct** connection string (Connect → connection pooling **off**):
`psql` restores a dump in one session, which the pooler does not support.

## 2. Download the dump

Use an R2 API token with read access to the bucket (Cloudflare → R2 → Manage API tokens).
Keep the credentials in your shell only, never in a file in this repo, and download outside
the repo checkout (the dump holds private data; the repo is public):

```bash
read -rs AWS_SECRET_ACCESS_KEY   # paste the token's secret access key; not echoed
export AWS_ACCESS_KEY_ID=<token id> AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
R2="https://<account-id>.r2.cloudflarestorage.com"
cd "$(mktemp -d)"
aws s3 ls "s3://<bucket>/backups/daily/" --endpoint-url "$R2"
aws s3 ls "s3://<bucket>/backups/weekly/" --endpoint-url "$R2"
aws s3 cp "s3://<bucket>/backups/daily/2026-03-14.sql.gz" . --endpoint-url "$R2"
```

(The Cloudflare dashboard's R2 object browser can download a single object too.)

## 3. Restore

Use `psql` 17 (the dump comes from `pg_dump` 17). The dump has no owners or grants
(`--no-owner --no-privileges`), so any role that owns the target database can load it:

```bash
read -rs RESTORE_DATABASE_URL   # paste the direct URL of the new branch, not echoed
gunzip -c 2026-03-14.sql.gz | psql "$RESTORE_DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction
```

Without a local `psql`, the same in Docker (the dump is piped in, the URL passed as an env
var):

```bash
gunzip -c 2026-03-14.sql.gz | docker run -i --rm -e RESTORE_DATABASE_URL postgres:17-alpine \
  sh -c 'psql "$RESTORE_DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction'
```

## 4. Check, then switch

- Spot-check: `psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM issues'` and open a few
  issues and docs with the app pointed at the branch (a Vercel preview with that branch's
  pooled `DATABASE_URL`).
- Migrations: the dump includes `drizzle.__drizzle_migrations`, so `pnpm db:migrate` against
  the branch only applies migrations newer than the backup.
- To make it production, either set the branch as Neon's primary / point Vercel's
  `DATABASE_URL` at it and redeploy, or copy the needed rows back.
- Attachments live in R2, not in the dump; their rows point at objects that are never
  deleted on soft delete, so restored rows keep working.

Finally delete the local dump (`rm 2026-03-14.sql.gz`) and the temporary directory.
