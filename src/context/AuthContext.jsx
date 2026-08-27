import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data || null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      loadProfile(session?.user?.id).finally(() => setLoading(false))
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      loadProfile(session?.user?.id)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signUp({
    email, password, fullName, phone, role,
    vehicleType, vehicleNumber, aadharNumber, drivingLicenceNumber, vehicleRegNumber,
  }) {
    // Profile fields go in auth metadata; a DB trigger (see supabase/schema.sql
    // and supabase/motor_driving_licence_migration.sql) reads them and creates
    // the profiles row server-side. Don't insert into profiles from the client
    // here — signUp() doesn't guarantee an active session (e.g. when email
    // confirmation is on), so a client insert can hit RLS with auth.uid() =
    // null before confirmation.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          role,
          vehicle_type: vehicleType,
          vehicle_number: vehicleNumber,
          aadhar_number: aadharNumber,
          driving_licence_number: drivingLicenceNumber,
          vehicle_reg_number: vehicleRegNumber,
        },
      },
    })
    if (error) throw error
    if (data.session) await loadProfile(data.user?.id)
    return data
  }

  async function signIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  const value = {
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || null,
    loading,
    signUp,
    signIn,
    signOut,
    refreshProfile: () => loadProfile(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
