-- Upsert of the per-attendance price lists needs a plain unique constraint (a partial index cannot be an ON CONFLICT target).
-- NULL attendance types stay allowed many times (NULLs are distinct).
drop index if exists price_lists_org_id_attendance_type_idx;
alter table price_lists add constraint price_lists_org_attendance_unique unique (org_id, attendance_type);
