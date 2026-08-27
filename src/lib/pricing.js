// Vehicle catalog: mirrors Porter's mixed two-wheeler / mini-truck lineup.
export const VEHICLE_TYPES = [
  { id: 'bike', label: 'Two-Wheeler', desc: 'Small parcels, documents', capacityKg: 20, base: 30, perKm: 6 },
  { id: 'three_wheeler', label: '3-Wheeler', desc: 'Small loads, tight lanes', capacityKg: 300, base: 60, perKm: 11 },
  { id: 'pickup', label: 'Pickup Truck', desc: 'Furniture, appliances', capacityKg: 750, base: 120, perKm: 16 },
  { id: 'mini_truck', label: 'Mini Truck', desc: 'Bulk goods, house shift', capacityKg: 1500, base: 220, perKm: 22 },
  { id: 'large_truck', label: 'Large Truck', desc: 'Full house / commercial', capacityKg: 5000, base: 450, perKm: 34 },
]

export function vehicleById(id) {
  return VEHICLE_TYPES.find((v) => v.id === id)
}

// Straight-line distance in km between two lat/lng points (Haversine).
export function distanceKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function estimateFare(vehicleTypeId, km) {
  const v = vehicleById(vehicleTypeId)
  if (!v) return 0
  return Math.round(v.base + v.perKm * Math.max(km, 1))
}

// Platform's cut of every completed trip's fare — the rest goes to the
// driver. Kept as a single constant here (rather than scattering the
// percentage across every report/payout screen) so admin, reports, and the
// driver's own payout page can never disagree about the split.
export const PLATFORM_COMMISSION_PCT = 15

export function splitFare(fare) {
  const gross = Number(fare) || 0
  const commission = Math.round((gross * PLATFORM_COMMISSION_PCT) / 100)
  return { gross, commission, payout: gross - commission }
}

// ----------------------------------------------------------------------------
// OrderIt-bridged deliveries (source = 'orderit')
//
// These bookings are hotel/restaurant delivery legs created by OrderIt, not
// a customer picking a vehicle in MoveIt directly, so they don't use
// estimateFare/splitFare above. Pricing comes from
// MoveIT_Final_2W_3W_Price_List.xlsx — per-vehicle tiers, each with a flat
// base charge up to 5km, a per-km rate beyond that, a flat platform charge
// on top, and a driver/MoveIT margin split of the delivery charge itself
// (the platform charge is not split — it's 100% MoveIT's).
//
//   delivery_charge = baseCharge + perKmAfter × max(km − baseKm, 0)
//   customer_total  = delivery_charge + platformCharge      (= gross)
//   driver_payout   = delivery_charge × driverPct
//   moveit_cut      = delivery_charge × marginPct + platformCharge  (= commission)
//
// OrderIt deliveries are capped at 20km — also enforced in the DB, see
// motor_orderit_distance_cap_migration.sql.
//
// NOTE: direct MoveIt bookings (a customer booking a vehicle themselves)
// keep using estimateFare/splitFare unchanged — this section is OrderIt-only.
export const ORDERIT_MAX_DISTANCE_KM = 20

const ORDERIT_VEHICLE_TIERS = {
  bike: { // Two-Wheeler
    baseKm: 5,
    baseCharge: 90,
    perKmAfter: 20,
    platformCharge: 20,
    driverPct: 0.7,
    marginPct: 0.3,
  },
  three_wheeler: {
    baseKm: 5,
    baseCharge: 125,
    perKmAfter: 35,
    platformCharge: 20,
    driverPct: 0.8,
    marginPct: 0.2,
  },
}

// Fallback for an OrderIt booking on any vehicle type other than 2W/3W —
// OrderIt currently only offers those two for hotel/restaurant deliveries,
// so this shouldn't come up. Kept as the original flat ₹150-base /
// ₹25-per-km tier this file used before the price list existed, so nothing
// breaks if an unexpected vehicle type ever shows up — but it's a
// placeholder, not an approved rate, and worth flagging if you see it used.
const ORDERIT_FALLBACK_TIER = {
  baseKm: 5,
  baseCharge: 150,
  perKmAfter: 25,
  platformCharge: 0,
  driverPct: 100 / 150,
  marginPct: 50 / 150,
}

export function orderItDeliverySplit(distanceKm, vehicleTypeId) {
  const tier = ORDERIT_VEHICLE_TIERS[vehicleTypeId] || ORDERIT_FALLBACK_TIER
  // Clamp defensively — the DB constraint should already prevent an
  // orderit-sourced row from ever exceeding 20km, but a display-layer
  // clamp means a stray bad row can't silently overcharge past the cap.
  const km = Math.min(Math.max(Number(distanceKm) || 0, 0), ORDERIT_MAX_DISTANCE_KM)
  const deliveryCharge = tier.baseCharge + tier.perKmAfter * Math.max(km - tier.baseKm, 0)
  return {
    gross: Math.round(deliveryCharge + tier.platformCharge),
    commission: Math.round(deliveryCharge * tier.marginPct + tier.platformCharge),
    payout: Math.round(deliveryCharge * tier.driverPct),
  }
}

// Single entry point for anywhere a booking's gross/commission/payout needs
// to be shown (admin dashboard, reports, driver payout). Picks the right
// split based on where the booking came from, so those screens don't need
// to know about source-specific pricing rules themselves.
export function splitBookingFare(booking) {
  if (booking?.source === 'orderit') {
    return orderItDeliverySplit(booking.distance_km, booking.vehicle_type)
  }
  return splitFare(booking?.fare_final ?? booking?.fare_estimate ?? 0)
}
