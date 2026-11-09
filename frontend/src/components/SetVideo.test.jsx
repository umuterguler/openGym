// @vitest-environment happy-dom
// A set's own form video on screen (components/SetVideo.jsx): the sheet that films it (the camera
// or the phone's videos, the caps of the server in force, where it is kept, said once that it stays
// private), the player, and an exercise's "Your form videos" with two dates side by side. The
// ingest is mocked (lib/media-ingest.js has its own tests); the rest is the real store.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const h = vi.hoisted(() => ({ ingest: null, thumbnails: null, nativeAvailable: false, trim: null, stageSaved: null, deleteTemp: null, exportGallery: null }))
vi.mock('../lib/media-ingest.js', () => ({ ingestMediaFile: (...a) => h.ingest(...a) }))
vi.mock('../lib/video-trim-thumbnails.js', () => ({ generateVideoThumbnails: (...a) => h.thumbnails(...a) }))
vi.mock('../lib/native-video-media.js', () => ({
  nativeVideoAvailable: () => h.nativeAvailable,
  tempVideoUrl: async path => `http://localhost/cache/${path.split('/').at(-1)}`,
  trimTempVideo: (...a) => h.trim(...a),
  stageSavedVideoForTrim: (...a) => h.stageSaved(...a),
  deleteTempVideo: (...a) => h.deleteTemp(...a),
  exportSavedVideoToGallery: (...a) => h.exportGallery(...a),
  videoMediaPlugin: () => ({})
}))
vi.mock('./InAppVideoRecorder.jsx', () => ({ default: ({ onRecorded }) => React.createElement('button', { type: 'button', onClick: () => onRecorded({ path: '/cache/source.mp4', mimeType: 'video/mp4', durationMs: 30000, size: 1000000, width: 720, height: 1280 }) }, 'Mock completed recording') }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'
import { bindUI } from './ui.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'
import { filmSetSheet, FormVideosSection, FormVideoPlayer, CompareVideos, openWorkoutSetVideo } from './SetVideo.jsx'
import { formVideosFor } from '../lib/set-videos.js'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S
const hex = n => n.toString(16).padStart(2, '0').repeat(32)
const video = (n, extra = {}) => ({ kind: 'video', hash: hex(n), mime: 'video/mp4', size: 400000, width: 720, height: 1280, dur: 6, codec: 'avc1', poster: { hash: hex(n + 100), mime: 'image/webp', size: 2000, width: 270, height: 480 }, at: 1, ...extra })
const MediaError = (code, extra) => Object.assign(new Error(code), { code, ...extra })
const CAPS = { imageMB: 2, gifMB: 8, videoMB: 25, videoSec: 30, quotaMB: 200, workouts: true, days: true }

function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
async function loadPhysicalDuration(host, seconds) {
  const video = host.querySelector('.fv-trim-preview video')
  Object.defineProperty(video, 'duration', { configurable: true, value: seconds })
  await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
}
async function choose(host, which = 'capture') {
  const input = which === 'capture' ? host.querySelector('input[type="file"][capture]') : host.querySelector('input[type="file"]:not([capture])')
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'VID_0001.MOV', { type: 'video/quicktime' })], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}
async function saveNewVideo(trim = 'full') {
  const editor = renderTop()
  await settle()
  expect(editor.querySelector('.fv-trim')).not.toBeNull()
  if (trim === 'cancel') {
    act(() => editor.querySelector('.fv-trim-actions button').click())
    await settle()
    return editor
  }
  if (trim === 'custom') dragTrim(editor, 'start', 1)
  act(() => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
  await settle()
  return editor
}
function pointer(type, clientX, pointerId = 7) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(ev, { clientX: { value: clientX }, pointerId: { value: pointerId } })
  return ev
}
function dragTrim(editor, handleName, clientX) {
  const timeline = editor.querySelector('.fv-trim-timeline')
  Object.defineProperty(timeline, 'getBoundingClientRect', { value: () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 76, height: 76 }) })
  const handle = editor.querySelector(`[data-vte-handle="${handleName}"]`)
  act(() => handle.dispatchEvent(pointer('pointerdown', 0)))
  act(() => timeline.dispatchEvent(pointer('pointermove', clientX)))
  act(() => timeline.dispatchEvent(pointer('pointerup', clientX)))
}
const active = () => ({ id: 'live', d: '2026-10-28', start: 1, name: 'Legs', entries: [{ id: '0043', target: { sets: 2, reps: 5 }, sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: false }] }] })

let media
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), active: active(), workouts: [] }, user: null, config: null })
  h.nativeAvailable = false
  h.trim = vi.fn(async () => ({ path: '/cache/trimmed.mp4', mimeType: 'video/mp4', durationMs: 10000, size: 350000, width: 720, height: 1280 }))
  h.deleteTemp = vi.fn(async () => {})
  h.stageSaved = vi.fn(async m => ({ path: `/cache/${m.hash}.mp4`, size: m.size }))
  h.exportGallery = vi.fn(async () => ({}))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['trimmed bytes']), { status: 200 })))
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
  media = createMediaStore({ ...memoryBackend(), persistent: true, name: 'test' }, { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL() {} } })
  _setMediaStore(media)
  h.ingest = vi.fn(async () => {
    const r = video(1)
    return { media: r, blobs: [{ hash: r.hash, blob: new Blob(['main']), mime: r.mime }, { hash: r.poster.hash, blob: new Blob(['poster']), mime: 'image/webp' }], warnings: [] }
  })
  h.thumbnails = vi.fn(async () => [])
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setMediaStore(null)
  vi.unstubAllGlobals()
})

describe('filming a set', () => {
  it('records with the back camera or picks a video, and puts it on that set', async () => {
    filmSetSheet({ entry: 0, set: 1 }, 'Film Set 2')
    const host = renderTop()
    expect(host.querySelector('h3').textContent).toBe('Film Set 2')
    const cam = host.querySelector('input[type="file"][capture]')
    expect(cam.getAttribute('capture')).toBe('environment')
    expect(cam.getAttribute('accept')).toBe('video/*')
    expect(host.querySelector('input[type="file"]:not([capture])').getAttribute('accept')).toBe('video/*')
    // Said once, here: they stay private.
    expect(host.textContent).toContain('Only for you. Your videos never go to the Coach, MCP, share cards, Wrapped or PDFs.')
    await choose(host)
    await saveNewVideo()
    const set = S().active.entries[0].sets[1]
    expect(set.media.map(m => m.hash)).toEqual([hex(1)])
    expect('local' in set.media[0]).toBe(false)   // a phone in local mode: kept here anyway, nothing to flag
    expect(await media.has(hex(1))).toBe(true)
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe('Video saved with this set')
  })

  it('holds the video to the server\'s caps, and says why one is refused', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { media: { ...CAPS, sets: true } } })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const host = renderTop()
    expect(host.textContent).toContain('Up to 30 seconds.')
    h.ingest = vi.fn(async () => { throw MediaError('too-long', { sec: 30 }) })
    await choose(host, 'library')
    expect(h.ingest.mock.calls[0][1]).toMatchObject({ videoMB: 25, videoSec: 30 })
    expect(useUI.getState().toastMsg).toBe('That video is too long. Max 30 seconds.')
    expect('media' in S().active.entries[0].sets[0]).toBe(false)
    h.ingest = vi.fn(async () => { throw MediaError('too-large', { mb: 25 }) })
    await choose(host, 'library')
    expect(useUI.getState().toastMsg).toBe('That file is too big. Max 25 MB.')
  })

  it('refuses a photo: a set gets a video', async () => {
    h.ingest = vi.fn(async () => ({ media: { kind: 'image', hash: hex(3), mime: 'image/webp', size: 10, width: 2, height: 2, at: 1 }, blobs: [], warnings: [] }))
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const host = renderTop()
    await choose(host)
    expect('media' in S().active.entries[0].sets[0]).toBe(false)
    expect(useUI.getState().toastMsg).toBe('That’s a photo. Pick a video for a set.')
  })

  it('saves a selected trim and cancel leaves an existing set video untouched', async () => {
    filmSetSheet({ entry: 0, set: 1 }, 'Film Set 2')
    const host = renderTop()
    await choose(host)
    const editor = renderTop()
    await settle()
    dragTrim(editor, 'start', 40)
    expect(editor.querySelector('[data-vte-handle="start"]').getAttribute('aria-valuenow')).toBe('1.2')
    act(() => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(S().active.entries[0].sets[1].media[0]).toMatchObject({ hash: hex(1), trim: { startSec: 1.2, endSec: 6 } })

    const old = video(2)
    useStore.setState({
      S: {
        ...S(),
        active: {
          ...active(),
          entries: [{
            ...active().entries[0],
            sets: [{ w: 100, r: 5, done: false, media: [old] }, active().entries[0].sets[1]],
          }],
        },
      },
    })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const next = renderTop()
    await choose(next)
    const trim = renderTop()
    await settle()
    act(() => [...trim.querySelectorAll('.fv-trim-actions button')][0].click())
    await settle()
    expect(S().active.entries[0].sets[0].media[0].hash).toBe(old.hash)
  })

  it('offers Save full video when duration cannot be read and supports the full-range choice', async () => {
    h.ingest = vi.fn(async () => ({ media: video(5, { dur: undefined }), blobs: [{ hash: hex(5), blob: new Blob(['source']), mime: 'video/mp4' }], warnings: [] }))
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const host = renderTop()
    await choose(host)
    const editor = renderTop()
    await settle()
    expect([...editor.querySelectorAll('.fv-trim-actions button')].at(-1).textContent).toBe('Save full video')
    act(() => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(S().active.entries[0].sets[0].media[0].trim).toBeUndefined()
  })

  it('physically trims a new Android recording and ingests only the final clip before cleanup', async () => {
    h.nativeAvailable = true
    h.ingest = vi.fn(async file => {
      expect(file).toBeInstanceOf(File)
      expect(file.size).toBe('trimmed bytes'.length)
      const result = video(35, { dur: 10, size: 350000 })
      return { media: result, blobs: [{ hash: result.hash, blob: new Blob(['final']), mime: result.mime }], warnings: [] }
    })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const sheet = renderTop()
    await settle()
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Record in OpenGym').click())
    const recorder = renderTop()
    act(() => recorder.querySelector('button').click())
    await settle()
    const editor = renderTop()
    await settle()
    await loadPhysicalDuration(editor, 30)
    dragTrim(editor, 'start', 133)
    await act(async () => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(h.trim).toHaveBeenCalledOnce()
    expect(h.trim.mock.calls[0][0]).toBe('/cache/source.mp4')
    expect(h.trim.mock.calls[0][1]).toBeCloseTo(20, 0)
    expect(h.trim.mock.calls[0][2]).toBe(30)
    expect(S().active.entries[0].sets[0].media[0].hash).toBe(hex(35))
    expect(h.deleteTemp.mock.calls.map(c => c[0])).toEqual(['/cache/source.mp4', '/cache/trimmed.mp4'])
    expect(h.exportGallery).not.toHaveBeenCalled()
  })

  it('keeps the temporary source after a trim failure for retry, then removes it after success', async () => {
    h.nativeAvailable = true
    h.trim.mockRejectedValueOnce(new Error('codec failure')).mockResolvedValueOnce({ path: '/cache/trimmed.mp4', mimeType: 'video/mp4', durationMs: 10000, size: 350000, width: 720, height: 1280 })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const sheet = renderTop(); await settle()
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Record in OpenGym').click())
    const recorder = renderTop(); act(() => recorder.querySelector('button').click())
    await settle()
    const editor = renderTop(); await settle()
    await loadPhysicalDuration(editor, 30)
    dragTrim(editor, 'start', 133)
    await act(async () => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(editor.textContent).toContain('Your recording is safe; tap Retry to try again.')
    expect(h.deleteTemp).not.toHaveBeenCalled()
    await act(async () => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(h.trim).toHaveBeenCalledTimes(2)
    expect(h.deleteTemp.mock.calls.map(c => c[0])).toEqual(['/cache/source.mp4', '/cache/trimmed.mp4'])
  })

  it('saves a full in-app MP4 without transcoding and discards only its temporary source on cancel', async () => {
    h.nativeAvailable = true
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const sheet = renderTop(); await settle()
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Record in OpenGym').click())
    const recorder = renderTop(); act(() => recorder.querySelector('button').click())
    await settle()
    const editor = renderTop(); await settle()
    await act(async () => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(h.trim).not.toHaveBeenCalled()
    expect(S().active.entries[0].sets[0].media[0].trim).toBeUndefined()
    expect(h.deleteTemp.mock.calls.map(c => c[0])).toEqual(['/cache/source.mp4'])
  })

  it('signed in: "Keep videos on this phone only" marks it, and a server that keeps none does by itself', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { media: { ...CAPS, sets: true } } })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    let host = renderTop()
    const sw = host.querySelector('button[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => { sw.click() })
    expect(S().formVideoLocal).toBe(true)
    await choose(host)
    await saveNewVideo()
    expect(S().active.entries[0].sets[0].media[0].local).toBe(true)

    // A server from before v1.4.4 (no media.sets): no switch, a note, and kept here.
    useStore.setState({ S: { ...S(), formVideoLocal: undefined, active: active() }, config: { media: CAPS } })
    filmSetSheet({ entry: 0, set: 1 }, 'Film Set 2')
    host = renderTop()
    expect(host.querySelector('button[role="switch"]')).toBeNull()
    expect(host.textContent).toContain('Your server doesn’t keep set videos, so this one stays on this phone.')
    await choose(host)
    await saveNewVideo()
    expect(S().active.entries[0].sets[1].media[0].local).toBe(true)
  })
})

describe('playing one', () => {
  it('runs Gallery export only after the person presses its explicit action', async () => {
    const exportVideo = vi.fn(async () => ({ uri: 'content://gallery/1', alreadyExists: false }))
    await media.put(hex(40), new Blob(['main']), { mime: 'video/mp4', pending: true })
    const host = render(<FormVideoPlayer m={video(40)} onExportGallery={exportVideo} />)
    await settle()
    expect(exportVideo).not.toHaveBeenCalled()
    act(() => [...host.querySelectorAll('.fv-bar button')].find(b => b.textContent === 'Save to Gallery').click())
    await settle()
    expect(exportVideo).toHaveBeenCalledOnce()
    expect(useUI.getState().toastMsg).toBe('Saved to Gallery.')
  })

  it('loops muted inline with controls, and switches to half speed', async () => {
    await media.put(hex(1), new Blob(['main']), { mime: 'video/mp4', pending: true })
    const host = render(<FormVideoPlayer m={video(1)} label="Set 1" />)
    await settle()
    const v = host.querySelector('video')
    expect(v).not.toBeNull()
    expect(v.muted).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.controls).toBe(true)
    expect(v.hasAttribute('playsinline')).toBe(true)
    const half = [...host.querySelectorAll('.fv-speed button')].find(b => b.textContent === '0.5×')
    act(() => { half.click() })
    expect(v.playbackRate).toBe(0.5)
    expect(host.querySelector('button[aria-label="Full screen"]')).not.toBeNull()
  })
  it('one kept on another phone says so and is never fetched', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { media: { ...CAPS, sets: true } } })
    const host = render(<FormVideoPlayer m={video(2, { local: true })} />)
    await settle()
    expect(host.querySelector('video')).toBeNull()
    expect(host.textContent).toContain('On the phone that filmed it')
  })
  it('a synced video missing from this device keeps the existing unavailable message', async () => {
    const host = render(<FormVideoPlayer m={video(3)} />)
    await settle()
    expect(host.querySelector('video')).toBeNull()
    expect(host.textContent).toContain('This video isn’t on this device')
  })
  it('uses the saved trim bounds in the shared player while keeping a local-only clip local', async () => {
    const m = video(4, { trim: { startSec: 1.25, endSec: 4.5 }, local: true })
    await media.put(m.hash, new Blob(['main']), { mime: 'video/mp4', pending: true })
    const host = render(<FormVideoPlayer m={m} />)
    await settle()
    const v = host.querySelector('video')
    expect(v).not.toBeNull()
    Object.defineProperty(v, 'currentTime', { value: 0, writable: true, configurable: true })
    act(() => v.dispatchEvent(new Event('loadedmetadata')))
    expect(v.currentTime).toBe(1.25)
    v.currentTime = 5.2
    act(() => v.dispatchEvent(new Event('seeking')))
    expect(v.currentTime).toBe(1.25)
  })
})

describe('Your form videos', () => {
  const saved = (id, d, n, w) => ({ id, d, start: Date.parse(d + 'T08:00:00Z'), end: Date.parse(d + 'T09:00:00Z'), name: 'Legs', prs: [], entries: [{ id: '0043', target: { sets: 1, reps: 5 }, sets: [{ w, r: 5, done: true, media: [video(n)] }] }] })
  beforeEach(() => {
    useStore.setState({ S: { ...S(), active: null, workouts: [saved('w1', '2026-08-01', 1, 80), saved('w2', '2026-09-01', 2, 90), saved('w3', '2026-10-01', 3, 100)] } })
  })
  it('lists the exercise\'s videos newest first and plays one in a sheet, with Remove', async () => {
    const host = render(<FormVideosSection exId="0043" />)
    expect(host.querySelector('h4').textContent).toBe('Your form videos')
    const tiles = [...host.querySelectorAll('.fv-tile')]
    const sets = tiles.map(t => t.querySelector('.fv-set').textContent)
    expect(sets[0]).toContain('100')
    expect(sets[1]).toContain('90')
    expect(sets[2]).toContain('80')
    act(() => { tiles[0].click() })
    const sheet = renderTop()
    expect(sheet.querySelector('.fv-player')).not.toBeNull()
    act(() => { sheet.querySelector('button[aria-label="Remove video"]').click() })
    const remove = [...sheet.querySelectorAll('.fv-ask button')].find(b => b.textContent === 'Remove')
    act(() => { remove.click() })
    expect(formVideosFor(S(), '0043').map(x => x.d)).toEqual(['2026-09-01', '2026-08-01'])
    expect(S().workouts.find(w => w.id === 'w3')._ts).toBeGreaterThan(0)
  })
  it('compares two dates: the newest with the oldest to start, both muted and in step', async () => {
    const host = render(<FormVideosSection exId="0043" />)
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Compare two dates').click() })
    const picked = [...host.querySelectorAll('.fv-tile')].map(t => t.getAttribute('aria-pressed'))
    expect(picked).toEqual(['true', 'false', 'true'])
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Compare').click() })
    const sheet = renderTop()
    expect([...sheet.querySelectorAll('figcaption b')].map(b => b.textContent)).toHaveLength(2)
    expect(sheet.querySelector('button[aria-label="Restart both"]')).not.toBeNull()
    expect(sheet.querySelector('button[aria-label="Pause both"]')).not.toBeNull()
  })
  it('shows nothing for an exercise without videos', () => {
    const host = render(<FormVideosSection exId="0025" />)
    expect(host.innerHTML).toBe('')
  })
  it('the compare view renders a pair it is handed', () => {
    const items = formVideosFor(S(), '0043')
    const host = render(<CompareVideos pair={[items[0], items[2]]} exId="0043" />)
    expect(host.querySelectorAll('.fv-side')).toHaveLength(2)
  })
  it('edits an existing saved video trim and Reset to full removes only the range metadata', async () => {
    const w = saved('w-edit-trim', '2026-10-10', 21, 80)
    const m = video(21, { local: true, trim: { startSec: 1, endSec: 5 } })
    w.entries[0].sets[0].media = [m]
    useStore.setState({ S: { ...S(), active: null, workouts: [w] } })
    await media.put(m.hash, new Blob(['source']), { mime: m.mime, pending: true })
    const host = render(<FormVideosSection exId="0043" />)
    act(() => host.querySelector('.fv-tile').click())
    const player = renderTop()
    await settle()
    act(() => [...player.querySelectorAll('.fv-bar button')].find(b => b.textContent === 'Edit trim').click())
    const editor = renderTop()
    await settle()
    dragTrim(editor, 'start', 80)
    act(() => [...editor.querySelectorAll('.fv-trim-transport button')].find(b => b.textContent === 'Reset to full video').click())
    act(() => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    const ref = S().workouts[0].entries[0].sets[0].media[0]
    expect(ref.trim).toBeUndefined()
    expect(ref).toMatchObject({ hash: m.hash, local: true })
    expect(S().workouts[0]._ts).toBeGreaterThan(0)
  })

  it('canceling an existing trim edit preserves the saved range, and unavailable local media has no edit action', async () => {
    const w = saved('w-cancel-trim', '2026-10-12', 22, 80)
    const m = video(22, { local: true, trim: { startSec: 1, endSec: 5 } })
    w.entries[0].sets[0].media = [m]
    useStore.setState({ S: { ...S(), active: null, workouts: [w] } })
    await media.put(m.hash, new Blob(['source']), { mime: m.mime, pending: true })
    const host = render(<FormVideosSection exId="0043" />)
    act(() => host.querySelector('.fv-tile').click())
    const player = renderTop()
    await settle()
    act(() => [...player.querySelectorAll('.fv-bar button')].find(b => b.textContent === 'Edit trim').click())
    const editor = renderTop()
    act(() => editor.querySelector('.fv-trim-actions button').click())
    await settle()
    expect(S().workouts[0].entries[0].sets[0].media[0].trim).toEqual(m.trim)
    expect(S().workouts[0]._ts).toBeUndefined()

    useStore.setState({ S: { ...S(), workouts: [saved('w-unavailable', '2026-10-13', 23, 80)] } })
    const missing = video(23, { local: true })
    S().workouts[0].entries[0].sets[0].media = [missing]
    const missingHost = render(<FormVideosSection exId="0043" />)
    act(() => missingHost.querySelector('.fv-tile').click())
    const missingPlayer = renderTop()
    await settle()
    expect([...missingPlayer.querySelectorAll('.fv-bar button')].some(b => b.textContent === 'Edit trim')).toBe(false)
  })

  it('the History video viewer shares the edit flow and module-off hides the editor action', async () => {
    const w = saved('w-history-trim', '2026-10-14', 24, 80)
    const m = video(24)
    w.entries[0].sets[0].media = [m]
    useStore.setState({ S: { ...S(), active: null, workouts: [w] } })
    await media.put(m.hash, new Blob(['source']), { mime: m.mime, pending: true })
    openWorkoutSetVideo(w, { entry: 0, set: 0, exId: '0043', m })
    const historyPlayer = renderTop()
    await settle()
    expect([...historyPlayer.querySelectorAll('.fv-bar button')].some(b => b.textContent === 'Edit trim')).toBe(true)
    useStore.setState({ S: { ...S(), modules: { videos: false } } })
    const noEditPlayer = render(<FormVideoPlayer m={m} onEditTrim={() => {}} />)
    await settle()
    expect([...noEditPlayer.querySelectorAll('.fv-bar button')].some(b => b.textContent === 'Edit trim')).toBe(false)
  })
  it('physically shortens the current saved Android clip and replaces its canonical MediaRef', async () => {
    h.nativeAvailable = true
    const w = saved('w-physical-edit', '2026-10-16', 26, 80)
    const current = video(26, { dur: 10, size: 350000, local: true })
    w.entries[0].sets[0].media = [current]
    useStore.setState({ S: { ...S(), active: null, workouts: [w] } })
    await media.put(current.hash, new Blob(['ten-second-current-clip']), { mime: current.mime, pending: true })
    h.ingest = vi.fn(async () => {
      const replacement = video(27, { dur: 5, size: 180000 })
      return { media: replacement, blobs: [{ hash: replacement.hash, blob: new Blob(['five-second-final']), mime: replacement.mime }], warnings: [] }
    })
    const host = render(<FormVideosSection exId="0043" />)
    act(() => host.querySelector('.fv-tile').click())
    const player = renderTop(); await settle()
    act(() => [...player.querySelectorAll('.fv-bar button')].find(b => b.textContent === 'Edit trim').click())
    await settle()
    const editor = renderTop(); await settle(); await loadPhysicalDuration(editor, 10)
    expect(editor.querySelector('.fv-trim-transport button')).not.toBeNull()
    expect([...editor.querySelectorAll('.fv-trim-transport button')].some(b => b.textContent === 'Reset to full video')).toBe(false)
    dragTrim(editor, 'end', 100)
    await act(async () => [...editor.querySelectorAll('.fv-trim-actions button')].at(-1).click())
    await settle()
    expect(h.stageSaved).toHaveBeenCalledWith(current)
    expect(h.trim).toHaveBeenCalledWith(`/cache/${current.hash}.mp4`, 0, 5)
    const savedRef = S().workouts[0].entries[0].sets[0].media[0]
    expect(savedRef).toMatchObject({ hash: hex(27), dur: 5, local: true })
    expect(savedRef.trim).toBeUndefined()
    expect(S().workouts[0]._ts).toBeGreaterThan(0)
    expect(h.deleteTemp.mock.calls.map(c => c[0])).toEqual([`/cache/${current.hash}.mp4`, '/cache/trimmed.mp4'])
  })
  it('migrates a legacy trimmed ref before Gallery export so Gallery receives the selected clip', async () => {
    h.nativeAvailable = true
    const w = saved('w-legacy-gallery', '2026-10-17', 28, 80)
    const legacy = video(28, { dur: 30, trim: { startSec: 20, endSec: 30 }, local: true })
    w.entries[0].sets[0].media = [legacy]
    useStore.setState({ S: { ...S(), active: null, workouts: [w] } })
    await media.put(legacy.hash, new Blob(['original-30s']), { mime: legacy.mime, pending: true })
    h.ingest = vi.fn(async () => {
      const final = video(29, { dur: 10, size: 300000 })
      return { media: final, blobs: [{ hash: final.hash, blob: new Blob(['selected-10s']), mime: final.mime }], warnings: [] }
    })
    const host = render(<FormVideosSection exId="0043" />)
    act(() => host.querySelector('.fv-tile').click())
    const player = renderTop(); await settle()
    await act(async () => [...player.querySelectorAll('.fv-bar button')].find(b => b.textContent === 'Save to Gallery').click())
    await settle()
    expect(h.trim).toHaveBeenCalledWith(`/cache/${legacy.hash}.mp4`, 20, 30)
    expect(S().workouts[0].entries[0].sets[0].media[0]).toMatchObject({ hash: hex(29), dur: 10, local: true })
    expect(S().workouts[0].entries[0].sets[0].media[0].trim).toBeUndefined()
    expect(h.exportGallery).toHaveBeenCalledWith(expect.objectContaining({ hash: hex(29), dur: 10 }))
    expect(h.deleteTemp.mock.calls.map(c => c[0])).toEqual([`/cache/${legacy.hash}.mp4`, '/cache/trimmed.mp4'])
  })
  it('compares each source within its own trim range', async () => {
    const a = video(11, { trim: { startSec: 1, endSec: 3 } })
    const b = video(12, { trim: { startSec: 4, endSec: 5.5 } })
    await media.put(a.hash, new Blob(['a']), { mime: 'video/mp4', pending: true })
    await media.put(b.hash, new Blob(['b']), { mime: 'video/mp4', pending: true })
    const pair = [
      { key: 'left', d: '2026-10-01', row: {}, m: a, entry: 0, set: 0, w: { entries: [{ target: {} }] } },
      { key: 'right', d: '2026-10-02', row: {}, m: b, entry: 0, set: 0, w: { entries: [{ target: {} }] } },
    ]
    const host = render(<CompareVideos pair={pair} exId="0043" />)
    await settle()
    const [left, right] = host.querySelectorAll('video')
    Object.defineProperty(left, 'currentTime', { value: 0, writable: true, configurable: true })
    Object.defineProperty(right, 'currentTime', { value: 0, writable: true, configurable: true })
    act(() => { left.dispatchEvent(new Event('loadedmetadata')); right.dispatchEvent(new Event('loadedmetadata')) })
    expect([left.currentTime, right.currentTime]).toEqual([1, 4])
    right.currentTime = 5.8
    act(() => right.dispatchEvent(new Event('timeupdate')))
    expect(right.currentTime).toBe(4)
  })
})
