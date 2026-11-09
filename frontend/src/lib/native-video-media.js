import { Capacitor, registerPlugin } from '@capacitor/core'
import { MOBILE } from './mobile.js'
import { MEDIA_MIMES } from './media-refs.js'

let plugin
const nativePlugin = () => plugin || (plugin = registerPlugin('VideoMedia'))
export const videoMediaPlugin = nativePlugin

export const nativeVideoAvailable = () => MOBILE && Capacitor.getPlatform() === 'android'

export async function tempVideoUrl(path) {
  return Capacitor.convertFileSrc(path)
}

export async function trimTempVideo(path, startSec, endSec, onProgress) {
  const p = nativePlugin()
  let listener
  if (onProgress) listener = await p.addListener('trimProgress', event => onProgress(event.progress))
  try { return await p.trim({ path, startMs: Math.round(startSec * 1000), endMs: Math.round(endSec * 1000) }) }
  finally { await listener?.remove() }
}

export async function stageSavedVideoForTrim(m) {
  if (!nativeVideoAvailable() || m?.kind !== 'video' || !MEDIA_MIMES[m.mime]) throw new Error('saved video staging unavailable')
  return nativePlugin().stageSavedVideo({ hash: m.hash, mime: m.mime })
}

/** Make a private scratch copy of a saved video before destructive editing. The saved MediaRef
 *  remains untouched until its replacement has been ingested and attached successfully. */
export async function deleteTempVideo(path) {
  if (!nativeVideoAvailable() || !path) return
  await nativePlugin().deleteTemp({ path })
}

/** Export the already-ingested app-private file. Native code validates the URI remains in its
 *  private media directory and uses MediaStore; this never accepts or deletes a gallery source. */
export async function exportSavedVideoToGallery(m) {
  if (!nativeVideoAvailable() || m?.kind !== 'video' || !MEDIA_MIMES[m.mime]) throw new Error('gallery export unavailable')
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { uri } = await Filesystem.getUri({
    path: `opengym-media/${m.hash}.${MEDIA_MIMES[m.mime].playExt}`,
    directory: Directory.Library
  })
  return nativePlugin().exportToGallery({ sourceUri: uri, hash: m.hash, mime: m.mime })
}
