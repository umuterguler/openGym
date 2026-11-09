import { describe, it, expect, vi } from 'vitest'
import { bindVideoTrim, restartVideoInTrim } from './video-trim.js'

function video(currentTime = 0) {
  const listeners = new Map()
  return {
    currentTime, readyState: 0, pause: vi.fn(), play: vi.fn(() => Promise.resolve()),
    addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
    removeEventListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(x => x !== fn)),
    emit: name => (listeners.get(name) || []).forEach(fn => fn()),
    listenerCount: () => [...listeners.values()].reduce((n, a) => n + a.length, 0),
  }
}

describe('trimmed video playback', () => {
  it('starts at the trim start, keeps pause/resume in range and replays from the start', () => {
    const v = video(0)
    const off = bindVideoTrim(v, { startSec: 2, endSec: 5 })
    v.emit('loadedmetadata')
    expect(v.currentTime).toBe(2)
    v.currentTime = 3
    v.emit('play')
    expect(v.currentTime).toBe(3)
    v.currentTime = 5
    v.emit('play')
    expect(v.currentTime).toBe(2)
    off()
  })

  it('corrects seeks on either side of the selected range and loops at its end', () => {
    const v = video(0)
    const off = bindVideoTrim(v, { startSec: 1.5, endSec: 4.5 })
    v.currentTime = 0.2
    v.emit('seeking')
    expect(v.currentTime).toBe(1.5)
    v.currentTime = 7
    v.emit('seeking')
    expect(v.currentTime).toBe(1.5)
    v.currentTime = 4.5
    v.emit('timeupdate')
    expect(v.currentTime).toBe(1.5)
    off()
  })

  it('rebinds cleanly after a source/range change and removes every old listener', () => {
    const v = video(0)
    const offOld = bindVideoTrim(v, { startSec: 2, endSec: 5 })
    expect(v.listenerCount()).toBe(5)
    offOld()
    expect(v.listenerCount()).toBe(0)
    const offNew = bindVideoTrim(v, { startSec: 7, endSec: 9 })
    v.emit('loadedmetadata')
    expect(v.currentTime).toBe(7)
    offNew()
    expect(v.listenerCount()).toBe(0)
  })

  it('lets two comparison videos enforce different ranges and restarts each at its own start', () => {
    const left = video(0), right = video(0)
    const leftOff = bindVideoTrim(left, { startSec: 1, endSec: 3 })
    const rightOff = bindVideoTrim(right, { startSec: 6, endSec: 8 })
    left.emit('loadedmetadata'); right.emit('loadedmetadata')
    expect([left.currentTime, right.currentTime]).toEqual([1, 6])
    left.currentTime = 3; right.currentTime = 8
    restartVideoInTrim(left, { startSec: 1, endSec: 3 })
    restartVideoInTrim(right, { startSec: 6, endSec: 8 })
    expect([left.currentTime, right.currentTime]).toEqual([1, 6])
    expect(left.play).toHaveBeenCalledOnce()
    expect(right.play).toHaveBeenCalledOnce()
    leftOff(); rightOff()
  })

  it('does not constrain untrimmed playback', () => {
    const v = video(0)
    const off = bindVideoTrim(v, null)
    v.currentTime = 20
    v.emit('timeupdate')
    expect(v.currentTime).toBe(20)
    expect(v.listenerCount()).toBe(0)
    off()
  })
})
