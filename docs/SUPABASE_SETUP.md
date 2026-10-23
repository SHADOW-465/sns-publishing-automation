# Supabase setup

The app does not create a Supabase project and does not apply this migration. Until Showmik does the steps below, settings stay on this computer: the browser uses localStorage, and a script can use a JSON file.

Nothing here is a secret. Do not commit the anon key or the service role key.

## What to create

1. A Supabase project for this tool.
2. Apply `supabase/migrations/20261023180000_clients_books.sql` once, from the Supabase SQL editor or with `supabase db push` after the project is linked. Do not run it from the app.
3. A storage bucket named `reference-files`, private. The `reference_files` table stores the path, not the bytes. The app does not upload yet.
4. Auth for the people who will use the tool (email is enough). Row level security is on. Signed-in users can read and write every row. The anon key alone cannot, because there is no policy for `anon`.

## Tables

| Table | What it holds |
| --- | --- |
| `clients` | Publisher name. |
| `layers` | One settings layer: house, client, series, or book. The body is the same JSON the app already saves. Unique on level plus name. |
| `books` | Title, e-book ISBN, series, and output type (`standard-epub`, `accessible-epub`, or `accessible-pdf`). |
| `jobs` | A run against a book: status and a short summary. |
| `reference_files` | Input or output path in the bucket, and whether that file was excluded as a bad sample. |
| `decisions` | The append-only log of who accepted a spec or a waiver. |

## Environment variable names

Set these only on the machine or host that should talk to Supabase. Do not put the values in git.

| Name | Required | Meaning |
| --- | --- | --- |
| `SUPABASE_URL` | both, or neither | Project URL. |
| `SUPABASE_ANON_KEY` | both, or neither | The anon (publishable) key. The service role key is not used. |
| `SNS_STORE` | optional | Path of a JSON file used when the two Supabase variables are absent. |

`openStoreFromEnv` in `src/engine/spec/json-store.ts` picks the store: Supabase when both variables are set, otherwise the JSON file when `SNS_STORE` is set, otherwise memory. Tests use the JSON file or memory. The key is never written to a log.

The browser build does not import those files. The screen keeps using localStorage until a later change points it at this store.
