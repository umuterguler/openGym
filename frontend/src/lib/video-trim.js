/* Playback-only trim boundaries for form videos. The source remains the same MediaRef/file. */

const EDGE_EPSILON_SEC = 0.04

export const trimBounds = trim => trim && Number.isFinite(trim.startSec) && Number.isFinite(trim.endSec) &&
  trim.startSec >= 0 && trim.startSec < trim.endSec
  ? { start: trim.startSec, end: trim.endSec }
  : null

/** Duration and clock position shown to the viewer, relative to the selected clip. */
export function trimPlaybackState(currentTime, trim) {
  const bounds = trimBounds(trim)
  if (!bounds) return null
  const duration = bounds.end - bounds.start
  const sourceTime = Number.isFinite(currentTime) ? currentTime : bounds.start
  const position = Math.min(duration, Math.max(0, sourceTime - bounds.start))
  return { position, duration, progress: duration > 0 ? position / duration : 0 }
}

/** Map a virtual clip position from its 0..duration timeline back onto the source video. */
export function seekVideoInTrim(video, clipPosition, trim) {
  const bounds = trimBounds(trim)
  if (!video || !bounds || !Number.isFinite(clipPosition)) return
  const position = Math.min(bounds.end - bounds.start, Math.max(0, clipPosition))
  seek(video, bounds.start + position)
}

const seek = (video, seconds) => {
  if (Math.abs(video.currentTime - seconds) < 0.01) return
  try { video.currentTime = seconds } catch { /* metadata is not seekable yet; loadedmetadata retries */ }
}

/** Constrains one video element to a saved range. Rebind when its src or trim changes. */
export function bindVideoTrim(video, trim, { loop = true } = {}) {
  const bounds = trimBounds(trim)
  if (!video || !bounds) return () => {}

  const start = bounds.start
  const end = bounds.end
  const position = () => {
    if (video.currentTime < start - EDGE_EPSILON_SEC) seek(video, start)
    else if (video.currentTime >= end - EDGE_EPSILON_SEC) {
      seek(video, loop ? start : end)
      if (!loop) video.pause()
    }
  }
  const onMetadata = () => position()
  const onPlay = () => position()
  const onSeeking = () => position()
  const onTime = () => {
    if (video.currentTime < start - EDGE_EPSILON_SEC) seek(video, start)
    else if (video.currentTime >= end - EDGE_EPSILON_SEC) {
      if (loop) seek(video, start)
      else { seek(video, end); video.pause() }
    }
  }
  const onEnded = () => {
    if (loop) {
      seek(video, start)
      video.play()?.catch?.(() => {})
    }
  }
  video.addEventListener('loadedmetadata', onMetadata)
  video.addEventListener('play', onPlay)
  video.addEventListener('seeking', onSeeking)
  video.addEventListener('timeupdate', onTime)
  video.addEventListener('ended', onEnded)
  if (video.readyState >= 1) onMetadata()

  return () => {
    video.removeEventListener('loadedmetadata', onMetadata)
    video.removeEventListener('play', onPlay)
    video.removeEventListener('seeking', onSeeking)
    video.removeEventListener('timeupdate', onTime)
    video.removeEventListener('ended', onEnded)
  }
}

/** Replay one trimmed video from its start (used by the two-up comparison's shared restart). */
export function restartVideoInTrim(video, trim) {
  if (!video) return
  const bounds = trimBounds(trim)
  try { video.currentTime = bounds ? bounds.start : 0 } catch { /* wait for loadedmetadata */ }
  video.play()?.catch?.(() => {})
}
