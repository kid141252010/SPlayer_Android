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

// 当前歌词
const amLyricsData = computed(() => {
  const { songLyric } = musicStore;
  if (!songLyric) return [];
  // 优先使用逐字歌词(YRC/TTML)
  const useYrc = songLyric.yrcData?.length && settingStore.showYrc;
  const lyrics = useYrc ? songLyric.yrcData : songLyric.lrcData;
  // 简单检查歌词有效性
  if (!Array.isArray(lyrics) || lyrics.length === 0) return [];
  // 此处使用 map 和 spread 运算符替代 cloneDeep 以显著提升长歌词处理性能
  // 注意：AMLL 库可能会修改对象属性，故必须进行深度克隆
  const clonedLyrics = lyrics.map((line) => ({
    ...line,
    words: line.words?.map((word) => ({ ...word })),
  })) as LyricLine[];
  // 处理歌词内容
  const { showTran, showRoma, showWordsRoma, swapTranRoma, lyricAlignRight } = settingStore;
  clonedLyrics.forEach((line) => {
    // 处理显隐
    if (!showTran) line.translatedLyric = "";
    if (!showRoma) line.romanLyric = "";
    if (!showWordsRoma) line.words?.forEach((word) => (word.romanWord = ""));
    // 调换翻译与音译位置
    if (swapTranRoma) {
      const temp = line.translatedLyric;
      line.translatedLyric = line.romanLyric;
      line.romanLyric = temp;
    }
    // 处理对唱方向反转
    if (lyricAlignRight) {
      line.isDuet = !line.isDuet;
    }
  });
  return clonedLyrics;
});

// 是否有对唱行
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
const processLyricLanguage = (player = lyricPlayerRef.value) => {
  if (typeof window.requestIdleCallback !== "function") return;

  window.requestIdleCallback(() => {
    const lyricLineObjects = player?.lyricPlayer?.currentLyricLineObjects;
    if (!Array.isArray(lyricLineObjects) || lyricLineObjects.length === 0) {
      return;
    }
    // 遍历歌词行
    for (let e of lyricLineObjects) {
      if (!e.element?.firstChild) continue;
      // 获取歌词行内容 (合并逐字歌词为一句)
      const content = e.lyricLine.words.map((word: any) => word.word).join("");
      // 跳过空行
      if (!content) continue;
      // 获取歌词语言
      const lang = getLyricLanguage(content);
      // 为主歌词设置 lang 属性 (firstChild 获取主歌词 不为翻译和音译设置属性)
      // 仅在属性不一致时更新，减少 DOM 操作
      if (e.element.firstChild.getAttribute("lang") !== lang) {
        e.element.firstChild.setAttribute("lang", lang);
      }
    }
  });
};

// 切换歌曲时处理歌词语言
watch(amLyricsData, (data) => {
  if (data) nextTick(() => processLyricLanguage());
});
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
          padding-left:10px;
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
    text-shadow: 0 0 20px rgba(255, 255, 255, 0.2), 0 4px 18px rgba(0, 0, 0, 0.35);
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
