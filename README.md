# 投资收益记录

一个基于 Capacitor 的跨平台手机 App，用于记录多个投资渠道的资产变化，并自动计算：

- **差值**：本次总资产与上次总资产的差额
- **充值金额**：本次新增投入
- **本次收益**：差值减去充值金额，反映真实投资收益
- **累计收益**：历次收益累加

所有数据保存在手机本地，无需联网即可使用。

## 技术栈

- [Capacitor](https://capacitorjs.com/)：将网页应用打包成 Android APK
- HTML / CSS / JavaScript（无框架）
- Tailwind CSS（CDN）
- IBM Plex Sans 字体
- Capacitor Filesystem：手机端本地文件持久化
- localStorage：电脑浏览器调试时的降级备份

## 在电脑上调试

不需要安装 Android SDK，直接在浏览器中运行即可。先进入项目根目录（`app_fund`），再执行下面任意一种方式：

### 方式一：Python 内置服务器（推荐，无需额外安装）

```bash
python -m http.server 8080 --directory www
```

浏览器访问：http://localhost:8080

### 方式二：Node 静态服务器

```bash
npx serve www -l 8080
```

浏览器访问：http://localhost:8080

> 注意：新版 Capacitor 已移除 `npx cap serve`，请勿使用。

建议将浏览器窗口调整为手机尺寸（例如 375×812），或在 DevTools 中开启移动端模拟。

## 打包成 APK

> 说明：Capacitor 生成 APK 需要借助 Android 构建工具。最简单的做法是安装 Android Studio（它会自动安装 Android SDK），然后按下面步骤操作。这样你不需要单独手动配置 SDK 环境变量。

### 方式一：Android Studio（推荐）

1. 确保已安装 [Android Studio](https://developer.android.com/studio)。
2. 在项目根目录执行：

   ```bash
   npx cap open android
   ```

3. Android Studio 打开后，等待 Gradle 同步完成。
4. 点击菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**。
5. 构建完成后，右下角会弹出提示，点击 **locate** 即可找到 `app-debug.apk`。

### 方式二：命令行（需要配置 Android SDK）

如果你已经配置了 Android SDK 环境变量，可以直接运行：

```bash
npx cap copy android
cd android
./gradlew assembleDebug
```

生成的 APK 位于：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

## 核心计算规则

现在每次只录入两个数：**总金额** 和 **累计收益**，App 自动算出其余指标：

```
本金 = 总金额 - 累计收益

区间段收益 = 当前累计收益 - 上次累计收益
区间段充值 = 当前本金 - 上次本金
区间段收益率 = 区间段收益 / 上次本金 × 100%
```

举例：

| 日期 | 总金额 | 累计收益 | 本金 | 区间收益 | 收益率 | 充值 |
|------|--------|----------|------|----------|--------|------|
| 1 月 | 10,000 | 0        | 10,000 | 0      | 0.00%  | 10,000 |
| 2 月 | 13,000 | 2,000    | 11,000 | 2,000  | 20.00% | 1,000  |

**第一次记录时**，累计收益填 0，这样充值金额就等于初始本金，收益从 0 开始累计。

## 数据存储说明

**手机端（APK）**：数据保存在 App 私有目录的文件中（`Directory.Data`），使用 Capacitor Filesystem 插件写入。

- **清理缓存不会删除数据**：文件不在缓存目录里。
- **卸载 App 或清除全部数据会删除**：这和任何 App 一样。
- **浏览器调试时**：回退到 `localStorage`，方便在电脑上直接调试。

建议定期使用首页的「导出备份」功能生成 JSON 文件，换机或重装时可「导入备份」恢复。

## 数据备份与恢复

- 点击首页右上角下载图标，可将所有数据导出为 JSON 文件。
- 点击「导入备份」，选择之前导出的 JSON 文件即可恢复数据。
- 建议在换手机或清理数据前先导出备份。

## 项目结构

```
app_fund/
├── www/                    # 网页应用源码
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── android/                # Capacitor 生成的 Android 项目
├── docs/plans/             # 实现计划
├── capacitor.config.json   # Capacitor 配置
├── package.json
└── README.md
```

## 常用命令

```bash
# 安装依赖
npm install

# 同步网页资源到 Android 项目
npx cap copy android

# 打开 Android Studio
npx cap open android

# 在浏览器中预览
python -m http.server 8080 --directory www
```

## 网页版无法访问？

1. **确认在项目根目录运行命令**：命令里的 `www` 是相对路径，必须在 `app_fund` 文件夹内执行。
2. **确认 `www/index.html` 存在**：如果文件缺失，服务器会返回 404。
3. **换端口试试**：如果 8080 被占用，改用 8081、3000 等：
   ```bash
   python -m http.server 8081 --directory www
   ```
4. **不要用 `https`**：本地调试用 `http://localhost:8080`，不是 `https`。
5. **检查防火墙/杀毒软件**：某些安全软件会拦截本地端口。
6. **查看终端输出**：如果看到 `Serving HTTP on :: port 8080` 说明服务已启动。
