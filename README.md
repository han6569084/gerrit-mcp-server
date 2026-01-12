# Gerrit MCP Server

这是一个用于与 Gerrit 代码审查系统集成的 Model Context Protocol (MCP) 服务端。它允许 GitHub Copilot 等 AI 助手直接查询、下载和评价 Gerrit 上的变更。

## 功能特性 (Capabilities)

该 MCP Server 提供了以下工具：

1.  **`list_changes`**: 列出 Gerrit 变更。
    *   支持自定义查询（如 `status:open owner:self`）。
    *   可以限制返回结果的数量。
2.  **`get_change_detail`**: 获取变更详情。
    *   获取包括修订版本、提交信息、标签状态等在内的完整详细信息。
3.  **`set_review`**: 发表评审。
    *   可以发送评审意见。
    *   支持对标签（如 `Code-Review`）进行打分。
4.  **`sync_gerrit_to_local`**: 同步变更到本地。
    *   基于 `repo download` 命令，自动将 Gerrit 上的特定主题（Topic）或变更（Change ID）下载并应用到本地工作区。

## 快速开始

### 1. 确保环境准备
*   安装了 [Node.js](https://nodejs.org/)。
*   安装了 [repo](https://source.android.com/docs/setup/download/downloading#installing-repo) 工具（如果需要使用 `sync_gerrit_to_local` 功能）。

### 2. 编译项目
```bash
npm install
npm run build
```

## 在 VSCode GitHub Copilot 中使用

要在 VSCode 的 GitHub Copilot 中使用此 MCP Server，请按照以下步骤操作：

### 1. 配置环境变量
确保你的环境中配置了以下 Gerrit 访问凭据：
*   `GERRIT_HOST`: Gerrit 服务器地址（例如 `https://gerrit.example.com`）
*   `GERRIT_USER`: 你的 Gerrit 用户名
*   `GERRIT_PASSWORD`: 你的 Gerrit HTTP 密码（通常在 Gerrit 设置的 "HTTP Password" 中获取）

### 2. 编辑 VSCode 配置
打开 VSCode 的 `settings.json` 文件，在 `github.copilot.chat.mcp.localServers` 中添加该服务：

```json
{
  "github.copilot.chat.mcp.localServers": [
    {
      "name": "gerrit-mcp-server",
      "command": "node",
      "args": ["/绝对路径/到/gerrit-mcp-server/build/index.js"],
      "env": {
        "GERRIT_HOST": "https://your-gerrit-host.com",
        "GERRIT_USER": "your-username",
        "GERRIT_PASSWORD": "your-password"
      }
    }
  ]
}
```

*请注意将 `/绝对路径/到/` 替换为项目实际所在的绝对路径。*

### 3. 开始对话
在 VSCode Copilot Chat 中，你可以直接询问关于 Gerrit 的问题，例如：
*   "列出我最近打开的 Gerrit 变更"
*   "帮我查看变更 ID 为 12345 的详细内容"
*   "将主题为 'fix-bug' 的所有变更同步到本地"
