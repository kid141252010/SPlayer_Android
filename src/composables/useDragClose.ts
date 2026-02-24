import { ref, computed } from "vue";

/**
 * 全局下拉关闭状态
 * 在 FullPlayerMobile 中设置偏移，在 FullPlayer 中消费样式
 * 这样可以保证背景和内容一起向下滑动，避免只有内容层移动而背景留原地
 */
const verticalDragOffset = ref(0);
const isSpringback = ref(false);

export function useDragClose() {
    /** 应用到整个播放器容器的变换样式 */
    const playerContainerStyle = computed(() => {
        const dy = verticalDragOffset.value;
        if (dy <= 0 && !isSpringback.value) return {};

        const progress = Math.min(dy / 400, 1);
        // 调快透明度变化曲线，更快露出底层界面
        const opacity = Math.max(0, 1 - Math.pow(progress, 0.7) * 0.9);
        const scale = 1 - progress * 0.05;
        const radius = Math.min(progress * 24, 24);

        return {
            transform: `translateY(${dy}px) scale(${scale})`,
            opacity: String(opacity),
            borderRadius: `${radius}px`,
            overflow: "hidden",
            willChange: "transform, opacity, border-radius",
            transition: isSpringback.value
                ? "transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s, border-radius 0.3s"
                : "none",
        };
    });

    return {
        verticalDragOffset,
        isSpringback,
        playerContainerStyle,
    };
}
