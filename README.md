# mygo-music-youtube

MyGo Music 的 **YouTube 主站**插件：用自己的 Google 账号登录，把 YouTube 上的订阅频道、喜欢的视频、稍后观看、观看历史和自建播放列表当成音乐库来播放。

它和官方的 [`mygo-music-youtube-music`](https://github.com/egoist/mygo-music-youtube-music) **互补不重叠**：那个插件读 YouTube Music 的曲库、榜单和新碟；这个插件读 YouTube 主站的账号数据。播放链路采用同一个已验证的方案：**ffmpeg 转 MP3，yt-dlp 可选兜底**。

| 能力 | 说明 |
|---|---|
| 登录 | 在 MyGo Music 窗口里打开 Google 登录页，取回 Cookie；也支持手动粘贴 Cookie |
| 目录 | 首页推荐、搜索（视频 / 频道 / 播放列表）、搜索建议 |
| 账号数据 | 订阅频道的新视频、喜欢的视频、稍后观看、观看历史、自建播放列表、频道上传 |
| 编辑 | 点赞 / 取消点赞（写入你的 YouTube 账号） |
| 播放 | 标准 128k / 高 192k MP3，含响度补偿（ReplayGain） |

---

## 安装：一步一步来

> **一句话结论**：`ffmpeg` 是**必需**的，`yt-dlp` 是**可选但推荐**的（只在某些视频直链失效时才用到，不装也能听大部分歌）。2026 年的 yt-dlp 还需要一个 **JavaScript 运行时**（推荐 Deno）才能解 YouTube 的 JS 挑战。

### 第 1 步 · 安装 ffmpeg（必需）

插件把 YouTube 给的 AAC / Opus 音频流转成宿主一定能播的 MP3，并在本机开一个临时 HTTP 端口喂给 App。没有 ffmpeg 会直接报 `setup` 错误。

**macOS**（需要 Homebrew，没有就先执行第一行）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install ffmpeg
```

**Windows**（PowerShell，管理员或普通用户均可）

```powershell
winget install --id Gyan.FFmpeg -e
```

**Linux（Debian / Ubuntu）**

```bash
sudo apt update && sudo apt install -y ffmpeg
```

装完后**关掉并重开终端**，再确认：

```bash
ffmpeg -version | head -1
```

### 第 2 步 · 安装 yt-dlp（可选，但推荐）

它只在 VISIONOS 直链失效（YouTube 索要 poToken / bot 校验 / 地址中途失效）时兜底。**不装也能正常听歌**，只是少数视频会播放失败。

⚠️ 现在的 yt-dlp 解 YouTube 的 JS 挑战需要两样东西：**EJS 挑战脚本** 和 **JavaScript 运行时**。

- 官方发布的**独立二进制**（下面的 `yt-dlp_linux` / `yt-dlp.exe` / `yt-dlp_macos`）**已内置 EJS**，不用另装 `yt-dlp-ejs`。
- 若改用 `pip install yt-dlp`，必须装 `pip install -U "yt-dlp[default]"` 才会带上 EJS。
- 运行时推荐 **Deno**（默认启用）；Node.js ≥ 22 也可以（插件会自动传 `--js-runtimes node:<路径>`）；Bun 已不推荐。

**macOS —— 一行装齐**

```bash
brew install yt-dlp deno
```

Homebrew 会放到 `/opt/homebrew/bin`（Apple Silicon）或 `/usr/local/bin`（Intel），正好是插件会查找的两个路径。

**Windows**

```powershell
winget install --id yt-dlp.yt-dlp -e
winget install --id DenoLand.Deno -e
```

装完**关掉并重开终端**。

**Linux（Debian / Ubuntu）**

```bash
# 2.1 官方独立二进制，自带 EJS，不需要 Python
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
     -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# 2.2 Deno，并软链到 /usr/local/bin —— GUI 应用不会读 ~/.deno/bin
curl -fsSL https://deno.land/install.sh | sh
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.profile
sudo ln -s "$HOME/.deno/bin/deno" /usr/local/bin/deno
```

### 第 3 步 · 验证安装

```bash
ffmpeg -version | head -1          # 必须有版本号
yt-dlp --version                   # 装了才有；没装可跳过
deno --version                     # 装了 Deno 才有
yt-dlp --simulate -F "https://www.youtube.com/watch?v=jfKfPfyJRdk"
```

最后一条能列出 format 列表，才说明 yt-dlp 的 EJS 和运行时都齐了。若因网络或地区连不上 YouTube，那是网络问题，不是安装问题。

> 升级：`brew upgrade ffmpeg yt-dlp deno` / `winget upgrade --all` / `yt-dlp -U`（Linux 独立二进制）。YouTube 常改，yt-dlp 尽量保持最新。

### 第 4 步 · 安装插件并授权

1. 在 MyGo Music 的 **插件**页用 **`+` → 从 zip / 文件夹安装** 选本插件，最省事；公开仓库也可以用 `mygo-music://install-plugin?repo=<你的用户名>/mygo-music-youtube` 一键安装。**私有仓库不支持这个链接**（宿主读不到私有仓库），请一律用 zip / 文件夹安装。
2. 安装时宿主会列出本插件要启动的程序：`ffmpeg`、`yt-dlp`，以及 `deno` / `node` / `bun`（仅用于让 yt-dlp 解 JS 挑战，插件只会执行 `--version` 检测）。**点「允许启动程序」**。
3. **重启 MyGo Music**。GUI 应用不会继承刚改好的 PATH，也不重新探测刚装的程序。

### 第 5 步 · 登录

在插件页点 **登录**，会弹出一个隔离的 Google 登录窗口；登录完成后窗口自动关闭，Cookie 保存在本机插件数据里。若窗口打不开，可以把已登录 `youtube.com` 标签页的 **Cookie 请求头**粘贴到插件设置里。

---

## 设置项

| 设置 | 作用 |
|---|---|
| `Cookie (optional)` | 手动粘贴 Cookie 请求头，替代弹窗登录 |
| `Audio source` | `Automatic`（Vision Pro 播放器 → 已登录网页播放器 → yt-dlp）/ `Vision Pro player` / `Signed-in web player` |
| `Report plays to YouTube` | `Report plays`（默认）/ `Don't report`：是否向 YouTube 如实上报每次播放，见下一节 |

---

## 播放是怎么工作的

```
InnerTube player (VISIONOS)  →  明文音频直链  →  ffmpeg 转 MP3  →  http://127.0.0.1:<随机端口>/  →  MyGo Music
                                      ↓ 失败时
                                  yt-dlp 兜底找到新直链
```

- **VISIONOS 客户端**目前不需要 poToken，YouTube 直接给明文音频地址；普通 WEB / ANDROID 客户端现在普遍要 poToken，所以直链失败时才交给 yt-dlp 跑 JS 挑战。
- **ffmpeg** 负责两件事：把任意编码（AAC、Opus/WebM、HLS）转成宿主一定支持的 MP3；带断线重连、分段请求地稳定读取 Google 的流媒体服务器。
- **yt-dlp** 只是兜底：直链拿不到或中途失效时再争取一次。装了 yt-dlp ≈ 成功率接近 100%；不装 ≈ 大部分歌照常播，少数歌报 `unavailable` 或 bot 提示。
- 音频地址缓存 50 分钟；同一时刻最多 3 个 ffmpeg 在等待播放。

---

## 播放量与观看历史

**结论：默认会如实上报一次播放，但不保证公开播放量一定增加。**

| | 说明 |
|---|---|
| 改之前 | 插件只从 `*.googlevideo.com` 拉音频字节，YouTube 完全不知道你听过 —— 播放量、观看历史、推荐都不受影响 |
| 改之后 | 每次真正开始播放时，向 `youtube.com/api/stats/playback` 发**一次**上报（带 `cpn`、客户端标识和你的登录态），与网页播放器点开视频时的第一次上报是同一类请求 |
| 通常会的 | 播放写入你的 **YouTube 观看历史** 并影响推荐（官方 YT Music 插件靠同一机制同步历史；本环境连不上 YouTube，未实测） |
| 不能保证的 | **公开播放量可能被计入，也可能被剔除** |

- YouTube 不靠「有人下载了音频流」计播放量，它靠 `youtubei/v1/player` 响应里 `playbackTracking.videostatsPlaybackUrl` 给出的地址上报，外加播放期间的 `api/stats/watchtime` 心跳。官方 `mygo-music-youtube-music` 插件也只做前者，本插件补上了同样的机制。
- 宿主只在「开始播放」时调用插件一次（`played`），**没有播放进度回调**，所以插件无法持续上报观看时长心跳，也无法提供 poToken / attestation。YouTube 的反作弊会把缺少这些的播放判为「低质量播放」并剔除。
- 要做到 100% 计入，需要跑一个完整的官方播放器环境（浏览器/WebView + 持续心跳 + poToken），这在 MyGo Music 的插件契约里做不到。
- 这是**一次真实播放 → 一次上报**，插件不会循环、批量或重复上报，**不是刷量工具**，也请不要用它刷量（违反 YouTube 虚假互动政策，并可能导致账号风控）。
- 不登录，或把 `Report plays to YouTube` 设为 `Don't report` 时，完全不上报。上报失败只写一条警告日志，绝不影响播放。

---

## 隐私

- 登录 Cookie 以明文保存在**本机**插件数据中，只随请求发往 `www.youtube.com` 及其 API。
- 传给 yt-dlp 时通过 **stdin**（`--config-locations -`）送入，不出现在命令行参数里——因为本机其他用户可能看到进程参数。
- Cookie 不会发往 googlevideo.com 之外的任何第三方，插件不上传、不遥测。
- 上报播放时，Cookie 与 `SAPISIDHASH` 只发往 `*.youtube.com` 的 `api/stats/playback`；插件会先校验域名，非 `youtube.com` 的地址一律拒绝，防止会话外泄。
- 退出登录会清除本机保存的 Cookie 与所有缓存。

---

## 已知限制

- **私有 API 无 SLA**：用的是 YouTube 网页自己的 InnerTube 接口，客户端版本、`browseId`、响应结构随时可能变。解析器和 `browseId` 集中在 `index.js` 里，便于实测调整。
- **开发时未能连真实接口**：本环境无法连通 YouTube（连接超时 / 502），因此解析器是按 InnerTube 已知响应结构 + 离线 fixture 验证的，登录态与真实账号数据需要你在本机首次使用时确认。
- **bot 校验**：`Sign in to confirm you're not a bot` 是 IP 被判定，与安装无关；装好 yt-dlp + Deno 往往能解，否则换网络或保持登录。
- **账号相关**：Premium 专属、地区限制、私密/会员视频不一定能播；登录过期会提示重新登录。
- **播放量不保证计入**：见「播放量与观看历史」。这是插件契约的上限，不是 bug；单次上报可能被 YouTube 判为低质量播放而剔除。
- **不支持**：字幕歌词、评论、电台、歌单增删改（后续可加）。
- 插件目录里含 `mygo-music-youtube-music` 已验证的协议思路，但代码为独立实现；主项目为 AGPL-3.0，本插件同许可。

---

## 故障排查

| 现象 | 处理 |
|---|---|
| `YouTube 的音频要经过 ffmpeg…` | 按第 1 步装 ffmpeg，**重启 App** |
| `请在插件设置里允许 YouTube 启动程序` | 插件页 → 允许启动程序 → 重启 App |
| `yt-dlp not found` / 兜底没生效 | 程序不在 PATH 或不在 `/opt/homebrew/bin`、`/usr/local/bin`；装到这些位置并重启 App |
| `No supported JavaScript runtime` | 装 Deno（或 Node ≥ 22），并确认在 PATH / `/usr/local/bin` |
| `n challenge solving failed` | `yt-dlp -U` 升级 |
| `Sign in to confirm you're not a bot` | IP 风控：装 yt-dlp + Deno、换网络、或保持登录态 |
| 部分视频播不了 | 装 yt-dlp 兜底；仍失败则说明该视频本身受地区 / 会员 / 私密限制 |
| 401 / 登录过期 | 在插件里重新登录 |

---

## 开发

```bash
npm test      # 39 个离线测试：登录、解析器、分页、账号数据、ffmpeg/yt-dlp 播放链路
npm run check # 语法检查
```

测试用 `tests/harness.mjs` 模拟 MyGo Music 的 `host` 全局与 ffmpeg / yt-dlp 进程，`tests/fixtures.mjs` 是构造的 InnerTube 响应样本，不触碰真实网络与真实账号。插件本身是一个无依赖的 ES module，宿主直接加载，无需构建。

## License

AGPL-3.0-only
