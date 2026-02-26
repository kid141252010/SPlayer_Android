<template>
  <div class="full-player-mobile" ref="mobileStart">
    <!-- 顶部信息栏：作为下拉关闭手势的触发区域 -->
    <div class="top-bar" ref="topBarRef"></div>

    <!-- 主内容 -->
    <div
      :class="['mobile-content', { swiping: isSwiping }]"
      :style="{ transform: contentTransform }"
      @click.stop
    >
      <!-- 歌曲信息页 -->
      <div class="page info-page">
        <!-- 封面 -->
        <div class="cover-section">
          <PlayerCover :no-lyric="true" />
        </div>

        <!-- 歌曲信息区域 -->
        <div class="info-group">
          <!-- 歌曲信息与操作 -->
          <div class="song-info-bar">
            <div class="info-section">
              <PlayerData :center="false" :light="false" class="mobile-data" />
            </div>
            <div class="info-actions">
              <!-- 添加到歌单 -->
              <div
                class="action-btn"
                @click.stop="openPlaylistAdd([musicStore.playSong], !!musicStore.playSong.path)"
              >
                <SvgIcon name="AddList" :size="26" />
              </div>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="progress-section">
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[0] }}</span>
            <PlayerSlider class="player" :show-tooltip="false" />
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[1] }}</span>
          </div>

          <!-- 主控制按钮 -->
          <div class="control-section">
            <!-- 随机模式 -->
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleShuffle()">
                <SvgIcon
                  :name="statusStore.shuffleIcon"
                  :size="24"
                  :depth="statusStore.shuffleMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>

            <!-- 上一曲 -->
            <div class="ctrl-btn" @click.stop="player.nextOrPrev('prev')">
              <SvgIcon name="SkipPrev" :size="36" />
            </div>

            <!-- 播放/暂停 -->
            <n-button
              :loading="statusStore.playLoading"
              class="play-btn"
              type="primary"
              strong
              secondary
              circle
              @click.stop="player.playOrPause()"
            >
              <template #icon>
                <Transition name="fade" mode="out-in">
                  <SvgIcon
                    :key="statusStore.playStatus ? 'Pause' : 'Play'"
                    :name="statusStore.playStatus ? 'Pause' : 'Play'"
                    :size="40"
                  />
                </Transition>
              </template>
            </n-button>

            <!-- 下一曲 -->
            <div class="ctrl-btn" @click.stop="player.nextOrPrev('next')">
              <SvgIcon name="SkipNext" :size="36" />
            </div>

            <!-- 循环模式 -->
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleRepeat()">
                <SvgIcon
                  :name="statusStore.repeatIcon"
                  :size="24"
                  :depth="statusStore.repeatMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>
          </div>
        </div>
      </div>

      <!-- 歌词页 -->
      <div class="page lyric-page">
        <div class="lyric-header" ref="lyricHeaderRef">
          <s-image :src="musicStore.getSongCover('s')" class="lyric-cover" />
          <div class="lyric-info">
            <TextContainer class="name">
              {{
                settingStore.hideBracketedContent
                  ? removeBrackets(musicStore.playSong.name)
                  : musicStore.playSong.name
              }}
            </TextContainer>
            <TextContainer class="artist">{{ artistName }}</TextContainer>
          </div>
        </div>
        <div class="lyric-main">
          <PlayerLyric />
        </div>
      </div>
    </div>

    <!-- 页面指示器 -->
    <div class="pagination" v-if="hasLyric">
      <div
        v-for="i in 2"
        :key="i"
        :class="['dot', { active: pageIndex === i - 1 }]"
        @click="pageIndex = i - 1"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSwipe } from "@vueuse/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMusicStore, useStatusStore, useSettingStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { useTimeFormat } from "@/composables/useTimeFormat";
// toLikeSong removed
import { openPlaylistAdd } from "@/utils/modal";
import { removeBrackets } from "@/utils/format";
import { useDragClose } from "@/composables/useDragClose";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const player = usePlayerController();
const { timeDisplay, toggleTimeFormat } = useTimeFormat();

const mobileStart = ref<HTMLElement | null>(null);
const topBarRef = ref<HTMLElement | null>(null);
const lyricHeaderRef = ref<HTMLElement | null>(null);
const pageIndex = ref(1);
let unlistenBack: UnlistenFn | null = null;

const hasLyric = computed(() => {
  return musicStore.isHasLrc && musicStore.playSong.type !== "radio";
});

const artistName = computed(() => {
  const artists = musicStore.playSong.artists;
  if (Array.isArray(artists)) {
    return artists.map((ar) => ar.name).join(" / ");
  }
  return (artists as string) || "未知艺术家";
});

// 没有歌词强制回到第一页
watch(hasLyric, (val) => {
  if (!val) pageIndex.value = 0;
});

// 滑动偏移量
const CLOSE_THRESHOLD = 120; // px 下拉距离触发关闭

// 使用共享的下拉关闭状态（应用到父容器 FullPlayer.vue）
const { verticalDragOffset, isSpringback } = useDragClose();

// 下拉关闭状态
const isDraggingClose = ref(false);

// 动画滑出后关闭
const closePlayerWithAnimation = async () => {
  isDraggingClose.value = false;
  isSpringback.value = true;
  // 快速滑出屏幕
  verticalDragOffset.value = window.innerHeight;
  await new Promise((r) => setTimeout(r, 200));
  // 先重置状态再关闭（避免在卸载后操作状态）
  verticalDragOffset.value = 0;
  isSpringback.value = false;
  statusStore.showFullPlayer = false;
};

// 弹回原位
let _springbackTimer: ReturnType<typeof setTimeout> | null = null;
const springback = () => {
  if (_springbackTimer) clearTimeout(_springbackTimer);
  isDraggingClose.value = false;
  isSpringback.value = true;
  verticalDragOffset.value = 0;
  _springbackTimer = setTimeout(() => {
    isSpringback.value = false;
    _springbackTimer = null;
  }, 300);
};

const swipeOffset = ref(0);

// 判断触点是否在顶部信息栏区域内（top-bar 或 lyric-header）
const isTouchInTopArea = (touch: Touch): boolean => {
  const topBar = topBarRef.value;
  const lyricHeader = lyricHeaderRef.value;
  if (topBar) {
    const r = topBar.getBoundingClientRect();
    if (
      touch.clientX >= r.left &&
      touch.clientX <= r.right &&
      touch.clientY >= r.top &&
      touch.clientY <= r.bottom
    )
      return true;
  }
  if (lyricHeader) {
    const r = lyricHeader.getBoundingClientRect();
    if (
      touch.clientX >= r.left &&
      touch.clientX <= r.right &&
      touch.clientY >= r.top &&
      touch.clientY <= r.bottom
    )
      return true;
  }
  return false;
};

// 记录本次拖拽是否从顶部区域开始
const _dragStartedInTopArea = ref(false);

const { direction, isSwiping, lengthX, lengthY } = useSwipe(mobileStart, {
  threshold: 10,
  onSwipeStart: (e) => {
    // 判断起始触点是否在顶部区域
    const touch = e.touches?.[0] ?? e.changedTouches?.[0];
    _dragStartedInTopArea.value = touch ? isTouchInTopArea(touch) : false;
  },
  onSwipe: () => {
    // 已确认为下拉关闭手势
    if (isDraggingClose.value) {
      const dy = Math.max(0, -lengthY.value);
      // 超过一定距离增加阻力，但不完全阻止
      verticalDragOffset.value = dy < 300 ? dy : 300 + (dy - 300) * 0.2;
      return;
    }
    // 已确认为水平翻页手势
    if (swipeOffset.value !== 0) {
      if (!hasLyric.value) return;
      swipeOffset.value = lengthX.value;
      return;
    }
    // 首次移动时判断主轴方向
    const absX = Math.abs(lengthX.value);
    const absY = Math.abs(lengthY.value);
    if (absY > absX && lengthY.value < 0 && _dragStartedInTopArea.value) {
      // 主轴向下且从顶部区域开始：触发关闭手势
      isDraggingClose.value = true;
      verticalDragOffset.value = Math.max(0, -lengthY.value);
    } else if (hasLyric.value && !(absY > absX && _dragStartedInTopArea.value)) {
      // 主轴水平：翻页
      swipeOffset.value = lengthX.value;
    }
  },
  onSwipeEnd: () => {
    if (isDraggingClose.value) {
      if (-lengthY.value > CLOSE_THRESHOLD) {
        closePlayerWithAnimation();
      } else {
        springback();
      }
      swipeOffset.value = 0;
      return;
    }
    if (!hasLyric.value) {
      swipeOffset.value = 0;
      return;
    }
    // 超过阈值则切换页面 (调高阈值避免误触发)
    if (direction.value === "left" && lengthX.value > 160) {
      pageIndex.value = 1;
    } else if (direction.value === "right" && lengthX.value < -160) {
      pageIndex.value = 0;
    }
    swipeOffset.value = 0;
  },
});

// 计算实时的变换位置
const contentTransform = computed(() => {
  const baseOffset = pageIndex.value * 50; // 百分比
  // 下拉手势时不做水平移动
  if (!isSwiping.value || !hasLyric.value || isDraggingClose.value) {
    return `translateX(-${baseOffset}%)`;
  }
  let pixelOffset = lengthX.value;
  // 限制滑动范围
  if (pageIndex.value === 0 && pixelOffset < 0) {
    pixelOffset = pixelOffset * 0.3;
  }
  if (pageIndex.value === 1 && pixelOffset > 0) {
    pixelOffset = pixelOffset * 0.3;
  }
  return `translateX(calc(-${baseOffset}% - ${pixelOffset}px))`;
});

// 监听 Android 返回键
onMounted(async () => {
  try {
    unlistenBack = await listen("tauri://back-button", () => {
      if (statusStore.showFullPlayer) {
        closePlayerWithAnimation();
      }
    });
  } catch (e) {
    console.error("Failed to listen to back button:", e);
  }
});

// 组件卸载时清理弹回定时器和返回键监听
onBeforeUnmount(() => {
  if (_springbackTimer) {
    clearTimeout(_springbackTimer);
    _springbackTimer = null;
  }
  if (unlistenBack) {
    unlistenBack();
    unlistenBack = null;
  }
});
</script>

<style lang="scss" scoped>
.full-player-mobile {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  .top-bar {
    position: absolute;
    width: 100%;
    height: calc(60px + env(safe-area-inset-top));
    padding-top: env(safe-area-inset-top);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-left: 24px;
    padding-right: 24px;
    z-index: 10;
    .btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;
      flex-shrink: 0;
      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
      .n-icon {
        color: rgb(var(--main-cover-color));
        opacity: 0.8;
      }
    }
  }
  .mobile-content {
    flex: 1;
    display: flex;
    width: 200%;
    height: 100%;
    will-change: transform;
    transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    &.swiping {
      transition: none;
    }
    .page {
      width: 50%;
      height: 100%;
      flex-shrink: 0;
      position: relative;
    }
    .info-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 24px 40px 24px;
      overflow-y: auto;
      .cover-section {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: calc(60px + env(safe-area-inset-top));
        margin-bottom: 20px;
        :deep(.player-cover) {
          width: min(100%, 45vh);
          // height: min(85vw, 45vh);
          &.record {
            width: 40vh;
            .cover-img {
              width: 40vh;
              height: 40vh;
              min-width: 40vh;
            }
            .pointer {
              width: 10vh;
              top: -9.5vh;
            }
            @media (max-width: 512px) {
              width: 36vh;
              .cover-img {
                width: 36vh;
                height: 36vh;
                min-width: 36vh;
              }
            }
          }
        }
      }
      .info-group {
        width: 100%;
        display: flex;
        flex-direction: column;
        .song-info-bar {
          width: 100%;
          display: flex;
          justify-content: space-between;
          margin-bottom: 24px;
          .info-section {
            flex: 1;
            min-width: 0;
            margin-right: 16px;
            :deep(.mobile-data) {
              width: 100%;
              max-width: 100%;
              .name {
                margin-left: 0;
              }
            }
          }
          .info-actions {
            display: flex;
            padding-top: 24px;
            gap: 16px;
            flex-shrink: 0;
            .action-btn {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 48px;
              height: 48px;
              border-radius: 50%;
              cursor: pointer;
              transition: background-color 0.2s;
              &:active {
                background-color: rgba(255, 255, 255, 0.1);
              }
              .n-icon {
                color: rgb(var(--main-cover-color));
                opacity: 0.6;
                transition:
                  opacity 0.2s,
                  transform 0.2s;
                &.liked {
                  fill: rgb(var(--main-cover-color));
                  opacity: 1;
                }
              }
            }
          }
        }
        .progress-section {
          display: flex;
          align-items: center;
          margin: 0 4px 30px;
          .time {
            font-size: 12px;
            opacity: 0.6;
            width: 40px;
            text-align: center;
            color: rgb(var(--main-cover-color));
            font-variant-numeric: tabular-nums;
          }
          .n-slider {
            margin: 0 12px;
          }
        }
        .control-section {
          width: 100%;
          max-width: 400px;
          margin: 0 auto 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          .placeholder {
            width: 24px;
          }
          .mode-btn {
            opacity: 0.8;
            cursor: pointer;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            .n-icon {
              color: rgb(var(--main-cover-color));
            }
          }
          .ctrl-btn {
            cursor: pointer;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            .n-icon {
              color: rgb(var(--main-cover-color));
            }
          }
          .play-btn {
            width: 60px;
            height: 60px;
            font-size: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s;
            background-color: rgba(var(--main-cover-color), 0.2);
            color: rgb(var(--main-cover-color));
            &.n-button--primary-type {
              --n-color: rgba(var(--main-cover-color), 0.14);
              --n-color-hover: rgba(var(--main-cover-color), 0.2);
              --n-color-focus: rgba(var(--main-cover-color), 0.2);
              --n-color-pressed: rgba(var(--main-cover-color), 0.12);
            }
            &:active {
              transform: scale(0.95);
            }
          }
        }
      }
    }
    .lyric-page {
      padding: 0 24px;
      padding-top: calc(30px + env(safe-area-inset-top));
      display: flex;
      flex-direction: column;
      .lyric-header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
        flex-shrink: 0;
        padding: 0 20px 0;
        .lyric-cover {
          width: 50px;
          height: 50px;
          flex-shrink: 0;
          :deep(img) {
            border-radius: 6px;
            width: 100%;
            height: 100%;
          }
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .lyric-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          .name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 2px;
          }
          .artist {
            font-size: 13px;
            opacity: 0.6;
          }
        }
        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          cursor: pointer;
          touch-action: manipulation; /* 消除 300ms 点击延迟 */
          -webkit-tap-highlight-color: transparent;
          transition: background-color 0.15s;
          margin-left: 0;
          flex-shrink: 0;
          &:active {
            background-color: rgba(255, 255, 255, 0.15);
          }
          .n-icon {
            color: rgb(var(--main-cover-color));
            opacity: 0.7;
            transition: all 0.2s;
            &.liked {
              fill: rgb(var(--main-cover-color));
              opacity: 1;
            }
          }
          &.close-btn .n-icon {
            opacity: 0.7;
          }
        }
      }
      .lyric-main {
        flex: 1;
        min-height: 0;
        position: relative;
      }
    }
  }
  .pagination {
    position: absolute;
    bottom: 24px;
    left: 0;
    width: 100%;
    display: flex;
    justify-content: center;
    gap: 8px;
    pointer-events: none;
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.2);
      transition: all 0.3s;
      &.active {
        background-color: rgb(var(--main-cover-color));
        width: 16px;
        border-radius: 4px;
        opacity: 0.8;
      }
    }
  }
}
</style>
