import { describe, it, expect, vi } from 'vitest'
import { generateVideoThumbnails } from './video-trim-thumbnails.js'

function fakeVideo({ duration = 12, readyState = 1 } = {}) {
  const listeners = new Map()
  const v = {
    duration, readyState, videoWidth: 1920, videoHeight: 1080, muted: false, paused: true,
    addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
    removeEventListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(x => x !== fn)),
    removeAttribute: vi.fn(), load: vi.fn(), pause: vi.fn(),
    emit: name => (listeners.get(name) || []).forEach(fn => fn()),
  }
  let time = 0
  Object.defineProperty(v, 'currentTime', { get: () => time, set: n => { time = n; queueMicrotask(() => v.emit('seeked')) } })
  return v
}

describe('generateVideoThumbnails', () => {
  it('samples bounded low-resolution frames and releases its temporary canvas and video source', async () => {
    const video = fakeVideo()
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/jpeg;base64,frame' }
    const frames = await generateVideoThumbnails('blob:local', {
      count: 5, maxWidth: 88, maxHeight: 64,
      createVideo: () => video, createCanvas: () => canvas,
    })
    expect(frames).toHaveLength(5)
    expect(frames[0].time).toBeGreaterThan(0)
    expect(frames.at(-1).time).toBeLessThan(video.duration)
    expect(canvas.width).toBe(0)
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.pause).toHaveBeenCalledOnce()
    expect(drawImage).toHaveBeenCalledTimes(5)
  })

  it('falls back to an empty strip when duration or canvas decoding is unavailable', async () => {
    expect(await generateVideoThumbnails('blob:bad-duration', {
      createVideo: () => fakeVideo({ duration: NaN }), createCanvas: () => { throw new Error('unused') },
    })).toEqual([])
    const video = fakeVideo()
    expect(await generateVideoThumbnails('blob:bad-canvas', {
      createVideo: () => video, createCanvas: () => ({ getContext: () => null }),
    })).toEqual([])
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
  })
})
