-- ============================================================================
-- MOTOR — Migration: allow OrderIt-bridged bookings to arrive with no
-- vehicle assigned yet, so MOTOR's own admin decides 2-Wheeler vs 3-Wheeler.
-- Run on the MOTOR project's Supabase SQL Editor.
-- Safe to re-run.
--
-- Previously APMC chose the vehicle in OrderIT's DeliveryPanel before the
-- booking was even created. Now APMC just clicks "Book via MoveIT" — the
-- booking arrives with vehicle_type = null, and doesn't show up in any
-- driver's job feed (see DriverHome.jsx's query) until an admin assigns a
-- vehicle from AdminDashboard's Bookings table.
-- ============================================================================

alter table bookings alter column vehicle_type drop not null;
