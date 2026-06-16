import { useEffect, useState } from 'react'
import './App.css'
import { supabase } from './supabase'

function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentRide, setCurrentRide] = useState(null)

  useEffect(() => {
    restoreSession()
  }, [])

  useEffect(() => {
    if (!loggedIn) return

    loadCurrentRide()

    const channel = supabase
      .channel('rider-ride-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
        },
        () => {
          loadCurrentRide()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loggedIn])

  async function restoreSession() {
    const { data } = await supabase.auth.getSession()

    if (data.session?.user) {
      setEmail(data.session.user.email)
      setLoggedIn(true)
      loadCurrentRide()
    }
  }

  async function login(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setEmail(data.user.email)
    setLoggedIn(true)
    loadCurrentRide()
  }

  async function logout() {
    await supabase.auth.signOut()
    setLoggedIn(false)
    setEmail('')
    setPassword('')
    setPickup('')
    setDestination('')
    setMessage('')
    setCurrentRide(null)
  }

  async function requestRide() {
    setLoading(true)
    setMessage('')

    if (!pickup || !destination) {
      setLoading(false)
      setMessage('Enter pickup and destination.')
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      setMessage('You must be logged in.')
      return
    }

    const { data, error } = await supabase
      .from('rides')
      .insert({
        rider_id: user.id,
        status: 'requested',
        pickup_address: pickup,
        destination_address: destination,
        pickup_location: 'POINT(-80.2906 25.7959)',
        destination_location: 'POINT(-80.1918 25.7617)',
        estimated_fare_cents: 2450,
      })
      .select('*')
      .single()

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setCurrentRide(data)
    setMessage('Ride requested. Looking for a driver.')
  }

  async function loadCurrentRide() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .eq('rider_id', user.id)
      .not('status', 'eq', 'completed')
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    setCurrentRide(data || null)
  }

  async function cancelRide() {
    if (!currentRide) return

    setLoading(true)
    setMessage('')

    const { error } = await supabase
      .from('rides')
      .update({
        status: 'cancelled',
        cancellation_reason: 'Cancelled by rider',
      })
      .eq('id', currentRide.id)

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setCurrentRide(null)
    setPickup('')
    setDestination('')
    setMessage('Ride cancelled.')
  }

  function rideMessage(status) {
    if (status === 'requested') return 'Looking for a driver...'
    if (status === 'accepted') return 'Driver accepted your ride.'
    if (status === 'arrived') return 'Your driver has arrived.'
    if (status === 'in_progress') return 'Trip is in progress.'
    if (status === 'completed') return 'Trip completed.'
    if (status === 'declined') return 'Driver declined. Waiting for another driver.'
    if (status === 'cancelled') return 'Ride cancelled.'
    return status
  }

  if (!loggedIn) {
    return (
      <div className="driver-app">
        <section className="card">
          <h1>LibreRide Rider</h1>
          <p>Sign in to request a ride</p>

          <form onSubmit={login}>
            <input
              type="email"
              placeholder="Rider email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button type="submit" disabled={loading}>
              {loading ? 'Signing In...' : 'Login'}
            </button>
          </form>

          {message && <p>{message}</p>}
        </section>
      </div>
    )
  }

  return (
    <div className="driver-app">
      <header className="card">
        <h1>LibreRide Rider</h1>
        <p>{email}</p>
        <button onClick={logout}>Logout</button>
      </header>

      {!currentRide && (
        <section className="card">
          <h2>Request Ride</h2>

          <input
            placeholder="Pickup location"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
          />

          <input
            placeholder="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />

          <p><strong>Estimated Fare:</strong> $24.50</p>

          <button onClick={requestRide} disabled={loading}>
            {loading ? 'Requesting...' : 'Request Ride'}
          </button>
        </section>
      )}

      {currentRide && (
        <section className="card">
          <h2>Your Ride</h2>

          <p><strong>Status:</strong> {currentRide.status}</p>
          <p>{rideMessage(currentRide.status)}</p>

          <p><strong>Pickup:</strong> {currentRide.pickup_address || 'Unknown'}</p>
          <p><strong>Dropoff:</strong> {currentRide.destination_address || 'Unknown'}</p>
          <p><strong>Fare:</strong> ${((currentRide.estimated_fare_cents || 0) / 100).toFixed(2)}</p>

          {currentRide.status === 'requested' && (
            <button onClick={cancelRide} disabled={loading}>
              {loading ? 'Cancelling...' : 'Cancel Ride'}
            </button>
          )}
        </section>
      )}

      {message && <p>{message}</p>}
    </div>
  )
}

export default App