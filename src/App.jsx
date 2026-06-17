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
  const [hasRated, setHasRated] = useState(false)
  const [rideHistory, setRideHistory] = useState([])
  const [hiddenCompletedRideId, setHiddenCompletedRideId] = useState(null)

  useEffect(() => {
    restoreSession()
  }, [])

  useEffect(() => {
    if (!loggedIn) return

    loadCurrentRide()
    loadRideHistory()

    const channel = supabase
      .channel('rider-trip-updates-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => {
        loadCurrentRide()
        loadRideHistory()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => {
        if (currentRide?.driver_id) loadDriver(currentRide.driver_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, () => {
        if (currentRide?.id) checkExistingRating(currentRide.id)
      })
      .subscribe()

    const interval = setInterval(() => {
      loadCurrentRide()
      loadRideHistory()
      if (currentRide?.driver_id) loadDriver(currentRide.driver_id)
    }, 5000)

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [loggedIn, currentRide?.id, currentRide?.driver_id, hiddenCompletedRideId])

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
    setHasRated(false)
    setRideHistory([])
    setHiddenCompletedRideId(null)
  }

  async function requestRide() {
    setLoading(true)
    setMessage('')
    setRatingSubmitted(false)
    setHasRated(false)
    setHiddenCompletedRideId(null)

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
        pickup_lat: 25.7959,
        pickup_lng: -80.2906,
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
      .in('status', ['requested', 'accepted', 'arrived', 'in_progress', 'completed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    if (data?.status === 'completed' && data.id === hiddenCompletedRideId) {
      setCurrentRide(null)
      setDriver(null)
      return
    }

    setCurrentRide(data || null)

    if (data?.driver_id) {
      await loadDriver(data.driver_id)
    } else {
      setDriver(null)
    }

    if (data?.id && data.status === 'completed') {
      await checkExistingRating(data.id)
    } else {
      setHasRated(false)
      setRatingSubmitted(false)
    }
  }

  async function checkExistingRating(rideId) {
    const { data } = await supabase
      .from('ratings')
      .select('id')
      .eq('ride_id', rideId)
      .maybeSingle()

    if (data) {
      setHasRated(true)
      setRatingSubmitted(true)
    } else {
      setHasRated(false)
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
    const { data } = await supabase
      .from('drivers')
      .select('*')
      .eq('id', driverId)
      .maybeSingle()

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

    const { data: existingRating } = await supabase
      .from('ratings')
      .select('id')
      .eq('ride_id', currentRide.id)
      .maybeSingle()

    if (existingRating) {
      setLoading(false)
      setHasRated(true)
      setRatingSubmitted(true)
      setMessage('You already rated this trip.')
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
      if (error.message.includes('duplicate key value')) {
        setHasRated(true)
        setRatingSubmitted(true)
        setMessage('You already rated this trip.')
        return
      }

      setMessage(error.message)
      return
    }

    setHasRated(true)
    setRatingSubmitted(true)
    setMessage('Thank you for rating your driver.')
  }

  function requestAnotherRide() {
    if (currentRide?.id) {
      setHiddenCompletedRideId(currentRide.id)
    }

    setCurrentRide(null)
    setDriver(null)
    setPickup('')
    setDestination('')
    setMessage('')
    setRating(5)
    setComment('')
    setRatingSubmitted(false)
    setHasRated(false)
    loadRideHistory()
  }

  function rideMessage(status) {
    if (status === 'requested') return 'Looking for a driver...'
    if (status === 'accepted') return 'Driver accepted your ride.'
    if (status === 'arrived') return 'Your driver has arrived.'
    if (status === 'in_progress') return 'Trip is in progress.'
    if (status === 'completed') return 'Trip completed.'
    return status
  }

  function formatDate(value) {
    if (!value) return ''
    return new Date(value).toLocaleString()
  }

  function formatCoordinate(value) {
    if (value === null || value === undefined) return 'Not available'
    return Number(value).toFixed(6)
  }

  function getPickupLat() {
    return Number(currentRide?.pickup_lat || 25.7959)
  }

  function getPickupLng() {
    return Number(currentRide?.pickup_lng || -80.2906)
  }

  function distanceMiles(lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return null

    const radiusMiles = 3958.8
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return radiusMiles * c
  }

  function driverDistance() {
    if (!driver?.current_lat || !driver?.current_lng || !currentRide) return null

    return distanceMiles(
      Number(driver.current_lat),
      Number(driver.current_lng),
      getPickupLat(),
      getPickupLng()
    )
  }

  function etaMinutes() {
    const miles = driverDistance()
    if (!miles) return null

    const averageCitySpeedMph = 25
    return Math.max(1, Math.round((miles / averageCitySpeedMph) * 60))
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

  const milesAway = driverDistance()
  const eta = etaMinutes()

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

          {currentRide.matched_at && <p><strong>Matched:</strong> {formatDate(currentRide.matched_at)}</p>}
          {currentRide.driver_arrived_at && <p><strong>Driver Arrived:</strong> {formatDate(currentRide.driver_arrived_at)}</p>}
          {currentRide.trip_started_at && <p><strong>Trip Started:</strong> {formatDate(currentRide.trip_started_at)}</p>}
          {currentRide.completed_at && <p><strong>Completed:</strong> {formatDate(currentRide.completed_at)}</p>}

          {driver && (
            <div className="ride-card">
              <h3>Assigned Driver</h3>
              <p><strong>Email:</strong> {driver.email || 'Driver'}</p>
              <p><strong>Status:</strong> {driver.availability_status || 'online'}</p>
              <p><strong>Trips:</strong> {driver.total_trips || 0}</p>

              <h3>Driver Location</h3>
              <p><strong>Latitude:</strong> {formatCoordinate(driver.current_lat)}</p>
              <p><strong>Longitude:</strong> {formatCoordinate(driver.current_lng)}</p>
              <p><strong>Last Updated:</strong> {driver.last_location_update ? formatDate(driver.last_location_update) : 'Not available'}</p>

              <h3>ETA</h3>
              <p><strong>Distance to pickup:</strong> {milesAway ? `${milesAway.toFixed(2)} miles` : 'Calculating...'}</p>
              <p><strong>Estimated arrival:</strong> {eta ? `${eta} minutes` : 'Calculating...'}</p>
            </div>
          )}

          {currentRide.status === 'requested' && (
            <button onClick={cancelRide} disabled={loading}>
              {loading ? 'Cancelling...' : 'Cancel Ride'}
            </button>
          )}

          {currentRide.status === 'completed' && driver && !hasRated && !ratingSubmitted && (
            <div className="ride-card">
              <h3>Rate Your Driver</h3>

              <select value={rating} onChange={(e) => setRating(e.target.value)}>
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

          {currentRide.status === 'completed' && (hasRated || ratingSubmitted) && (
            <div className="ride-card">
              <h3>Ride Complete</h3>
              <p>Thank you for riding with LibreRide.</p>
              <p>You already rated this trip.</p>
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