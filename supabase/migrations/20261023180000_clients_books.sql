-- Settings layers, books and reference files for the publishing tool.
-- Do not apply this from the app. Showmik applies it once the project exists.
-- See docs/SUPABASE_SETUP.md.

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table layers (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('house', 'client', 'series', 'book')),
  name text not null,
  client_id uuid references clients (id) on delete cascade,
  body jsonb not null,
  updated_at timestamptz not null default now(),
  unique (level, name)
);

create table books (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients (id) on delete set null,
  title text not null,
  eisbn text,
  series text,
  output_type text not null check (output_type in ('standard-epub', 'accessible-epub', 'accessible-pdf')),
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books (id) on delete cascade,
  status text not null default 'draft',
  summary text,
  created_at timestamptz not null default now()
);

create table reference_files (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books (id) on delete cascade,
  role text not null check (role in ('input', 'output')),
  storage_path text not null,
  note text,
  excluded boolean not null default false,
  created_at timestamptz not null default now()
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  client text not null default '',
  book text not null default '',
  rule_id text,
  detail text not null,
  spec_hash text not null default '',
  snapshot jsonb
);

alter table clients enable row level security;
alter table layers enable row level security;
alter table books enable row level security;
alter table jobs enable row level security;
alter table reference_files enable row level security;
alter table decisions enable row level security;

-- One team uses this project. Signed-in users can read and write. The anon key alone cannot.
create policy clients_team on clients for all to authenticated using (true) with check (true);
create policy layers_team on layers for all to authenticated using (true) with check (true);
create policy books_team on books for all to authenticated using (true) with check (true);
create policy jobs_team on jobs for all to authenticated using (true) with check (true);
create policy reference_files_team on reference_files for all to authenticated using (true) with check (true);
create policy decisions_team on decisions for all to authenticated using (true) with check (true);
