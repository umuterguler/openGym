import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { createNativeRecording, chooseRecordingMime } from '../lib/video-recorder.js'
import { videoMediaPlugin } from '../lib/native-video-media.js'
import { Button } from './ui.jsx'

const errorLine = error => {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return t('Camera permission is needed to record. Enable it in Settings.')
  if (error?.code === 'unsupported-codec') return t('This phone does not support in-app video recording.')
  return t('The camera could not start. Try again or use the device camera.')
}

/** Android WebView camera preview and MediaRecorder. The source bytes stream to app-private cache. */
export default function InAppVideoRecorder({ maxSeconds = 60, onRecorded, onCancel, onFallback }) {
  const preview = useRef(null)
  const stream = useRef(null)
  const sink = useRef(null)
  const finished = useRef(false)
  const ending = useRef(false)
  const startedAt = useRef(0)
  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [silent, setSilent] = useState(false)
  const [error, setError] = useState(null)

  const releaseCamera = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (preview.current) preview.current.srcObject = null
  }, [])

  const openCamera = useCallback(async () => {
    setError(null); setReady(false); setSilent(false)
    const devices = navigator.mediaDevices
    if (!devices?.getUserMedia || !globalThis.MediaRecorder) {
      setError(t('This phone does not support in-app video recording.'))
      return
    }
    if (!chooseRecordingMime(globalThis.MediaRecorder)) {
      setError(t('This phone does not support in-app video recording.'))
      return
    }
    let live
    try {
      live = await devices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
    } catch (audioError) {
      // A refused or unavailable microphone must not make a silent form recording impossible.
      try {
        live = await devices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        setSilent(true)
      } catch { setError(errorLine(audioError)); return }
    }
    stream.current = live
    if (preview.current) {
      preview.current.srcObject = live
      try { await preview.current.play() } catch { /* autoplay is muted; user can still start recording */ }
    }
    setReady(true)
  }, [])

  useEffect(() => {
    openCamera()
    return () => {
      releaseCamera()
      if (!finished.current && sink.current) sink.current.cancel().catch(() => {})
    }
  }, [openCamera, releaseCamera])

  const cancelPartial = useCallback(async () => {
    if (ending.current) return
    ending.current = true
    try { await sink.current?.cancel() } catch { /* file cleanup is also covered by cache GC */ }
    sink.current = null
    setRecording(false)
    releaseCamera()
  }, [releaseCamera])

  const stopRecording = useCallback(async () => {
    if (!recording || ending.current || !sink.current) return
    ending.current = true
    setFinishing(true)
    setRecording(false)
    try {
      const result = await sink.current.stop()
      sink.current = null
      finished.current = true
      releaseCamera()
      await onRecorded(result)
    } catch (cause) {
      await sink.current?.cancel().catch(() => {})
      sink.current = null
      releaseCamera()
      setError(errorLine(cause))
    } finally { ending.current = false; setFinishing(false) }
  }, [onRecorded, recording, releaseCamera])

  const startRecording = async () => {
    if (!ready || !stream.current || ending.current) return
    setError(null)
    try {
      const plugin = videoMediaPlugin()
      const mimeType = chooseRecordingMime(globalThis.MediaRecorder)
      sink.current = await createNativeRecording({ stream: stream.current, plugin, mimeType })
      startedAt.current = Date.now()
      setSeconds(0); setRecording(true)
    } catch (cause) { setError(errorLine(cause)) }
  }

  useEffect(() => {
    if (!recording) return undefined
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(elapsed)
      if (elapsed >= maxSeconds) stopRecording()
    }, 250)
    const background = () => { if (document.hidden) { cancelPartial(); setError(t('Recording stopped because OpenGym went to the background.')) } }
    document.addEventListener('visibilitychange', background)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', background) }
  }, [recording, maxSeconds, stopRecording, cancelPartial])

  const cancel = async () => { await cancelPartial(); onCancel() }
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return <div className="fv-recorder">
    <h3>{t('Record a video')}</h3>
    <div className="fv-recorder-preview">
      <video ref={preview} autoPlay muted playsInline />
      {!ready && <div className="fv-recorder-overlay">{error || t('Opening camera…')}</div>}
    </div>
    {silent && <div className="small dim">{t('Microphone unavailable. The video will have no sound.')}</div>}
    {finishing && <div className="small dim" role="status">{t('Finishing recording…')}</div>}
    {recording && <div className="fv-recorder-clock" dir="ltr">● {clock} / {Math.floor(maxSeconds / 60)}:{String(maxSeconds % 60).padStart(2, '0')}</div>}
    {error && <div className="small dim" role="alert">{error}</div>}
    <div className="fv-trim-actions">
      {recording
        ? <Button variant="primary" onClick={stopRecording}>{t('Stop')}</Button>
        : <Button variant="primary" icon="camera" disabled={!ready || finishing} onClick={startRecording}>{t('Record')}</Button>}
      <Button variant="ghost" disabled={finishing} onClick={cancel}>{t('Cancel')}</Button>
    </div>
    {!ready && !recording && !finishing && <Button size="sm" variant="ghost" onClick={openCamera}>{t('Try opening the camera again')}</Button>}
    {onFallback && <Button size="sm" variant="ghost" onClick={onFallback}>{t('Use the device camera instead')}</Button>}
  </div>
}
