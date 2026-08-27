-- ============================================================================
-- MOTOR — Migration: formalize `source` / `external_order_id` + cap OrderIt
-- bridged bookings at 20km.
-- Run this on the MOTOR project's Supabase SQL Editor, after schema.sql and
-- motor_driver_vehicle_migration.sql.
--
-- Why: OrderIt bookings are inserted directly into this table via a
-- service-role key (see README "OrderIt integration"), bypassing any
-- client-side validation MoveIt's own React app could otherwise do. The
-- only place that boundary can actually be enforced is here, in the DB, via
-- a CHECK constraint so it applies no matter which app writes the row.
--
-- Also adds `source` / `external_order_id` to schema.sql formally — until
-- now these existed only informally per the README.
--
-- Safe to re-run.
-- ============================================================================

alter table bookings add column if not exists source text not null default 'direct'
  check (source in ('direct', 'orderit'));
alter table bookings add column if not exists external_order_id text;

-- OrderIt deliveries are capped at 20km (see src/lib/pricing.js —
-- ORDERIT_MAX_DISTANCE_KM / orderItDeliverySplit, per
-- MoveIT_Final_2W_3W_Price_List.xlsx). Direct MoveIt bookings
-- (source = 'direct') are unaffected and can go any distance.
--
-- Drop-then-add rather than a guarded IF NOT EXISTS check: an earlier
-- version of this migration created a 10km version of this constraint
-- (named bookings_orderit_max_10km) before the 2W/3W price list raised the
-- cap to 20km — this cleans that up on projects that already ran it, and is
-- a no-op on fresh installs where it never existed.
alter table bookings drop constraint if exists bookings_orderit_max_10km;
alter table bookings drop constraint if exists bookings_orderit_max_distance;
alter table bookings add constraint bookings_orderit_max_distance
  check (source <> 'orderit' or distance_km <= 20);

-- Index for OrderIt's own lookups (e.g. resolving its order back to the
-- bridged booking) and for the pg_net status-webhook trigger's own queries.
create index if not exists bookings_external_order_id_idx
  on bookings (external_order_id) where external_order_id is not null;
