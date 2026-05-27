# Agent WebUI

Agent WebUI 是一个面向文献调研场景的 macOS 本地桌面 Agent 应用。它使用 Electron + React + TypeScript 构建，当前只接入 DeepSeek 模型，并内置 `literature-research` 文献调研 skills，目标是让用户双击打开应用、配置 API Key 后，就能通过对话完成文献检索、调研分析和 Markdown/PDF 报告导出。

> 当前项目仍处于早期版本，适合个人本地调研、原型验证和二次开发。生成的学术内容需要人工核对原始文献后再用于正式研究或决策。

## 项目目的

- 提供一个可以本地运行的 Agent WebUI，而不是只停留在命令行或单页 HTML。
- 降低文献调研工具的使用门槛：用户只需要输入课题，Agent 会主动澄清需求、检索文献并整理报告。
- 将模型接入、会话历史、本地数据、skills 管理和报告导出整合进一个 macOS 桌面应用。
- 为后续扩展更多 skills、更多检索源和更完整的科研工作流打基础。

## 主要功能

- macOS 桌面应用：使用 Electron 打包，可生成 `.dmg` 安装包。
- DeepSeek 接入：当前仅支持 DeepSeek，默认模型为 `deepseek-v4-pro`，可切换 `deepseek-v4-flash`。
- API Key 本地保存：首次启动时弹出配置窗口，API Key 通过 Electron `safeStorage` 加密保存在本机。
- ChatGPT 风格界面：左侧会话历史，右侧主对话区，底部固定输入框。
- 多轮文献调研：用户提出课题后，Agent 会先澄清需求，再执行文献检索和报告整理。
- 文献检索：优先使用 Semantic Scholar，失败时可降级使用 OpenAlex。
- 报告导出：每次完整调研结束后生成 Markdown 和 PDF 文件，支持保存到本地。
- 中断生成：生成过程中可以点击停止按钮，避免错误问题继续消耗请求。
- Skills 管理：左侧可添加本地 skills 目录，并激活或停用不同 skills。
- 本地持久化：会话历史、设置和报告保存在本机，应用重启后仍可继续使用。

## 获取 DeepSeek API Key

1. 打开 [DeepSeek API Keys 页面](https://platform.deepseek.com/api_keys)。
2. 登录或注册 DeepSeek Platform 账号。
3. 在 API Keys 页面创建新的 API Key。
4. 复制生成的 Key，并在 Agent WebUI 首次启动弹窗中粘贴保存。
5. 如需充值、查看用量或管理 Key，可以回到 DeepSeek Platform 控制台操作。

DeepSeek 官方 API 文档地址：[https://api-docs.deepseek.com/](https://api-docs.deepseek.com/)

安全说明：

- 不要把 API Key 提交到 GitHub。
- 不要把 API Key 写进 README、截图、Issue 或日志。
- 本项目会将 API Key 加密保存在本机，renderer 界面层不会直接接触明文 Key。
- 如果怀疑 API Key 泄露，请立即到 DeepSeek Platform 删除旧 Key 并重新创建。

## 用户如何使用

面向最终用户的理想使用方式：

1. 下载项目打包生成的 `.dmg` 文件。
2. 双击打开 `.dmg`，将 `Agent WebUI.app` 拖入 Applications。
3. 打开 `Agent WebUI.app`。
4. 首次打开时填写 DeepSeek API Key。
5. 点击“新文献调研”，输入调研课题。
6. 按绿色发送按钮开始对话；输入框内回车只换行，不会直接发送。
7. 按 Agent 的澄清问题补充研究范围、年份、语言、论文类型等信息。
8. 等待调研完成后，点击 Markdown 或 PDF 按钮保存报告。

如果 macOS 提示应用来自未知开发者，可以右键点击应用选择“打开”，或到“系统设置 > 隐私与安全性”中允许打开。正式分发前建议补充 Apple Developer 签名与 notarization。

## 开发运行

### 环境要求

- macOS
- Node.js 20 或更高版本
- npm

### 克隆项目

```bash
git clone --recurse-submodules https://github.com/Rufus-willy/agent-webUI.git
cd agent-webUI
```

如果克隆时忘记拉取子模块，可以执行：

```bash
git submodule update --init --recursive
```

### 安装依赖

```bash
npm install
```

如果 Electron 下载较慢，可以使用国内镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install --registry=https://registry.npmmirror.com
```

### 启动开发模式

```bash
npm run dev
```

开发模式会同时启动：

- Vite renderer dev server
- TypeScript main process watch
- Electron 桌面窗口

## 打包成 DMG

执行：

```bash
npm run dist:mac
```

打包完成后，产物会出现在 `release/` 目录，例如：

```text
release/Agent WebUI-0.1.0-arm64.dmg
```

当前配置主要面向 Apple Silicon Mac。若要分发给 Intel Mac 或做通用包，可以继续扩展 `electron-builder` 的 macOS 架构配置。

## 数据存储位置

应用数据默认保存在 macOS 的应用数据目录：

```text
~/Library/Application Support/agent-webui/
```

其中通常包含：

- `agent-webui.sqlite`：本地会话历史、消息和设置。
- `reports/`：生成的 Markdown 和 PDF 调研报告。
- 加密后的 API Key 和本地配置。

注意：`.dmg` 安装包本身不会打包你的历史记录。如果你安装新版本后仍然看到之前的会话，是因为本机的 `Application Support` 数据目录还在。若想清空本地数据，可以关闭应用后执行：

```bash
rm -rf "$HOME/Library/Application Support/agent-webui"
```

这会删除历史记录、设置、已保存的 API Key 和本地报告，请谨慎操作。

## Skills 使用说明

项目内置了 `literature-research` 子模块作为默认文献调研 skill pack。应用启动后会自动加载它，用于文献检索、研究问题澄清、结果整理和报告生成。

你也可以在左侧点击 `Skills`：

- 查看当前可用 skills。
- 添加本地 skills 目录。
- 激活或停用某个 skill pack。
- 复用其他符合结构的本地技能目录。

当前支持的 skills 目录形态包括：

- 包含 `.claude-plugin/plugin.json` 的插件目录。
- 单个 `SKILL.md` 技能目录。
- `skills/*/SKILL.md` 形式的多技能目录。

## 项目结构

```text
agent-webUI/
├── literature-research/      # 文献调研 skills 子模块
├── src/
│   ├── main/                 # Electron main process 和本地服务
│   ├── preload/              # Electron preload 桥接
│   ├── renderer/             # React 界面
│   └── shared/               # 前后端共享类型
├── package.json              # 脚本、依赖和 electron-builder 配置
├── tsconfig.json
├── tsconfig.main.json
└── vite.config.ts
```

## 常用命令

```bash
npm run dev       # 开发运行
npm run build     # 构建 main 和 renderer
npm run start     # 构建后直接用 Electron 启动
npm run dist:mac  # 打包 macOS DMG
```

## 当前限制

- 第一版只支持 macOS 本地单用户使用。
- 当前只接入 DeepSeek，不支持 OpenAI、Claude、Gemini 等其他模型。
- 文献检索第一版以 Semantic Scholar 和 OpenAlex 为主，覆盖面仍需要继续增强。
- PDF 生成以本地 HTML 渲染为基础，复杂排版和图表能力还有扩展空间。
- 未完成 Apple Developer 签名和 notarization，公开分发时可能触发 macOS 安全提示。
- 生成内容不能替代人工阅读原文和学术判断。

## 后续扩展方向

- 增加更多文献数据源，例如 Crossref、PubMed、arXiv、OpenReview、Google Scholar 替代源等。
- 支持更多导出格式，例如 DOCX、BibTeX、RIS、EndNote XML。
- 增加引用管理能力，包括文献收藏、标签、去重、引用格式切换和参考文献校验。
- 增强 skills 市场能力，支持导入、更新、排序和分享自定义 skills。
- 支持更细粒度的研究流程，例如系统综述、实验方案调研、专利调研、基金申请背景调研等。
- 增加任务队列、后台运行、失败重试和长任务进度面板。
- 增加应用自动更新、签名、公证和更完整的发布流程。
- 在保持本地优先的前提下，探索团队共享、报告模板和项目级知识库。

## 隐私与安全

- 项目不包含云端账号系统。
- 会话历史和报告默认保存在用户本机。
- API Key 使用 Electron `safeStorage` 加密保存。
- 调研过程中会向 DeepSeek API 发送用户输入、上下文和待生成内容。
- 文献检索会请求 Semantic Scholar、OpenAlex 等公开文献接口。

## 许可证

当前仓库尚未添加开源许可证。正式公开协作前，建议根据目标选择 MIT、Apache-2.0 或其他合适许可证，并同时确认 `literature-research` 子模块及其依赖的许可证要求。
