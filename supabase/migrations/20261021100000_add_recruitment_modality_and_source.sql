alter table public.applications
  add column if not exists candidate_modality text,
  add column if not exists source_site text;

alter table public.applications
  add constraint applications_candidate_modality_check
  check (candidate_modality is null or candidate_modality in ('viatura da empresa', 'viatura própria'));

alter table public.applications
  add constraint applications_source_site_check
  check (source_site is null or source_site in ('fleet', 'website'));
