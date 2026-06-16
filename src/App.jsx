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
  const [driver, setDriver] = useState(null)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [rideHistory, setRideHistory] = useState([])

  useEffect(() => {
    restoreSession()
  }, [])

  useEffect(() => {
    if (!loggedIn) return

    loadCurrentRide()
    loadRideHistory()

    const channel = supabase
      .channel('rider-trip-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
        },
        () => {
          loadCurrentRide()
          loadRideHistory()
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
      await loadCurrentRide()
      await loadRideHistory()
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
    await loadCurrentRide()
    await loadRideHistory()
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
    setDriver(null)
    setRating(5)
    setComment('')
    setRatingSubmitted(false)
    setRideHistory([])
  }

  async function requestRide() {
    setLoading(true)
    setMessage('')
    setRatingSubmitted(false)

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
    setDriver(null)
    setMessage('Ride requested. Looking for a driver.')
    await loadRideHistory()
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
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    setCurrentRide(data || null)

    if (data?.driver_id) {
      await loadDriver(data.driver_id)
    } else {
      setDriver(null)
    }
  }

  async function loadRideHistory() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .eq('rider_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      setMessage(error.message)
      return
    }

    setRideHistory(data || [])
  }

  async function loadDriver(driverId) {
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('id', driverId)
      .maybeSingle()

    if (error) {
      setDriver(null)
      return
    }

    setDriver(data || null)
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
    setDriver(null)
    setPickup('')
    setDestination('')
    setMessage('Ride cancelled.')
    await loadRideHistory()
  }

  async function submitRating() {
    if (!currentRide || !driver) return

    setLoading(true)
    setMessage('')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      setMessage('You must be logged in.')
      return
    }

    const { error } = await supabase
      .from('ratings')
      .insert({
        ride_id: currentRide.id,
        rider_id: user.id,
        driver_id: driver.id,
        rating: Number(rating),
        comment,
      })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setRatingSubmitted(true)
    setMessage('Thank you for rating your driver.')
  }

  function requestAnotherRide() {
    setCurrentRide(null)
    setDriver(null)
    setPickup('')
    setDestination('')
    setMessage('')
    setRating(5)
    setComment('')
    setRatingSubmitted(false)
    loadRideHistory()
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

  function formatDate(value) {
    if (!value) return ''
    return new Date(value).toLocaleString()
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

          {currentRide.matched_at && (
            <p><strong>Matched:</strong> {formatDate(currentRide.matched_at)}</p>
          )}

          {currentRide.driver_arrived_at && (
            <p><strong>Driver Arrived:</strong> {formatDate(currentRide.driver_arrived_at)}</p>
          )}

          {currentRide.trip_started_at && (
            <p><strong>Trip Started:</strong> {formatDate(currentRide.trip_started_at)}</p>
          )}

          {currentRide.completed_at && (
            <p><strong>Completed:</strong> {formatDate(currentRide.completed_at)}</p>
          )}

          {driver && (
            <div className="ride-card">
              <h3>Assigned Driver</h3>
              <p><strong>Email:</strong> {driver.email || 'Driver'}</p>
              <p><strong>Status:</strong> {driver.availability_status || 'online'}</p>
              <p><strong>Trips:</strong> {driver.total_trips || 0}</p>
            </div>
          )}

          {currentRide.status === 'requested' && (
            <button onClick={cancelRide} disabled={loading}>
              {loading ? 'Cancelling...' : 'Cancel Ride'}
            </button>
          )}

          {currentRide.status === 'completed' && !ratingSubmitted && driver && (
            <div className="ride-card">
              <h3>Rate Your Driver</h3>

              <select
                value={rating}
                onChange={(e) => setRating(e.target.value)}
              >
                <option value="5">5 - Excellent</option>
                <option value="4">4 - Good</option>
                <option value="3">3 - Okay</option>
                <option value="2">2 - Poor</option>
                <option value="1">1 - Bad</option>
              </select>

              <textarea
                placeholder="Optional comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />

              <button onClick={submitRating} disabled={loading}>
                {loading ? 'Submitting...' : 'Submit Rating'}
              </button>
            </div>
          )}

          {currentRide.status === 'completed' && ratingSubmitted && (
            <div className="ride-card">
              <h3>Ride Complete</h3>
              <p>Thank you for riding with LibreRide.</p>
              <button onClick={requestAnotherRide}>Request Another Ride</button>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Recent Rides</h2>

        {rideHistory.length === 0 ? (
          <p>No ride history yet.</p>
        ) : (
          rideHistory.map((ride) => (
            <div key={ride.id} className="ride-card">
              <p><strong>Status:</strong> {ride.status}</p>
              <p><strong>Pickup:</strong> {ride.pickup_address || 'Unknown'}</p>
              <p><strong>Dropoff:</strong> {ride.destination_address || 'Unknown'}</p>
              <p><strong>Fare:</strong> ${((ride.final_fare_cents || ride.estimated_fare_cents || 0) / 100).toFixed(2)}</p>
              <p><strong>Date:</strong> {formatDate(ride.created_at)}</p>
            </div>
          ))
        )}
      </section>

      {message && <p>{message}</p>}
    </div>
  )
}

export default App