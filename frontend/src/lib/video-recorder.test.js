import { describe, expect, it, vi } from 'vitest'
import { chooseRecordingMime, createNativeRecording } from './video-recorder.js'

class FakeRecorder {
  static supported = []
  static isTypeSupported(type) { return this.supported.includes(type) }
  constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive' }
  start() { this.state = 'recording' }
  stop() {
    this.ondataavailable?.({ data: new Blob(['last chunk']) })
    this.state = 'inactive'
    this.onstop?.()
  }
}

describe('Android in-app recording helpers', () => {
  it('detects the preferred recording codec rather than assuming an output format', () => {
    FakeRecorder.supported = ['video/webm;codecs=vp8,opus']
    expect(chooseRecordingMime(FakeRecorder)).toBe('video/webm;codecs=vp8,opus')
    FakeRecorder.supported = []
    expect(chooseRecordingMime(FakeRecorder)).toBeNull()
  })

  it('streams chunks to the private native file and waits for the final chunk before finishing', async () => {
    FakeRecorder.supported = ['video/mp4;codecs=avc1.42E01E']
    const plugin = {
      beginRecording: vi.fn(async ({ mimeType }) => ({ id: 'abc', mimeType })),
      appendRecordingChunk: vi.fn(async () => {}),
      finishRecording: vi.fn(async () => ({ path: '/private/clip.mp4', durationMs: 1000, size: 123 })),
      cancelRecording: vi.fn()
    }
    const session = await createNativeRecording({ stream: {}, plugin, Recorder: FakeRecorder })
    const output = await session.stop()
    expect(plugin.appendRecordingChunk).toHaveBeenCalledOnce()
    expect(plugin.appendRecordingChunk.mock.calls[0][0].data).toBe(btoa('last chunk'))
    expect(plugin.finishRecording).toHaveBeenCalledWith({ id: 'abc' })
    expect(output.size).toBe(123)
  })

  it('deletes a cancelled temporary recording instead of finalizing it', async () => {
    FakeRecorder.supported = ['video/mp4']
    const plugin = { beginRecording: vi.fn(async () => ({ id: 'abc' })), appendRecordingChunk: vi.fn(async () => {}), finishRecording: vi.fn(), cancelRecording: vi.fn(async () => {}) }
    const session = await createNativeRecording({ stream: {}, plugin, Recorder: FakeRecorder })
    await session.cancel()
    expect(plugin.cancelRecording).toHaveBeenCalledWith({ id: 'abc' })
    expect(plugin.finishRecording).not.toHaveBeenCalled()
  })

  it('removes a partial file when a streamed chunk fails', async () => {
    FakeRecorder.supported = ['video/mp4']
    const plugin = { beginRecording: vi.fn(async () => ({ id: 'abc' })), appendRecordingChunk: vi.fn(async () => { throw new Error('disk full') }), finishRecording: vi.fn(), cancelRecording: vi.fn(async () => {}) }
    const session = await createNativeRecording({ stream: {}, plugin, Recorder: FakeRecorder })
    await expect(session.stop()).rejects.toThrow('disk full')
    expect(plugin.cancelRecording).toHaveBeenCalledWith({ id: 'abc' })
    expect(plugin.finishRecording).not.toHaveBeenCalled()
  })
})
