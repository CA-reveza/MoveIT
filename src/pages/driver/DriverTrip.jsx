import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { vehicleById, splitBookingFare } from '../../lib/pricing.js'

const NEXT_STATUS = {
  accepted: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'completed',
}

const NEXT_LABEL = {
  accepted: 'Mark Picked Up',
  picked_up: 'Start Trip',
  in_transit: 'Mark Delivered',
}

export default function DriverTrip() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [booking, setBooking] = useState(null)
  const [customer, setCustomer] = useState(null)

  async function load() {
    const { data } = await supabase.from('bookings').select('*').eq('id', id).single()
    setBooking(data)
    if (data?.customer_id) {
      const { data: c } = await supabase.from('profiles').select('full_name, phone').eq('id', data.customer_id).single()
      setCustomer(c)
    }
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`driver-trip-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function advance() {
    const next = NEXT_STATUS[booking.status]
    if (!next) return
    const patch = { status: next }
    if (next === 'picked_up') patch.picked_up_at = new Date().toISOString()
    if (next === 'completed') {
      patch.completed_at = new Date().toISOString()
      patch.fare_final = booking.fare_estimate
    }
    await supabase.from('bookings').update(patch).eq('id', id)
    if (next === 'completed') navigate('/driver')
  }

  async function cancel() {
    await supabase.from('bookings').update({ status: 'cancelled', driver_id: null }).eq('id', id)
    navigate('/driver')
  }

  if (!booking) return <div className="max-w-2xl mx-auto px-5 py-10 dash">Loading…</div>

  const vehicle = vehicleById(booking.vehicle_type)
  const driverRate = splitBookingFare(booking).payout

  return (
    <div className="max-w-2xl mx-auto px-5 py-10">
      <p className="dash mb-2">Trip #{booking.id.slice(0, 8)}</p>
      <div className="flex items-center justify-between mb-8">
        <h1 className="h1">Active Trip</h1>
        <StatusBadge status={booking.status} />
      </div>

      <div className="card p-5 mb-5">
        <p className="text-asphalt-200">↑ {booking.pickup_address}</p>
        <p className="text-asphalt-400 mt-1">↓ {booking.drop_address}</p>
        {booking.order_details?.orders?.map((o) => (
          <div key={o.order_number} className="mt-3 text-sm text-asphalt-300">
            <p className="font-mono text-xs text-asphalt-400">Order {o.order_number}{o.hotel ? ` · ${o.hotel}` : ''}</p>
            <ul className="list-disc ml-5">
              {o.items.map((i, idx) => <li key={idx}>{i.name} — {i.quantity} {i.unit}</li>)}
            </ul>
          </div>
        ))}
        {booking.notes && <p className="text-asphalt-400 text-sm mt-3 italic">"{booking.notes}"</p>}
        <div className="flex justify-between font-mono text-sm mt-4 text-asphalt-400">
          <span>{vehicle?.label} · {booking.distance_km}km</span>
          <span className="text-line">₹{driverRate} <span className="text-asphalt-500 text-xs">(your rate)</span></span>
        </div>
      </div>

      {customer && (
        <div className="card p-5 mb-5">
          <p className="dash mb-1">Customer</p>
          <p className="text-asphalt-200">{customer.full_name}</p>
          <p className="text-asphalt-400 font-mono text-sm">{customer.phone}</p>
        </div>
      )}

      <div className="flex gap-3">
        {NEXT_STATUS[booking.status] && (
          <button className="btn-primary flex-1" onClick={advance}>
            {NEXT_LABEL[booking.status]}
          </button>
        )}
        {booking.status !== 'completed' && (
          <button className="btn-ghost" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
