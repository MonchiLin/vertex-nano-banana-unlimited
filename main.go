package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"

	"vertex-nano-banana-unlimited/internal/app"
	"vertex-nano-banana-unlimited/internal/proxy"
)

func main() {
	preloadProxies(context.Background())
	fmt.Println("🧪 HTTP 测试服务已启动：POST /run 支持 multipart（image/prompt/scenarioCount）或 JSON（image/prompt/scenarioCount）。")
	fmt.Println("🩺 健康检查：GET /healthz")

	// 固定端口配置
	addr := ":8080"

	fmt.Printf("🌐 服务器启动在端口 8080 (支持CORS跨域请求)\n")
	if err := app.StartHTTPServer(context.Background(), addr); err != nil {
		log.Fatalf("❌ HTTP 服务异常: %v", err)
	}
}

func preloadProxies(ctx context.Context) {
	_ = godotenv.Load()
	sub := os.Getenv("PROXY_SINGBOX_SUB_URLS")
	if strings.TrimSpace(sub) == "" {
		fmt.Println("ℹ️ 启动时未配置 PROXY_SINGBOX_SUB_URLS（默认直连）")
		return
	}
	fmt.Println("🧭 检测到 PROXY_SINGBOX_SUB_URLS，启动时预下载 sing-box 二进制和订阅缓存")
	if err := proxy.WarmupSingBox(ctx); err != nil {
		fmt.Printf("⚠️ 预下载 sing-box 失败：%v\n", err)
	} else {
		fmt.Println("✅ sing-box 预下载完成")
	}
}
