import { QualityType, SongType, UpdateLogType } from "@/types/main";
import { AI_AUDIO_LEVELS, AI_AUDIO_KEYS } from "@/utils/meta";
import { NTooltip, SelectOption } from "naive-ui";
import { h, VNode } from "vue";
import { getCacheData } from "./cache";
import { updateLog } from "@/api/other";
import { isEmpty } from "lodash-es";
import { convertToLocalTime } from "./time";
import { useSettingStore } from "@/stores";
import { marked } from "marked";
import { isElectron, isTauri, isMobile } from "./env";
import { open } from "@tauri-apps/plugin-dialog";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import Fuse from "fuse.js";

type AnyObject = { [key: string]: any };

/**
 * 打开链接
 * @param url 链接地址
 * @param target 打开方式（_self 或 _blank）
 */
export const openLink = (url: string, target: "_self" | "_blank" = "_blank") => {
  window.open(url, target);
};

/**
 * 渲染图标
 * @param iconName 图标名称
 * @param option 图标选项（大小和样式）
 * @returns 图标组件
 */
export const renderIcon = (
  iconName: string,
  option: {
    size?: number;
    style?: AnyObject;
  } = {},
) => {
  const { size, style } = option;
  return () => {
    return h(SvgIcon, { name: iconName, size, style });
  };
};

/**
 * 延时函数
 * @param ms 延时时间（毫秒）
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * 渲染选项
 * @param param0 包含节点和选项的对象
 * @returns 包含工具提示的节点
 */
export const renderOption = ({ node, option }: { node: VNode; option: SelectOption }) =>
  h(
    NTooltip,
    { placement: "left" },
    {
      trigger: () => node,
      default: () => option.label,
    },
  );

/**
 * 模糊搜索
 * @param keyword 搜索关键词
 * @param data 要搜索的数据数组
 * @returns 包含匹配项的数组
 */
export const fuzzySearch = (keyword: string, data: SongType[]): SongType[] => {
  try {
    if (!keyword || !data || !Array.isArray(data)) return [];

    const fuse = new Fuse(data, {
      // 针对歌曲可读字段进行索引
      keys: [
        { name: "name", weight: 0.5 },
        { name: "alia", weight: 0.2 },
        { name: "artists", weight: 0.15 },
        { name: "artists.name", weight: 0.15 },
        { name: "album", weight: 0.1 },
        { name: "album.name", weight: 0.1 },
        { name: "dj.name", weight: 0.05 },
      ],
      threshold: 0.35, // 0 精确匹配 ~ 1 完全模糊
      ignoreLocation: true, // 不要求关键词位置接近
    });

    return fuse.search(keyword).map((result) => result.item);
  } catch (error) {
    console.error("模糊搜索出现错误：", error);
    return [];
  }
};

/**
 * 将 32 位 ARGB 颜色值转换为 24 位 RGB 颜色值
 *
 * @param {number} x - 32位ARGB颜色值
 * @returns {number[]} - 包含红色、绿色和蓝色分量的24位RGB颜色值数组（0-255）
 */
export const argbToRgb = (x: number): number[] => {
  // 提取红色、绿色和蓝色分量
  const r = (x >> 16) & 0xff;
  const g = (x >> 8) & 0xff;
  const b = x & 0xff;
  // 返回24位RGB颜色值数组
  return [r, g, b];
};

/**
 * 封面加载完成时，设置透明度为 1
 * @param e 事件对象
 */
export const coverLoaded = (e: Event) => {
  const target = e.target as HTMLElement | null;
  if (target && target.nodeType === Node.ELEMENT_NODE) {
    target.style.opacity = "1";
  }
};

/**
 * 格式化数字
 * @param num 要格式化的数字
 * @returns 格式化后的数字字符串
 */
export const formatNumber = (num: number): string => {
  if (num < 10000) {
    return num.toString();
  } else if (num < 100000000) {
    return `${(num / 10000).toFixed(1)}万`;
  } else {
    return `${(num / 100000000).toFixed(1)}亿`;
  }
};

/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @returns 格式化后的文件大小字符串
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  } else {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
};
/**
 * 复制数据到剪贴板（原生实现）
 * @param text 要复制的数据
 * @param message 复制成功提示消息（可选）
 */
export const copyData = async (text: any, message?: string) => {
  if (!text) return;
  const content =
    typeof text === "string"
      ? text.trim()
      : Array.isArray(text)
        ? text.join("\n")
        : JSON.stringify(text, null, 2);
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(content);
      window.$message.success(message ?? "已复制到剪贴板");
      return;
    } catch (err) {
      console.error("clipboard.writeText 失败，尝试降级方案", err);
    }
  }
  // 降级方案
  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    // 避免页面滚动
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    // 添加到页面
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    // 执行复制
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (success) {
      window.$message.success(message ?? "已复制到剪贴板");
    } else {
      throw new Error("execCommand 返回 false");
    }
  } catch (error) {
    window.$message.error("复制出错，请重试");
    console.error("复制出错：", error);
  }
};

/*
 * 获取剪贴板内容
 * @returns 剪贴板内容字符串或 null
 */
export const getClipboardData = async (): Promise<string | null> => {
  try {
    const text = await navigator.clipboard.readText();
    return text;
  } catch (error) {
    console.error("Failed to read clipboard content:", error);
    return null;
  }
};

/**
 * 格式化为 Electron 快捷键
 * @param shortcut 快捷键
 * @returns Accelerator
 */
export const formatForGlobalShortcut = (shortcut: string): string => {
  return shortcut
    .split("+")
    .map((part) => {
      // 字母
      if (part.startsWith("Key")) {
        return part.replace("Key", "");
      }
      // 数字
      if (part.startsWith("Digit")) {
        return part.replace("Digit", "num");
      }
      if (part.startsWith("Numpad")) {
        return part.replace("Numpad", "num");
      }
      // 方向键
      if (part.startsWith("Arrow")) {
        return part.replace("Arrow", "");
      }
      return part;
    })
    .join("+");
};

/**
 * 获取更新日志
 * @returns 更新日志数组
 */
export const getUpdateLog = async (): Promise<UpdateLogType[]> => {
  const result = await getCacheData(updateLog, { key: "updateLog", time: 10 });
  if (!result || isEmpty(result)) return [];
  const updateLogs = await Promise.all(
    result.map(async (v: any) => ({
      version: v.tag_name,
      changelog: await marked(v.body),
      time: convertToLocalTime(v.published_at),
      url: v.html_url,
      prerelease: v.prerelease,
    })),
  );
  return updateLogs;
};

/** 更改本地目录选项 */
type ChangeLocalPathOptions = {
  /** 设置项 key */
  settingsKey: string;
  /** 标题 */
  title: string;
  /** 是否包含子文件夹 */
  includeSubFolders: boolean;
  /** 控制台输出的错误信息 */
  errorConsole: string;
  /** 错误信息 */
  errorMessage: string;
};

/**
 * 获取 更改本地目录
 * @param settingsKey 设置项 key
 * @param includeSubFolders 是否包含子文件夹
 * @param errorConsole 控制台输出的错误信息
 * @param errorMessage 错误信息
 */
const changeLocalPath =
  (
    options: ChangeLocalPathOptions = {
      settingsKey: "localFilesPath",
      includeSubFolders: true,
      title: "选择文件夹",
      errorConsole: "Error changing local path",
      errorMessage: "更改本地歌曲文件夹出错，请重试",
    },
  ) =>
  async (delIndex?: number) => {
    const { settingsKey, includeSubFolders, title, errorConsole, errorMessage } = options;
    try {
      if (!isElectron && !isTauri) return;
      const settingStore = useSettingStore();
      // 删除目录
      if (typeof delIndex === "number" && delIndex >= 0) {
        settingStore[settingsKey].splice(delIndex, 1);
        return;
      }

      let dirsToAdd: string[] = [];

      if (isElectron) {
        // 添加目录（支持多选）
        const selectedDirs = await window.electron.ipcRenderer.invoke("choose-path", title, true);
        if (!selectedDirs || selectedDirs.length === 0) return;
        // 转换为数组（兼容单选返回字符串的情况）
        dirsToAdd = Array.isArray(selectedDirs) ? selectedDirs : [selectedDirs];
      } else if (isTauri) {
        const isAndroid = navigator.userAgent.toLowerCase().includes("android");

        if (isAndroid) {
          // 🤖 安卓专属物理外挂：绕过崩溃的系统选择器，直接输入路径！
          const defaultPath = title.includes("歌词")
            ? "/storage/emulated/0/Music/Lyrics"
            : "/storage/emulated/0/Music";

          const userInput = window.prompt(
            "【安卓权限已破解】\n系统选择器存在兼容问题，请直接确认或修改下方的物理路径：\n(注：请确保手机存储中有此文件夹)",
            defaultPath,
          );

          if (!userInput || !userInput.trim()) return;
          dirsToAdd = [userInput.trim()];
        } else {
          // 💻 电脑端：继续保持优雅的窗口选择
          const selectedDirs = await open({
            directory: true,
            multiple: !isMobile,
            title: title,
          });
          if (!selectedDirs) return;
          dirsToAdd = Array.isArray(selectedDirs) ? selectedDirs : [selectedDirs];
        }
      }

      if (!dirsToAdd.length) return;

      // 记录成功添加的数量
      let addedCount = 0;
      let skippedCount = 0;
      // 用于追踪本次批量添加中已添加的路径
      const newlyAddedPaths: string[] = [];
      for (const selectedDir of dirsToAdd) {
        // 检查时需要包含原有路径和本次已添加的路径
        const pathsToCheck = [...settingStore[settingsKey], ...newlyAddedPaths];

        let isExactMatch = false;
        let isSubfolder = false;

        if (isElectron) {
          // 是否是完全相同的路径
          isExactMatch = await window.electron.ipcRenderer.invoke(
            "check-if-same-path",
            pathsToCheck,
            selectedDir,
          );
          if (includeSubFolders && !isExactMatch) {
            isSubfolder = await window.electron.ipcRenderer.invoke(
              "check-if-subfolder",
              pathsToCheck,
              selectedDir,
            );
          }
        } else if (isTauri) {
          const normalizeStr = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
          const normalizedSelected = normalizeStr(selectedDir);
          const normalizedPaths = pathsToCheck.map(normalizeStr);

          isExactMatch = normalizedPaths.includes(normalizedSelected);
          if (includeSubFolders && !isExactMatch) {
            isSubfolder = normalizedPaths.some((p: string) =>
              normalizedSelected.startsWith(p + "/"),
            );
          }
        }

        if (isExactMatch || isSubfolder) {
          skippedCount++;
          continue;
        }

        // 通过所有检查，添加目录
        settingStore[settingsKey].push(selectedDir);
        newlyAddedPaths.push(selectedDir);
        addedCount++;
      }
      // 显示结果提示
      if (addedCount > 0 && skippedCount > 0) {
        window.$message.success(`成功添加 ${addedCount} 个目录，跳过 ${skippedCount} 个重复目录`);
      } else if (addedCount > 0) {
        window.$message.success(`成功添加 ${addedCount} 个目录`);
      } else if (skippedCount > 0) {
        window.$message.warning(`所选目录已存在或有重叠，已跳过`);
      }
    } catch (error) {
      console.error(`${errorConsole}: `, error);
      window.$message.error(errorMessage);
    }
  };

/**
 * 更改本地音乐目录
 * @param delIndex 删除文件夹路径的索引
 */
export const changeLocalMusicPath = changeLocalPath({
  settingsKey: "localFilesPath",
  includeSubFolders: true,
  title: "选择本地歌曲文件夹",
  errorConsole: "Error changing local path",
  errorMessage: "更改本地歌曲文件夹出错，请重试",
});

/**
 * 更改本地歌词目录
 * @param delIndex 删除文件夹路径的索引
 */
export const changeLocalLyricPath = changeLocalPath({
  settingsKey: "localLyricPath",
  includeSubFolders: true,
  title: "选择本地歌词文件夹",
  errorConsole: "Error changing local lyric path",
  errorMessage: "更改本地歌词文件夹出错，请重试",
});

/**
 * 洗牌数组（Fisher-Yates）
 */
export const shuffleArray = <T>(arr: T[]): T[] => {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * 处理歌曲音质
 * @param song 歌曲数据
 * @param type 歌曲类型
 * @returns 歌曲音质
 */
export const handleSongQuality = (
  song: AnyObject | number,
  type: "local" | "online" = "local",
): QualityType | undefined => {
  const settingStore = useSettingStore();
  const { disableAiAudio } = settingStore;
  if (!song) return undefined;
  if (type === "local" && typeof song === "number") {
    if (song >= 960000) return QualityType.HiRes;
    if (song >= 441000) return QualityType.SQ;
    if (song >= 320000) return QualityType.HQ;
    if (song >= 160000) return QualityType.MQ;
    return QualityType.LQ;
  }

  const levelQualityMap = {
    jymaster: QualityType.Master,
    dolby: QualityType.Dolby,
    sky: QualityType.Spatial,
    jyeffect: QualityType.Surround,
    hires: QualityType.HiRes,
    lossless: QualityType.SQ,
    exhigh: QualityType.HQ,
    higher: QualityType.MQ,
    standard: QualityType.LQ,
  };

  // Fuck AI Filter: 如果是 AI 音质，跳过 level 属性判断，让后续遍历逻辑来确定真正的最高音质
  const isAiLevel =
    disableAiAudio &&
    typeof song === "object" &&
    song &&
    (("level" in song && AI_AUDIO_LEVELS.includes(song.level)) ||
      ("privilege" in song &&
        AI_AUDIO_LEVELS.includes(song.privilege?.playMaxBrLevel ?? song.privilege?.plLevel)));

  if (typeof song === "object" && song && !isAiLevel) {
    // 含有 level 特殊处理（仅在非 AI 音质时使用）
    if ("level" in song) {
      const quality = levelQualityMap[song.level];
      if (quality) return quality;
    }
    // 云盘歌曲适配
    if ("privilege" in song) {
      const privilege = song.privilege;
      const quality =
        levelQualityMap[privilege?.playMaxBrLevel] ?? levelQualityMap[privilege?.plLevel];
      if (quality) return quality;
    }
  }

  const order = [
    { key: "jm", type: QualityType.Master },
    { key: "db", type: QualityType.Dolby },
    { key: "sk", type: QualityType.Spatial },
    { key: "je", type: QualityType.Surround },
    { key: "hr", type: QualityType.HiRes },
    { key: "sq", type: QualityType.SQ },
    { key: "h", type: QualityType.HQ },
    { key: "m", type: QualityType.MQ },
    { key: "l", type: QualityType.LQ },
  ];

  for (const itemKey of order) {
    // 过滤 AI 音质
    if (disableAiAudio && AI_AUDIO_KEYS.includes(itemKey.key)) {
      continue;
    }
    if (song[itemKey.key] && Number(song[itemKey.key].br) > 0) {
      return itemKey.type;
    }
  }
  return undefined;
};

/**
 * 获取分享链接
 * @param type 资源类型 (song, playlist, album, artist, mv, etc.)
 * @param id 资源 ID
 * @returns 分享链接
 */
export const getShareUrl = (type: string, id: number | string): string => {
  const settingStore = useSettingStore();
  const { shareUrlFormat } = settingStore;

  if (shareUrlFormat === "mobile") {
    return `https://y.music.163.com/m/${type}?id=${id}`;
  }

  return `https://music.163.com/#/${type}?id=${id}`;
};
