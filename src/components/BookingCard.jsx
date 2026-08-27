import { Link } from 'react-router-dom'
import StatusBadge from './StatusBadge.jsx'
import { vehicleById, splitBookingFare } from '../lib/pricing.js'

export default function BookingCard({ booking, to, action }) {
  const vehicle = vehicleById(booking.vehicle_type)
  // Drivers see their own payout rate, not the gross fare charged to the
  // customer/hotel — for OrderIt-bridged bookings especially, those two
  // numbers differ (see orderItDeliverySplit in lib/pricing.js), and
  // showing the gross figure here would overstate what the driver actually
  // earns on the job.
  const driverRate = splitBookingFare(booking).payout
  const content = (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="dash">#{booking.id.slice(0, 8)}</span>
        <StatusBadge status={booking.status} />
      </div>
      <div className="text-asphalt-200 text-sm">
        <p className="truncate">↑ {booking.pickup_address}</p>
        <p className="truncate text-asphalt-400">↓ {booking.drop_address}</p>
      </div>
      <div className="flex items-center justify-between font-mono text-xs text-asphalt-400">
        <span>{vehicle?.label}</span>
        <span className="text-line">₹{driverRate} <span className="text-asphalt-500">(your rate)</span></span>
      </div>
      {action}
    </div>
  )
  return to ? <Link to={to}>{content}</Link> : content
}
