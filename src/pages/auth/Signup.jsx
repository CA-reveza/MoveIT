import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { VEHICLE_TYPES } from '../../lib/pricing.js'

const DOC_FIELDS = [
  { key: 'aadhar', label: 'Aadhar card photo' },
  { key: 'driving_licence', label: 'Driving licence photo' },
  { key: 'vehicle_reg', label: 'Vehicle registration (RC) photo' },
]

export default function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    fullName: '', phone: '', email: '', password: '', role: 'customer',
    vehicleType: '', vehicleNumber: '', aadharNumber: '', drivingLicenceNumber: '', vehicleRegNumber: '',
  })
  const [docs, setDocs] = useState({ aadhar: null, driving_licence: null, vehicle_reg: null })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('') // '' | 'creating account' | 'uploading documents'

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function updateDoc(kind, file) {
    setDocs((d) => ({ ...d, [kind]: file }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (form.role === 'driver') {
      if (!form.vehicleType || !form.vehicleNumber || !form.aadharNumber || !form.drivingLicenceNumber || !form.vehicleRegNumber) {
        setError('Vehicle details, Aadhar number, driving licence number, and RC number are all required to sign up as a driver.')
        return
      }
      const missingDoc = DOC_FIELDS.find((d) => !docs[d.key])
      if (missingDoc) {
        setError(`${missingDoc.label} is required to sign up as a driver — Aadhar, driving licence, and RC are all mandatory.`)
        return
      }
    }

    setBusy(true)
    setStage('creating account')
    try {
      const signUpResult = await signUp({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        phone: form.phone,
        role: form.role,
        ...(form.role === 'driver' && {
          vehicleType: form.vehicleType,
          vehicleNumber: form.vehicleNumber,
          aadharNumber: form.aadharNumber,
          drivingLicenceNumber: form.drivingLicenceNumber,
          vehicleRegNumber: form.vehicleRegNumber,
        }),
      })

      if (form.role === 'driver') {
        const userId = signUpResult?.user?.id
        if (userId && signUpResult?.session) {
          setStage('uploading documents')
          const paths = {}
          for (const { key } of DOC_FIELDS) {
            const file = docs[key]
            const ext = file.name.split('.').pop()
            const path = `${userId}/${key}.${ext}`
            const { error: uploadErr } = await supabase.storage
              .from('driver-documents')
              .upload(path, file, { upsert: true, contentType: file.type })
            if (uploadErr) throw new Error(`Account created, but ${key.replace('_', ' ')} upload failed: ${uploadErr.message}. You can upload it from the Details tab after logging in.`)
            paths[key] = path
          }
          const { error: updateErr } = await supabase
            .from('profiles')
            .update({
              aadhar_doc_path: paths.aadhar,
              driving_licence_doc_path: paths.driving_licence,
              vehicle_reg_doc_path: paths.vehicle_reg,
              kyc_status: 'submitted',
            })
            .eq('id', userId)
          if (updateErr) throw updateErr
        } else {
          throw new Error('Account created, but you need to confirm your email before documents can be uploaded — please log in and upload them from the Details tab.')
        }
      }

      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setStage('')
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-5 py-10">
      <div className={`auth-card ${form.role === 'driver' ? 'max-w-lg' : ''}`}>
        <img src="/logo.png" alt="MoveIT" className="h-12 w-auto mb-2" />
        <p className="auth-tagline">We Deliver your Orders...</p>

        <div className="auth-tabs">
          <Link to="/login" className="auth-tab">Sign in</Link>
          <Link to="/signup" className="auth-tab active">Sign up</Link>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              type="button"
              onClick={() => update('role', 'customer')}
              className={`btn-ghost ${form.role === 'customer' ? 'border-signal text-signal' : ''}`}
            >
              I ship
            </button>
            <button
              type="button"
              onClick={() => update('role', 'driver')}
              className={`btn-ghost ${form.role === 'driver' ? 'border-signal text-signal' : ''}`}
            >
              I drive
            </button>
          </div>
          <label className="field-label">Full name</label>
          <input
            className="input-plain"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            required
          />
          <label className="field-label">Phone</label>
          <input
            className="input-plain"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            required
          />
          <label className="field-label">Email</label>
          <input
            className="input-plain"
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
          <label className="field-label">Password</label>
          <input
            className="input-plain"
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            minLength={6}
            required
          />

          {form.role === 'driver' && (
            <>
              <div className="h-px bg-asphalt-700 my-4" />
              <p className="dash mb-3">Vehicle &amp; KYC — all fields and documents below are mandatory</p>

              <label className="field-label">Vehicle type</label>
              <select
                className="input-plain"
                value={form.vehicleType}
                onChange={(e) => update('vehicleType', e.target.value)}
                required
              >
                <option value="" disabled>Select vehicle type…</option>
                {VEHICLE_TYPES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>

              <label className="field-label">Vehicle number</label>
              <input
                className="input-plain"
                placeholder="e.g. KA01AB1234"
                value={form.vehicleNumber}
                onChange={(e) => update('vehicleNumber', e.target.value)}
                required
              />

              <label className="field-label">Aadhar number</label>
              <input
                className="input-plain"
                value={form.aadharNumber}
                onChange={(e) => update('aadharNumber', e.target.value)}
                required
              />
              <label className="field-label">{DOC_FIELDS[0].label}</label>
              <input
                type="file"
                accept="image/*,.pdf"
                className="input-plain"
                onChange={(e) => updateDoc('aadhar', e.target.files?.[0])}
                required
              />

              <label className="field-label">Driving licence number</label>
              <input
                className="input-plain"
                value={form.drivingLicenceNumber}
                onChange={(e) => update('drivingLicenceNumber', e.target.value)}
                required
              />
              <label className="field-label">{DOC_FIELDS[1].label}</label>
              <input
                type="file"
                accept="image/*,.pdf"
                className="input-plain"
                onChange={(e) => updateDoc('driving_licence', e.target.files?.[0])}
                required
              />

              <label className="field-label">Vehicle RC number</label>
              <input
                className="input-plain"
                value={form.vehicleRegNumber}
                onChange={(e) => update('vehicleRegNumber', e.target.value)}
                required
              />
              <label className="field-label">{DOC_FIELDS[2].label}</label>
              <input
                type="file"
                accept="image/*,.pdf"
                className="input-plain"
                onChange={(e) => updateDoc('vehicle_reg', e.target.files?.[0])}
                required
              />
            </>
          )}

          {error && <p className="text-red-500 text-sm font-mono mb-4 mt-4">{error}</p>}
          <button className="btn-auth" disabled={busy}>
            {busy
              ? stage === 'uploading documents'
                ? 'Uploading documents…'
                : 'Creating account…'
              : 'Sign up'}
          </button>
        </form>
      </div>
    </div>
  )
}
