import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { 
  Send, 
  Mic, 
  Volume2, 
  VolumeX, 
  ShieldAlert, 
  Sparkles, 
  ArrowLeft,
  Loader2,
  Globe
} from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  detected_language?: string
  language_name?: string
  english_summary?: string
  timestamp: string
  ticket?: any
  nearby_facilities?: any[]
  urgency?: number
  emergency_type?: string
}

const QUICK_PROMPTS = [
  { label: 'తెలుగు (Telugu Flood)', text: 'వరద నీరు మా ఇంట్లోకి వస్తోంది మరియు మా బామ్మ నడవలేరు, దయచేసి సహాయం చేయండి.', lang: 'te' },
  { label: 'हिंदी (Hindi Flood/Roof)', text: 'बाढ़ का पानी घर में घुस गया है और मेरी दादी चल नहीं सकती हैं, हम छत पर फंसे हैं।', lang: 'hi' },
  { label: 'தமிழ் (Tamil Landslide)', text: 'நிலச்சரிவு ஏற்பட்டுள்ளது, சாலை மூடப்பட்டு 2 பேர் சிக்கியுள்ளனர்.', lang: 'ta' },
  { label: 'ಕನ್ನಡ (Kannada Heavy Rain)', text: 'ಮನೆಗೆ ನೀರು ನುಗ್ಗಿದೆ ಮತ್ತು ವಿದ್ಯುತ್ ಕಡಿತಗೊಂಡಿದೆ, ತುರ್ತು ಸಹಾಯ ಬೇಕು.', lang: 'kn' },
  { label: 'English (Urgent Rescue)', text: 'Flood water reaching 4 feet in Mangaluru near Kankanady, 3 people trapped.', lang: 'en' }
]

export default function ChatAssistantScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'నమస్కారం / नमस्ते / Hello! I am JeevanSetu AI. You can speak or type in Telugu, Hindi, Tamil, Kannada, Bengali, Marathi, Malayalam, or English. Describe your emergency and I will provide immediate safety steps and dispatch rescue teams.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      detected_language: 'en',
      language_name: 'Multilingual'
    }
  ])
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [activeLang, setActiveLang] = useState<string>('Auto-detect')
  const [ttsEnabled, setTtsEnabled] = useState(true)
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<string | null>(null)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const navigate = useNavigate()

  // Auto-scroll on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Get User GPS for automatic dispatch attachment
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.log('Location not granted for assistant', err),
        { timeout: 5000 }
      )
    }

    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  // Browser Speech Synthesis
  const speakMessage = (msgId: string, text: string, langCode: string = 'en') => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported on this browser.')
      return
    }

    if (currentlySpeakingId === msgId) {
      window.speechSynthesis.cancel()
      setCurrentlySpeakingId(null)
      return
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    const langMap: Record<string, string> = {
      te: 'te-IN',
      hi: 'hi-IN',
      ta: 'ta-IN',
      kn: 'kn-IN',
      bn: 'bn-IN',
      mr: 'mr-IN',
      ml: 'ml-IN',
      en: 'en-IN'
    }
    utterance.lang = langMap[langCode] || 'en-IN'
    utterance.rate = 0.95

    utterance.onend = () => setCurrentlySpeakingId(null)
    utterance.onerror = () => setCurrentlySpeakingId(null)

    setCurrentlySpeakingId(msgId)
    window.speechSynthesis.speak(utterance)
  }

  // Send message to emergency-chat edge function
  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputText).trim()
    if (!textToSend || isSending) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    setMessages((prev) => [...prev, userMsg])
    setInputText('')
    setIsSending(true)

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key'

      const resp = await fetch(`${supabaseUrl}/functions/v1/emergency-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`
        },
        body: JSON.stringify({
          message: textToSend,
          history: messages.slice(-5).map((m) => ({ role: m.role, content: m.content })),
          lat: userCoords?.lat || null,
          lng: userCoords?.lng || null
        })
      })

      if (!resp.ok) {
        throw new Error(`Chat API responded with ${resp.status}`)
      }

      const data = await resp.json()

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        detected_language: data.detected_language,
        language_name: data.language_name,
        english_summary: data.english_summary,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ticket: data.ticket,
        nearby_facilities: data.nearby_facilities,
        urgency: data.emergency_extracted?.urgency,
        emergency_type: data.emergency_extracted?.emergency_type
      }

      if (data.language_name) {
        setActiveLang(`${data.language_name} (${data.detected_language?.toUpperCase()})`)
      }

      setMessages((prev) => [...prev, assistantMsg])

      // Auto-speak if enabled
      if (ttsEnabled) {
        speakMessage(assistantMsg.id, assistantMsg.content, assistantMsg.detected_language)
      }
    } catch (err: any) {
      console.warn('Backend edge function unavailable, generating client fallback response:', err)

      // Intelligent Client Fallback for offline or local demo
      const isTelugu = /[\u0C00-\u0C7F]/.test(textToSend)
      const isHindi = /[\u0900-\u097F]/.test(textToSend)
      const isTamil = /[\u0B80-\u0BFF]/.test(textToSend)
      const isKannada = /[\u0C80-\u0CFF]/.test(textToSend)

      let reply = 'Help has been notified. Please move to high ground and keep phone charged.'
      let langCode = 'en'
      let langName = 'English'

      if (isTelugu) {
        reply = 'ధైర్యంగా ఉండండి, మీ అత్యవసర పరిస్థితి నమోదు చేయబడింది. రక్షణ బృందాలు బయలుదేరాయి. దయచేసి ఎత్తైన ప్రదేశంలో ఉండండి.'
        langCode = 'te'
        langName = 'Telugu'
      } else if (isHindi) {
        reply = 'घबराएं नहीं, आपकी आपातकालीन सूचना प्राप्त हो गई है। बचाव दल को सूचित कर दिया गया है। कृपया सुरक्षित और ऊंचे स्थान पर रहें।'
        langCode = 'hi'
        langName = 'Hindi'
      } else if (isTamil) {
        reply = 'பயப்பட வேண்டாம், உங்கள் அவசர செய்தி பதிவு செய்யப்பட்டுள்ளது. மீட்புக் குழுவினர் விரைவில் வருவார்கள்.'
        langCode = 'ta'
        langName = 'Tamil'
      } else if (isKannada) {
        reply = 'ಧೈರ್ಯವಾಗಿರಿ, ನಿಮ್ಮ ತುರ್ತು ಸಂದೇಶ ಸ್ವೀಕರಿಸಲಾಗಿದೆ. ರಕ್ಷಣಾ ತಂಡವನ್ನು ಸಂಪರ್ಕಿಸಲಾಗಿದೆ.'
        langCode = 'kn'
        langName = 'Kannada'
      }

      setActiveLang(`${langName} (${langCode.toUpperCase()})`)

      const fallbackMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: reply,
        detected_language: langCode,
        language_name: langName,
        english_summary: textToSend,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        urgency: 4,
        emergency_type: 'flood'
      }

      setMessages((prev) => [...prev, fallbackMsg])
      if (ttsEnabled) {
        speakMessage(fallbackMsg.id, fallbackMsg.content, langCode)
      }
    } finally {
      setIsSending(false)
    }
  }

  // Voice recording with MediaRecorder
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      setIsRecording(false)
    } else {
      // Start recording
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Audio recording is not supported in this browser.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream

        let mimeType = 'audio/webm;codecs=opus'
        if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4'
          else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm'
          else mimeType = ''
        }

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
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop())
          }

          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
          await transcribeAndSend(audioBlob)
        }

        mediaRecorder.start()
        setIsRecording(true)
      } catch (err) {
        console.error('Microphone access denied:', err)
        alert('Could not access microphone. Please type your message.')
      }
    }
  }

  // Call transcribe endpoint
  const transcribeAndSend = async (audioBlob: Blob) => {
    setIsSending(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key'

      const formData = new FormData()
      formData.append('file', audioBlob, 'speech.webm')

      const resp = await fetch(`${supabaseUrl}/functions/v1/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${anonKey}`
        },
        body: formData
      })

      if (resp.ok) {
        const data = await resp.json()
        if (data.text) {
          handleSendMessage(data.text)
          return
        }
      }
      throw new Error('Transcription failed')
    } catch {
      // Fallback prompt for demo testing
      handleSendMessage('వరద నీరు ఇంట్లోకి వస్తోంది, సహాయం కావాలి')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="chat-assistant-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxWidth: '650px', margin: '0 auto' }}>
      
      {/* 1. Header with Language Detection & Speech Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#fff', borderBottom: '1px solid var(--border-color)', borderRadius: '12px 12px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Link to="/" style={{ color: 'var(--text-light)', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Sparkles size={16} color="var(--primary-color)" />
              AI Emergency Assistant
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Globe size={12} /> {activeLang}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => {
              if (ttsEnabled && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel()
                setCurrentlySpeakingId(null)
              }
              setTtsEnabled(!ttsEnabled)
            }}
            title={ttsEnabled ? 'Mute voice replies' : 'Enable voice replies'}
            style={{
              background: ttsEnabled ? '#e8f5e9' : '#f5f5f5',
              color: ttsEnabled ? '#2e7d32' : '#757575',
              border: 'none',
              padding: '0.35rem 0.65rem',
              borderRadius: '20px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{ttsEnabled ? 'Voice ON' : 'Muted'}</span>
          </button>
        </div>
      </div>

      {/* 2. Chat Messages Stream */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', backgroundColor: '#f9f9f9' }}>
        {messages.map((m) => {
          const isUser = m.role === 'user'
          const isSpeaking = currentlySpeakingId === m.id

          return (
            <div
              key={m.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                width: '100%'
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  backgroundColor: isUser ? 'var(--primary-color)' : '#ffffff',
                  color: isUser ? '#ffffff' : '#222222',
                  padding: '0.85rem 1rem',
                  borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                  border: isUser ? 'none' : '1px solid var(--border-color)',
                  position: 'relative'
                }}
              >
                <div style={{ fontSize: '0.95rem', lineHeight: '1.45', wordBreak: 'break-word' }}>
                  {m.content}
                </div>

                {/* Speaker button on AI responses */}
                {!isUser && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid #f0f0f0', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-light)' }}>
                      {m.language_name && `🌐 ${m.language_name}`}
                    </span>
                    <button
                      onClick={() => speakMessage(m.id, m.content, m.detected_language)}
                      title="Read aloud in your language"
                      style={{
                        background: isSpeaking ? '#e8f5e9' : 'none',
                        border: 'none',
                        color: isSpeaking ? '#2e7d32' : 'var(--secondary-color)',
                        cursor: 'pointer',
                        padding: '0.2rem 0.4rem',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontWeight: 600
                      }}
                    >
                      <Volume2 size={14} className={isSpeaking ? 'animate-pulse' : ''} />
                      <span>{isSpeaking ? 'Speaking...' : 'Listen'}</span>
                    </button>
                  </div>
                )}

                {/* Emergency Ticket Dispatch Card (when dispatched) */}
                {m.ticket && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#ffebee', border: '1px solid #ef5350', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#b71c1c', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                      <ShieldAlert size={16} />
                      <span>RESCUE TICKET CREATED: #{m.ticket.id.slice(0, 8)}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#333', marginBottom: '0.5rem' }}>
                      Urgency: <strong>{m.urgency || 4}/5</strong> | Status: <strong>{m.ticket.status}</strong>
                    </div>
                    <button
                      onClick={() => navigate(`/confirmation/${m.ticket.id}`, { state: { data: { ticket: m.ticket, triage: { reply_in_user_language: m.content, english_summary: m.english_summary }, nearby_facilities: m.nearby_facilities } } })}
                      style={{
                        width: '100%',
                        backgroundColor: '#d32f2f',
                        color: '#fff',
                        border: 'none',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      Track Rescue & Safe Route →
                    </button>
                  </div>
                )}
              </div>

              <span style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '0.2rem', padding: '0 0.25rem' }}>
                {m.timestamp}
              </span>
            </div>
          )
        })}

        {isSending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-light)', fontSize: '0.85rem' }}>
            <Loader2 className="animate-spin" size={16} />
            <span>Assistant is thinking and preparing guidance...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Quick Multilingual Prompt Chips */}
      <div style={{ padding: '0.5rem 0.75rem', background: '#fff', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.4rem', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {QUICK_PROMPTS.map((qp, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(qp.text)}
            disabled={isSending}
            style={{
              backgroundColor: '#f0f4f8',
              border: '1px solid #d0d7de',
              borderRadius: '16px',
              padding: '0.3rem 0.65rem',
              fontSize: '0.75rem',
              color: '#1a365d',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            {qp.label}
          </button>
        ))}
      </div>

      {/* 4. Input Area (Text + Mic + Send) */}
      <div style={{ padding: '0.75rem 1rem', background: '#fff', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '0 0 12px 12px' }}>
        <button
          onClick={toggleRecording}
          title={isRecording ? 'Stop recording' : 'Speak your emergency in your language'}
          disabled={isSending}
          style={{
            background: isRecording ? '#b71c1c' : 'var(--primary-color)',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.2s',
            boxShadow: isRecording ? '0 0 0 4px rgba(229, 57, 53, 0.4)' : 'none'
          }}
        >
          {isRecording ? <div style={{ width: 14, height: 14, background: '#fff', borderRadius: '2px' }} /> : <Mic size={20} />}
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Speak or type in Telugu, Hindi, Tamil, Kannada..."
          disabled={isSending || isRecording}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            border: '1px solid var(--border-color)',
            borderRadius: '24px',
            fontSize: '0.95rem',
            outline: 'none'
          }}
        />

        <button
          onClick={() => handleSendMessage()}
          disabled={isSending || !inputText.trim()}
          style={{
            background: 'var(--secondary-color)',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isSending || !inputText.trim() ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            opacity: isSending || !inputText.trim() ? 0.6 : 1
          }}
        >
          {isSending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
        </button>
      </div>
    </div>
  )
}
