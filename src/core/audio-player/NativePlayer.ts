import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TypedEventTarget } from "@/utils/TypedEventTarget";
import {
  type IPlaybackEngine,
  type PlayOptions,
  type PauseOptions,
  type EngineCapabilities,
} from "./IPlaybackEngine";
import { AUDIO_EVENTS, type AudioEventMap } from "./BaseAudioPlayer";

/**
 * 原生播放器 (Android)
 *
 * 通过 Tauri IPC 调用 Rust 后端的 Oboe/OpenSL ES 音频引擎。
 * 解码由 Symphonia (纯 Rust) 完成，输出由 Oboe 驱动。
 */
export class NativePlayer extends TypedEventTarget<AudioEventMap> implements IPlaybackEngine {
  public readonly capabilities: EngineCapabilities = {
    supportsSpectrum: false,
    supportsEqualizer: false,
    supportsSinkId: false,
    supportsRate: false,
  };

  private _src: string = "";
  private _volume: number = 1.0;
  private _duration: number = 0;
  private _metadata: any = null;
  private _currentTime: number = 0;
  private _paused: boolean = true;
  private _unlistenEnded: UnlistenFn | null = null;
  private _initialized: boolean = false;

  constructor() {
    super();
  }

  public async init() {
    if (this._initialized) return;
    this._initialized = true;

    // 监听 Rust 发送的音频结束事件
    try {
      this._unlistenEnded = await listen("audioplayer://ended", () => {
        if (!this._switching) {
          this._paused = true;
          this.dispatch(AUDIO_EVENTS.ENDED, undefined);
          this.syncNativeState();
        }
      });

      // 监听进度事件 (取代轮询)
      await listen<{ position: number; duration: number }>("audioplayer://progress", (event) => {
        this._currentTime = event.payload.position;
        this._duration = event.payload.duration;
        this.dispatch(AUDIO_EVENTS.TIME_UPDATE, undefined);

        // 每 1s 同步一次进度到原生 MediaSession
        if (Math.floor(this._currentTime) !== Math.floor(this._lastSyncTime)) {
          this._lastSyncTime = this._currentTime;
          this.syncNativeState();
        }
      });

      // 监听元数据事件 (取代轮询)
      await listen<{ duration: number; title: string; artist: string; album: string }>(
        "audioplayer://metadata",
        (event) => {
          const meta = event.payload;
          this._duration = meta.duration;
          this._metadata = meta;
          this.dispatch(AUDIO_EVENTS.DURATION_CHANGE, undefined);
          this.syncNativeMetadata(meta);
          console.log("[NativePlayer] Metadata Event received:", meta);
        },
      );

      // 监听 Android 原生 MediaSession 事件
      await listen("plugin:NativeMediaPlugin|play", () => this.resume());
      await listen("plugin:NativeMediaPlugin|pause", () => this.pause());
      await listen("plugin:NativeMediaPlugin|next", () => {
        this.dispatch("skip_next" as any, undefined);
      });
      await listen("plugin:NativeMediaPlugin|previous", () => {
        this.dispatch("skip_previous" as any, undefined);
      });
      await listen("plugin:NativeMediaPlugin|seek", (event: any) => {
        const pos = event.payload?.position || 0;
        this.seek(pos / 1000); // 毫秒转秒
      });
    } catch (e) {
      console.error("[NativePlayer] failed to listen to events:", e);
    }
  }

  public destroy() {
    this.stop();
    if (this._unlistenEnded) {
      this._unlistenEnded();
      this._unlistenEnded = null;
    }
  }

  /** 每次 play(url) 递增，用于取消过期的异步续体 */
  private _playGen: number = 0;
  /** 切歌进行中（play_audio 已发送但新歌尚未开始）— 跳过 ENDED 检测 */
  private _switching: boolean = false;
  /** 上次同步 MediaSession 的时间 */
  private _lastSyncTime: number = 0;

  public async play(url?: string, options?: PlayOptions): Promise<void> {
    const shouldPlay = options?.autoPlay ?? true;
    if (url) {
      // 递增版本号，使旧的 play() 续体失效
      const gen = ++this._playGen;
      this._switching = true; // 进入切换状态，期间跳过 ENDED 检测

      this._currentTime = options?.seek ?? 0;
      this._duration = 0;
      this._metadata = null;

      try {
        this.dispatch(AUDIO_EVENTS.LOAD_START, undefined);

        await invoke("play_audio", { url, paused: !shouldPlay });

        // 如果在等待 play_audio 期间已经切歌，放弃
        if (gen !== this._playGen) return;

        this._switching = false; // 新歌已就绪，允许 ENDED 检测
        this._paused = !shouldPlay;
        this.dispatch(AUDIO_EVENTS.CAN_PLAY, undefined);

        if (shouldPlay) {
          this.dispatch(AUDIO_EVENTS.PLAY, undefined);
          this.dispatch(AUDIO_EVENTS.PLAYING, undefined);
        }
      } catch (e) {
        if (gen !== this._playGen) return; // 切歌后的错误忽略
        console.error("[NativePlayer] play failed:", e);
        this.dispatch(AUDIO_EVENTS.ERROR, { errorCode: 1, message: String(e) });
      }
    } else {
      await this.resume();
    }
  }

  public async pause(_options?: PauseOptions): Promise<void> {
    try {
      await invoke("pause_audio");
      this._paused = true;
      this.dispatch(AUDIO_EVENTS.PAUSE, undefined);
      this.syncNativeState();
    } catch (e) {
      console.error("[NativePlayer] pause failed:", e);
    }
  }

  public async resume(_options?: { fadeIn?: boolean }): Promise<void> {
    try {
      await invoke("resume_audio");
      this._paused = false;
      this.dispatch(AUDIO_EVENTS.PLAY, undefined);
      this.dispatch(AUDIO_EVENTS.PLAYING, undefined);
      this.syncNativeState();
    } catch (e) {
      console.error("[NativePlayer] resume failed:", e);
    }
  }

  public stop(): void {
    this._switching = true;
    invoke("stop_audio").catch(console.error);
    this._paused = true;
    this._currentTime = 0;
    this._duration = 0;
    this._metadata = null;
  }

  public seek(time: number): void {
    invoke("seek_audio", { time })
      .then(() => {
        this._currentTime = time;
        this.dispatch(AUDIO_EVENTS.TIME_UPDATE, undefined);
        this.syncNativeState();
      })
      .catch(console.error);
  }

  public setVolume(volume: number): void {
    this._volume = volume;
    invoke("set_volume", { volume }).catch(console.error);
  }

  public preload(url: string): void {
    invoke("preload_audio", { url }).catch(console.error);
  }

  public getVolume(): number {
    return this._volume;
  }

  public setRate(_rate: number): void {
    // Not implemented in Oboe backend yet
  }

  public getRate(): number {
    return 1.0;
  }

  public get duration(): number {
    return this._duration;
  }

  public get metadata(): any {
    return this._metadata;
  }

  public get currentTime(): number {
    return this._currentTime;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public get src(): string {
    return this._src;
  }

  public getErrorCode(): number {
    return 0;
  }

  public setReplayGain(_gain: number): void {}
  public setPitchShift(_semitones: number): void {}
  public setFilterGain(_index: number, _value: number): void {}
  public getFilterGains?(): number[] {
    return [];
  }
  public setHighPassFilter?(_frequency: number, _rampTime?: number): void {}
  public setHighPassQ?(_q: number): void {}
  public setLowPassFilter?(_frequency: number, _rampTime?: number): void {}
  public setLowPassQ?(_q: number): void {}
  public getFrequencyData?(): Uint8Array {
    return new Uint8Array(0);
  }
  public getLowFrequencyVolume?(): number {
    return 0;
  }
  public rampVolumeTo?(value: number, _duration: number, _curve?: any): void {
    this.setVolume(value);
  }
  public setSinkId(_deviceId: string): Promise<void> {
    return Promise.resolve();
  }

  // ========== Internal ==========

  // (Removed _tickBusy, _timer, startTimer, stopTimer, _fetchDuration)
  private syncNativeState() {
    invoke("plugin:NativeMediaPlugin|updatePlaybackState", {
      isPlaying: !this._paused,
      position: Math.floor(this._currentTime * 1000),
      duration: Math.floor(this._duration * 1000),
    }).catch(() => {});
  }

  private syncNativeMetadata(meta: any) {
    if (!meta) return;
    invoke("plugin:NativeMediaPlugin|updateMetadata", {
      title: meta.title || "Unknown",
      artist: meta.artist || "Unknown",
      album: meta.album || "Unknown",
    }).catch(() => {});
  }
}
