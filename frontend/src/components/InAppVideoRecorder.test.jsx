// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const mocks = vi.hoisted(() => ({ choose: vi.fn(), create: vi.fn(), plugin: {} }))
vi.mock('../lib/video-recorder.js', () => ({ chooseRecordingMime: (...a) => mocks.choose(...a), createNativeRecording: (...a) => mocks.create(...a) }))
vi.mock('../lib/native-video-media.js', () => ({ videoMediaPlugin: () => mocks.plugin }))

import InAppVideoRecorder from './InAppVideoRecorder.jsx'
import { _setLangState } from '../lib/i18n-core.js'
import { bindUI } from './ui.jsx'
import { useUI } from '../store/useUI.js'

bindUI(useUI)
let root, host, stopTrack, camera
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function mount(props = {}) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<InAppVideoRecorder {...props} />))
  return host
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null })
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  stopTrack = vi.fn()
  camera = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: camera } })
  globalThis.MediaRecorder = class { static isTypeSupported = () => true }
  mocks.choose.mockReturnValue('video/mp4')
  mocks.create.mockReset()
  mocks.plugin = {}
})
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null }
  document.body.innerHTML = ''
})

describe('in-app video recorder UX', () => {
  it('opens a live stream, records, stops and returns the private temporary video', async () => {
    const output = { path: '/cache/a.mp4', mimeType: 'video/mp4', durationMs: 900, size: 1000 }
    const sink = { stop: vi.fn(async () => output), cancel: vi.fn() }
    mocks.create.mockResolvedValue(sink)
    const onRecorded = vi.fn()
    const h = mount({ onRecorded })
    await settle()
    expect(camera).toHaveBeenCalledWith(expect.objectContaining({ audio: true, video: expect.any(Object) }))
    expect(h.textContent).toContain('Record')
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent === 'Record').click())
    await settle()
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent === 'Stop').click())
    await settle()
    expect(sink.stop).toHaveBeenCalledOnce()
    expect(onRecorded).toHaveBeenCalledWith(output)
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('falls back to silent video when the microphone permission is denied', async () => {
    camera.mockRejectedValueOnce(Object.assign(new Error('mic denied'), { name: 'NotAllowedError' }))
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack }] })
    const h = mount()
    await settle()
    expect(camera).toHaveBeenCalledTimes(2)
    expect(camera.mock.calls[1][0].audio).toBe(false)
    expect(h.textContent).toContain('Microphone unavailable. The video will have no sound.')
    expect(h.querySelector('button[disabled]')).toBeNull()
  })

  it('reports camera denial and leaves the external camera fallback available', async () => {
    camera.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const fallback = vi.fn()
    const h = mount({ onFallback: fallback })
    await settle()
    expect(h.textContent).toContain('Camera permission is needed to record. Enable it in Settings.')
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent.includes('device camera')).click())
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('cancels a partial native file when the app backgrounds during recording', async () => {
    const sink = { stop: vi.fn(), cancel: vi.fn(async () => {}) }
    mocks.create.mockResolvedValue(sink)
    const h = mount()
    await settle()
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent === 'Record').click())
    await settle()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await settle()
    expect(sink.cancel).toHaveBeenCalledOnce()
    expect(h.textContent).toContain('Recording stopped because OpenGym went to the background.')
  })
})
