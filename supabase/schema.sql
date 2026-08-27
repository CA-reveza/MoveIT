-- MoveIT schema: profiles, bookings, ratings
-- Run this in the Supabase SQL editor. Safe to run multiple times — table/
-- function/policy creation is all guarded (create if not exists, drop-then-
-- create for policies), so re-running after an update to this file just
-- applies whatever's new.


-- 1. Profiles (extends auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null check (role in ('customer', 'driver', 'admin')),
  is_online boolean default false,
  created_at timestamptz default now()
);

-- 2. Bookings
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  driver_id uuid references profiles(id) on delete set null,
  pickup_address text not null,
  drop_address text not null,
  distance_km numeric not null default 1,
  vehicle_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'picked_up', 'in_transit', 'completed', 'cancelled')),
  fare_estimate numeric not null default 0,
  fare_final numeric,
  notes text,
  created_at timestamptz default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  completed_at timestamptz
);

-- `create table if not exists` above doesn't add columns to a table that
-- already existed from an earlier run — these fill it in either way.
alter table bookings add column if not exists pickup_lat numeric;
alter table bookings add column if not exists pickup_lng numeric;
alter table bookings add column if not exists drop_lat numeric;
alter table bookings add column if not exists drop_lng numeric;

-- 3. Ratings
create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  driver_id uuid references profiles(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

-- One rating per booking — without this, refreshing the track page right
-- after submitting (before the page re-fetches) could insert a second row
-- for the same trip. Existing bookings may already have duplicate rating
-- rows from before this constraint existed, so clear those out first (kept:
-- the most recent rating per booking) — otherwise the unique index below
-- fails with "could not create unique index ... is duplicated".
delete from ratings a using ratings b
where a.booking_id = b.booking_id
  and (a.created_at, a.ctid) < (b.created_at, b.ctid);

-- (Postgres has no "add constraint if not exists", so this is guarded
-- manually like the realtime publication check below.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ratings_booking_id_key'
  ) then
    alter table ratings add constraint ratings_booking_id_key unique (booking_id);
  end if;
end $$;

-- Auto-create a profile row whenever a new auth user signs up, reading
-- full_name / phone / role out of the metadata passed to supabase.auth.signUp().
-- Runs as SECURITY DEFINER so it works even before the user has a session
-- (e.g. while email confirmation is pending) — the client never inserts
-- into profiles directly.
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: is the current user an admin?
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer;

-- Enable RLS
alter table profiles enable row level security;
alter table bookings enable row level security;
alter table ratings enable row level security;

-- Profiles policies
drop policy if exists "Users can read own profile" on profiles;
create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id or is_admin());

drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile" on profiles
  for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id or is_admin());

-- Drivers need to be readable by customers who booked them, and vice versa.
-- Simplify by allowing any authenticated user to read minimal profile fields
-- via a view in production; for this scaffold we allow broad read of profiles
-- to authenticated users so trip pages can show driver/customer name+phone.
drop policy if exists "Authenticated users can read profiles" on profiles;
create policy "Authenticated users can read profiles" on profiles
  for select using (auth.role() = 'authenticated');

-- Bookings policies
drop policy if exists "Customers can create bookings" on bookings;
create policy "Customers can create bookings" on bookings
  for insert with check (auth.uid() = customer_id);

drop policy if exists "Customers can read own bookings" on bookings;
create policy "Customers can read own bookings" on bookings
  for select using (auth.uid() = customer_id or auth.uid() = driver_id or is_admin());

drop policy if exists "Drivers can read pending bookings" on bookings;
create policy "Drivers can read pending bookings" on bookings
  for select using (status = 'pending');

drop policy if exists "Customers can update own pending bookings" on bookings;
create policy "Customers can update own pending bookings" on bookings
  for update using (auth.uid() = customer_id or auth.uid() = driver_id or is_admin());

-- A driver isn't yet `driver_id` on a pending row when they try to accept it,
-- so the policy above (which checks the *existing* driver_id) blocks the
-- claim. This policy separately allows any driver to move a still-pending,
-- unassigned row to themselves. Postgres OR's permissive policies together,
-- so this only adds a capability — it doesn't loosen the one above.
drop policy if exists "Drivers can accept pending bookings" on bookings;
create policy "Drivers can accept pending bookings" on bookings
  for update
  using (status = 'pending' and driver_id is null)
  with check (driver_id = auth.uid());

-- Ratings policies
drop policy if exists "Customers can insert ratings for own bookings" on ratings;
create policy "Customers can insert ratings for own bookings" on ratings
  for insert with check (
    exists (select 1 from bookings where bookings.id = booking_id and bookings.customer_id = auth.uid())
  );

drop policy if exists "Users can read relevant ratings" on ratings;
create policy "Users can read relevant ratings" on ratings
  for select using (
    exists (
      select 1 from bookings
      where bookings.id = booking_id
        and (bookings.customer_id = auth.uid() or bookings.driver_id = auth.uid())
    ) or is_admin()
  );

-- Realtime: make sure the bookings table publishes changes (safe to re-run)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table bookings;
  end if;
end $$;
