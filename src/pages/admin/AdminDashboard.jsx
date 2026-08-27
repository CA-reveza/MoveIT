import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { VEHICLE_TYPES, vehicleById, splitBookingFare } from '../../lib/pricing.js'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function isoDateInput(d) {
  return d.toISOString().slice(0, 10)
}

const ASSIGNABLE_STATUSES = ['pending', 'accepted', 'picked_up', 'in_transit']
const KYC_STYLES = {
  pending: 'border-asphalt-600 text-asphalt-400',
  submitted: 'border-line text-line',
  verified: 'border-green-600 text-green-500',
}

const today = new Date()
const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

export default function AdminDashboard() {
  const [tab, setTab] = useState('overview')
  const [bookings, setBookings] = useState([])
  const [drivers, setDrivers] = useState([])

  const loadBookings = useCallback(async () => {
    const { data } = await supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(200)
    setBookings(data || [])
  }, [])

  const loadDrivers = useCallback(async () => {    const { data } = await supabase.from('profiles').select('*').eq('role', 'driver').order('full_name')
    setDrivers(data || [])
  }, [])

  const loadAll = useCallback(() => {
    loadBookings()
    loadDrivers()
  }, [loadBookings, loadDrivers])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, loadBookings)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadDrivers)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadBookings, loadDrivers])

  const completed = bookings.filter((b) => b.status === 'completed')
  const activeBookings = bookings.filter((b) => !['completed', 'cancelled'].includes(b.status))
  const onlineDrivers = drivers.filter((d) => d.is_online)
  const totals = completed.reduce(
    (acc, b) => {
      const s = splitBookingFare(b)
      acc.gross += s.gross
      acc.commission += s.commission
      acc.payout += s.payout
      return acc
    },
    { gross: 0, commission: 0, payout: 0 }
  )

  return (
    <div className="max-w-6xl mx-auto px-5 py-10">
      <p className="dash mb-2">Control room</p>
      <h1 className="h1 mb-8">Admin</h1>

      <div className="tabs">
        <button className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'bookings' ? 'tab active' : 'tab'} onClick={() => setTab('bookings')}>All Bookings ({bookings.length})</button>
        <button className={tab === 'drivers' ? 'tab active' : 'tab'} onClick={() => setTab('drivers')}>Drivers ({drivers.length})</button>
        <button className={tab === 'reports' ? 'tab active' : 'tab'} onClick={() => setTab('reports')}>Reports</button>
      </div>

      {tab === 'overview' && (
        <Overview
          bookingsCount={bookings.length}
          activeCount={activeBookings.length}
          driversCount={drivers.length}
          onlineCount={onlineDrivers.length}
          totals={totals}
        />
      )}

      {tab === 'bookings' && <Bookings bookings={bookings} drivers={drivers} />}
      {tab === 'drivers' && <Drivers drivers={drivers} onChanged={loadDrivers} />}
      {tab === 'reports' && <Reports />}
    </div>
  )
}

function Overview({ bookingsCount, activeCount, driversCount, onlineCount, totals }) {
  const cards = [
    { label: 'Total Bookings', value: bookingsCount },
    { label: 'Active Now', value: activeCount },
    { label: 'Registered Drivers', value: driversCount },
    { label: 'Online Drivers', value: onlineCount },
  ]
  const moneyCards = [
    { label: 'Gross Revenue', value: `₹${totals.gross.toLocaleString('en-IN')}`, accent: 'text-asphalt-200' },
    { label: 'Platform Commission', value: `₹${totals.commission.toLocaleString('en-IN')}`, accent: 'text-signal' },
    { label: 'Driver Payouts', value: `₹${totals.payout.toLocaleString('en-IN')}`, accent: 'text-line' },
  ]

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="dash mb-2">{c.label}</p>
            <p className="font-display text-3xl text-asphalt-200">{c.value ?? '—'}</p>
          </div>
        ))}
      </div>

      <p className="dash mb-2">Completed trips — revenue split</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {moneyCards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="dash mb-2">{c.label}</p>
            <p className={`font-display text-3xl ${c.accent}`}>{c.value}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function Bookings({ bookings, drivers }) {
  const [assigning, setAssigning] = useState(null)
  const [pendingDriverId, setPendingDriverId] = useState({})

  function driverLabel(d) {
    const vt = vehicleById(d.vehicle_type)
    return `${d.full_name}${vt ? ` — ${vt.label}` : ''}${d.vehicle_number ? ` (${d.vehicle_number})` : ''}`
  }

  async function assignDriver(booking) {
    const driverId = pendingDriverId[booking.id]
    if (!driverId) return
    setAssigning(booking.id)
    const patch = { driver_id: driverId }
    if (booking.status === 'pending') {
      patch.status = 'accepted'
      patch.accepted_at = new Date().toISOString()
    }
    await supabase.from('bookings').update(patch).eq('id', booking.id)
    setAssigning(null)
  }

  // OrderIt-bridged bookings arrive with vehicle_type = null — APMC just
  // clicks "Book via MoveIT" and leaves segregating 2W vs 3W to us. Until
  // this is set, the booking is invisible in every driver's job feed (see
  // DriverHome.jsx), so this is the step that actually puts it into play.
  async function assignVehicle(booking, vehicleTypeId) {
    if (!vehicleTypeId) return
    await supabase.from('bookings').update({ vehicle_type: vehicleTypeId }).eq('id', booking.id)
  }

  return (
    <div className="overflow-x-auto card">
      <table className="w-full text-sm">
        <thead>
          <tr className="dash text-left border-b border-asphalt-700">
            <th className="p-3">Date</th>
            <th className="p-3">ID</th>
            <th className="p-3">Source</th>
            <th className="p-3">Route</th>
            <th className="p-3">Vehicle</th>
            <th className="p-3">Driver</th>
            <th className="p-3">Status</th>
            <th className="p-3">Fare</th>
            <th className="p-3">Commission</th>
            <th className="p-3">Payout</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const assignedDriver = drivers.find((d) => d.id === b.driver_id)
            const canAssign = ASSIGNABLE_STATUSES.includes(b.status)
            const eligibleDrivers = drivers.filter((d) => d.kyc_status === 'verified' && d.vehicle_type)
            const fare = b.fare_final ?? b.fare_estimate
            const split = b.status === 'completed' ? splitBookingFare(b) : null
            return (
              <tr key={b.id} className="border-b border-asphalt-800 text-asphalt-200 align-top">
                <td className="p-3 font-mono text-xs whitespace-nowrap text-asphalt-400">{formatDate(b.created_at)}</td>
                <td className="p-3 font-mono text-xs">{b.id.slice(0, 8)}</td>
                <td className="p-3">
                  <span className={`status-pill text-xs ${b.source === 'orderit' ? 'border-line text-line' : 'border-asphalt-600 text-asphalt-400'}`}>
                    {b.source === 'orderit' ? 'OrderIt' : 'Direct'}
                  </span>
                </td>
                <td className="p-3"><p className="truncate max-w-xs">{b.pickup_address} → {b.drop_address}</p></td>
                <td className="p-3 font-mono text-xs min-w-[140px]">
                  {b.vehicle_type ? (
                    vehicleById(b.vehicle_type)?.label || b.vehicle_type
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-asphalt-500">Unassigned</span>
                      <select
                        className="input py-1 px-2 text-xs"
                        defaultValue=""
                        onChange={(e) => assignVehicle(b, e.target.value)}
                      >
                        <option value="" disabled>Segregate…</option>
                        {VEHICLE_TYPES.filter((v) => v.id === 'bike' || v.id === 'three_wheeler').map((v) => (
                          <option key={v.id} value={v.id}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </td>
                <td className="p-3 min-w-[220px]">
                  {assignedDriver ? (
                    <p className="text-xs">{driverLabel(assignedDriver)}</p>
                  ) : (
                    <p className="text-xs text-asphalt-500">Unassigned</p>
                  )}
                  {canAssign && (
                    <div className="flex gap-1 mt-1">
                      <select
                        className="input py-1 px-2 text-xs"
                        value={pendingDriverId[b.id] || ''}
                        onChange={(e) => setPendingDriverId((prev) => ({ ...prev, [b.id]: e.target.value }))}
                      >
                        <option value="">{eligibleDrivers.length === 0 ? 'No eligible drivers' : 'Assign driver…'}</option>
                        {eligibleDrivers.map((d) => (
                          <option key={d.id} value={d.id}>{driverLabel(d)}{d.is_online ? '' : ' (offline)'}</option>
                        ))}
                      </select>
                      <button
                        className="btn-ghost py-1 px-2 text-xs"
                        disabled={!pendingDriverId[b.id] || assigning === b.id}
                        onClick={() => assignDriver(b)}
                      >
                        {assigning === b.id ? '…' : assignedDriver ? 'Reassign' : 'Assign'}
                      </button>
                    </div>
                  )}
                </td>
                <td className="p-3"><StatusBadge status={b.status} /></td>
                <td className="p-3 font-mono text-asphalt-200 whitespace-nowrap">₹{fare}</td>
                <td className="p-3 font-mono text-signal whitespace-nowrap">{split ? `₹${split.commission}` : '—'}</td>
                <td className="p-3 font-mono text-line whitespace-nowrap">{split ? `₹${split.payout}` : '—'}</td>
              </tr>
            )
          })}
          {bookings.length === 0 && (
            <tr><td colSpan={10} className="p-4 text-asphalt-400 text-sm">No bookings yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Drivers({ drivers, onChanged }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(null)
  const [docUrls, setDocUrls] = useState({})
  const [docErrors, setDocErrors] = useState({})
  const [loadingDocs, setLoadingDocs] = useState(null)

  function fieldValue(driver, field) {
    return edits[driver.id]?.[field] ?? driver[field] ?? ''
  }

  function setField(driverId, field, value) {
    setEdits((prev) => ({ ...prev, [driverId]: { ...prev[driverId], [field]: value } }))
  }

  async function saveVehicle(driver) {
    const vehicle_type = fieldValue(driver, 'vehicle_type')
    const vehicle_number = fieldValue(driver, 'vehicle_number')
    setSaving(driver.id)
    await supabase.from('profiles').update({ vehicle_type, vehicle_number }).eq('id', driver.id)
    onChanged()
    setSaving(null)
  }

  async function setKycStatus(driver, status) {
    await supabase.from('profiles').update({ kyc_status: status }).eq('id', driver.id)
    onChanged()
  }

  async function viewDocs(driver) {
    const paths = { aadhar: driver.aadhar_doc_path, driving_licence: driver.driving_licence_doc_path, vehicle_reg: driver.vehicle_reg_doc_path }
    setLoadingDocs(driver.id)
    setDocErrors((prev) => ({ ...prev, [driver.id]: '' }))
    const urls = {}
    const errors = []
    for (const [key, path] of Object.entries(paths)) {
      if (!path) continue
      const { data, error } = await supabase.storage.from('driver-documents').createSignedUrl(path, 600)
      if (error) {
        const label = key === 'aadhar' ? 'Aadhar' : key === 'driving_licence' ? 'DL' : 'RC'
        errors.push(`${label}: ${error.message}`)
      }
      else if (data?.signedUrl) urls[key] = data.signedUrl
    }
    setDocUrls((prev) => ({ ...prev, [driver.id]: urls }))
    if (errors.length) setDocErrors((prev) => ({ ...prev, [driver.id]: errors.join(' · ') }))
    setLoadingDocs(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {drivers.map((d) => {
        const dirty = edits[d.id] && (edits[d.id].vehicle_type !== undefined || edits[d.id].vehicle_number !== undefined)
        const urls = docUrls[d.id]
        return (
          <div key={d.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-asphalt-200 font-display text-lg uppercase tracking-wide">{d.full_name}</p>
                <p className="text-asphalt-400 font-mono text-sm">{d.phone}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`status-pill ${d.is_online ? 'border-line text-line' : 'border-asphalt-600 text-asphalt-400'}`}>
                  {d.is_online ? 'online' : 'offline'}
                </span>
                <span className={`status-pill ${KYC_STYLES[d.kyc_status] || KYC_STYLES.pending}`}>
                  kyc: {d.kyc_status}
                </span>
              </div>
            </div>

            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-4">
              <select className="input" value={fieldValue(d, 'vehicle_type')} onChange={(e) => setField(d.id, 'vehicle_type', e.target.value)}>
                <option value="">No vehicle assigned</option>
                {VEHICLE_TYPES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Vehicle number (e.g. KA01AB1234)"
                value={fieldValue(d, 'vehicle_number')}
                onChange={(e) => setField(d.id, 'vehicle_number', e.target.value)}
              />
              <button className="btn-primary" disabled={!dirty || saving === d.id} onClick={() => saveVehicle(d)}>
                {saving === d.id ? 'Saving…' : 'Save'}
              </button>
            </div>

            <div className="flex items-center gap-4 mt-4 flex-wrap">
              {(d.aadhar_doc_path || d.driving_licence_doc_path || d.vehicle_reg_doc_path) && !urls?.aadhar && !urls?.driving_licence && !urls?.vehicle_reg && (
                <button className="btn-ghost py-1 px-3 text-xs" disabled={loadingDocs === d.id} onClick={() => viewDocs(d)}>
                  {loadingDocs === d.id ? 'Loading…' : docErrors[d.id] ? 'Retry loading documents' : 'Load documents'}
                </button>
              )}
              {urls?.aadhar && <a href={urls.aadhar} target="_blank" rel="noreferrer" className="text-line text-xs underline">View Aadhar</a>}
              {urls?.driving_licence && <a href={urls.driving_licence} target="_blank" rel="noreferrer" className="text-line text-xs underline">View DL</a>}
              {urls?.vehicle_reg && <a href={urls.vehicle_reg} target="_blank" rel="noreferrer" className="text-line text-xs underline">View RC</a>}
              {docErrors[d.id] && <span className="text-red-500 text-xs font-mono">{docErrors[d.id]}</span>}
              {d.kyc_status === 'submitted' && (
                <div className="flex gap-2 ml-auto">
                  <button className="btn-ghost py-1 px-3 text-xs border-green-600 text-green-500" onClick={() => setKycStatus(d, 'verified')}>Verify</button>
                  <button className="btn-ghost py-1 px-3 text-xs border-red-700 text-red-500" onClick={() => setKycStatus(d, 'pending')}>Reject</button>
                </div>
              )}
              {d.kyc_status === 'verified' && (
                <button className="btn-ghost py-1 px-3 text-xs ml-auto" onClick={() => setKycStatus(d, 'pending')}>Revoke verification</button>
              )}
            </div>
          </div>
        )
      })}
      {drivers.length === 0 && <p className="text-asphalt-400 text-sm">No drivers registered yet.</p>}
    </div>
  )
}

function Reports() {
  const [from, setFrom] = useState(isoDateInput(thirtyDaysAgo))
  const [to, setTo] = useState(isoDateInput(today))
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setRows(null)
      const { data } = await supabase
        .from('bookings')
        .select('vehicle_type, source, distance_km, fare_final, fare_estimate, completed_at, created_at')
        .eq('status', 'completed')
        .gte('completed_at', `${from}T00:00:00`)
        .lte('completed_at', `${to}T23:59:59`)

      const byVehicle = {}
      for (const v of VEHICLE_TYPES) byVehicle[v.id] = { trips: 0, gross: 0, commission: 0, payout: 0 }

      for (const b of data || []) {
        const key = byVehicle[b.vehicle_type] ? b.vehicle_type : 'other'
        if (!byVehicle[key]) byVehicle[key] = { trips: 0, gross: 0, commission: 0, payout: 0 }
        const s = splitBookingFare(b)
        byVehicle[key].trips += 1
        byVehicle[key].gross += s.gross
        byVehicle[key].commission += s.commission
        byVehicle[key].payout += s.payout
      }

      if (active) {
        setRows(
          Object.entries(byVehicle)
            .map(([vehicleType, v]) => ({ vehicleType, ...v }))
            .filter((r) => r.trips > 0)
            .sort((a, b) => b.gross - a.gross)
        )
      }
    }
    load()
    return () => { active = false }
  }, [from, to])

  const totalGross = (rows || []).reduce((sum, r) => sum + r.gross, 0)
  const totalCommission = (rows || []).reduce((sum, r) => sum + r.commission, 0)
  const totalPayout = (rows || []).reduce((sum, r) => sum + r.payout, 0)
  const totalTrips = (rows || []).reduce((sum, r) => sum + r.trips, 0)

  return (
    <div>
      <p className="dash mb-2">Revenue by vehicle</p>
      <p className="text-asphalt-400 text-sm mb-6">
        Every completed trip's fare, split into platform commission and driver payout — direct bookings use a flat commission, OrderIt deliveries use the distance-tier rate.
      </p>

      <div className="flex items-end gap-3 mb-6">
        <div>
          <p className="dash mb-1">From</p>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <p className="dash mb-1">To</p>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {rows === null ? (
        <p className="dash">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-asphalt-400 text-sm">No completed trips in this date range.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="dash text-left border-b border-asphalt-700">
                <th className="p-3">Vehicle</th>
                <th className="p-3">Trips</th>
                <th className="p-3">Gross Revenue</th>
                <th className="p-3">Commission</th>
                <th className="p-3">Driver Payout</th>
                <th className="p-3">Avg Fare</th>
                <th className="p-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vehicleType} className="border-b border-asphalt-800 text-asphalt-200">
                  <td className="p-3">{vehicleById(r.vehicleType)?.label || r.vehicleType}</td>
                  <td className="p-3 font-mono">{r.trips}</td>
                  <td className="p-3 font-mono text-asphalt-200">₹{r.gross.toLocaleString('en-IN')}</td>
                  <td className="p-3 font-mono text-signal">₹{r.commission.toLocaleString('en-IN')}</td>
                  <td className="p-3 font-mono text-line">₹{r.payout.toLocaleString('en-IN')}</td>
                  <td className="p-3 font-mono">₹{Math.round(r.gross / r.trips)}</td>
                  <td className="p-3 font-mono text-asphalt-400">{totalGross ? Math.round((r.gross / totalGross) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-asphalt-200 font-display uppercase tracking-wide">
                <td className="p-3">Total</td>
                <td className="p-3 font-mono">{totalTrips}</td>
                <td className="p-3 font-mono text-asphalt-200">₹{totalGross.toLocaleString('en-IN')}</td>
                <td className="p-3 font-mono text-signal">₹{totalCommission.toLocaleString('en-IN')}</td>
                <td className="p-3 font-mono text-line">₹{totalPayout.toLocaleString('en-IN')}</td>
                <td className="p-3" />
                <td className="p-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
