# MoveIT

A Porter-style on-demand logistics app: customers book a vehicle (two-wheeler
through large truck), nearby drivers accept and run the trip, and admins
watch the whole fleet from one dashboard. Built with Vite + React + Supabase.

## Stack

- **Vite + React 18** — frontend, no framework lock-in
- **React Router** — role-based routing (`/`, `/driver`, `/admin`)
- **Supabase** — Postgres + Auth + Realtime (row-level security enforced)
- **Tailwind CSS** — asphalt/road-marking design system (see `tailwind.config.js`)

No external maps/geocoding provider is wired in — pickup/drop are plain text
fields and distance is entered by hand. See "Extending this scaffold" below
for how to add real geocoding later, on your own terms.

## Setup

1. **Create a Supabase project** at supabase.com.
2. **Run the schema**: open the SQL editor in your Supabase project and run
   the contents of `supabase/schema.sql`. This creates `profiles`,
   `bookings`, `ratings`, and all RLS policies. The whole file is safe to
   re-run any time you pull an update to it.
3. **Copy env vars**:
   ```bash
   cp .env.example .env
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
   Project Settings → API in your Supabase dashboard.
4. **Install & run**:
   ```bash
   npm install
   npm run dev
   ```
   App runs at `http://localhost:5173`.

## How roles work

Every user signs up as either `customer` or `driver` (pick on the signup
screen) — this is written to `profiles.role`. There's no self-serve `admin`
signup: promote a user to admin manually after they sign up:

```sql
update profiles set role = 'admin' where id = 'the-users-uuid';
```

The router (`src/App.jsx`) sends each role to its own home:
- `customer` → `/` (book + track trips)
- `driver` → `/driver` (go online, accept jobs, run trips)
- `admin` → `/admin` (fleet stats, all bookings, all drivers)

## Booking flow

1. Customer submits pickup/drop address + distance + vehicle type from
   `/book`. Fare is estimated client-side (`src/lib/pricing.js`) and stored
   as `fare_estimate`.
2. Booking lands in `pending`. Any online driver sees it in their feed
   (`/driver`) and can accept — the first accept wins (guarded by a
   conditional update on `status = 'pending'`, backed by an RLS policy that
   lets a driver claim an unassigned pending row).
3. Driver walks the trip through `accepted → picked_up → in_transit →
   completed` from `/driver/trip/:id`. The customer's `/track/:id` page
   updates live via Supabase Realtime subscriptions — no polling.
4. On completion the customer can leave a 1–5 rating.

## OrderIt integration (bridged bookings)

This copy of MoveIT has been patched to work as the delivery layer for a
separate app called OrderIt (a hotel↔APMC procurement platform, its own
Supabase project). OrderIt creates bookings here directly via a service-role
key when a supplier books a vehicle, tagged `source = 'orderit'` with an
`external_order_id` pointing back to the OrderIt order. Everything else about
those bookings — driver accept/progress flow — works exactly like a normal
MoveIT booking.

**Run these seven migrations, in order, in addition to the base `schema.sql`:**
1. `supabase/motor_driver_vehicle_migration.sql` — adds `vehicle_type`,
   `vehicle_number`, `address`, `aadhar_number`, `vehicle_reg_number` to
   `profiles`. Without this, admins have no way to assign a driver a vehicle,
   so drivers can never accept any job (including bridged ones).
2. `supabase/motor_document_upload_migration.sql` — private Storage bucket +
   RLS for drivers to upload Aadhar/vehicle-RC photos, viewable by admins.
3. `supabase/motor_driving_licence_migration.sql` — adds
   `driving_licence_number`/`driving_licence_doc_path` to `profiles`. Signup
   requires all three documents (Aadhar, DL, RC) — skip this one and driver
   signup fails outright with `Could not find the 'driving_licence_doc_path'
   column of 'profiles' in the schema cache`.
4. `supabase/motor_pgnet_webhook_workaround.sql` — pushes booking status
   changes back to OrderIt via a `pg_net` trigger. Use this instead of the
   dashboard's "Database Webhooks" feature if you hit
   `ERROR: 3F000: schema "supabase_functions" does not exist` there — that's
   a known Supabase provisioning bug on some projects, and this sidesteps it
   entirely. Fill in the two placeholders (OrderIt's Edge Function URL and
   your shared webhook secret) before running.
5. `supabase/motor_orderit_distance_cap_migration.sql` — formalizes the
   `source`/`external_order_id` columns and adds a CHECK constraint capping
   `source = 'orderit'` bookings at 20km. Since OrderIt inserts bookings
   directly via a service-role key, this DB constraint is the only place the
   distance cap can actually be enforced regardless of which app is writing.
6. `supabase/motor_orderit_vehicle_optional_migration.sql` — drops the
   `NOT NULL` on `bookings.vehicle_type`, so OrderIt-bridged bookings can
   arrive with no vehicle yet ("Book via MoveIT" no longer asks APMC to pick
   one) — MOTOR's own admin assigns 2W/3W afterwards from the Bookings tab.
7. `supabase/motor_orderit_order_details_migration.sql` — adds
   `bookings.order_details` (JSON) so each OrderIt booking carries its order
   number, goods list and prices for MoveIT admin. Skipping it is safe: OrderIt
   falls back to putting the same details in the booking notes.

### OrderIt delivery pricing (per-vehicle distance tiers)

OrderIt-bridged bookings don't use the vehicle-based `estimateFare`/
`splitFare` in `src/lib/pricing.js` that a direct MoveIT customer booking
does — they use per-vehicle distance tiers instead (from
`MoveIT_Final_2W_3W_Price_List.xlsx`), computed by `orderItDeliverySplit()`:

| Vehicle | 1–5 km (flat) | Per km after 5km | Platform charge | Driver share | MoveIT margin |
|---|---|---|---|---|---|
| Two-Wheeler (`bike`) | ₹90 | +₹20/km | ₹20 flat | 70% of delivery charge | 30% of delivery charge |
| 3-Wheeler (`three_wheeler`) | ₹125 | +₹35/km | ₹20 flat | 80% of delivery charge | 20% of delivery charge |

Capped at 20km (see migration above). The platform charge is flat regardless
of distance and isn't split — it's entirely MoveIT's, on top of its margin
share of the delivery charge. Example at 10km: Two-Wheeler customer total
₹210 (driver ₹133 / MoveIT ₹77), 3-Wheeler customer total ₹320 (driver ₹240
/ MoveIT ₹80).

Only 2W/3W have official rates so far since those are the only vehicle
types OrderIt currently offers for hotel/restaurant deliveries. Any other
vehicle type on an `orderit`-sourced booking falls back to a placeholder
rate in `pricing.js` (flagged in a comment there) rather than breaking.

`splitBookingFare(booking)` is the single entry point the app (admin
dashboard, reports, driver payout) uses to get the right split — it checks
`booking.source` and routes to `orderItDeliverySplit()` for `'orderit'` rows
or the existing flat-commission `splitFare()` for everything else. Direct
customer bookings in MoveIT keep their current vehicle-based pricing
unchanged for now — a separate calculation for that is planned but not yet
built.

**What changed from the base scaffold:**
- `src/pages/admin/AdminDrivers.jsx` — vehicle assignment UI, KYC status,
  document view/verify links (was previously read-only)
- `src/pages/auth/Signup.jsx` + `src/context/AuthContext.jsx` — driver
  sign-up now collects vehicle type/number, Aadhar number, RC number, address
- `src/components/DriverDocumentUpload.jsx` — new; the actual file-upload
  widget, shown inline on the driver's job feed
- `src/pages/driver/DriverHome.jsx` — gates the job feed until a vehicle is
  assigned; shows the document upload widget when documents are missing;
  **the job feed now only shows bookings matching the driver's own assigned
  vehicle type** (previously showed every pending booking to every driver
  regardless of vehicle — a Two-Wheeler driver could see and accept a job
  that actually needed a Mini Truck)

## Extending this scaffold

- **Real geocoding/maps**: `distance_km` is currently entered by hand.
  If you want address autocomplete and computed distance later, `bookings`
  already has `pickup_lat`/`pickup_lng`/`drop_lat`/`drop_lng` columns ready
  to populate — you'd wire up whichever geocoding provider you're
  comfortable with (Google, Mappls, OpenStreetMap/Nominatim, etc.) and feed
  the result into `estimateFare()`. Worth checking a provider's CORS policy
  and console UI before committing — that's what cost the most time last
  time around.
- **Live driver location**: add a `driver_locations` table and push
  lat/lng from the driver app every few seconds; subscribe to it from
  `TrackBooking.jsx` to render a moving marker.
- **Payments**: `fare_final` is set to `fare_estimate` on completion —
  wire in Razorpay/Stripe before that step for real charges.
- **Vehicle capacity matching**: `src/lib/pricing.js` already carries
  `capacityKg` per vehicle type if you want to filter/suggest by load.
