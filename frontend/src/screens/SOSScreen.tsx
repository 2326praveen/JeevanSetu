import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Mic, MapPin, Send, Loader2, Sparkles, Camera } from 'lucide-react'
import { set, get, del } from 'idb-keyval'
import RiskCard from '../components/RiskCard'
import DamageCaptureModal from '../components/DamageCaptureModal'
import OfflineFallbackPanel from '../components/OfflineFallbackPanel'

// Assuming we have a global queue for offline requests
const QUEUE_KEY = 'jeevansetu-sos-queue';

export default function SOSScreen({ isOffline }: { isOffline: boolean }) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [text, setText] = useState('')
  const [useGPS, setUseGPS] = useState(true)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [showDamageScanner, setShowDamageScanner] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const mimeTypeRef = useRef<string>('audio/webm;codecs=opus')

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  // Geolocation check for location-specific disaster risk
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        (err) => console.log('Location access not granted for risk forecast', err),
        { timeout: 5000 }
      )
    }
  }, [])

  // Auto-sync when coming back online
  useEffect(() => {
    if (!isOffline) {
      processQueue();
    }
  }, [isOffline]);

  const processQueue = async () => {
    try {
      const queue: any[] = await get(QUEUE_KEY) || [];
      if (queue.length > 0) {
        for (const req of queue) {
          await sendSosToApi(req);
        }
        await del(QUEUE_KEY);
      }
    } catch (e) {
      console.error("Failed to process queue", e);
    }
  }

  const startRecording = async () => {
    if (isOffline) {
      alert("Voice transcription is unavailable while offline. Please type your emergency message directly into the text box.")
      return
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Audio recording is not supported in this browser. Please type your emergency message.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      let mimeType = 'audio/webm;codecs=opus'
      if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4'
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm'
        } else {
          mimeType = ''
        }
      }
      mimeTypeRef.current = mimeType

      const options = mimeType ? { mimeType } : undefined
      const mediaRecorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        setIsRecording(false)
        setRecordingTime(0)

        const recordedBlob = new Blob(audioChunksRef.current, {
          type: mimeTypeRef.current || 'audio/webm'
        })

        if (recordedBlob.size === 0) return

        if (isOffline || !navigator.onLine) {
          alert("You are currently offline. Voice transcription requires an internet connection. Please type your emergency message.")
          return
        }

        setIsTranscribing(true)
        try {
          const formData = new FormData()
          const extension = mimeTypeRef.current.includes('mp4') ? 'mp4' : 'webm'
          formData.append('file', recordedBlob, `recording.${extension}`)

          const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'
          const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

          const response = await fetch(`${baseUrl}/functions/v1/transcribe`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${anonKey}`
            },
            body: formData
          })

          if (!response.ok) {
            throw new Error(`Transcription request failed with status ${response.status}`)
          }

          const data = await response.json()
          if (data.text) {
            setText(prev => prev ? `${prev} ${data.text.trim()}` : data.text.trim())
          }
        } catch (err) {
          console.error("Transcription error:", err)
          alert("Voice transcription failed. You can still type your emergency message directly in the text box.")
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)

      const startTime = Date.now()
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        if (elapsed >= 60) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
        } else {
          setRecordingTime(elapsed)
        }
      }, 1000)
    } catch (err: any) {
      console.error("Microphone access error:", err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Microphone permission was denied. Please allow microphone access or type your emergency message.")
      } else {
        alert("Unable to access microphone. Please type your emergency message.")
      }
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  const sendSosToApi = async (payload: any) => {
    // We would hit our Supabase Edge Function here.
    // Assuming relative path or configured backend API
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'}/functions/v1/create-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error('API Error');
    return response.json();
  }

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setIsSubmitting(true);
    
    let lat = null;
    let lng = null;
    
    if (useGPS && 'geolocation' in navigator) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        lat = position.coords.latitude;
        lng = position.coords.longitude;
      } catch (e) {
        console.log("GPS disabled or failed", e);
      }
    }

    const payload = {
      text,
      channel: 'app',
      lat,
      lng
    };

    if (isOffline) {
      // Queue in IndexedDB
      const queue: any[] = await get(QUEUE_KEY) || [];
      queue.push(payload);
      await set(QUEUE_KEY, queue);
      setIsSubmitting(false);
      alert("You are offline. Your SOS has been queued and will be sent automatically when you reconnect.");
      setText('');
    } else {
      try {
        const data = await sendSosToApi(payload);
        navigate(`/confirmation/${data.ticket.id}`, { state: { data } });
      } catch (error) {
        console.error("Submission failed", error);
        alert("Failed to send SOS. Please try again or use SMS.");
      } finally {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <div className="sos-container">
      {/* 1. Citizen Disaster Risk & Preparedness Card (Phase 1) */}
      <RiskCard userLat={userCoords?.lat} userLng={userCoords?.lng} />

      {/* Multilingual Voice/Chat Assistant Banner (Phase 2) */}
      <Link 
        to="/assistant" 
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
          color: '#ffffff',
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          textDecoration: 'none',
          boxShadow: '0 2px 8px rgba(25, 118, 210, 0.25)',
          marginBottom: '0.5rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Sparkles size={20} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Multilingual Voice & Chat Assistant</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>Talk in Telugu, Hindi, Tamil, Kannada & more</div>
          </div>
        </div>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, background: 'rgba(255,255,255,0.2)', padding: '0.25rem 0.6rem', borderRadius: '12px' }}>
          Open →
        </span>
      </Link>

      {/* AI Crowd Damage Scanner Button (Phase 4) */}
      <button
        onClick={() => setShowDamageScanner(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #e65100 0%, #bf360c 100%)',
          color: '#ffffff',
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          border: 'none',
          boxShadow: '0 2px 8px rgba(230, 81, 0, 0.25)',
          marginBottom: '0.75rem',
          cursor: 'pointer',
          width: '100%'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textAlign: 'left' }}>
          <Camera size={20} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>AI Damage Scanner (Photo Upload)</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>Capture flood / collapse damage with Groq Vision</div>
          </div>
        </div>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, background: 'rgba(255,255,255,0.2)', padding: '0.25rem 0.6rem', borderRadius: '12px' }}>
          Scan →
        </span>
      </button>

      {showDamageScanner && (
        <DamageCaptureModal
          userLat={userCoords?.lat}
          userLng={userCoords?.lng}
          onClose={() => setShowDamageScanner(false)}
        />
      )}

      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <h2>Emergency SOS</h2>
        <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
          {isTranscribing
            ? 'Transcribing audio...'
            : isRecording
            ? 'Recording... Tap to stop (max 60s).'
            : 'Tap the mic to speak in any language or type below.'}
        </p>
      </div>

      <button 
        className={`mic-button ${isRecording ? 'recording' : ''}`}
        onClick={handleMicClick}
        aria-label={isRecording ? 'Stop recording' : 'Hold to speak'}
        disabled={isSubmitting || isTranscribing}
      >
        {isTranscribing ? <Loader2 className="animate-spin" size={48} /> : <Mic size={48} />}
      </button>

      {isRecording && (
        <div style={{ textAlign: 'center', marginTop: '-1.5rem', marginBottom: '1rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
          {recordingTime}s / 60s
        </div>
      )}

      <div className="text-input-group">
        <textarea 
          className="sos-input"
          placeholder="Type your emergency here... (e.g. My house is flooding, 2 people trapped)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isSubmitting}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>Language: Auto-detect</span>
           <label className="toggle-group">
            <input 
              type="checkbox" 
              checked={useGPS} 
              onChange={(e) => setUseGPS(e.target.checked)} 
            />
            <MapPin size={16} /> Use my GPS
          </label>
        </div>
      </div>

      <button 
        className="submit-button"
        onClick={handleSubmit}
        disabled={isSubmitting || !text.trim()}
      >
        {isSubmitting ? <Loader2 className="animate-spin" style={{ margin: '0 auto' }} /> : (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Send size={20} /> SEND SOS
          </span>
        )}
      </button>

      {/* 4. Offline / Low-Network SMS-SOS & Cache Panel (Phase 6) */}
      <div style={{ marginTop: '1.25rem' }}>
        <OfflineFallbackPanel
          isOffline={isOffline}
          userLat={userCoords?.lat}
          userLng={userCoords?.lng}
        />
      </div>
    </div>
  )
}
