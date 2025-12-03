# Vertex Nano Banana Unlimited

![tour.png](screenshots/tour.png)

## 环境要求

- **Go 1.22+**
- **Node.js 18+**
- **Chrome/Chromium 浏览器**

使用前提：sing-box 格式的订阅链接（支持多个）。
原理基于无限试用，生成一次后大概率触发 429，所以要配置多个节点，程序已经内置了代理管理，只需在 .env 配置订阅地址即可。

已知限制：
1. 无法上传 7M 以上的图片，程序已内置压缩逻辑，通过前端/接口使用无需处理。
2. 可能有些 playwright 的 case 没覆盖到。

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/MonchiLin/vertex-nano-banana-unlimited.git
cd vertex-nano-banana-unlimited
```

### 2. 后端设置

```bash
# 安装 Playwright 浏览器
go run github.com/playwright-community/playwright-go/cmd/playwright@v0.5200.1 install chromium

# 启动后端服务器（固定端口 8080）
go run .
```

### 2. 前端设置

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（端口 5173）
npm run dev
```

### 3. 环境变量配置

在项目根目录创建 `.env` 文件：

```bash
# .env
# sing-box 订阅链接（支持多个，逗号分隔，标准 sing-box JSON 或 Base64 JSON）
# 示例：
# PROXY_SINGBOX_SUB_URLS=https://example.com/sub1.json,https://example.com/sub2.json
PROXY_SINGBOX_SUB_URLS=
```

### 代理设置说明

- **格式**: 标准 sing-box JSON 或 Base64 编码格式
- **多个订阅**: 用逗号分隔不同的订阅 URL
- **可选配置**: 留空则直接连接，不使用代理
- **配置示例**:
  ```bash
  PROXY_SINGBOX_SUB_URLS=https://<URL1>,https://<URL2>
  ```

### 5. 访问应用

- 前端界面: http://localhost:5173
- 后端 API: http://localhost:8080
