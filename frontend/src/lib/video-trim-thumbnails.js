const waitFor = (video, event, signal, timeoutMs) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('aborted'))
  const done = (error, value) => {
    clearTimeout(timer)
    video.removeEventListener(event, ok)
    video.removeEventListener('error', failed)
    signal?.removeEventListener('abort', aborted)
    error ? reject(error) : resolve(value)
  }
  const ok = () => done(null, true)
  const failed = () => done(new Error('video decode failed'))
  const aborted = () => done(new Error('aborted'))
  const timer = setTimeout(() => done(new Error('video decode timed out')), timeoutMs)
  video.addEventListener(event, ok, { once: true })
  video.addEventListener('error', failed, { once: true })
  signal?.addEventListener('abort', aborted, { once: true })
})

/** Make a small, temporary strip of representative frames from a local media URL. Returns [] on
 *  unsupported codecs/canvas failures; it never persists the derived images. Factories keep the
 *  browser API boundary testable and let unmount abort outstanding decode work. */
export async function generateVideoThumbnails(src, {
  count = 8, maxWidth = 88, maxHeight = 64, signal,
  createVideo = () => globalThis.document?.createElement('video'),
  createCanvas = () => globalThis.document?.createElement('canvas'),
  timeoutMs = 5000,
} = {}) {
  const video = createVideo()
  if (!src || !video) return []
  let canvas
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = src
    if (video.readyState < 1) await waitFor(video, 'loadedmetadata', signal, timeoutMs)
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return []
    canvas = createCanvas()
    const context = canvas?.getContext?.('2d')
    if (!context || !video.videoWidth || !video.videoHeight) return []
    const scale = Math.min(maxWidth / video.videoWidth, maxHeight / video.videoHeight, 1)
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const frames = []
    const n = Math.max(1, Math.min(12, Math.floor(count)))
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new Error('aborted')
      // Avoid exact endpoints: some encoders cannot seek to the final presentation timestamp.
      const time = duration * ((i + 1) / (n + 1))
      const seeked = waitFor(video, 'seeked', signal, timeoutMs)
      video.currentTime = time
      await seeked
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({ time, src: canvas.toDataURL('image/jpeg', 0.62) })
    }
    return frames
  } catch {
    return []
  } finally {
    try { video.pause() } catch { /* no playback was started */ }
    try { video.removeAttribute('src'); video.load() } catch { /* incomplete media element */ }
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
