-- The client rulebook (242 rules) and the log of client corrections (130), from SNS_Rulebook_2026-10-25.xlsx.
-- Do not apply this from the app. Showmik applies it once; scripts/seed-rulebook.ts then fills the tables.

create table rules (
  id text primary key, -- IMG-005
  category text not null,
  output_type text not null, -- Standard EPUB, Accessible EPUB, Standard + Accessible EPUB, Accessible PDF, All
  source_format text not null, -- All, InDesign, PDF, Word
  statement text not null,
  rationale text,
  origin_type text, -- Standard, Client-stated, Client-reference, Implicit best practice
  origin text,
  scope text, -- 'Default (all clients)' or the client it belongs to
  verify text, -- how to check it
  engine_status text, -- Implemented, Partial / open, Needs code, Unknown
  engine_detail text, -- which check or file covers it, in words
  priority text check (priority in ('P0', 'P1', 'P2', 'P3')),
  notes text
);

create table corrections (
  id text primary key, -- CL-001
  received_date date,
  kind text, -- Correction, Requirement sheet, Bug report, ...
  source_file text,
  book text,
  page text,
  output_type text,
  source_format text,
  text text not null, -- what the client wrote
  rule_ids text[] not null default '{}', -- rules.id values; not a foreign key, a correction may name a rule not yet written
  status text, -- Open, Fixed (per repo history), Partly fixed, ...
  fix_commit text,
  proof text
);

create index corrections_rule_ids on corrections using gin (rule_ids);

alter table rules enable row level security;
alter table corrections enable row level security;

-- Same as the other tables: signed-in users can read and write. The anon key alone cannot.
create policy rules_team on rules for all to authenticated using (true) with check (true);
create policy corrections_team on corrections for all to authenticated using (true) with check (true);
