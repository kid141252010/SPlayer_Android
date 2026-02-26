# AI 开发助手行为准则

## 项目技术栈与环境

- **核心框架**: Vue 3 + Electron
- **UI 组件库**: **Naive UI** (严禁混用其他 UI 库)
- **包管理器**: **严格使用 `pnpm`** (严禁使用 npm/yarn)
- **开发命令**: `pnpm dev` (预览代码)
- **代码质量**: 每次任务结束前，必须自动运行 `pnpm lint` 并修复所有问题，确保 0 错误、0 警告后方可交付。
- **提交之前**: 必须运行 `pnpm build` 和 `pnpm format` 并修复所有问题，确保 0 错误、0 警告后方可提交。

## 常用命令

### 开发与构建

| 命令                 | 说明                        |
| -------------------- | --------------------------- |
| `pnpm dev`           | 开发模式启动应用            |
| `pnpm build`         | 完整构建（类型检查 + 打包） |
| `pnpm start`         | 预览打包后的应用            |
| `pnpm build:win`     | 构建 Windows 安装包         |
| `pnpm build:mac`     | 构建 macOS 安装包           |
| `pnpm build:linux`   | 构建 Linux 安装包           |
| `pnpm build:android` | 构建 Android 应用           |

### 代码质量

| 命令                  | 说明                            |
| --------------------- | ------------------------------- |
| `pnpm lint`           | ESLint 检查（严格模式，0 警告） |
| `pnpm format`         | Prettier 代码格式化             |
| `pnpm typecheck`      | TypeScript 类型检查             |
| `pnpm typecheck:node` | 主进程类型检查                  |
| `pnpm typecheck:web`  | 渲染进程类型检查                |

### 注意事项

- 本项目**暂无测试框架**，无需运行测试命令
- 构建命令会先执行类型检查，类型错误会导致构建失败
- lint 和 format 命令需在提交前确保 0 错误 0 警告

## 代码风格与规范

### 1. 注释规范

- **语言**: 必须使用**中文**
- **格式**: 保持简洁，禁止长句、英文长文或带序号的注释
  - 正确: `// 监听主进程消息`
  - 错误: `// 1. listen to main process`, `// this function handles ipc...`

### 2. 导入规范 (Imports)

- **路径别名**: 使用 `@/` 前缀导入 src 目录下的模块
  ```typescript
  import { useMusicStore } from "@/stores";
  import PlayerController from "@/core/player/PlayerController";
  ```
- **顺序**: 先导入外部库，再导入内部模块（保持清晰的分层）
  ```typescript
  import { ref, computed } from "vue";
  import { useMusicStore } from "@/stores";
  import type { SongType } from "@/types/main";
  import PlayerController from "@/core/player/PlayerController";
  ```
- **类型导入**: 使用 `import type` 导入类型定义

### 3. 格式化规范

- **缩进**: 2 空格
- **引号**: 双引号 (`"`)
- **分号**: 必须使用分号
- **尾随逗号**: 所有可能的位置 (trailingComma: all)
- **行宽**: 最大 100 字符

### 4. 命名规范

- **组件文件**: PascalCase，如 `PlayerControls.vue`、`SongListCard.vue`
- **工具函数**: camelCase，如 `useTimeFormat.ts`、`formatTime.ts`
- **常量**: 全大写加下划线，如 `REPEAT_MODE_KEYWORDS`
- **接口/类型**: PascalCase，如 `SongType`、`AudioAnalysis`
- **私有属性/方法**: 以 `_` 开头，如 `_internalMethod()`

### 5. TypeScript 规范

- **类型推断**: 优先使用类型推断，避免冗余类型标注

  ```typescript
  // 正确
  const count = ref(0);
  const list: SongType[] = [];

  // 避免
  const count: Ref<number> = ref(0);
  ```

- **any 类型**: 严禁使用 `any`，除非经过评估确有必要
- **未使用变量**: 使用 `_` 前缀标记未使用的参数
  ```typescript
  function handleClick(_event: MouseEvent) {
    // 不使用 event 参数
  }
  ```

### 6. Vue 组件规范

- **UI 组件**: 必须使用 Naive UI 组件，禁止手写原生 HTML/CSS
  ```vue
  <template>
    <n-button type="primary">按钮</n-button>
    <n-modal v-model:show="visible">...</n-modal>
  </template>
  ```
- **图标**: 使用项目内置的 SvgIcon 组件
  ```vue
  <SvgIcon :name="isPlaying ? 'Pause' : 'Play'" />
  ```

### 7. Electron 特性规范

- **进程安全**: 明确代码运行环境（Main vs Renderer），不要在渲染进程中直接调用 Node.js API
- **IPC 通信**: 使用 preload 暴露的 API 进行主进程通信，保持频道命名清晰
- **文件操作**: 必须通过 IPC 调用主进程处理，禁止在渲染进程直接读写文件

### 8. 错误处理

- **异步操作**: 必须使用 try-catch 包装可能失败的异步操作
- **用户反馈**: 错误需反馈给用户，使用 Naive UI 的 message 组件提示
- **日志记录**: 主进程使用 electron-log 记录错误日志

### 9. 测试与清理

- **临时文件**: 任务过程中生成的临时测试文件必须在结束前删除
- **提交检查**: 确保 lint、typecheck、build 全部通过后再提交

## 目录结构参考

```
src/
├── api/              # API 接口层
├── assets/           # 静态资源
├── components/       # Vue 组件
│   ├── Card/         # 卡片组件
│   ├── Global/       # 全局组件
│   ├── Layout/       # 布局组件
│   └── ...
├── composables/      # 组合式函数
├── core/             # 核心逻辑
│   ├── audio-player/ # 音频播放引擎
│   ├── player/       # 播放器控制器
│   └── resource/    # 资源管理
├── stores/           # Pinia 状态管理
├── types/            # TypeScript 类型定义
├── utils/            # 工具函数
└── views/           # 页面视图
```

## 交互与思维链

### 1. 遇到困难多确认

- **原则**: 禁止假设。当遇到不理解的概念时，必须暂停并向用户提问
- **建议**: "此处涉及文件系统操作，请确认是通过 IPC 调用主进程处理？"

### 2. 复杂任务先规划

- **文档驱动开发**: 遇到复杂功能时，先创建临时的 Markdown 文档梳理思路
- **流程**: 文档梳理 -> 展示给用户 -> 用户同意 -> 开始写代码

### 3. 复用优先 DRY 原则

- **原则**: 在编写新功能前，强制检索项目现存代码
- **自检**: "项目中是否已经有类似的 IPC 封装或 UI 组件？"

### 4. 聊天方式

- **原则**: 与用户保持中文对话，禁止使用英文或其他语言

## 严格合规声明

- **指令等级**: Critical
- **违规后果**: 违反以上任何一条规则将被定义为任务失败，代码将被直接拒绝
