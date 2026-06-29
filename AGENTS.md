# AGENTS.md - 投资收益记录 App

## 项目概述

这是一个投资收益记录 App，使用 Capacitor + 原生 HTML/CSS/JS 构建，可打包为 Android APK。

## 代码规范

### 中文注释规范

**核心原则：**
1. 代码关键字必须保持英文 - 所有编程语言的关键字、API名称、库名称等使用英文原词
2. 注释使用中文 - 代码注释、文档字符串使用中文
3. 保持代码可运行 - 注释不应影响代码的实际功能

**需要保留英文的内容：**
- 编程语言关键字：if/else/for/while/switch/function/class/import/export 等
- API 和框架名称：React/Vue/Node.js/Express 等
- 数据库相关：SELECT/INSERT/UPDATE/DELETE 等
- 前端框架和库：useState/useEffect/className 等
- 技术术语：API/SDK/DTO/VO/DAO/HTTP/JSON 等

**需要使用中文的内容：**
- 代码注释
- 方法文档注释
- 日志信息
- 异常消息

### Git 提交规范

**提交信息格式：** `类型(模块): 描述`

**提交类型：**
- feat: 新功能
- fix: 修复bug
- docs: 文档更新
- style: 代码格式
- refactor: 代码重构
- perf: 性能优化
- test: 测试相关
- chore: 构建/工具

**示例：**
```
feat(用户): 添加用户登录功能
fix(订单): 修复订单查询空指针异常
docs: 更新API文档
refactor(用户): 重构用户权限校验逻辑
```

## 项目结构

```
app_fund/
├── www/                    # Web 资源
│   ├── index.html         # 主页面
│   ├── css/
│   │   └── style.css      # 样式文件
│   ├── js/
│   │   └── app.js         # 主逻辑
│   └── favicon.svg        # 图标
├── android/                # Capacitor Android 项目
├── .github/
│   └── workflows/
│       └── build-apk.yml  # GitHub Actions 构建配置
├── capacitor.config.json  # Capacitor 配置
├── package.json           # 依赖配置
└── AGENTS.md             # 本文件
```

## 常用命令

### 开发
```bash
# 启动本地服务器
npx serve www -l 8080

# 或使用 Python
python -m http.server 8080 --directory www
```

### 构建
```bash
# 同步 Capacitor
npx cap sync android

# 构建 APK（需要 Android SDK）
cd android && ./gradlew assembleDebug
```

### Git
```bash
# 提交代码（使用中文提交信息）
git add -A
git commit -m "feat(功能): 描述"
git push origin main
```

## 数据模型

### Channel (渠道)
```javascript
{
  id: string,           // 唯一标识
  name: string,         // 渠道名称
  records: Record[]     // 记录列表
}
```

### Record (记录)
```javascript
{
  id: string,               // 唯一标识
  date: string,             // 日期
  totalValue: number,       // 总金额
  cumulativeReturn: number, // 累计收益
  principal: number,        // 本金（自动计算）
  intervalReturn: number,   // 区间收益（自动计算）
  intervalReturnRate: number, // 收益率（自动计算）
  intervalRecharge: number  // 充值金额（自动计算）
}
```

## 计算逻辑

```
本金 = 总金额 - 累计收益
区间收益 = 当前累计收益 - 上次累计收益
收益率 = 区间收益 / 上次本金 × 100%
充值金额 = 当前本金 - 上次本金
```

## 注意事项

1. 数据持久化：移动端使用 Capacitor Filesystem，浏览器使用 localStorage
2. 指纹验证：使用 capacitor-native-biometric 插件
3. 返回键处理：双击退出，内页返回首页
4. 渠道删除保护：有记录时隐藏删除按钮
