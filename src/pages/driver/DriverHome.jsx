import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import BookingCard from '../../components/BookingCard.jsx'
import DriverTabs from '../../components/DriverTabs.jsx'
import { vehicleById } from '../../lib/pricing.js'

export default function DriverHome() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState([])
  const [myTrip, setMyTrip] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data: active } = await supabase
      .from('bookings')
      .select('*')
      .eq('driver_id', user.id)
      .not('status', 'in', '(completed,cancelled)')
      .maybeSingle()
    setMyTrip(active || null)

    if (!active) {
      const { data: jobs } = await supabase
        .from('bookings')
        .select('*')
        .eq('status', 'pending')
        .not('vehicle_type', 'is', null) // OrderIt-bridged jobs awaiting admin vehicle assignment stay hidden until then
        .order('created_at', { ascending: true })
        .limit(20)
      setPending(jobs || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('driver-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleOnline() {
    await supabase.from('profiles').update({ is_online: !profile.is_online }).eq('id', user.id)
    refreshProfile()
  }

  async function acceptJob(booking) {
    const { error } = await supabase
      .from('bookings')
      .update({ driver_id: user.id, status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', booking.id)
      .eq('status', 'pending') // guard against double-accept
    if (!error) navigate(`/driver/trip/${booking.id}`)
  }

  return (
    <div className="max-w-4xl mx-auto px-5 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="dash mb-1">Driver console</p>
          <h1 className="h1">Job Feed</h1>
        </div>
        <button
          onClick={toggleOnline}
          className={`btn-ghost ${profile?.is_online ? 'border-line text-line' : ''}`}
        >
          {profile?.is_online ? '● Online' : '○ Offline'}
        </button>
      </div>

      <DriverTabs />

      {loading ? (
        <p className="dash">Loading…</p>
      ) : myTrip ? (
        <div className="max-w-md">
          <p className="dash mb-3">Current Trip</p>
          <BookingCard booking={myTrip} to={`/driver/trip/${myTrip.id}`} />
        </div>
      ) : !profile?.is_online ? (
        <p className="text-asphalt-400 text-sm">Go online to start receiving jobs.</p>
      ) : pending.length === 0 ? (
        <p className="text-asphalt-400 text-sm">No jobs waiting right now.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {pending.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              action={
                <button className="btn-primary mt-1" onClick={() => acceptJob(b)}>
                  Accept — {vehicleById(b.vehicle_type)?.label}
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
