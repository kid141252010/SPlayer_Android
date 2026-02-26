import { defineStore } from "pinia";
import type { SongType } from "@/types/main";
import { isElectron } from "@/utils/env";
import { cloneDeep } from "lodash-es";
import { SongLyric } from "@/types/lyric";

interface MusicState {
  playSong: SongType;
  playPlaylistId: number;
  songLyric: SongLyric;
  personalFM: {
    playIndex: number;
    list: SongType[];
  };
  dailySongsData: {
    timestamp: number | null;
    list: SongType[];
  };
}

// 默认音乐数据
const defaultMusicData: SongType = {
  id: 0,
  name: "未播放歌曲",
  artists: "未知歌手",
  album: "未知专辑",
  cover: "/images/song.jpg?asset",
  duration: 0,
  free: 0,
  mv: null,
  type: "song",
};

export const useMusicStore = defineStore("music", {
  state: (): MusicState => ({
    playSong: { ...defaultMusicData },
    playPlaylistId: 0,
    songLyric: {
      lrcData: [],
      yrcData: [],
    },
    personalFM: {
      playIndex: 0,
      list: [],
    },
    dailySongsData: {
      timestamp: null,
      list: [],
    },
  }),

  getters: {
    // 确保 id 始终为 number，解决 v-debounce 报错
    isHasPlayer: (state) => state.playSong.id !== 0,
    songCover: (state) => state.playSong.cover,
    isHasLrc: (state) => state.songLyric.lrcData.length > 0,
    isHasYrc: (state) => state.songLyric.yrcData.length > 0,

    /**
     * 🌟 关键修复：确保私人 FM 歌曲永远不为 null
     * 这样组件里的 musicStore.personalFMSong.album 就不会报“可能为 null”了
     */
    personalFMSong: (state): SongType => {
      return state.personalFM.list[state.personalFM.playIndex] || { ...defaultMusicData };
    },

    /**
     * 获取指定尺寸的封面
     * 🌟 修复：使用了 size 参数，解决“declared but never read”报错
     */
    getSongCover:
      (state) =>
      (size: string = "m") => {
        let cover = state.playSong.cover;
        if (!cover || cover.includes("?asset")) return cover;

        // 根据 size 参数进行简单的处理（如果需要网易云图片压缩可以加在这里）
        const suffix = size === "s" ? "120" : size === "m" ? "300" : "500";
        if (cover.includes("music.126.net")) {
          return `${cover}?param=${suffix}y${suffix}`;
        }
        return cover;
      },
  },

  actions: {
    setPlaySong(song: SongType) {
      this.playSong = { ...song };

      const nav = navigator as any;
      if (nav && nav.mediaSession) {
        const artistName = Array.isArray(song.artists)
          ? song.artists.map((a: any) => (typeof a === "string" ? a : a.name)).join("/")
          : String(song.artists || "未知歌手");

        if ((window as any).MediaMetadata) {
          nav.mediaSession.metadata = new (window as any).MediaMetadata({
            title: song.name,
            artist: artistName,
            album: song.album || "SPlayer",
            artwork: [{ src: song.cover, sizes: "512x512", type: "image/png" }],
          });
        }
        this.initMediaHandlers();
      }

      this.setSongLyric({ lrcData: [], yrcData: [] }, true);
      if (isElectron) {
        window.electron.ipcRenderer.send("play-song-change", null);
      }
    },

    resetMusicData() {
      this.playSong = { ...defaultMusicData };
      this.playPlaylistId = 0;
      this.setSongLyric({ lrcData: [], yrcData: [] }, true);
    },

    initMediaHandlers() {
      const nav = navigator as any;
      if (!nav || !nav.mediaSession) return;

      const handlers = [
        ["play", ".icon-play, .btn-play"],
        ["pause", ".icon-pause, .btn-pause"],
        ["previoustrack", ".icon-prev, .btn-prev"],
        ["nexttrack", ".icon-next, .btn-next"],
      ];

      handlers.forEach(([action, selector]) => {
        try {
          nav.mediaSession.setActionHandler(action as any, () => {
            const el = document.querySelector(selector) as HTMLElement;
            if (el) el.click();
          });
        } catch (e) {}
      });
    },

    setSongLyric(updates: Partial<SongLyric>, replace: boolean = false) {
      if (replace) {
        this.songLyric = {
          lrcData: updates.lrcData ?? [],
          yrcData: updates.yrcData ?? [],
        };
      } else {
        this.songLyric = {
          lrcData: updates.lrcData ?? this.songLyric.lrcData,
          yrcData: updates.yrcData ?? this.songLyric.yrcData,
        };
      }
      if (isElectron) {
        window.electron.ipcRenderer.send(
          "play-lyric-change",
          cloneDeep({
            songId: this.playSong?.id,
            lyricLoading: false,
            lrcData: this.songLyric.lrcData ?? [],
            yrcData: this.songLyric.yrcData ?? [],
          }),
        );
      }
    },
  },
});
