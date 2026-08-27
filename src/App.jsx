import { Route, Routes, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'

import Login from './pages/auth/Login.jsx'
import Signup from './pages/auth/Signup.jsx'

import CustomerHome from './pages/customer/CustomerHome.jsx'
import NewBooking from './pages/customer/NewBooking.jsx'
import TrackBooking from './pages/customer/TrackBooking.jsx'

import DriverHome from './pages/driver/DriverHome.jsx'
import DriverTrip from './pages/driver/DriverTrip.jsx'
import DriverDetails from './pages/driver/DriverDetails.jsx'
import DriverHistory from './pages/driver/DriverHistory.jsx'
import DriverPayout from './pages/driver/DriverPayout.jsx'

import AdminDashboard from './pages/admin/AdminDashboard.jsx'

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route
          path="/"
          element={
            <ProtectedRoute allow={['customer']}>
              <CustomerHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/book"
          element={
            <ProtectedRoute allow={['customer']}>
              <NewBooking />
            </ProtectedRoute>
          }
        />
        <Route
          path="/track/:id"
          element={
            <ProtectedRoute allow={['customer']}>
              <TrackBooking />
            </ProtectedRoute>
          }
        />

        <Route
          path="/driver"
          element={
            <ProtectedRoute allow={['driver']}>
              <DriverHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver/trip/:id"
          element={
            <ProtectedRoute allow={['driver']}>
              <DriverTrip />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver/details"
          element={
            <ProtectedRoute allow={['driver']}>
              <DriverDetails />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver/history"
          element={
            <ProtectedRoute allow={['driver']}>
              <DriverHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver/payout"
          element={
            <ProtectedRoute allow={['driver']}>
              <DriverPayout />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/admin/bookings" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/drivers" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/reports" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  )
}
