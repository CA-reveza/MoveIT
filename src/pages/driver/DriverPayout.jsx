import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import DriverTabs from '../../components/DriverTabs.jsx'
import { splitBookingFare } from '../../lib/pricing.js'

function startOfWeek(d) {
  const date = new Date(d)
  const day = date.getDay() === 0 ? 7 : date.getDay() // Mon=1..Sun=7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (day - 1))
  return date
}

export default function DriverPayout() {
  const { user } = useAuth()
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('driver_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(200)
      if (active) {
        setTrips(data || [])
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [user.id])

  const earn = (b) => splitBookingFare(b).payout
  const grossOf = (b) => splitBookingFare(b).gross
  const commissionOf = (b) => splitBookingFare(b).commission
  const total = trips.reduce((sum, b) => sum + earn(b), 0)

  const weekStart = startOfWeek(new Date())
  const thisWeek = trips.filter((b) => b.completed_at && new Date(b.completed_at) >= weekStart)
  const weekTotal = thisWeek.reduce((sum, b) => sum + earn(b), 0)

  return (
    <div className="max-w-4xl mx-auto px-5 py-10">
      <div className="mb-8">
        <p className="dash mb-1">Driver console</p>
        <h1 className="h1">Payout</h1>
      </div>

      <DriverTabs />

      {loading ? (
        <p className="dash">Loading…</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            <div className="card p-5">
              <p className="dash mb-1">This week — your payout</p>
              <p className="text-2xl font-display font-bold text-signal">₹{weekTotal.toFixed(0)}</p>
              <p className="text-asphalt-400 text-sm mt-1">{thisWeek.length} trip{thisWeek.length === 1 ? '' : 's'} · after platform fee</p>
            </div>
            <div className="card p-5">
              <p className="dash mb-1">All time — your payout</p>
              <p className="text-2xl font-display font-bold text-signal">₹{total.toFixed(0)}</p>
              <p className="text-asphalt-400 text-sm mt-1">{trips.length} trip{trips.length === 1 ? '' : 's'}</p>
            </div>
            <div className="card p-5">
              <p className="dash mb-1">Avg. payout per trip</p>
              <p className="text-2xl font-display font-bold text-signal">
                ₹{trips.length ? (total / trips.length).toFixed(0) : '0'}
              </p>
            </div>
          </div>

          <p className="dash mb-3">Completed trips</p>
          {trips.length === 0 ? (
            <p className="text-asphalt-400 text-sm">No completed trips yet.</p>
          ) : (
            <div className="card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-asphalt-400 border-b border-asphalt-700">
                    <th className="px-4 py-3 font-normal">Trip</th>
                    <th className="px-4 py-3 font-normal">Source</th>
                    <th className="px-4 py-3 font-normal">Completed</th>
                    <th className="px-4 py-3 font-normal text-right">Fare</th>
                    <th className="px-4 py-3 font-normal text-right">Platform fee</th>
                    <th className="px-4 py-3 font-normal text-right">Your payout</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((b) => (
                    <tr key={b.id} className="border-b border-asphalt-700 last:border-0">
                      <td className="px-4 py-3 font-mono text-asphalt-400">#{b.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-asphalt-400">{b.source === 'orderit' ? 'OrderIt' : 'Direct'}</td>
                      <td className="px-4 py-3 text-asphalt-400">
                        {b.completed_at ? new Date(b.completed_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-asphalt-400">₹{grossOf(b).toFixed(0)}</td>
                      <td className="px-4 py-3 text-right text-asphalt-400">−₹{commissionOf(b).toFixed(0)}</td>
                      <td className="px-4 py-3 text-right text-asphalt-200 font-semibold">₹{earn(b).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-asphalt-400 text-xs mt-4">
            This is an earnings summary, not a payment record — actual payouts to your bank account are handled separately.
          </p>
        </>
      )}
    </div>
  )
}
