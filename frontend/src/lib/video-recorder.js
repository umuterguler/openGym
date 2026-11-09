// MediaRecorder output is streamed in small pieces to Android's app-private cache. Never retain
// the entire source recording as a JavaScript Blob: only the final processed clip enters ingest.

export const RECORDING_MIME_TYPES = Object.freeze([
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
])

export function chooseRecordingMime(Recorder) {
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return null
  return RECORDING_MIME_TYPES.find(type => {
    try { return Recorder.isTypeSupported(type) } catch { return false }
  }) || null
}

export function toBase64(bytes) {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}

/** Start one recorder and serialize each native file write, including the final dataavailable. */
export async function createNativeRecording({ Recorder = globalThis.MediaRecorder, stream, plugin, mimeType }) {
  const type = mimeType || chooseRecordingMime(Recorder)
  if (!type) throw Object.assign(new Error('no supported video recording codec'), { code: 'unsupported-codec' })
  const session = await plugin.beginRecording({ mimeType: type })
  let writes = Promise.resolve()
  let writeError = null
  let stopped
  let resolveStopped
  stopped = new Promise(resolve => { resolveStopped = resolve })
  let recorder
  try {
    recorder = new Recorder(stream, { mimeType: type, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 })
    recorder.ondataavailable = event => {
      if (!event.data?.size) return
      writes = writes.then(async () => {
        if (writeError) return
        const bytes = new Uint8Array(await event.data.arrayBuffer())
        await plugin.appendRecordingChunk({ id: session.id, data: toBase64(bytes) })
      }).catch(error => { writeError = error })
    }
    recorder.onerror = event => { writeError = event.error || new Error('recording failed') }
    recorder.onstop = resolveStopped
    recorder.start(750)
  } catch (error) {
    await plugin.cancelRecording({ id: session.id }).catch(() => {})
    throw error
  }

  let settled = false
  return {
    mimeType: type,
    get state() { return recorder.state },
    async stop() {
      if (!settled) {
        settled = true
        if (recorder.state !== 'inactive') recorder.stop()
        await stopped
      }
      await writes
      if (writeError) {
        await plugin.cancelRecording({ id: session.id }).catch(() => {})
        throw writeError
      }
      return plugin.finishRecording({ id: session.id })
    },
    async cancel() {
      if (!settled) {
        settled = true
        if (recorder.state !== 'inactive') recorder.stop()
        await stopped
      }
      await writes
      await plugin.cancelRecording({ id: session.id })
    }
  }
}
