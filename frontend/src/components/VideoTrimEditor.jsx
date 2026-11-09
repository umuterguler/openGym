import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtClip, normalizeTrimRange, TRIM_DURATION_EPSILON_SEC } from '../lib/media-refs.js'
import { bindVideoTrim } from '../lib/video-trim.js'
import { generateVideoThumbnails } from '../lib/video-trim-thumbnails.js'
import { useMediaUrl } from './CustomMedia.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const MIN_CLIP_SEC = 0.15

export default function VideoTrimEditor({ m, title, onSave, onCancel, sourceUrl = null, physicalRecording = false }) {
  const storedMain = useMediaUrl(m, { auto: physicalRecording || m.local !== true })
  const main = sourceUrl ? { url: sourceUrl, status: 'ready', load() {} } : storedMain
  const poster = useMediaUrl(m.poster || null, { auto: m.local !== true })
  const videoRef = useRef(null)
  const timelineRef = useRef(null)
  const drag = useRef(null)
  // MediaMetadataRetriever can report only the first fragment duration for the fragmented MP4
  // emitted by WebView MediaRecorder. For a new native recording, trust the browser's parsed
  // media duration after metadata loads instead of that incomplete container header value.
  const [duration, setDuration] = useState(physicalRecording ? null : m.dur ?? null)
  const [range, setRange] = useState({ start: m.trim?.startSec ?? 0, end: physicalRecording ? m.trim?.endSec ?? 0 : m.trim?.endSec ?? m.dur ?? 0 })
  const [playhead, setPlayhead] = useState(m.trim?.startSec ?? 0)
  const [playing, setPlaying] = useState(false)
  const [frames, setFrames] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    setFrames([])
    if (main.url) generateVideoThumbnails(main.url, { signal: controller.signal }).then(setFrames)
    return () => controller.abort()
  }, [main.url, m.hash])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !duration || range.end <= range.start) return undefined
    return bindVideoTrim(v, { startSec: range.start, endSec: range.end }, { loop: false })
  }, [main.url, duration, range.start, range.end])

  const framesStyle = useMemo(() => ({ '--vte-frame-count': Math.max(frames.length, 1) }), [frames.length])
  const percent = seconds => duration > 0 ? Math.max(0, Math.min(100, seconds / duration * 100)) : 0
  const positionAt = clientX => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect || !duration) return null
    return Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration))
  }
  const setTime = (kind, seconds) => {
    if (!duration || seconds == null) return
    // Pointer-to-time arithmetic can produce values such as 1.2000000000000002.
    // Keep editor state and accessibility values aligned with stored millisecond precision.
    seconds = Math.round(seconds * 1000) / 1000
    if (kind === 'start') {
      setRange(r => {
        const min = Math.min(MIN_CLIP_SEC, duration)
        const start = Math.min(Math.max(0, seconds), Math.max(0, r.end - min))
        setPlayhead(p => Math.max(start, Math.min(r.end, p)))
        return { ...r, start }
      })
    } else if (kind === 'end') {
      setRange(r => {
        const min = Math.min(MIN_CLIP_SEC, duration)
        const end = Math.max(Math.min(duration, seconds), Math.min(duration, r.start + min))
        setPlayhead(p => Math.max(r.start, Math.min(end, p)))
        return { ...r, end }
      })
    } else {
      const at = Math.max(range.start, Math.min(range.end, seconds))
      setPlayhead(at)
      if (videoRef.current) {
        try { videoRef.current.currentTime = at } catch { /* metadata may still be loading */ }
      }
    }
  }
  const pointerDown = (kind, ev) => {
    if (!duration) return
    ev.preventDefault()
    ev.stopPropagation()
    drag.current = { kind, id: ev.pointerId, captureTarget: ev.currentTarget }
    try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* capture is optional on older WebViews */ }
    if (kind === 'playhead') setTime(kind, positionAt(ev.clientX))
  }
  const pointerMove = ev => {
    if (!drag.current || drag.current.id !== ev.pointerId) return
    setTime(drag.current.kind, positionAt(ev.clientX))
  }
  const pointerEnd = ev => {
    if (drag.current?.id !== ev.pointerId) return
    const captureTarget = drag.current.captureTarget
    drag.current = null
    try { captureTarget?.releasePointerCapture(ev.pointerId) } catch { /* already released */ }
  }
  const keyMove = (kind, ev) => {
    if (!duration) return
    const step = ev.shiftKey ? 1 : Math.max(0.01, duration / 100)
    const current = kind === 'start' ? range.start : range.end
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); setTime(kind, current - step) }
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); setTime(kind, current + step) }
    else if (ev.key === 'Home') { ev.preventDefault(); setTime(kind, 0) }
    else if (ev.key === 'End') { ev.preventDefault(); setTime(kind, duration) }
  }
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime < range.start || v.currentTime >= range.end) v.currentTime = range.start
      v.play()?.catch?.(() => {})
    } else v.pause()
  }
  const replay = () => {
    const v = videoRef.current
    if (!v) return
    try { v.currentTime = range.start } catch { /* wait for metadata */ }
    v.play()?.catch?.(() => {})
  }
  const reset = () => {
    if (!duration) return
    setRange({ start: 0, end: duration })
    setPlayhead(0)
    if (videoRef.current) { videoRef.current.pause(); try { videoRef.current.currentTime = 0 } catch { /* wait for metadata */ } }
    setPlaying(false)
  }
  const save = async () => {
    if (saving) return
    setSaving(true); setSaveError(null)
    if (!duration) { try { await onSave(null) } catch { setSaveError(t('Could not create the selected clip. Your recording is safe; tap Retry to try again.')); setSaving(false) } return }
    const normalized = normalizeTrimRange({ startSec: range.start, endSec: range.end }, duration)
    if (!normalized) { setSaving(false); return }
    const coversFullVideo = normalized.startSec <= TRIM_DURATION_EPSILON_SEC &&
      duration - normalized.endSec <= TRIM_DURATION_EPSILON_SEC
    try { await onSave(coversFullVideo ? null : normalized) }
    catch { setSaveError(t('Could not create the selected clip. Your recording is safe; tap Retry to try again.')); setSaving(false) }
  }
  const selectedDuration = duration && range.end > range.start ? range.end - range.start : null

  return <div className="fv-trim">
    <div className="fv-trim-heading"><h3>{title || t('Trim video')}</h3><span className="small dim">{physicalRecording ? t('A shorter video file will be created on this phone.') : t('Original video stays unchanged')}</span></div>
    <div className="fv-trim-preview">
      {main.url
        ? <video ref={videoRef} src={main.url} poster={poster.url || undefined} playsInline muted preload="metadata"
            onLoadedMetadata={ev => {
              const n = ev.currentTarget.duration
              if ((physicalRecording || !(Number.isFinite(m.dur) && m.dur > 0)) && Number.isFinite(n) && n > 0) {
                setDuration(n)
                setRange(r => (physicalRecording && !m.trim) || r.end <= 0 ? { start: 0, end: n } : { start: Math.min(r.start, n), end: Math.min(r.end, n) })
                setPlayhead(physicalRecording ? Math.min(m.trim?.startSec ?? 0, n) : 0)
              }
            }}
            onTimeUpdate={ev => setPlayhead(ev.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        : <div className="fv-trim-missing">{main.status === 'loading' ? t('Loading…') : m.local ? t('On the phone that filmed it') : t('This video isn’t on this device')}</div>}
    </div>
    <div className="fv-trim-readout">
      <span>{t('Clip start')} <b dir="ltr">{fmtClip(range.start)}</b></span>
      <span>{t('Selected duration')} <b dir="ltr">{selectedDuration == null ? '–' : fmtClip(selectedDuration)}</b></span>
      <span>{t('Clip end')} <b dir="ltr">{duration ? fmtClip(range.end) : '–'}</b></span>
    </div>
    <div className="fv-trim-timeline-wrap">
      <div ref={timelineRef} className="fv-trim-timeline" style={framesStyle}
        onPointerDown={ev => { if (ev.target.closest('[data-vte-handle]')) return; pointerDown('playhead', ev) }}
        onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
        <div className={'fv-trim-frames' + (frames.length ? '' : ' empty')}>
          {frames.map((frame, i) => <span key={i} className="fv-trim-frame" style={{ backgroundImage: `url("${frame.src}")` }} />)}
        </div>
        <div className="fv-trim-outside left" style={{ width: percent(range.start) + '%' }} />
        <div className="fv-trim-outside right" style={{ left: percent(range.end) + '%' }} />
        <div className="fv-trim-selection" style={{ left: percent(range.start) + '%', width: Math.max(0, percent(range.end) - percent(range.start)) + '%' }} />
        <button type="button" data-vte-handle="start" className="fv-trim-handle start" style={{ left: percent(range.start) + '%' }}
          role="slider" aria-label={t('Trim start')} aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={range.start}
          onPointerDown={ev => pointerDown('start', ev)} onKeyDown={ev => keyMove('start', ev)} />
        <button type="button" data-vte-handle="end" className="fv-trim-handle end" style={{ left: percent(range.end) + '%' }}
          role="slider" aria-label={t('Trim end')} aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={range.end}
          onPointerDown={ev => pointerDown('end', ev)} onKeyDown={ev => keyMove('end', ev)} />
        <div className="fv-trim-playhead" style={{ left: percent(playhead) + '%' }} aria-hidden="true"><i /></div>
      </div>
      <div className="fv-trim-thumbs-status" aria-live="polite">{!frames.length && main.url ? t('Preparing video timeline…') : null}</div>
    </div>
    <div className="fv-trim-controls">
      <div className="fv-trim-transport">
        <button type="button" className="iconbtn" aria-label={t('Replay')} title={t('Replay')} disabled={!main.url} onClick={replay}><Icon name="reset" /></button>
        <button type="button" className="iconbtn" aria-label={playing ? t('Pause') : t('Play')} disabled={!main.url} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} /></button>
        {!physicalRecording && <button type="button" className="chip" onClick={reset} disabled={!duration}>{t('Reset to full video')}</button>}
      </div>
      {saving && <div className="small dim" role="status">{t('Processing video…')}</div>}
      {saveError && <div className="small dim" role="alert">{saveError}</div>}
      <div className="fv-trim-actions">
        <Button variant="ghost" disabled={saving} onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="primary" disabled={!main.url || saving} onClick={save}>{saving ? t('Processing…') : saveError ? t('Retry') : duration ? t('Save') : t('Save full video')}</Button>
      </div>
    </div>
  </div>
}
