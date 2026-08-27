-- ============================================================================
-- MOTOR — Migration: driving licence field for driver KYC
-- Run this on the MOTOR project's Supabase SQL Editor. Safe to re-run.
--
-- Drivers previously only had Aadhar + vehicle RC fields — no Driving
-- Licence column existed at all. Signup now requires all three (Aadhar, DL,
-- RC) as mandatory documents, so this adds the missing DL columns and
-- updates the signup trigger to capture the DL number too.
-- ============================================================================

alter table profiles add column if not exists driving_licence_number text;
alter table profiles add column if not exists driving_licence_doc_path text;

-- Capture the DL number at sign-up alongside the existing onboarding fields.
-- (Storage policies for driver-documents already key off
-- (storage.foldername(name))[1] = auth.uid()::text, so no policy changes
-- are needed for the new dl.<ext> file — it's covered by the same rule as
-- aadhar.<ext> and vehicle_reg.<ext>.)
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (
    id, full_name, phone, role,
    vehicle_type, vehicle_number, address, aadhar_number, vehicle_reg_number,
    driving_licence_number
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    new.raw_user_meta_data->>'vehicle_type',
    new.raw_user_meta_data->>'vehicle_number',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'aadhar_number',
    new.raw_user_meta_data->>'vehicle_reg_number',
    new.raw_user_meta_data->>'driving_licence_number'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
