import { useEffect, useState } from 'react'
import './App.css'
import { supabase } from './supabase'

const API_BASE = 'https://libreride-backend.libreride.workers.dev'

const RIDE_TYPES = [
  {
    value: 'regular',
    label: 'Regular',
    capacity: 4,
  },
  {
    value: 'xl',
    label: 'XL',
    capacity: 6,
  },
  {
    value: 'premium',
    label: 'Premium',
    capacity: 4,
  },
  {
    value: 'premium_xl',
    label: 'Premium XL',
    capacity: 6,
  },
]

function formatRideType(value) {
  if (value === 'premium_xl') return 'Premium XL'
  if (value === 'premium') return 'Premium'
  if (value === 'xl') return 'XL'
  return 'Regular'
}

function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [riderProfile, setRiderProfile] = useState(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [paymentTermsAccepted, setPaymentTermsAccepted] = useState(false)

  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const [pickupLat, setPickupLat] = useState(null)
  const [pickupLng, setPickupLng] = useState(null)
  const [rideType, setRideType] = useState('regular')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [rideEstimate, setRideEstimate] = useState(null)
  const [currentRide, setCurrentRide] = useState(null)
  const [driver, setDriver] = useState(null)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [hasRated, setHasRated] = useState(false)
  const [rideHistory, setRideHistory] = useState([])
  const [hiddenCompletedRideId, setHiddenCompletedRideId] = useState(null)
  const [activePage, setActivePage] = useState('ride')

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

  function profileIsComplete(profile = riderProfile) {
    return Boolean(
      profile?.first_name &&
      profile?.last_name &&
      profile?.phone &&
      profile?.terms_accepted &&
      profile?.privacy_accepted &&
      profile?.payment_terms_accepted
    )
  }

  function loadProfileIntoForm(profile) {
    setFirstName(profile?.first_name || '')
    setLastName(profile?.last_name || '')
    setPhone(profile?.phone || '')
    setTermsAccepted(Boolean(profile?.terms_accepted))
    setPrivacyAccepted(Boolean(profile?.privacy_accepted))
    setPaymentTermsAccepted(Boolean(profile?.payment_terms_accepted))
  }

  async function loadRiderProfile(authUserId) {
    const { data, error } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      return null
    }

    if (data) {
      setRiderProfile(data)
      loadProfileIntoForm(data)
      return data
    }

    setRiderProfile(null)
    return null
  }

  async function restoreSession() {
    const { data } = await supabase.auth.getSession()

    if (data.session?.user) {
      const user = data.session.user
      setEmail(user.email || '')
      setLoggedIn(true)

      const profile = await loadRiderProfile(user.id)

      if (!profileIsComplete(profile)) {
        setActivePage('profile')
      }

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

    setEmail(data.user.email || email)
    setLoggedIn(true)

    const profile = await loadRiderProfile(data.user.id)

    if (!profileIsComplete(profile)) {
      setActivePage('profile')
      setMessage('Please complete your rider profile before requesting a ride.')
    } else {
      setActivePage('ride')
      setMessage('')
    }

    await loadCurrentRide()
    await loadRideHistory()
  }

  async function signup(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (!firstName || !lastName || !phone || !email || !password) {
      setLoading(false)
      setMessage('Please complete all required fields.')
      return
    }

    if (password.length < 6) {
      setLoading(false)
      setMessage('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setLoading(false)
      setMessage('Passwords do not match.')
      return
    }

    if (!termsAccepted || !privacyAccepted || !paymentTermsAccepted) {
      setLoading(false)
      setMessage('You must accept the terms, privacy policy, and payment notice.')
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone,
          role: 'rider',
        },
      },
    })

    if (error) {
      setLoading(false)
      setMessage(error.message)
      return
    }

    if (data.session?.user) {
      const savedProfile = await upsertRiderProfile(data.session.user)

      setLoading(false)

      if (savedProfile) {
        setLoggedIn(true)
        setRiderProfile(savedProfile)
        setActivePage('ride')
        setMessage('Rider account created successfully.')
      }

      return
    }

    setLoading(false)
    setAuthMode('login')
    setPassword('')
    setConfirmPassword('')
    setMessage('Account created. Check your email to verify your account, then log in.')
  }

  async function upsertRiderProfile(user) {
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('rider_profiles')
      .upsert(
        {
          auth_user_id: user.id,
          email: user.email || email,
          first_name: firstName,
          last_name: lastName,
          phone,
          terms_accepted: termsAccepted,
          privacy_accepted: privacyAccepted,
          payment_terms_accepted: paymentTermsAccepted,
          terms_accepted_at: termsAccepted && privacyAccepted && paymentTermsAccepted ? now : null,
          updated_at: now,
        },
        { onConflict: 'auth_user_id' }
      )
      .select('*')
      .single()

    if (error) {
      setMessage(error.message)
      return null
    }

    setRiderProfile(data)
    loadProfileIntoForm(data)
    return data
  }

  async function saveRiderProfile(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (!firstName || !lastName || !phone) {
      setLoading(false)
      setMessage('First name, last name, and phone are required.')
      return
    }

    if (!termsAccepted || !privacyAccepted || !paymentTermsAccepted) {
      setLoading(false)
      setMessage('You must accept the terms, privacy policy, and payment notice.')
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

    const savedProfile = await upsertRiderProfile(user)

    setLoading(false)

    if (savedProfile) {
      setActivePage('ride')
      setMessage('Rider profile saved.')
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    setLoggedIn(false)
    setAuthMode('login')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setRiderProfile(null)
    setFirstName('')
    setLastName('')
    setPhone('')
    setTermsAccepted(false)
    setPrivacyAccepted(false)
    setPaymentTermsAccepted(false)
    setPickup('')
    setDestination('')
    setPickupLat(null)
    setPickupLng(null)
    setRideType('regular')
    setMessage('')
    setLoading(false)
    setLocationLoading(false)
    setEstimateLoading(false)
    setRideEstimate(null)
    setCurrentRide(null)
    setDriver(null)
    setRating(5)
    setComment('')
    setRatingSubmitted(false)
    setHasRated(false)
    setRideHistory([])
    setHiddenCompletedRideId(null)
    setActivePage('ride')
  }

  async function payForRide() {
    if (!currentRide) return

    setLoading(true)
    setMessage('')

    const amountCents =
      currentRide.final_fare_cents ||
      currentRide.estimated_fare_cents ||
      2450

    const response = await fetch(`${API_BASE}/api/payments/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rideId: currentRide.id,
        amountCents,
      }),
    })

    const data = await response.json()
    setLoading(false)

    if (!response.ok) {
      setMessage(data.error || 'Payment failed to start.')
      return
    }

    window.location.href = data.url
  }

  async function requestRide() {
    setLoading(true)
    setMessage('')
    setRatingSubmitted(false)
    setHasRated(false)
    setHiddenCompletedRideId(null)

    if (!profileIsComplete()) {
      setLoading(false)
      setActivePage('profile')
      setMessage('Complete your rider profile before requesting a ride.')
      return
    }

    if (!pickup || !destination) {
      setLoading(false)
      setMessage('Enter pickup and destination.')
      return
    }

    let estimate = rideEstimate

    if (!estimate || estimate.rideType !== rideType) {
      estimate = await estimateRide()
    }

    if (!estimate) {
      setLoading(false)
      return
    }

    const pickupLocation = {
      lat: estimate.pickupLat,
      lng: estimate.pickupLng,
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      setMessage('You must be logged in.')
      return
    }

    const response = await fetch(`${API_BASE}/api/payments/prepaid-ride-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        riderId: user.id,
        riderEmail: user.email,
        pickupAddress: pickup,
        destinationAddress: estimate.destinationAddress || destination,
        pickupLat: pickupLocation.lat,
        pickupLng: pickupLocation.lng,
        destinationLat: estimate.destinationLat,
        destinationLng: estimate.destinationLng,
        amountCents: estimate.estimatedFareCents,
        rideType: estimate.rideType || rideType,
        rideTypeLabel: estimate.rideTypeLabel || formatRideType(rideType),
        requestedCapacity: estimate.requestedCapacity || selectedRideType().capacity,
        estimatedDistanceMiles: estimate.distanceMiles,
        estimatedDurationMinutes: estimate.estimatedMinutes,
        fareBreakdown: estimate.fareBreakdown,
      }),
    })

    const data = await response.json()
    setLoading(false)

    if (!response.ok) {
      setMessage(data.error || 'Could not start payment.')
      return
    }

    window.location.href = data.url
  }

  function selectedRideType() {
    return RIDE_TYPES.find((type) => type.value === rideType) || RIDE_TYPES[0]
  }

  function handlePickupChange(value) {
    setPickup(value)
    setPickupLat(null)
    setPickupLng(null)
    setRideEstimate(null)
  }

  function handleDestinationChange(value) {
    setDestination(value)
    setRideEstimate(null)
  }

  function handleRideTypeChange(value) {
    setRideType(value)
    setRideEstimate(null)
  }

  async function estimateRide() {
    setMessage('')
    setEstimateLoading(true)

    if (!profileIsComplete()) {
      setEstimateLoading(false)
      setActivePage('profile')
      setMessage('Complete your rider profile before estimating a ride.')
      return null
    }

    if (!pickup || !destination) {
      setEstimateLoading(false)
      setMessage('Enter pickup and destination before estimating fare.')
      return null
    }

    const pickupLocation = await getPickupLocationForRequest()

    if (!pickupLocation) {
      setEstimateLoading(false)
      return null
    }

    const response = await fetch(`${API_BASE}/api/rides/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupAddress: pickup,
        destinationAddress: destination,
        pickupLat: pickupLocation.lat,
        pickupLng: pickupLocation.lng,
        rideType,
      }),
    })

    const data = await response.json()
    setEstimateLoading(false)

    if (!response.ok) {
      setRideEstimate(null)
      setMessage(data.error || 'Could not estimate ride.')
      return null
    }

    setRideEstimate(data)
    setPickupLat(data.pickupLat)
    setPickupLng(data.pickupLng)
    setDestination(data.destinationAddress || destination)
    setMessage('Fare estimate ready.')

    return data
  }

  async function getPickupLocationForRequest() {
    const savedPickupLat = Number(pickupLat)
    const savedPickupLng = Number(pickupLng)

    if (Number.isFinite(savedPickupLat) && Number.isFinite(savedPickupLng)) {
      return {
        lat: savedPickupLat,
        lng: savedPickupLng,
      }
    }

    return capturePickupLocation()
  }

  async function capturePickupLocation() {
    if (!navigator.geolocation) {
      setMessage('Location services are not supported by this browser.')
      return null
    }

    setLocationLoading(true)
    setMessage('Getting your pickup location...')

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        })
      })

      const lat = position.coords.latitude
      const lng = position.coords.longitude

      setPickupLat(lat)
      setPickupLng(lng)
      setRideEstimate(null)
      setMessage('Pickup GPS location captured.')

      return { lat, lng }
    } catch (error) {
      let errorMessage = 'Could not get your pickup GPS location.'

      if (error.code === 1) {
        errorMessage = 'Location permission was denied. Please allow location access to request a ride.'
      } else if (error.code === 2) {
        errorMessage = 'Your location is currently unavailable. Please try again.'
      } else if (error.code === 3) {
        errorMessage = 'Location request timed out. Please try again.'
      }

      setMessage(errorMessage)
      return null
    } finally {
      setLocationLoading(false)
    }
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
      .in('status', ['payment_pending', 'requested', 'accepted', 'arrived', 'in_progress', 'completed'])
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

    setHasRated(Boolean(data))
    setRatingSubmitted(Boolean(data))
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
    setPickupLat(null)
    setPickupLng(null)
    setRideType('regular')
    setRideEstimate(null)
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
    setPickupLat(null)
    setPickupLng(null)
    setRideType('regular')
    setRideEstimate(null)
    setMessage('')
    setRating(5)
    setComment('')
    setRatingSubmitted(false)
    setHasRated(false)
    setActivePage('ride')
    loadRideHistory()
  }

  function rideMessage(status) {
    if (status === 'payment_pending') return 'Payment pending. Complete payment to request this ride.'
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

  function renderProfileForm() {
    return (
      <section className="card">
        <h2>Rider Profile</h2>
        <p>Complete this profile before requesting a ride.</p>

        <form onSubmit={saveRiderProfile}>
          <input
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />

          <input
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />

          <input
            placeholder="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <label style={{ display: 'block', marginBottom: '8px' }}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              style={{ width: 'auto', marginRight: '8px' }}
            />
            I accept the LibreRide Terms of Service.
          </label>

          <label style={{ display: 'block', marginBottom: '8px' }}>
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              style={{ width: 'auto', marginRight: '8px' }}
            />
            I accept the LibreRide Privacy Policy.
          </label>

          <label style={{ display: 'block', marginBottom: '8px' }}>
            <input
              type="checkbox"
              checked={paymentTermsAccepted}
              onChange={(e) => setPaymentTermsAccepted(e.target.checked)}
              style={{ width: 'auto', marginRight: '8px' }}
            />
            I understand rides are prepaid before dispatch.
          </label>

          <button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save Rider Profile'}
          </button>
        </form>
      </section>
    )
  }

  if (!loggedIn) {
    return (
      <div className="driver-app">
        <section className="card">
          <h1>LibreRide Rider</h1>
          <p>{authMode === 'login' ? 'Sign in to request a ride' : 'Create your rider account'}</p>

          <div style={{ marginBottom: '12px' }}>
            <button
              type="button"
              onClick={() => {
                setAuthMode('login')
                setMessage('')
              }}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode('signup')
                setMessage('')
              }}
              style={{ marginLeft: '8px' }}
            >
              Create Account
            </button>
          </div>

          {authMode === 'login' ? (
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
          ) : (
            <form onSubmit={signup}>
              <input
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />

              <input
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />

              <input
                placeholder="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />

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

              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              <label style={{ display: 'block', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  style={{ width: 'auto', marginRight: '8px' }}
                />
                I accept the LibreRide Terms of Service.
              </label>

              <label style={{ display: 'block', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  style={{ width: 'auto', marginRight: '8px' }}
                />
                I accept the LibreRide Privacy Policy.
              </label>

              <label style={{ display: 'block', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={paymentTermsAccepted}
                  onChange={(e) => setPaymentTermsAccepted(e.target.checked)}
                  style={{ width: 'auto', marginRight: '8px' }}
                />
                I understand rides are prepaid before dispatch.
              </label>

              <button type="submit" disabled={loading}>
                {loading ? 'Creating Account...' : 'Create Rider Account'}
              </button>
            </form>
          )}

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
        {riderProfile && (
          <p>
            {riderProfile.first_name} {riderProfile.last_name} • {riderProfile.phone}
          </p>
        )}
        <button onClick={logout}>Logout</button>
      </header>

      <section className="card">
        <button onClick={() => setActivePage('ride')}>
          Request Ride
        </button>

        <button onClick={() => setActivePage('profile')}>
          Rider Profile
        </button>

        <button onClick={() => setActivePage('history')}>
          Ride History
        </button>
      </section>

      {activePage === 'profile' && renderProfileForm()}

      {activePage === 'ride' && !profileIsComplete() && (
        <section className="card">
          <h2>Complete Rider Profile</h2>
          <p>You must complete your rider profile before requesting a ride.</p>
          <button type="button" onClick={() => setActivePage('profile')}>
            Complete Profile
          </button>
        </section>
      )}

      {activePage === 'ride' && profileIsComplete() && !currentRide && (
        <section className="card">
          <h2>Request Ride</h2>

          <input
            placeholder="Pickup location"
            value={pickup}
            onChange={(e) => handlePickupChange(e.target.value)}
          />

          <button type="button" onClick={capturePickupLocation} disabled={loading || locationLoading}>
            {locationLoading ? 'Getting Location...' : 'Use My Current Location'}
          </button>

          {pickupLat !== null && pickupLng !== null && (
            <p>
              <strong>Pickup GPS:</strong> {Number(pickupLat).toFixed(6)}, {Number(pickupLng).toFixed(6)}
            </p>
          )}

          <input
            placeholder="Destination"
            value={destination}
            onChange={(e) => handleDestinationChange(e.target.value)}
          />

          <div className="ride-card">
            <h3>Choose Ride Type</h3>

            {RIDE_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => handleRideTypeChange(type.value)}
                disabled={loading || locationLoading || estimateLoading}
                style={{
                  fontWeight: rideType === type.value ? 'bold' : 'normal',
                  borderWidth: rideType === type.value ? '2px' : '1px',
                  margin: '4px',
                }}
              >
                {type.label} • {type.capacity} seats
              </button>
            ))}
          </div>

          {rideEstimate ? (
            <div className="ride-card">
              <h3>{rideEstimate.rideTypeLabel || formatRideType(rideEstimate.rideType)} Estimate</h3>
              <p><strong>Capacity:</strong> {rideEstimate.requestedCapacity || selectedRideType().capacity} seats</p>
              <p><strong>Distance:</strong> {rideEstimate.distanceMiles} miles</p>
              <p><strong>Estimated time:</strong> {rideEstimate.estimatedMinutes} minutes</p>
              <p><strong>Estimated fare:</strong> ${Number(rideEstimate.estimatedFareDollars || 0).toFixed(2)}</p>
            </div>
          ) : (
            <p><strong>Estimated Fare:</strong> Choose ride type, then tap Estimate Fare</p>
          )}

          <button type="button" onClick={estimateRide} disabled={loading || locationLoading || estimateLoading}>
            {estimateLoading ? 'Estimating...' : 'Estimate Fare'}
          </button>

          <button onClick={requestRide} disabled={loading || locationLoading || estimateLoading}>
            {loading ? 'Opening Payment...' : 'Request Ride & Pay'}
          </button>
        </section>
      )}

      {activePage === 'ride' && currentRide && (
        <section className="card">
          <h2>Your Ride</h2>

          <p><strong>Status:</strong> {currentRide.status}</p>
          <p>{rideMessage(currentRide.status)}</p>

          <p><strong>Ride Type:</strong> {formatRideType(currentRide.ride_type)}</p>
          {currentRide.requested_capacity && (
            <p><strong>Capacity:</strong> {currentRide.requested_capacity} seats</p>
          )}
          <p><strong>Pickup:</strong> {currentRide.pickup_address || 'Unknown'}</p>
          <p><strong>Dropoff:</strong> {currentRide.destination_address || 'Unknown'}</p>
          <p><strong>Fare:</strong> ${((currentRide.estimated_fare_cents || 0) / 100).toFixed(2)}</p>
          {currentRide.estimated_distance_miles && (
            <p><strong>Distance:</strong> {Number(currentRide.estimated_distance_miles).toFixed(2)} miles</p>
          )}
          {currentRide.estimated_duration_minutes && (
            <p><strong>Estimated time:</strong> {Math.round(Number(currentRide.estimated_duration_minutes))} minutes</p>
          )}
          <p><strong>Payment:</strong> {currentRide.payment_status || 'unpaid'}</p>

          {currentRide.payment_status !== 'paid' &&
            (currentRide.status === 'payment_pending' || currentRide.status === 'completed') && (
              <button onClick={payForRide} disabled={loading}>
                {loading ? 'Opening Payment...' : 'Continue Payment'}
              </button>
            )}

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

          {(currentRide.status === 'requested' || currentRide.status === 'payment_pending') && (
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

      {activePage === 'history' && (
        <section className="card">
          <h2>Ride History</h2>

          {rideHistory.length === 0 ? (
            <p>No ride history yet.</p>
          ) : (
            rideHistory.map((ride) => (
              <div key={ride.id} className="ride-card">
                <p><strong>Status:</strong> {ride.status}</p>
                <p><strong>Ride Type:</strong> {formatRideType(ride.ride_type)}</p>
                {ride.requested_capacity && (
                  <p><strong>Capacity:</strong> {ride.requested_capacity} seats</p>
                )}
                <p><strong>Pickup:</strong> {ride.pickup_address || 'Unknown'}</p>
                <p><strong>Dropoff:</strong> {ride.destination_address || 'Unknown'}</p>
                <p><strong>Fare:</strong> ${((ride.final_fare_cents || ride.estimated_fare_cents || 0) / 100).toFixed(2)}</p>
                {ride.estimated_distance_miles && (
                  <p><strong>Distance:</strong> {Number(ride.estimated_distance_miles).toFixed(2)} miles</p>
                )}
                {ride.estimated_duration_minutes && (
                  <p><strong>Estimated time:</strong> {Math.round(Number(ride.estimated_duration_minutes))} minutes</p>
                )}
                <p><strong>Payment:</strong> {ride.payment_status || 'unpaid'}</p>
                <p><strong>Date:</strong> {formatDate(ride.created_at)}</p>
              </div>
            ))
          )}
        </section>
      )}

      {message && <p>{message}</p>}
    </div>
  )
}

export default App