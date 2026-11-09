package ch.duartesantos.opengym;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.source.ClippingMediaSource;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android-only scratch recording, physical trim and explicit Gallery export for set videos. */
@CapacitorPlugin(name = "VideoMedia")
public class VideoMediaPlugin extends Plugin {
    private static final String TAG = "OpenGymVideo";
    private static final String HASH = "[0-9a-f]{64}";
    private static final String ID = "[0-9a-f-]{36}";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Map<String, Session> sessions = new HashMap<>();
    private String activeRecordingId;

    private static final class Session {
        final File file;
        final OutputStream out;
        Session(File file, OutputStream out) { this.file = file; this.out = out; }
    }

    @Override public void load() {
        super.load();
        cleanupStale();
    }

    @Override protected void handleOnStop() {
        super.handleOnStop();
        final String id = activeRecordingId;
        if (id != null) discardSession(id);
    }

    @PluginMethod public void beginRecording(PluginCall call) {
        String mime = call.getString("mimeType", "");
        final String ext;
        if (mime.startsWith("video/mp4")) ext = "mp4";
        else if (mime.startsWith("video/webm")) ext = "webm";
        else { call.reject("unsupported recording MIME type", "unsupported-codec"); return; }
        synchronized (sessions) {
            if (activeRecordingId != null) { call.reject("a recording is already active", "busy"); return; }
            try {
                File dir = tempDir();
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cannot create temporary video folder");
                String id = UUID.randomUUID().toString();
                File file = new File(dir, id + "." + ext);
                OutputStream out = new BufferedOutputStream(new java.io.FileOutputStream(file));
                sessions.put(id, new Session(file, out));
                activeRecordingId = id;
                JSObject result = new JSObject(); result.put("id", id); result.put("path", file.getAbsolutePath());
                call.resolve(result);
            } catch (Exception e) { call.reject("could not start temporary recording", "storage", e); }
        }
    }

    @PluginMethod public void appendRecordingChunk(PluginCall call) {
        String id = call.getString("id", ""), data = call.getString("data");
        if (!id.matches(ID) || data == null) { call.reject("recording chunk is invalid"); return; }
        io.execute(() -> {
            try {
                Session s;
                synchronized (sessions) { s = sessions.get(id); }
                if (s == null || !id.equals(activeRecordingId)) throw new IllegalStateException("recording is no longer active");
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                s.out.write(bytes);
                call.resolve();
            } catch (Exception e) { call.reject("could not write recording chunk", "storage", e); }
        });
    }

    @PluginMethod public void finishRecording(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches(ID)) { call.reject("recording id is invalid"); return; }
        io.execute(() -> {
            try {
                Session s;
                synchronized (sessions) { s = sessions.remove(id); if (id.equals(activeRecordingId)) activeRecordingId = null; }
                if (s == null) throw new IllegalStateException("recording is no longer available");
                s.out.flush(); s.out.close();
                JSObject result = describe(s.file);
                if (result == null) throw new IllegalStateException("recording has no playable video track");
                call.resolve(result);
            } catch (Exception e) { call.reject("could not finish the recording", "recording-failed", e); }
        });
    }

    @PluginMethod public void cancelRecording(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches(ID)) { call.reject("recording id is invalid"); return; }
        discardSession(id);
        call.resolve();
    }

    /** Stages a copy of the current app-private canonical file for destructive editing. The
     *  persistent source is never passed to a mutating operation and remains available on failure. */
    @PluginMethod public void stageSavedVideo(PluginCall call) {
        String hash = call.getString("hash", ""), mime = call.getString("mime", "");
        String ext = ("video/mp4".equals(mime) || "video/quicktime".equals(mime)) ? "mp4" : "video/webm".equals(mime) ? "webm" : null;
        if (!hash.matches(HASH) || ext == null) { call.reject("video reference is invalid"); return; }
        File source = new File(new File(getContext().getFilesDir(), "opengym-media"), hash + "." + ext);
        io.execute(() -> {
            File staged = null;
            try {
                File canonical = source.getCanonicalFile();
                File mediaDir = new File(getContext().getFilesDir(), "opengym-media").getCanonicalFile();
                if (!mediaDir.equals(canonical.getParentFile()) || !canonical.isFile() || canonical.length() == 0)
                    throw new IllegalStateException("saved video is missing");
                staged = new File(tempDir(), UUID.randomUUID() + "." + ext);
                try (FileInputStream in = new FileInputStream(canonical); OutputStream out = new java.io.FileOutputStream(staged)) {
                    byte[] buffer = new byte[256 * 1024]; int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                }
                JSObject result = new JSObject(); result.put("path", staged.getAbsolutePath()); result.put("size", staged.length());
                call.resolve(result);
            } catch (Exception e) {
                if (staged != null) staged.delete();
                call.reject("could not prepare the saved video for editing", "storage", e);
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod public void trim(PluginCall call) {
        String path = call.getString("path", "");
        Double startValue = call.getDouble("startMs"), endValue = call.getDouble("endMs");
        long startMs = startValue == null ? -1L : Math.round(startValue);
        long endMs = endValue == null ? -1L : Math.round(endValue);
        File source = allowedTemp(path);
        if (source == null || !source.isFile() || source.length() == 0) { call.reject("temporary source video is missing", "source-missing"); return; }
        if (startMs < 0 || endMs <= startMs) { call.reject("trim range is invalid", "invalid-range"); return; }
        Log.i(TAG, "Trim requested; sourceBytes=" + source.length() + ", rangeMs=" + startMs + ".." + endMs);
        File output;
        try { output = new File(tempDir(), UUID.randomUUID() + ".trimmed.mp4"); }
        catch (Exception e) { call.reject("cannot create trimmed output", "storage", e); return; }
        final File dest = output;
        io.execute(() -> {
        try {
            File normalizedSource = null;
            File inputFile = source;
            if (source.getName().endsWith(".mp4")) {
                normalizedSource = remuxSeekableMp4(source);
                inputFile = normalizedSource;
                Log.i(TAG, "Fragmented MP4 remuxed; sourceBytes=" + source.length() + ", seekableBytes=" + normalizedSource.length());
            }
            final File intermediate = normalizedSource;
            File playbackSource = inputFile;
            getActivity().runOnUiThread(() -> startTransformer(call, dest, playbackSource, intermediate, startMs, endMs));
        } catch (Exception e) {
            dest.delete();
            Log.e(TAG, "Trim preparation failed; type=" + e.getClass().getSimpleName() + ", detail=" + sanitize(e.getMessage()));
            call.reject("Could not prepare the selected clip. Your recording is safe; tap Retry to try again.", "trim-failed");
        }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    private void startTransformer(PluginCall call, File dest, File inputFile, File intermediate, long startMs, long endMs) {
        try {
            MediaItem.Builder mediaItem = new MediaItem.Builder().setUri(Uri.fromFile(inputFile));
            if (intermediate == null) {
                // Other supported recorder formats may also be unseekable; preserve their
                // existing sequential-read behavior. The MP4 path above is seekable now.
                mediaItem.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(startMs).setEndPositionMs(endMs).setAllowUnseekableMedia(true).build());
            } else {
                mediaItem.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(startMs).setEndPositionMs(endMs).build());
            }
            MediaItem input = mediaItem.build();
            Transformer transformer = new Transformer.Builder(getContext())
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .setPortraitEncodingEnabled(true)
                    // Keep the default physical trim. Edit-list pre-roll can retain excluded samples.
                    .addListener(new Transformer.Listener() {
                        @Override public void onCompleted(Composition composition, ExportResult exportResult) {
                            try {
                                JSObject result = describe(dest);
                                double expected = (endMs - startMs) / 1000.0;
                                double actual = result == null ? 0 : result.getDouble("durationMs") / 1000.0;
                                if (result == null || actual <= 0 || Math.abs(actual - expected) > Math.max(0.75, expected * 0.04)) {
                                    dest.delete();
                                    if (intermediate != null) intermediate.delete();
                                    call.reject("trimmed video duration did not match the selected range", "invalid-output");
                                    return;
                                }
                                result.put("requestedDurationMs", endMs - startMs);
                                if (intermediate != null) intermediate.delete();
                                Log.i(TAG, "Trim completed; outputBytes=" + result.getLong("size") + ", durationMs="
                                        + result.getLong("durationMs") + ", requestedDurationMs=" + (endMs - startMs));
                                call.resolve(result);
                            } catch (Exception e) { dest.delete(); if (intermediate != null) intermediate.delete(); call.reject("trimmed output could not be verified", "invalid-output", e); }
                        }
                        @Override public void onError(Composition composition, ExportResult exportResult, ExportException exception) {
                            dest.delete();
                            if (intermediate != null) intermediate.delete();
                            StringBuilder causes = new StringBuilder();
                            for (Throwable cause = exception.getCause(); cause != null; cause = cause.getCause()) {
                                if (causes.length() > 0) causes.append(" <- ");
                                causes.append(cause.getClass().getSimpleName());
                                if (cause instanceof ClippingMediaSource.IllegalClippingException) {
                                    causes.append("(reason=").append(((ClippingMediaSource.IllegalClippingException) cause).reason).append(')');
                                }
                                String detail = cause.getMessage();
                                if (detail != null && !detail.isEmpty()) {
                                    causes.append(": ").append(detail.replaceAll("(?i)(file://|content://|/data/|/storage/)[^\\s,;]+", "[private path]"));
                                }
                            }
                            Log.e(TAG, "Trim failed; media3Error=" + exception.getErrorCodeName() + "(" + exception.errorCode + ")"
                                    + ", causeChain=" + (causes.length() == 0 ? "none" : causes));
                            call.reject("Could not create the selected clip. Your recording is safe; try again.", "trim-failed", exception);
                        }
                    }).build();
            transformer.start(input, dest.getAbsolutePath());
        } catch (Exception e) {
            dest.delete();
            if (intermediate != null) intermediate.delete();
            Log.e(TAG, "Trim setup failed; type=" + e.getClass().getSimpleName() + ", detail=" + sanitize(e.getMessage()));
            call.reject("Could not start trimming. Your recording is safe; tap Retry to try again.", "trim-failed");
        }
    }

    /** Copies compressed MP4 samples into a regular indexed MP4 without decoding or quality loss. */
    private File remuxSeekableMp4(File source) throws Exception {
        File output = new File(tempDir(), UUID.randomUUID() + ".seekable.mp4");
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        boolean started = false;
        try {
            extractor.setDataSource(source.getAbsolutePath());
            muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int trackCount = extractor.getTrackCount();
            int[] trackMap = new int[trackCount];
            Arrays.fill(trackMap, -1);
            int rotation = 0;
            for (int i = 0; i < trackCount; i++) {
                MediaFormat format = extractor.getTrackFormat(i);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime == null || (!mime.startsWith("video/") && !mime.startsWith("audio/"))) continue;
                if (mime.startsWith("video/") && format.containsKey(MediaFormat.KEY_ROTATION)) {
                    rotation = format.getInteger(MediaFormat.KEY_ROTATION);
                    format.removeKey(MediaFormat.KEY_ROTATION);
                }
                trackMap[i] = muxer.addTrack(format);
                extractor.selectTrack(i);
            }
            if (Arrays.stream(trackMap).noneMatch(track -> track >= 0)) throw new IllegalStateException("recording contains no muxable tracks");
            if (rotation != 0) muxer.setOrientationHint(rotation);
            muxer.start(); started = true;
            ByteBuffer buffer = ByteBuffer.allocateDirect(4 * 1024 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long samples = 0;
            while (true) {
                int sourceTrack = extractor.getSampleTrackIndex();
                if (sourceTrack < 0) break;
                int muxTrack = trackMap[sourceTrack];
                buffer.clear();
                int size = extractor.readSampleData(buffer, 0);
                if (size < 0) break;
                if (muxTrack >= 0) {
                    info.set(0, size, extractor.getSampleTime(), extractor.getSampleFlags());
                    muxer.writeSampleData(muxTrack, buffer, info);
                    samples++;
                }
                if (!extractor.advance()) break;
            }
            if (samples == 0) throw new IllegalStateException("recording contains no readable samples");
            muxer.stop(); started = false;
            return output;
        } catch (Exception e) {
            output.delete();
            throw e;
        } finally {
            if (started && muxer != null) try { muxer.stop(); } catch (Exception ignored) { }
            if (muxer != null) muxer.release();
            extractor.release();
        }
    }

    private String sanitize(String detail) {
        if (detail == null) return "none";
        return detail.replaceAll("(?i)(file://|content://|/data/|/storage/)[^\\s,;]+", "[private path]");
    }

    @PluginMethod public void deleteTemp(PluginCall call) {
        File file = allowedTemp(call.getString("path", ""));
        if (file == null) { call.reject("temporary file is not owned by OpenGym"); return; }
        discardSessionForFile(file);
        if (file.exists() && !file.delete()) { call.reject("could not remove temporary video", "storage"); return; }
        call.resolve();
    }

    @PluginMethod public void exportToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("Gallery export needs Android 10 or later", "unsupported"); return; }
        String hash = call.getString("hash", ""), mime = call.getString("mime", "");
        String extension = ("video/mp4".equals(mime) || "video/quicktime".equals(mime)) ? "mp4" : "video/webm".equals(mime) ? "webm" : null;
        if (!hash.matches(HASH) || extension == null) { call.reject("video reference is invalid"); return; }
        String sourceUri = call.getString("sourceUri", "");
        File source = allowedMediaFile(sourceUri, hash + "." + extension);
        if (source == null || !source.isFile()) { call.reject("saved OpenGym video is missing", "source-missing"); return; }
        String galleryMime = "video/webm".equals(mime) ? "video/webm" : "video/mp4";
        io.execute(() -> exportFile(call, source, hash, galleryMime));
    }

    private void exportFile(PluginCall call, File source, String hash, String mime) {
        ContentResolver resolver = getContext().getContentResolver();
        String name = "OpenGym-" + hash.substring(0, 12) + ("video/webm".equals(mime) ? ".webm" : ".mp4");
        String relative = Environment.DIRECTORY_MOVIES + "/openGym";
        Uri collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri output = null;
        try {
            String[] columns = { MediaStore.Video.Media._ID };
            String selection = MediaStore.Video.Media.DISPLAY_NAME + "=? AND " + MediaStore.Video.Media.RELATIVE_PATH + "=?";
            try (Cursor c = resolver.query(collection, columns, selection, new String[] { name, relative + "/" }, null)) {
                if (c != null && c.moveToFirst()) {
                    JSObject existing = new JSObject();
                    existing.put("uri", Uri.withAppendedPath(collection, c.getString(0)).toString());
                    existing.put("alreadyExists", true); existing.put("size", source.length());
                    call.resolve(existing); return;
                }
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Video.Media.MIME_TYPE, mime);
            values.put(MediaStore.Video.Media.RELATIVE_PATH, relative);
            values.put(MediaStore.Video.Media.IS_PENDING, 1);
            output = resolver.insert(collection, values);
            if (output == null) throw new IllegalStateException("MediaStore refused the Gallery item");
            try (FileInputStream in = new FileInputStream(source); OutputStream out = resolver.openOutputStream(output, "w")) {
                if (out == null) throw new IllegalStateException("Gallery destination could not be opened");
                byte[] buffer = new byte[256 * 1024]; int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            }
            ContentValues ready = new ContentValues(); ready.put(MediaStore.Video.Media.IS_PENDING, 0);
            resolver.update(output, ready, null, null);
            JSObject result = new JSObject(); result.put("uri", output.toString()); result.put("size", source.length());
            result.put("alreadyExists", false); call.resolve(result);
        } catch (Exception e) {
            if (output != null) try { resolver.delete(output, null, null); } catch (Exception ignored) { }
            call.reject("could not save this video to Gallery", "gallery-export", e);
        }
    }

    private JSObject describe(File file) throws Exception {
        if (!file.isFile() || file.length() == 0) return null;
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            String width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            if (duration == null || width == null || height == null || Long.parseLong(duration) <= 0) return null;
            JSObject result = new JSObject(); result.put("path", file.getAbsolutePath());
            result.put("mimeType", file.getName().endsWith(".webm") ? "video/webm" : "video/mp4");
            result.put("durationMs", Long.parseLong(duration)); result.put("size", file.length());
            result.put("width", Integer.parseInt(width)); result.put("height", Integer.parseInt(height));
            String rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            result.put("rotation", rotation == null ? 0 : Integer.parseInt(rotation));
            return result;
        } finally { retriever.release(); }
    }

    private File tempDir() throws Exception { return new File(getContext().getCacheDir(), "opengym-video").getCanonicalFile(); }

    private File allowedTemp(String path) {
        try {
            File file = new File(path).getCanonicalFile();
            if (!tempDir().equals(file.getParentFile()) || !file.getName().matches(ID + "(\\.(trimmed|seekable))?\\.(mp4|webm)")) return null;
            return file;
        } catch (Exception e) { return null; }
    }

    private File allowedMediaFile(String uriText, String expectedName) {
        try {
            Uri uri = Uri.parse(uriText);
            if (!"file".equals(uri.getScheme())) return null;
            File file = new File(uri.getPath()).getCanonicalFile();
            File dir = new File(getContext().getFilesDir(), "opengym-media").getCanonicalFile();
            if (!dir.equals(file.getParentFile()) || !expectedName.equals(file.getName())) return null;
            return file;
        } catch (Exception e) { return null; }
    }

    private void discardSession(String id) {
        io.execute(() -> {
            Session s;
            synchronized (sessions) { s = sessions.remove(id); if (id.equals(activeRecordingId)) activeRecordingId = null; }
            if (s != null) { try { s.out.close(); } catch (Exception ignored) { } if (s.file.exists()) s.file.delete(); }
        });
    }

    private void discardSessionForFile(File file) {
        synchronized (sessions) {
            Iterator<Map.Entry<String, Session>> entries = sessions.entrySet().iterator();
            while (entries.hasNext()) {
                Map.Entry<String, Session> e = entries.next();
                if (!e.getValue().file.equals(file)) continue;
                try { e.getValue().out.close(); } catch (Exception ignored) { }
                if (e.getKey().equals(activeRecordingId)) activeRecordingId = null;
                entries.remove(); break;
            }
        }
    }

    private void cleanupStale() {
        io.execute(() -> {
            try {
                File dir = tempDir(); File[] files = dir.listFiles();
                if (files == null) return;
                long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
                for (File file : files) if (file.isFile() && file.lastModified() < cutoff && allowedTemp(file.getAbsolutePath()) != null) file.delete();
            } catch (Exception ignored) { }
        });
    }
}
