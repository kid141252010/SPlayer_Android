import { useSettingStore } from "@/stores";
import { SettingConfig } from "@/types/settings";
import { computed, h, markRaw, ref } from "vue";
import { NA } from "naive-ui";
// import { debounce } from "lodash-es";
import { getAuthToken, getAuthUrl, getSession } from "@/api/lastfm";
import StreamingServerList from "../components/StreamingServerList.vue";

export const useNetworkSettings = (): SettingConfig => {
  const settingStore = useSettingStore();
  // const testProxyLoading = ref<boolean>(false);

  // --- Network Proxy Logic ---
  // Note: Electron IPC calls removed as this is Android-only build.
  // Proxy settings might still be useful if implemented natively in Android later.
  // For now, we keep the UI state but remove the IPC calls that would fail.

  /*
  const proxyConfig = computed(() => ({
    protocol: settingStore.proxyProtocol,
    server: settingStore.proxyServe,
    port: settingStore.proxyPort,
  }));
  */

  // Simplified Proxy Logic (No Electron IPC)
  // const setProxy = debounce(() => {
  //    // TODO: Implement Android Native Proxy setting if needed
  //    console.log("Proxy settings updated (Android implementation pending):", proxyConfig.value);
  //    window.$message.success("网络代理设置已保存 (Android暂未生效)");
  // }, 300);

  // const testProxy = async () => {
  //   testProxyLoading.value = true;
  //   // Mock test for now
  //   await new Promise(resolve => setTimeout(resolve, 1000));
  //   window.$message.info("暂不支持 Android 代理测试");
  //   testProxyLoading.value = false;
  // };

  // --- Last.fm Logic (from third.ts) ---
  const lastfmAuthLoading = ref(false);

  const connectLastfm = async () => {
    try {
      lastfmAuthLoading.value = true;
      const tokenResponse = await getAuthToken();
      if (!tokenResponse.token) throw new Error("无法获取认证令牌");
      const token = tokenResponse.token;
      const authUrl = getAuthUrl(token);

      if (typeof window !== "undefined") {
        const authWindow = window.open(authUrl, "_blank", "width=800,height=600");
        const checkAuth = setInterval(async () => {
          if (authWindow?.closed) {
            clearInterval(checkAuth);
            if (lastfmAuthLoading.value) {
              lastfmAuthLoading.value = false;
              window.$message.warning("授权已取消");
            }
            return;
          }
          try {
            const sessionResponse = await getSession(token);
            if (sessionResponse.session) {
              clearInterval(checkAuth);
              authWindow?.close();
              settingStore.lastfm.sessionKey = sessionResponse.session.key;
              settingStore.lastfm.username = sessionResponse.session.name;
              window.$message.success(`已成功连接到 Last.fm 账号: ${sessionResponse.session.name}`);
              lastfmAuthLoading.value = false;
            }
          } catch {
            // 用户还未授权，继续等待
          }
        }, 2000);

        setTimeout(() => {
          clearInterval(checkAuth);
          if (lastfmAuthLoading.value) {
            lastfmAuthLoading.value = false;
            window.$message.warning("授权超时，请重试");
          }
        }, 30000);
      }
    } catch (error: any) {
      console.error("Last.fm 连接失败:", error);
      window.$message.error(`连接失败: ${error.message || "未知错误"}`);
      lastfmAuthLoading.value = false;
    }
  };

  const disconnectLastfm = () => {
    window.$dialog.warning({
      title: "断开连接",
      content: "确定要断开与 Last.fm 的连接吗？",
      positiveText: "确定",
      negativeText: "取消",
      onPositiveClick: () => {
        settingStore.lastfm.sessionKey = "";
        settingStore.lastfm.username = "";
        window.$message.success("已断开与 Last.fm 的连接");
      },
    });
  };

  const onActivate = () => {
    // initSocketConfig(); // WebSocket removed
  };

  return {
    onActivate,
    groups: [
      {
        title: "API 配置",
        items: [
          {
            key: "customNeteaseApiUrl",
            label: "自定义网易云 API",
            type: "text-input",
            description: "设置自定义的网易云 API 地址（包含端口），留空则使用内置或 VITE_API_BASE_URL 配置",
            componentProps: {
              placeholder: "https://your-api.com:3000",
            },
            value: computed({
              get: () => settingStore.customNeteaseApiUrl,
              set: (v) => (settingStore.customNeteaseApiUrl = v),
            }),
          },
        ],
      },
      {
        title: "流媒体服务",
        items: [
          {
            key: "streamingEnabled",
            label: "启用流媒体",
            type: "switch",
            description: "开启后可使用并管理 Navidrome、Jellyfin 等流媒体服务",
            value: computed({
              get: () => settingStore.streamingEnabled,
              set: (v) => (settingStore.streamingEnabled = v),
            }),
          },
          {
            key: "serverList",
            label: "服务器管理",
            type: "custom",
            description: "在此添加和管理您的流媒体服务器",
            noWrapper: true,
            component: markRaw(StreamingServerList),
          },
        ],
      },
      // Note: Proxy UI hidden for now as Electron IPC is removed.
      // Can be re-enabled if native implementation is added.
      /*
      {
        title: "网络代理",
        items: [
           // ... Proxy Items ...
        ],
      },
      */
      {
        title: "第三方集成",
        items: [
          {
            key: "smtcOpen",
            label: "开启浏览器媒体会话",
            type: "switch",
            description: "向系统/浏览器发送 Media Session 媒体元数据",
            value: computed({
              get: () => settingStore.smtcOpen,
              set: (v) => (settingStore.smtcOpen = v),
            }),
          },
          {
            key: "lastfm_enabled",
            label: "启用 Last.fm",
            type: "switch",
            description: "开启后可记录播放历史到 Last.fm",
            value: computed({
              get: () => settingStore.lastfm.enabled,
              set: (v) => (settingStore.lastfm.enabled = v),
            }),
            children: [
              {
                key: "lastfm_apikey",
                label: "API Key",
                type: "text-input",
                description: () =>
                  h("div", null, [
                    h("div", null, [
                      "在 ",
                      h(
                        NA,
                        {
                          href: "https://www.last.fm/zh/api/account/create",
                          target: "_blank",
                        },
                        { default: () => "Last.fm 创建应用" },
                      ),
                      " 获取，只有「程序名称」是必要的",
                    ]),
                    h("div", null, [
                      "如果已经创建过，则可以在 ",
                      h(
                        NA,
                        {
                          href: "https://www.last.fm/zh/api/accounts",
                          target: "_blank",
                        },
                        { default: () => "Last.fm API 应用程序" },
                      ),
                      " 处查看",
                    ]),
                  ]),
                value: computed({
                  get: () => settingStore.lastfm.apiKey,
                  set: (v) => (settingStore.lastfm.apiKey = v),
                }),
              },
              {
                key: "lastfm_secret",
                label: "API Secret",
                type: "text-input",
                description: "Shared Secret，用于签名验证",
                componentProps: { type: "password", showPasswordOn: "click" },
                value: computed({
                  get: () => settingStore.lastfm.apiSecret,
                  set: (v) => (settingStore.lastfm.apiSecret = v),
                }),
              },
              {
                key: "lastfm_connect",
                label: computed(() =>
                  !settingStore.lastfm.sessionKey ? "连接 Last.fm 账号" : "已连接账号",
                ),
                type: "button",
                description: computed(() =>
                  !settingStore.lastfm.sessionKey
                    ? "首次使用需要授权连接"
                    : settingStore.lastfm.username,
                ),
                buttonLabel: computed(() =>
                  !settingStore.lastfm.sessionKey ? "连接账号" : "断开连接",
                ),
                action: () =>
                  !settingStore.lastfm.sessionKey ? connectLastfm() : disconnectLastfm(),
                componentProps: computed(() =>
                  !settingStore.lastfm.sessionKey
                    ? {
                        type: "primary",
                        loading: lastfmAuthLoading.value,
                        disabled: !settingStore.isLastfmConfigured,
                      }
                    : { type: "error" },
                ),
              },
              {
                key: "lastfm_scrobble",
                label: "Scrobble（播放记录）",
                type: "switch",
                description: "自动记录播放历史到 Last.fm",
                condition: () => !!settingStore.lastfm.sessionKey,
                value: computed({
                  get: () => settingStore.lastfm.scrobbleEnabled,
                  set: (v) => (settingStore.lastfm.scrobbleEnabled = v),
                }),
              },
              {
                key: "lastfm_nowplaying",
                label: "正在播放状态",
                type: "switch",
                description: "向 Last.fm 同步正在播放的歌曲",
                condition: () => !!settingStore.lastfm.sessionKey,
                value: computed({
                  get: () => settingStore.lastfm.nowPlayingEnabled,
                  set: (v) => (settingStore.lastfm.nowPlayingEnabled = v),
                }),
              },
            ],
          },
        ],
      },
    ],
  };
};
