use std::sync::{Arc, Mutex, Condvar, atomic::{AtomicBool, Ordering}};
use std::sync::mpsc::{channel, Sender, TryRecvError};
use std::thread;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::time::Duration;

use oboe::{
    AudioOutputCallback, AudioStreamBuilder, AudioStream,
    DataCallbackResult, PerformanceMode, SharingMode, Stereo, Output,
};
use ringbuf::traits::*;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{State, Emitter, AppHandle, Manager};

// ============================================================
// Streaming support for HTTP Audio
// ============================================================

struct SharedStreamData {
    buffer: Vec<u8>,
    is_eof: bool,
    has_error: bool,
}

#[derive(Clone)]
struct ProgressiveStream {
    shared: Arc<(Mutex<SharedStreamData>, Condvar)>,
    pos: u64,
    content_length: Option<u64>,
}

impl Read for ProgressiveStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let (lock, cvar) = &*self.shared;
        let mut state = lock.lock().unwrap();

        loop {
            let available = state.buffer.len() as u64;
            if self.pos < available {
                let to_read = std::cmp::min(buf.len() as u64, available - self.pos) as usize;
                buf[0..to_read].copy_from_slice(&state.buffer[self.pos as usize .. self.pos as usize + to_read]);
                self.pos += to_read as u64;
                return Ok(to_read);
            }

            if state.has_error {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, "HTTP Streaming Error"));
            }

            if state.is_eof {
                return Ok(0);
            }

            state = cvar.wait(state).unwrap();
        }
    }
}

impl Seek for ProgressiveStream {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let (lock, cvar) = &*self.shared;
        let mut state = lock.lock().unwrap();

        let new_pos = match pos {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::Current(p) => self.pos as i64 + p,
            SeekFrom::End(p) => {
                while !state.is_eof && !state.has_error {
                    state = cvar.wait(state).unwrap();
                }
                if state.has_error {
                    return Err(std::io::Error::new(std::io::ErrorKind::Other, "Download error before finding EOF"));
                }
                state.buffer.len() as i64 + p
            }
        };

        if new_pos < 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Seek to negative offset"));
        }

        self.pos = new_pos as u64;
        Ok(self.pos)
    }
}

impl MediaSource for ProgressiveStream {
    fn is_seekable(&self) -> bool { true }
    fn byte_len(&self) -> Option<u64> { self.content_length }
}

// ============================================================
// Commands sent from the frontend via Tauri IPC
// ============================================================
pub enum AudioCommand {
    Play(String),
    Preload(String),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(f32),
}

// ============================================================
// Shared playback status (read by frontend via get_position / get_duration)
// ============================================================

#[derive(Clone, serde::Serialize)]
pub struct AudioMetadata {
    pub duration_secs: f32,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

struct PlaybackStatus {
    is_playing: bool,
    /// True while switching songs (stop old → start new) — prevents false ENDED detection
    is_transitioning: bool,
    duration_secs: f32,
    /// Current playback position in samples (at the output sample rate)
    position_samples: u64,
    /// Output sample rate (set by Oboe stream)
    sample_rate: u32,
    /// Seek target: when set, the decode thread will seek to this position
    seek_to: Option<f32>,
    pub metadata: Option<AudioMetadata>,
}

pub struct StreamContext {
    flush_requested: AtomicBool,
}

impl PlaybackStatus {
    fn position_secs(&self) -> f32 {
        if self.sample_rate == 0 {
            return 0.0;
        }
        self.position_samples as f32 / self.sample_rate as f32
    }
}

// ============================================================
// Oboe audio callback — reads PCM from a shared ring buffer
// ============================================================

struct PlayerCallback {
    /// Consumer side of the ring buffer — receives interleaved stereo f32 samples
    consumer: Arc<Mutex<ringbuf::HeapCons<f32>>>,
    /// Shared status for tracking position
    status: Arc<Mutex<PlaybackStatus>>,
    /// Volume (0.0 – 1.0)
    volume: Arc<Mutex<f32>>,
    /// Flag: is the stream supposed to be playing?
    playing: Arc<AtomicBool>,
    /// Communication context with decoding thread
    stream_ctx: Arc<StreamContext>,
}

impl AudioOutputCallback for PlayerCallback {
    type FrameType = (f32, Stereo);

    fn on_audio_ready(
        &mut self,
        _stream: &mut dyn oboe::AudioOutputStreamSafe,
        frames: &mut [(f32, f32)],
    ) -> oboe::DataCallbackResult {
        let vol = *self.volume.lock().unwrap();
        let is_playing = self.playing.load(Ordering::Relaxed);

        if !is_playing {
            // Output silence when paused
            for frame in frames.iter_mut() {
                frame.0 = 0.0;
                frame.1 = 0.0;
            }
            return DataCallbackResult::Continue;
        }

        // Handle seeking buffer flush
        if self.stream_ctx.flush_requested.load(Ordering::Acquire) {
            let mut cons = self.consumer.lock().unwrap();
            let count = cons.occupied_len();
            let _ = cons.skip(count);

            // Output silence during flush
            for frame in frames.iter_mut() {
                frame.0 = 0.0;
                frame.1 = 0.0;
            }

            self.stream_ctx.flush_requested.store(false, Ordering::Release);
            return DataCallbackResult::Continue;
        }

        let mut samples_read: u64 = 0;
        let mut cons = self.consumer.lock().unwrap();
        
        for frame in frames.iter_mut() {
            // Each frame = 2 f32 samples (L, R)
            let l = cons.try_pop().unwrap_or(0.0);
            let r = cons.try_pop().unwrap_or(0.0);
            frame.0 = l * vol;
            frame.1 = r * vol;
            samples_read += 1;
        }
        drop(cons);

        // Update position based on exactly how many samples were output
        if samples_read > 0 {
            if let Ok(mut st) = self.status.try_lock() {
                st.position_samples += samples_read;
            }
        }

        DataCallbackResult::Continue
    }
}

// ============================================================
// Public state managed by Tauri
// ============================================================

pub struct AudioState {
    command_tx: Mutex<Sender<AudioCommand>>,
    status: Arc<Mutex<PlaybackStatus>>,
    _app_handle: tauri::AppHandle,
    preloaded: Arc<Mutex<Option<(String, MediaSourceStream, Hint)>>>,
}

impl AudioState {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (tx, rx) = channel::<AudioCommand>();

        let status = Arc::new(Mutex::new(PlaybackStatus {
            is_playing: false,
            is_transitioning: false,
            duration_secs: 0.0,
            position_samples: 0,
            sample_rate: 44100,
            seek_to: None,
            metadata: None,
        }));

        let preloaded = Arc::new(Mutex::new(None));
        let preloaded_clone = preloaded.clone();
        let status_clone = status.clone();
        let app_handle_clone = app_handle.clone();

        // Main audio management thread
        thread::spawn(move || {
            Self::audio_thread(rx, status_clone, app_handle_clone, preloaded_clone);
        });

        Self {
            command_tx: Mutex::new(tx),
            status,
            _app_handle: app_handle,
            preloaded,
        }
    }

    /// The audio management thread — owns the Oboe stream and decode thread.
    fn audio_thread(
        rx: std::sync::mpsc::Receiver<AudioCommand>,
        status: Arc<Mutex<PlaybackStatus>>,
        app_handle: tauri::AppHandle,
        preloaded: Arc<Mutex<Option<(String, MediaSourceStream, Hint)>>>,
    ) {
        let volume = Arc::new(Mutex::new(1.0f32));
        let playing = Arc::new(AtomicBool::new(false));

        // Current stream handle (if any)
        let mut stream: Option<oboe::AudioStreamAsync<Output, PlayerCallback>> = None;
        // Decode thread stop flag
        let decode_stop: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
        // Ring buffer producer (owned by decode thread), consumer (owned by Oboe callback)
        let mut _decode_handle: Option<thread::JoinHandle<()>> = None;

        loop {
            // Wait for commands (blocking)
            let cmd = match rx.recv() {
                Ok(c) => c,
                Err(_) => break, // Channel closed
            };

            match cmd {
                AudioCommand::Play(url) => {
                    // ---- Stop existing playback ----
                    playing.store(false, Ordering::SeqCst);
                    decode_stop.store(true, Ordering::SeqCst);
                    if let Some(mut s) = stream.take() {
                        let _ = s.stop();
                    }
                    // Small delay to let old decode thread see the stop flag
                    thread::sleep(Duration::from_millis(50));
                    decode_stop.store(false, Ordering::SeqCst);

                    // ---- Create ring buffer ----
                    // 2 channels * 192000 samples/sec * 2 seconds = maximum needed
                    let rb = ringbuf::HeapRb::<f32>::new(192000 * 4);
                    let (producer, consumer) = rb.split();
                    let arc_consumer = Arc::new(Mutex::new(consumer));
                    
                    let stream_ctx = Arc::new(StreamContext {
                        flush_requested: AtomicBool::new(false),
                    });

                    // ---- Reset status ----
                    {
                        let mut st = status.lock().unwrap();
                        st.is_playing = false;
                        st.is_transitioning = true; // block false ENDED detection
                        st.duration_secs = 0.0;
                        st.position_samples = 0;
                        st.seek_to = None;
                        st.metadata = None;
                    }

                    // ---- Start decode thread ----
                let decode_stop_clone = decode_stop.clone();
                let status_for_decode = status.clone();
                let playing_for_decode = playing.clone();
                let volume_for_decode = volume.clone();
                let stream_ctx_for_decode = stream_ctx.clone();
                let app_handle_clone = app_handle.clone();
                let preloaded_for_decode = preloaded.clone();

                _decode_handle = Some(thread::spawn(move || {
                    Self::decode_thread(url, producer, arc_consumer, decode_stop_clone, status_for_decode, playing_for_decode, volume_for_decode, stream_ctx_for_decode, app_handle_clone, preloaded_for_decode);
                }));

                // Note: Oboe stream initialization is now executed inside the decode thread
                    // so we can properly utilize the target sample rate dynamically instead of hard-coding 44.1kHz!

                    // Collect any queued commands that arrived during setup
                    loop {
                        match rx.try_recv() {
                            Ok(queued) => {
                                // Process immediately (only volume/pause make sense here)
                                match queued {
                                    AudioCommand::SetVolume(v) => {
                                        *volume.lock().unwrap() = v;
                                    }
                                    AudioCommand::Pause => {
                                        playing.store(false, Ordering::SeqCst);
                                        status.lock().unwrap().is_playing = false;
                                    }
                                    _ => {}
                                }
                            }
                            Err(TryRecvError::Empty) => break,
                            Err(TryRecvError::Disconnected) => return,
                        }
                    }
                }
                AudioCommand::Preload(url) => {
                    let preloaded_clone = preloaded.clone();
                    thread::spawn(move || {
                        if let Some((mss, hint)) = Self::prepare_stream(&url) {
                            let mut p = preloaded_clone.lock().unwrap();
                            *p = Some((url, mss, hint));
                        }
                    });
                }
                AudioCommand::Pause => {
                    playing.store(false, Ordering::SeqCst);
                    if let Ok(mut st) = status.lock() {
                        st.is_playing = false;
                    }
                }
                AudioCommand::Resume => {
                    playing.store(true, Ordering::SeqCst);
                    if let Ok(mut st) = status.lock() {
                        st.is_playing = true;
                    }
                }
                AudioCommand::Stop => {
                    playing.store(false, Ordering::SeqCst);
                    decode_stop.store(true, Ordering::SeqCst);
                    if let Ok(mut st) = status.lock() {
                        st.is_playing = false;
                        st.position_samples = 0;
                    }
                }
                AudioCommand::SetVolume(v) => {
                    *volume.lock().unwrap() = v;
                }
                AudioCommand::Seek(time) => {
                    if let Ok(mut st) = status.lock() {
                        st.seek_to = Some(time);
                        st.position_samples = (time * st.sample_rate as f32) as u64;
                    }
                }
            }
        }
    }

    /// Decode thread: reads audio file with symphonia, writes PCM to ring buffer.
    fn decode_thread(
        url: String,
        mut producer: ringbuf::HeapProd<f32>,
        consumer: Arc<Mutex<ringbuf::HeapCons<f32>>>,
        stop_flag: Arc<AtomicBool>,
        status: Arc<Mutex<PlaybackStatus>>,
        playing: Arc<AtomicBool>,
        volume: Arc<Mutex<f32>>,
        stream_ctx: Arc<StreamContext>,
        app_handle: tauri::AppHandle,
        preloaded: Arc<Mutex<Option<(String, MediaSourceStream, Hint)>>>,
    ) {
        let preloaded_data = {
            let mut p = preloaded.lock().unwrap();
            if let Some((p_url, _, _)) = &*p {
                if p_url == &url {
                    p.take()
                } else {
                    None
                }
            } else {
                None
            }
        };

        let (mss, hint) = if let Some((_, mss, hint)) = preloaded_data {
            (mss, hint)
        } else {
            match Self::prepare_stream(&url) {
                Some(s) => s,
                None => return,
            }
        };

        let mut probed = match symphonia::default::get_probe().format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        ) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[Decode] Failed to probe format: {}", e);
                return;
            }
        };

        let mut format_reader = probed.format;

        // ---- Find the first audio track ----
        let track = match format_reader.tracks().iter().find(|t| {
            t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL
        }) {
            Some(t) => t.clone(),
            None => {
                eprintln!("[Decode] No audio track found");
                return;
            }
        };
        let track_id = track.id;

        // ---- Get Metadata ----
        let mut title = None;
        let mut artist = None;
        let mut album = None;
        if let Some(metadata_rev) = probed.metadata.get().as_ref().and_then(|m| m.current()) {
            for tag in metadata_rev.tags() {
                if tag.std_key == Some(symphonia::core::meta::StandardTagKey::TrackTitle) {
                    title = Some(tag.value.to_string());
                } else if tag.std_key == Some(symphonia::core::meta::StandardTagKey::Artist) {
                    artist = Some(tag.value.to_string());
                } else if tag.std_key == Some(symphonia::core::meta::StandardTagKey::Album) {
                    album = Some(tag.value.to_string());
                }
            }
        }

        // ---- Get duration ----
        let codec_params = &track.codec_params;
        let tb = codec_params.time_base;
        let n_frames = codec_params.n_frames;
        let sample_rate_file = codec_params.sample_rate.unwrap_or(44100);

        if let (Some(tb), Some(n_frames)) = (tb, n_frames) {
            let duration_secs = tb.calc_time(n_frames);
            let dur = duration_secs.seconds as f32 + duration_secs.frac as f32;
            if let Ok(mut st) = status.lock() {
                st.duration_secs = dur;
                st.metadata = Some(AudioMetadata {
                    duration_secs: dur,
                    title,
                    artist,
                    album,
                });
            }
        }

        // ---- Create decoder ----
        let mut decoder = match symphonia::default::get_codecs().make(
            &track.codec_params,
            &DecoderOptions::default(),
        ) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[Decode] Failed to create decoder: {}", e);
                return;
            }
        };

        // Initialize Oboe Stream on High-Res Audio detection
        let mut oboe_stream_holder = match AudioStreamBuilder::default()
            .set_performance_mode(PerformanceMode::LowLatency)
            .set_sharing_mode(SharingMode::Shared)
            .set_format::<f32>()
            .set_channel_count::<Stereo>()
            .set_sample_rate(sample_rate_file as i32)
            .set_usage(oboe::Usage::Media)
            .set_content_type(oboe::ContentType::Music)
            .set_callback(PlayerCallback {
                consumer,
                status: status.clone(),
                volume,
                playing: playing.clone(),
                stream_ctx: stream_ctx.clone(),
            })
            .open_stream()
        {
            Ok(mut s) => {
                if let Err(e) = s.start() {
                    eprintln!("[AudioPlayer] Failed to start Oboe stream: {}", e);
                }
                
                let mut st = status.lock().unwrap();
                st.sample_rate = sample_rate_file;

                Some(s)
            }
            Err(e) => {
                eprintln!("[AudioPlayer] Failed to open Oboe stream: {}", e);
                None
            }
        };

        // ---- Signal "playing" ----
        playing.store(true, Ordering::SeqCst);
        if let Ok(mut st) = status.lock() {
            st.is_playing = true;
            st.is_transitioning = false; // song is now loaded, safe for ENDED detection
        }

        // ---- Decode loop ----

        loop {
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Check for seek request
            let seek_target = {
                let mut st = status.lock().unwrap();
                st.seek_to.take()
            };
            if let Some(seek_time) = seek_target {
                stream_ctx.flush_requested.store(true, Ordering::Release);
                
                let seek_ts = (seek_time as f64 * sample_rate_file as f64) as u64;
                match format_reader.seek(
                    symphonia::core::formats::SeekMode::Accurate,
                    symphonia::core::formats::SeekTo::TimeStamp {
                        ts: seek_ts,
                        track_id,
                    },
                ) {
                    Ok(seeked_to) => {
                        // Perfect sync: match UI position instantly to actual hardware sample jump location
                        if let Ok(mut st) = status.lock() {
                            st.position_samples = seeked_to.actual_ts;
                        }
                    }
                    Err(e) => {
                        eprintln!("[Decode] Failed to accurately seek: {}", e);
                    }
                }
                decoder.reset();

                // Wait for the consumer to finish flushing the buffer
                while stream_ctx.flush_requested.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(5));
                }
            }

            // Read next packet
            let packet = match format_reader.next_packet() {
                Ok(p) => p,
                Err(symphonia::core::errors::Error::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    // End of stream
                    break;
                }
                Err(e) => {
                    eprintln!("[Decode] Error reading packet: {}", e);
                    break;
                }
            };

            if packet.track_id() != track_id {
                continue;
            }

            // Decode packet
            let decoded = match decoder.decode(&packet) {
                Ok(d) => d,
                Err(symphonia::core::errors::Error::DecodeError(msg)) => {
                    eprintln!("[Decode] Decode error (skipping): {}", msg);
                    continue;
                }
                Err(e) => {
                    eprintln!("[Decode] Fatal decode error: {}", e);
                    break;
                }
            };

            // Convert to interleaved f32
            let spec = *decoded.spec();
            let num_frames = decoded.frames();
            let num_channels = spec.channels.count();

            let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
            sample_buf.copy_interleaved_ref(decoded);
            let samples = sample_buf.samples();

            // Write to ring buffer (stereo interleaved)
            // If source is mono, duplicate to stereo
            // If source is stereo, write as-is
            // If source has more channels, take first two
            let mut i = 0;
            while i < samples.len() {
                if stop_flag.load(Ordering::Relaxed) {
                    return;
                }

                let (l, r) = if num_channels == 1 {
                    let s = samples[i];
                    i += 1;
                    (s, s)
                } else {
                    let l = samples[i];
                    let r = if i + 1 < samples.len() { samples[i + 1] } else { l };
                    i += num_channels;
                    (l, r)
                };

                // Try to push to ring buffer; if full, spin-wait briefly
                loop {
                    if stop_flag.load(Ordering::Relaxed) {
                        return;
                    }
                    if producer.try_push(l).is_ok() {
                        break;
                    }
                    thread::sleep(Duration::from_micros(500));
                }
                loop {
                    if stop_flag.load(Ordering::Relaxed) {
                        return;
                    }
                    if producer.try_push(r).is_ok() {
                        break;
                    }
                    thread::sleep(Duration::from_micros(500));
                }
            }
        }

        // Playback finished naturally — wait for ring buffer to drain
        // then signal end
        let mut drain_wait = 0;
        while !producer.is_empty() && drain_wait < 200 {
            if stop_flag.load(Ordering::Relaxed) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
            drain_wait += 1;
        }

        // Signal playback end
        playing.store(false, Ordering::SeqCst);
        if let Ok(mut st) = status.lock() {
            st.is_playing = false;
        }

        // Emit ended event to frontend safely
        let _ = app_handle.emit("audioplayer://ended", ());

        // Drop oboe stream, freeing hardware resources
        if let Some(mut stream) = oboe_stream_holder.take() {
            let _ = stream.stop();
        }
    }

    /// Prepare a stream (starts download if HTTP) without starting decoding.
    fn prepare_stream(url: &str) -> Option<(MediaSourceStream, Hint)> {
        let mut hint = Hint::new();
        let ext = url.rsplit('.').next().unwrap_or("").to_lowercase();
        let ext_clean = ext.split('?').next().unwrap_or(&ext);
        hint.with_extension(ext_clean);

        if url.starts_with("http://") || url.starts_with("https://") {
            let shared = Arc::new((
                Mutex::new(SharedStreamData {
                    buffer: Vec::new(),
                    is_eof: false,
                    has_error: false,
                }),
                Condvar::new(),
            ));

            let shared_clone = shared.clone();
            let url_string = url.to_string();
            let mut content_length = None;

            if let Ok(resp) = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap()
                .get(&url_string)
                .send()
            {
                if let Some(cl) = resp.content_length() {
                    content_length = Some(cl);
                }

                thread::spawn(move || {
                    let mut r = resp;
                    let mut chunk = [0u8; 32768];
                    loop {
                        match r.read(&mut chunk) {
                            Ok(0) => {
                                let (lock, cvar) = &*shared_clone;
                                let mut state = lock.lock().unwrap();
                                state.is_eof = true;
                                cvar.notify_all();
                                break;
                            }
                            Ok(n) => {
                                let (lock, cvar) = &*shared_clone;
                                let mut state = lock.lock().unwrap();
                                state.buffer.extend_from_slice(&chunk[0..n]);
                                cvar.notify_all();
                            }
                            Err(_) => {
                                let (lock, cvar) = &*shared_clone;
                                let mut state = lock.lock().unwrap();
                                state.has_error = true;
                                cvar.notify_all();
                                break;
                            }
                        }
                    }
                });
            } else {
                eprintln!("[AudioPlayer] Preload failed to start request");
                return None;
            }

            let stream = ProgressiveStream {
                shared,
                pos: 0,
                content_length,
            };

            Some((MediaSourceStream::new(Box::new(stream), Default::default()), hint))
        } else {
            // Local file
            match std::fs::read(url) {
                Ok(data) => {
                    let cursor = Cursor::new(data);
                    Some((MediaSourceStream::new(Box::new(cursor), Default::default()), hint))
                }
                Err(e) => {
                    eprintln!("[AudioPlayer] Failed to read local file: {}", e);
                    None
                }
            }
        }
    }
}

#[tauri::command]
pub fn play_audio(state: State<AudioState>, url: String) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::Play(url))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preload_audio(state: State<AudioState>, url: String) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::Preload(url))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pause_audio(state: State<AudioState>) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::Pause)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resume_audio(state: State<AudioState>) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::Resume)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_audio(state: State<AudioState>) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::Stop)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_volume(state: State<AudioState>, volume: f32) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::SetVolume(volume.clamp(0.0, 1.0)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn seek_audio(state: State<AudioState>, time: f32) -> Result<(), String> {
    state.command_tx.lock().unwrap()
        .send(AudioCommand::Seek(time))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_position(state: State<AudioState>) -> Result<f32, String> {
    let st = state.status.lock().map_err(|e| e.to_string())?;
    Ok(st.position_secs())
}

#[tauri::command]
pub fn get_duration(state: State<AudioState>) -> Result<f32, String> {
    let st = state.status.lock().map_err(|e| e.to_string())?;
    Ok(st.duration_secs)
}

#[tauri::command]
pub fn get_playback_state(state: State<AudioState>) -> Result<bool, String> {
    let st = state.status.lock().map_err(|e| e.to_string())?;
    // Return true while transitioning so JS timer won't fire false ENDED
    Ok(st.is_playing || st.is_transitioning)
}

#[tauri::command]
pub fn get_metadata(state: State<AudioState>) -> Result<Option<AudioMetadata>, String> {
    let st = state.status.lock().map_err(|e| e.to_string())?;
    Ok(st.metadata.clone())
}

#[tauri::command]
pub fn update_native_metadata(
    _app_handle: AppHandle,
    _title: String,
    _artist: String,
    _album: String,
    _cover_url: String,
) -> Result<(), String> {
    // Note: Native metadata updates are currently handled via JS IPC to NativeMediaPlugin.kt
    // This Rust command is a placeholder for future direct JNI integration if needed.
    Ok(())
}
