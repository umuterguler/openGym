// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

vi.mock('./CustomMedia.jsx', () => ({ useMediaUrl: file => ({ url: file?.hash ? 'blob:stored-video' : null, status: file?.hash ? 'ready' : 'none' }) }))
vi.mock('../lib/video-trim-thumbnails.js', () => ({ generateVideoThumbnails: vi.fn(async () => []) }))

import VideoTrimEditor from './VideoTrimEditor.jsx'
import { _setLangState } from '../lib/i18n-core.js'

let root, host
function mount(props) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host); act(() => root.render(<VideoTrimEditor {...props} />)); return host
}
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null }; document.body.innerHTML = '' })
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; _setLangState('en', null, null, null); document.body.innerHTML = '' })

describe('video trim processing UX', () => {
  it('shows a processing state while saving and leaves the original range available after failure', async () => {
    let fail
    const onSave = vi.fn(() => new Promise((_, reject) => { fail = reject }))
    const h = mount({ m: { kind: 'video', hash: 'a'.repeat(64), mime: 'video/mp4', size: 100, width: 1280, height: 720, dur: 30 }, onSave, onCancel: vi.fn() })
    const save = [...h.querySelectorAll('.fv-trim-actions button')].at(-1)
    await act(async () => save.click())
    expect(h.textContent).toContain('Processing video…')
    expect(save.disabled).toBe(true)
    await act(async () => fail(new Error('native transformer failed')))
    expect(h.textContent).toContain('Could not create the selected clip. Your recording is safe; tap Retry to try again.')
    expect([...h.querySelectorAll('.fv-trim-actions button')].at(-1).textContent).toBe('Retry')
    expect(h.querySelector('.fv-trim')).not.toBeNull()
  })

  it('supports a temporary recording source without requiring a saved MediaRef or gallery file', () => {
    const h = mount({ m: { kind: 'video', mime: 'video/mp4', size: 1000, width: 720, height: 1280, dur: 5 }, sourceUrl: 'http://localhost/_capacitor_file_/cache/video.mp4', physicalRecording: true, onSave: vi.fn(), onCancel: vi.fn() })
    expect(h.textContent).toContain('A shorter video file will be created on this phone.')
    expect(h.querySelector('.fv-trim-preview video').getAttribute('src')).toBe('http://localhost/_capacitor_file_/cache/video.mp4')
  })

  it('uses the parsed fragment duration for a physical recording, not the incomplete native header duration', async () => {
    const h = mount({ m: { kind: 'video', mime: 'video/mp4', size: 1000, width: 720, height: 1280, dur: 4 }, sourceUrl: 'http://localhost/cache/fragmented.mp4', physicalRecording: true, onSave: vi.fn(), onCancel: vi.fn() })
    const video = h.querySelector('.fv-trim-preview video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
    expect(h.querySelector('[aria-label="Trim end"]').getAttribute('aria-valuemax')).toBe('30')
    expect(h.textContent).toContain('Clip end 0:30')
  })

  it('saves a full-range physical recording without requesting a trim', async () => {
    const onSave = vi.fn()
    const h = mount({ m: { kind: 'video', mime: 'video/mp4', size: 1000, width: 720, height: 1280, dur: 3.063 }, sourceUrl: 'http://localhost/cache/full.mp4', physicalRecording: true, onSave, onCancel: vi.fn() })
    const video = h.querySelector('.fv-trim-preview video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 3.063 })
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
    await act(async () => [...h.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    expect(onSave).toHaveBeenCalledWith(null)
  })
})
