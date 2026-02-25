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
  private _timer: number | null = null;
  private _ended: boolean = false;
  private _unlistenEnded: UnlistenFn | null = null;

  constructor() {
    super();
  }

  public async init() {
    // 监听 Rust 发送的音频结束事件
    try {
      this._unlistenEnded = await listen("audioplayer://ended", () => {
        if (!this._switching) {
          this._ended = true;
          this._paused = true;
          this.stopTimer();
          this.dispatch(AUDIO_EVENTS.ENDED, undefined);
          this.syncNativeState();
        }
      });

      // 监听 Android 原生 MediaSession 事件
      await listen("plugin:NativeMedia|play", () => this.resume());
      await listen("plugin:NativeMedia|pause", () => this.pause());
      await listen("plugin:NativeMedia|next", () => {
        // 使用字符串直接分发，避开枚举带来的类型限制，
        // 同时在外部（PlayerController）监听这些自定义事件。
        this.dispatch("skip_next" as any, undefined);
      });
      await listen("plugin:NativeMedia|previous", () => {
        this.dispatch("skip_previous" as any, undefined);
      });
      await listen("plugin:NativeMedia|seek", (event: any) => {
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

  public async play(url?: string, options?: PlayOptions): Promise<void> {
    const shouldPlay = options?.autoPlay ?? true;
    if (url) {
      // 递增版本号，使旧的 play() 续体失效
      const gen = ++this._playGen;
      this._switching = true; // 进入切换状态，timer 期间跳过 ENDED 检测

      this._src = url;
      this._ended = false;
      this._currentTime = options?.seek ?? 0;
      this._duration = 0;
      this._metadata = null;

      // 先停止旧的定时器，避免旧歌状态轮询干扰新歌
      this.stopTimer();

      try {
        this.dispatch(AUDIO_EVENTS.LOAD_START, undefined);

        if (!shouldPlay) {
          this._paused = true;
          this._switching = false;
          // Dispatch CAN_PLAY to satisfy UI loading state
          this.dispatch(AUDIO_EVENTS.CAN_PLAY, undefined);
          return;
        }

        await invoke("play_audio", { url });

        // 如果在等待 play_audio 期间已经切歌，放弃
        if (gen !== this._playGen) return;

        // Fetch duration (symphonia parses metadata on decode start)
        await this._fetchDuration(gen);

        // 再次检查：_fetchDuration 耗时最长 4s，期间可能已切歌
        if (gen !== this._playGen) return;

        this._switching = false; // 新歌已就绪，允许 ENDED 检测
        this._paused = false;
        this.dispatch(AUDIO_EVENTS.CAN_PLAY, undefined);
        this.dispatch(AUDIO_EVENTS.PLAY, undefined);
        this.dispatch(AUDIO_EVENTS.PLAYING, undefined);

        this.startTimer();
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
      this.stopTimer();
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
      this._ended = false;
      this.startTimer();
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
    this._ended = false;
    this.stopTimer();
  }

  public seek(time: number): void {
    invoke("seek_audio", { time })
      .then(() => {
        this._currentTime = time;
        this._ended = false;
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

  public setReplayGain(_gain: number): void { }
  public setPitchShift(_semitones: number): void { }
  public setFilterGain(_index: number, _value: number): void { }
  public getFilterGains?(): number[] { return [] }
  public setHighPassFilter?(_frequency: number, _rampTime?: number): void { }
  public setHighPassQ?(_q: number): void { }
  public setLowPassFilter?(_frequency: number, _rampTime?: number): void { }
  public setLowPassQ?(_q: number): void { }
  public getFrequencyData?(): Uint8Array { return new Uint8Array(0) }
  public getLowFrequencyVolume?(): number { return 0 }
  public rampVolumeTo?(value: number, _duration: number, _curve?: any): void {
    this.setVolume(value);
  }
  public setSinkId(_deviceId: string): Promise<void> {
    return Promise.resolve();
  }

  // ========== Internal ==========

  /** 防止定时器 tick 并发执行（IPC 延迟可能超过 50ms） */
  private _tickBusy: boolean = false;

  /**
   * 定时轮询 Rust 后端获取播放进度和状态
   */
  private startTimer() {
    this.stopTimer();
    this._timer = window.setInterval(async () => {
      // 跳过本次 tick（上一次仍在执行中）
      if (this._tickBusy) return;
      this._tickBusy = true;
      try {
        // Get current position
        const time = await invoke<number>("get_position");
        this._currentTime = time;
        this.dispatch(AUDIO_EVENTS.TIME_UPDATE, undefined);

        // Check if playback ended naturally
        if (!this._ended && !this._paused && !this._switching) {
          const isPlaying = await invoke<boolean>("get_playback_state");
          if (!isPlaying && this._currentTime > 0) {
            this._ended = true;
            this._paused = true;
            this.stopTimer();
            this.dispatch(AUDIO_EVENTS.ENDED, undefined);
            this.syncNativeState();
            return;
          }
        }

        // 每 1s 同步一次进度到原生 MediaSession
        if (Math.floor(this._currentTime % 1) === 0) {
          this.syncNativeState();
        }
      } catch (_e) {
        // ignore polling errors
      } finally {
        this._tickBusy = false;
      }
    }, 50);
  }

  private stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * 异步获取音频时长（解码线程需要一点时间来解析元数据）
   * @param gen 播放版本号，用于检测是否已切歌
   */
  private async _fetchDuration(gen: number) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 200));
      // 等待期间已切歌，立即退出
      if (gen !== this._playGen) return;
      try {
        const dur = await invoke<number>("get_duration");
        if (gen !== this._playGen) return;
        if (dur > 0) {
          this._duration = dur;
          this.dispatch(AUDIO_EVENTS.DURATION_CHANGE, undefined);

          try {
            const meta = await invoke<any>("get_metadata");
            if (gen !== this._playGen) return;
            if (meta) {
              this._metadata = meta;
              this.syncNativeMetadata(meta);
              console.log("[NativePlayer] Metadata loaded:", meta);
            }
          } catch (e) {
            console.warn("[NativePlayer] Failed to fetch metadata", e);
          }
          return;
        }
      } catch (_e) {
        // ignore
      }
    }
  }

  // Optional methods stub
  private syncNativeState() {
    invoke("plugin:NativeMedia|updatePlaybackState", {
      isPlaying: !this._paused,
      position: Math.floor(this._currentTime * 1000),
      duration: Math.floor(this._duration * 1000),
    }).catch(() => { });
  }

  private syncNativeMetadata(meta: any) {
    if (!meta) return;
    invoke("plugin:NativeMedia|updateMetadata", {
      title: meta.title || "Unknown",
      artist: meta.artist || "Unknown",
      album: meta.album || "Unknown",
    }).catch(() => { });
  }
}
