import { useState, useRef } from 'react'
import { supabase } from '../lib/supabaseClient.js'

const DOC_COLUMN = {
  aadhar: 'aadhar_doc_path',
  driving_licence: 'driving_licence_doc_path',
  vehicle_reg: 'vehicle_reg_doc_path',
}
const DOC_LABEL = {
  aadhar: 'Aadhar card photo',
  driving_licence: 'Driving licence photo',
  vehicle_reg: 'Vehicle registration (RC) photo',
}
const KINDS = ['aadhar', 'driving_licence', 'vehicle_reg']

// Uploads photos of the driver's Aadhar card, driving licence, and vehicle
// RC to the private 'driver-documents' Storage bucket (see
// supabase/motor_driver_vehicle_migration.sql and
// motor_driving_licence_migration.sql for the bucket + RLS setup), then
// records the storage path on their profile. All three are mandatory —
// once all are on file, marks kyc_status = 'submitted'. An admin reviews
// and flips it to 'verified' from the admin Drivers tab.
export default function DriverDocumentUpload({ userId, profile, onUploaded }) {
  const [uploading, setUploading] = useState(null)
  const [error, setError] = useState('')
  const inputRefs = { aadhar: useRef(null), driving_licence: useRef(null), vehicle_reg: useRef(null) }

  async function handleUpload(kind, file) {
    if (!file) return
    setError('')
    setUploading(kind)
    try {
      const ext = file.name.split('.').pop()
      const path = `${userId}/${kind}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('driver-documents')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadErr) throw uploadErr

      const column = DOC_COLUMN[kind]
      const otherPaths = KINDS.filter((k) => k !== kind).map((k) => (k === kind ? path : profile?.[DOC_COLUMN[k]]))
      const allPresent = otherPaths.every(Boolean)

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ [column]: path, kyc_status: allPresent ? 'submitted' : profile?.kyc_status || 'pending' })
        .eq('id', userId)
      if (updateErr) throw updateErr

      onUploaded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(null)
    }
  }

  const has = (kind) => Boolean(profile?.[DOC_COLUMN[kind]])
  const allDone = KINDS.every(has)

  return (
    <div className="card p-5 max-w-md">
      <p className="dash mb-3">KYC documents (all three mandatory)</p>
      {error && <p className="text-red-500 text-sm font-mono mb-3">{error}</p>}

      <div className="flex flex-col gap-4">
        {KINDS.map((kind) => (
          <div key={kind}>
            <p className="text-sm text-asphalt-200 mb-2">
              {DOC_LABEL[kind]} {has(kind) && <span className="text-line">✓ uploaded</span>}
            </p>
            <input
              ref={inputRefs[kind]}
              type="file"
              accept="image/*,.pdf"
              className="input"
              disabled={uploading === kind}
              onChange={(e) => handleUpload(kind, e.target.files?.[0])}
            />
            {uploading === kind && <p className="text-asphalt-400 text-xs mt-1">Uploading…</p>}
          </div>
        ))}
      </div>

      {allDone && (
        <p className="text-line text-sm mt-4">
          All documents submitted — waiting for admin verification.
        </p>
      )}
    </div>
  )
}
