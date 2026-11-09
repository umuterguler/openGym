import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ impl: {}, getUri: null }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', convertFileSrc: path => `http://localhost${path}` },
  registerPlugin: () => new Proxy({}, { get: (_, key) => (...args) => mocks.impl[key](...args) })
}))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { getUri: (...args) => mocks.getUri(...args) }, Directory: { Library: 'Library' } }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))

import { deleteTempVideo, exportSavedVideoToGallery, nativeVideoAvailable, tempVideoUrl, trimTempVideo } from './native-video-media.js'

describe('Android video media bridge', () => {
  it('exports the persistent app copy to Gallery only after the explicit call', async () => {
    const result = { uri: 'content://media/33', size: 9000, alreadyExists: false }
    mocks.getUri = vi.fn(async () => ({ uri: 'file:///private/opengym-media/' + 'ab'.repeat(32) + '.mp4' }))
    mocks.impl = { exportToGallery: vi.fn(async () => result) }
    expect(nativeVideoAvailable()).toBe(true)
    expect(await tempVideoUrl('/cache/clip.mp4')).toBe('http://localhost/cache/clip.mp4')
    const m = { kind: 'video', hash: 'ab'.repeat(32), mime: 'video/mp4' }
    expect(await exportSavedVideoToGallery(m)).toBe(result)
    expect(mocks.getUri).toHaveBeenCalledWith({ path: `opengym-media/${m.hash}.mp4`, directory: 'Library' })
    expect(mocks.impl.exportToGallery).toHaveBeenCalledWith({ sourceUri: `file:///private/opengym-media/${m.hash}.mp4`, hash: m.hash, mime: m.mime })
  })

  it('propagates Gallery failures and never calls a source deletion API', async () => {
    mocks.getUri = vi.fn(async () => ({ uri: 'file:///private/video.mp4' }))
    mocks.impl = { exportToGallery: vi.fn(async () => { throw new Error('MediaStore unavailable') }), deleteTemp: vi.fn() }
    await expect(exportSavedVideoToGallery({ kind: 'video', hash: 'cd'.repeat(32), mime: 'video/mp4' })).rejects.toThrow('MediaStore unavailable')
    expect(mocks.impl.deleteTemp).not.toHaveBeenCalled()
  })

  it('passes millisecond clipping bounds, reports progress and removes the native listener', async () => {
    const remove = vi.fn()
    const progress = vi.fn()
    mocks.impl = {
      addListener: vi.fn(async (_event, listener) => { listener({ progress: 0.5 }); return { remove } }),
      trim: vi.fn(async () => ({ path: '/cache/out.mp4', durationMs: 10000, size: 1000 }))
    }
    const output = await trimTempVideo('/cache/in.mp4', 2.25, 12.25, progress)
    expect(mocks.impl.trim).toHaveBeenCalledWith({ path: '/cache/in.mp4', startMs: 2250, endMs: 12250 })
    expect(progress).toHaveBeenCalledWith(0.5)
    expect(remove).toHaveBeenCalledOnce()
    expect(output.durationMs).toBe(10000)
  })

  it('cleans only the passed app-private temp path', async () => {
    mocks.impl = { deleteTemp: vi.fn(async () => {}) }
    await deleteTempVideo('/cache/clip.mp4')
    expect(mocks.impl.deleteTemp).toHaveBeenCalledWith({ path: '/cache/clip.mp4' })
  })
})
