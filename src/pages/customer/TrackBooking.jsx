import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { vehicleById } from '../../lib/pricing.js'

const STEPS = ['pending', 'accepted', 'picked_up', 'in_transit', 'completed']

export default function TrackBooking() {
  const { id } = useParams()
  const [booking, setBooking] = useState(null)
  const [driver, setDriver] = useState(null)
  const [rating, setRating] = useState(0)
  const [submittedRating, setSubmittedRating] = useState(false)

  async function load() {
    const { data } = await supabase.from('bookings').select('*').eq('id', id).single()
    setBooking(data)
    if (data?.driver_id) {
      const { data: d } = await supabase.from('profiles').select('full_name, phone').eq('id', data.driver_id).single()
      setDriver(d)
    }
    const { data: existingRating } = await supabase
      .from('ratings')
      .select('rating')
      .eq('booking_id', id)
      .maybeSingle()
    if (existingRating) {
      setRating(existingRating.rating)
      setSubmittedRating(true)
    }
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`booking-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function submitRating() {
    if (submittedRating) return
    const { error } = await supabase.from('ratings').insert({ booking_id: id, rating, driver_id: booking.driver_id })
    if (!error) setSubmittedRating(true)
  }

  if (!booking) return <div className="max-w-2xl mx-auto px-5 py-10 dash">Loading…</div>

  const vehicle = vehicleById(booking.vehicle_type)
  const stepIndex = STEPS.indexOf(booking.status)

  return (
    <div className="max-w-2xl mx-auto px-5 py-10">
      <p className="dash mb-2">Booking #{booking.id.slice(0, 8)}</p>
      <div className="flex items-center justify-between mb-8">
        <h1 className="h1">Track</h1>
        <StatusBadge status={booking.status} />
      </div>

      {booking.status !== 'cancelled' && (
        <div className="flex mb-10">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full ${
                  i <= stepIndex ? 'bg-signal' : 'bg-asphalt-700'
                }`}
              />
              <span className="dash mt-2 text-center">{s.replace('_', ' ')}</span>
              {i < STEPS.length - 1 && (
                <div className={`h-px w-full mt-[-16px] ${i < stepIndex ? 'bg-signal' : 'bg-asphalt-700'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card p-5 mb-5">
        <p className="text-asphalt-200">↑ {booking.pickup_address}</p>
        <p className="text-asphalt-400 mt-1">↓ {booking.drop_address}</p>
        <div className="flex justify-between font-mono text-sm mt-4 text-asphalt-400">
          <span>{vehicle?.label} · {booking.distance_km}km</span>
          <span className="text-line">₹{booking.fare_final ?? booking.fare_estimate}</span>
        </div>
      </div>

      {driver && (
        <div className="card p-5 mb-5">
          <p className="dash mb-1">Driver</p>
          <p className="text-asphalt-200">{driver.full_name}</p>
          <p className="text-asphalt-400 font-mono text-sm">{driver.phone}</p>
        </div>
      )}

      {booking.status === 'completed' && !submittedRating && (
        <div className="card p-5">
          <p className="dash mb-3">Rate this trip</p>
          <div className="flex gap-2 mb-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={`w-9 h-9 rounded-sm border font-mono ${
                  n <= rating ? 'border-signal text-signal' : 'border-asphalt-600 text-asphalt-400'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button className="btn-primary" disabled={!rating} onClick={submitRating}>
            Submit Rating
          </button>
        </div>
      )}
      {submittedRating && (
        <div className="card p-5">
          <p className="dash mb-2">Your rating</p>
          <div className="flex gap-2 mb-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`w-9 h-9 flex items-center justify-center rounded-sm border font-mono ${
                  n <= rating ? 'border-signal text-signal' : 'border-asphalt-700 text-asphalt-600'
                }`}
              >
                {n}
              </span>
            ))}
          </div>
          <p className="text-line dash">Thanks for the rating.</p>
        </div>
      )}
    </div>
  )
}
