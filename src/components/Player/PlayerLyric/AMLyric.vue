<template>
  <div
    :class="[
      'lyric-am',
      {
        pure: statusStore.pureLyricMode,
        duet: hasDuet,
        'align-right': settingStore.lyricAlignRight,
      },
    ]"
    :style="{
      '--amll-lp-color': 'rgb(var(--main-cover-color, 239 239 239))',
      '--amll-lp-hover-bg-color': statusStore.playerMetaShow
        ? 'rgba(var(--main-cover-color), 0.08)'
        : 'transparent',
      '--amll-lyric-left-padding': settingStore.lyricAlignRight
        ? ''
        : `${settingStore.lyricHorizontalOffset}px`,
      '--amll-lyric-right-padding': settingStore.lyricAlignRight
        ? `${settingStore.lyricHorizontalOffset}px`
        : '',
    }"
    @touchstart="handleInteractionStart"
    @touchmove="handleInteractionMove"
    @touchend="handleInteractionEnd"
    @mousedown="handleInteractionStart"
    @mousemove="handleInteractionMove"
    @mouseup="handleInteractionEnd"
  >
    <div v-show="statusStore.lyricLoading" class="lyric-loading">歌词正在加载中...</div>
    <LyricPlayer
      v-show="!statusStore.lyricLoading"
      ref="lyricPlayerRef"
      :lyricLines="amLyricsData"
      :currentTime="currentTime"
      :playing="statusStore.playStatus"
      :enableSpring="settingStore.useAMSpring"
      :enableScale="settingStore.useAMSpring"
      :alignPosition="settingStore.lyricsScrollOffset"
      :alignAnchor="settingStore.lyricsScrollOffset > 0.4 ? 'center' : 'top'"
      :enableBlur="settingStore.lyricsBlur && !isManualScrolling"
      :hidePassedLines="settingStore.hidePassedLines"
      :wordFadeWidth="settingStore.wordFadeWidth"
      :style="{
        '--display-count-down-show': settingStore.countDownShow ? 'flex' : 'none',
        '--amll-lp-font-size': getFontSize(
          settingStore.lyricFontSize,
          settingStore.lyricFontSizeMode,
        ),
        'font-weight': settingStore.lyricFontWeight,
        'font-family': settingStore.LyricFont !== 'follow' ? settingStore.LyricFont : '',
        ...lyricLangFontStyle(settingStore),
      }"
      class="am-lyric"
      @line-click="jumpSeek"
    />
  </div>
</template>

<script setup lang="ts">
import { LyricLineMouseEvent, type LyricLine } from "@applemusic-like-lyrics/core";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { getLyricLanguage } from "@/utils/format";
import { usePlayerController } from "@/core/player/PlayerController";

import { lyricLangFontStyle } from "@/utils/lyric/lyricFontConfig";
import { getFontSize } from "@/utils/style";

defineProps({
  currentTime: {
    type: Number,
    default: 0,
  },
});

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const player = usePlayerController();

const lyricPlayerRef = ref<any | null>(null);

// 手动翻滚状态
const isManualScrolling = ref(false);
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

const handleInteractionStart = () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  isManualScrolling.value = true;
};

const handleInteractionMove = () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  isManualScrolling.value = true;
};

const handleInteractionEnd = () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    isManualScrolling.value = false;
  }, 2000);
};

// 当前歌词数据缓存，使用 shallowRef 避免深度响应
const amLyricsData = shallowRef<LyricLine[]>([]);

// 内部维护歌词数据的缓存，用于比较是否真正变化
let cachedLyricsData: LyricLine[] = [];

// 更新歌词数据（只在真正变化时才更新）
const updateAmLyricsData = () => {
  const { songLyric } = musicStore;
  if (!songLyric) {
    if (cachedLyricsData.length !== 0) {
      cachedLyricsData = [];
      amLyricsData.value = [];
    }
    return;
  }

  const useYrc = songLyric.yrcData?.length && settingStore.showYrc;
  const rawLyrics = useYrc ? songLyric.yrcData : songLyric.lrcData;
  if (!Array.isArray(rawLyrics) || rawLyrics.length === 0) {
    if (cachedLyricsData.length !== 0) {
      cachedLyricsData = [];
      amLyricsData.value = [];
    }
    return;
  }

  const { showTran, showRoma, showWordsRoma, swapTranRoma, lyricAlignRight } = settingStore;

  // 这里的处理逻辑进行了优化，仅在必要时进行深度拷贝和属性处理
  const processedLyrics = rawLyrics.map((line) => {
    // 浅层拷贝行，深层拷贝 words（如果存在且需要修改）
    const processedLine = { ...line };

    // 处理显隐和位置调换
    if (!showTran) processedLine.translatedLyric = "";
    if (!showRoma) processedLine.romanLyric = "";

    if (swapTranRoma) {
      const temp = processedLine.translatedLyric;
      processedLine.translatedLyric = processedLine.romanLyric;
      processedLine.romanLyric = temp;
    }

    if (lyricAlignRight) {
      processedLine.isDuet = !processedLine.isDuet;
    }

    if (processedLine.words) {
      processedLine.words = processedLine.words.map((word) => {
        const processedWord = { ...word };
        if (!showWordsRoma) processedWord.romanWord = "";
        return processedWord;
      });
    }

    return processedLine as LyricLine;
  });

  // 只有当数据真正变化时才更新
  if (cachedLyricsData !== processedLyrics) {
    cachedLyricsData = processedLyrics;
    amLyricsData.value = processedLyrics;
  }
};

// 使用 watch 监听需要变化的数据，避免 computed 被频繁触发
watch(
  () => [
    musicStore.songLyric?.yrcData?.length,
    musicStore.songLyric?.lrcData?.length,
    settingStore.showYrc,
    settingStore.showTran,
    settingStore.showRoma,
    settingStore.showWordsRoma,
    settingStore.swapTranRoma,
    settingStore.lyricAlignRight,
  ],
  () => {
    updateAmLyricsData();
  },
  { deep: false, immediate: true },
);

// 监听歌曲切换，强制更新
watch(
  () => musicStore.playSong?.id,
  () => {
    // 清空缓存，强制更新
    cachedLyricsData = [];
    updateAmLyricsData();
  },
);

// 是否有对唱行 - 使用 getter 函数访问 value
const hasDuet = computed(() => amLyricsData.value?.some((line) => line.isDuet) ?? false);

// 进度跳转
const jumpSeek = (line: LyricLineMouseEvent) => {
  const lineContent = line.line.getLine();
  if (!lineContent?.startTime) return;
  const time = lineContent.startTime;
  const offsetMs = statusStore.getSongOffset(musicStore.playSong?.id);
  const globalOffset = settingStore.lyricOffset || 0;
  player.setSeek(time - offsetMs - globalOffset);
  player.play();
};

// 处理歌词语言
const processedElements = new WeakSet();

const processLyricLanguage = (player = lyricPlayerRef.value) => {
  if (typeof window.requestIdleCallback !== "function") return;

  window.requestIdleCallback(() => {
    const lyricLineObjects = player?.lyricPlayer?.currentLyricLineObjects;
    if (!Array.isArray(lyricLineObjects) || lyricLineObjects.length === 0) return;

    // 批量处理，减少单次任务耗时
    for (let e of lyricLineObjects) {
      if (!e.element?.firstChild || processedElements.has(e.element)) continue;

      const content = e.lyricLine.words.map((word: any) => word.word).join("");
      if (!content) continue;

      const lang = getLyricLanguage(content);
      if (e.element.firstChild.getAttribute("lang") !== lang) {
        e.element.firstChild.setAttribute("lang", lang);
      }
      processedElements.add(e.element);
    }
  });
};

// 切换歌曲时处理歌词语言
watch(
  () => musicStore.playSong?.id,
  () => {
    // 歌曲切换时清空已处理标记
    processedElements.delete(lyricPlayerRef.value?.lyricPlayer?.currentLyricLineObjects); // WeakSet doesn't support clear, but we can rely on GC or just reset
  },
);

// 歌词数据变化时处理语言（使用 shallowRef 的监听方式）
watch(
  () => amLyricsData.value,
  (data) => {
    if (data?.length) nextTick(() => processLyricLanguage());
  },
);
watch(lyricPlayerRef, (player) => {
  if (player) nextTick(() => processLyricLanguage(player));
});
</script>

<style lang="scss" scoped>
.lyric-am {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  isolation: isolate;

  :deep(.am-lyric) {
    width: 100%;
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    padding-left: var(--amll-lyric-left-padding, 10px);
    padding-right: 80px;
    div {
      div[class^="_interludeDots"] {
        display: var(--display-count-down-show);
      }
    }
    @media (max-width: 990px) {
      padding: 0;
      margin-left: 0;
      .amll-lyric-player {
        > div {
          padding-left: 10px;
          padding-right: 10px;
        }
      }
    }
  }

  &.align-right {
    :deep(.am-lyric) {
      padding-left: 80px;
      padding-right: var(--amll-lyric-right-padding, 10px);

      @media (max-width: 990px) {
        padding: 0;
        margin-right: -20px;
      }
      @media (max-width: 500px) {
        margin-right: 0;
      }
    }
  }
  &.pure {
    &:not(.duet) {
      text-align: center;

      :deep(.am-lyric) div {
        transform-origin: center;
      }
    }

    :deep(.am-lyric) {
      margin: 0;
      padding: 0 80px;
    }
  }

  /* 调亮基础歌词颜色，提高非活动行的可见度 */
  :deep(.am-lyric .lyric-line) {
    color: rgba(255, 255, 255, 0.85);
    transition: color 0.3s ease;
  }

  /* 保持当前行纯白高亮，并适当增强发光感 */
  :deep(.am-lyric .current),
  :deep(.am-lyric .is-current),
  :deep(.am-lyric .active),
  :deep(.am-lyric .is-active),
  :deep(.am-lyric .lyric-line.current),
  :deep(.am-lyric .lyric-line.is-current) {
    color: #ffffff !important;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    /* 告诉浏览器该元素可能会变化，优化渲染（强制开启硬件加速） */
    will-change: transform, opacity, color;
    transform: translateZ(0);
  }

  /* 只对主歌词文本（非翻译/音译）启用平滑 */
  :deep(.am-lyric [lang]) {
    -webkit-font-smoothing: antialiased;
  }

  :deep(.am-lyric div[class*="lyricMainLine"] span) {
    text-align: start;
  }

  :lang(ja) {
    font-family: var(--ja-font-family);
  }
  :lang(en) {
    font-family: var(--en-font-family);
  }
  :lang(ko) {
    font-family: var(--ko-font-family);
  }
}

.lyric-loading {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--amll-lp-color, #efefef);
  font-size: 22px;
}
</style>
