package imageprocessing

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
)

// decodeImage 解码输入图片（支持文件路径或字节缓冲区）
func decodeImage(input interface{}) (image.Image, string, error) {
	var reader io.Reader
	var file *os.File

	switch v := input.(type) {
	case string:
		// 安全验证文件路径
		config := DefaultSecurityConfig()
		cleanPath, err := validateFilePath(v, config)
		if err != nil {
			return nil, "", NewSecurityError("path_validation", "invalid file path", err)
		}

		// 验证文件扩展名
		if err := validateFileExtension(cleanPath); err != nil {
			return nil, "", NewSecurityError("extension_validation", "invalid file extension", err)
		}

		// 验证文件大小
		if err := validateFileSize(cleanPath, MaxFileSize); err != nil {
			return nil, "", NewSecurityError("size_validation", "file size validation failed", err)
		}

		// 安全地打开文件
		file, err = os.Open(cleanPath)
		if err != nil {
			return nil, "", fmt.Errorf("failed to open file: %w", err)
		}
		defer func() {
			if closeErr := file.Close(); closeErr != nil {
				// 记录关闭错误，但不覆盖主要错误
				fmt.Printf("warning: failed to close file %s: %v\n", cleanPath, closeErr)
			}
		}()
		reader = file

	case []byte:
		// 验证字节缓冲区大小
		if len(v) > MaxFileSize {
			return nil, "", NewSecurityError("size_validation", "input data too large", nil)
		}
		reader = bytes.NewReader(v)

	default:
		return nil, "", &InputValidationError{
			Field:  "input_type",
			Value:  fmt.Sprintf("%T", input),
			Reason: "unsupported input type",
		}
	}

	// 尝试不同的图片格式解码
	// 使用 imaging 作为主要解码器
	img, err := imaging.Decode(reader)
	if err == nil {
		return img, "unknown", nil
	}

	// 如果 imaging 解码失败，尝试手动解码特定格式
	if fn, ok := reader.(io.Seeker); ok {
		fn.Seek(0, 0)
	} else if str, ok := input.(string); ok {
		file, err := os.Open(str)
		if err != nil {
			return nil, "", err
		}
		defer file.Close()
		reader = file
	} else {
		reader = bytes.NewReader(input.([]byte))
	}

	// 尝试 PNG
	if pngImg, err := png.Decode(reader); err == nil {
		return pngImg, "png", nil
	}

	// 重置 reader
	if fn, ok := reader.(io.Seeker); ok {
		fn.Seek(0, 0)
	} else if str, ok := input.(string); ok {
		file, err := os.Open(str)
		if err != nil {
			return nil, "", err
		}
		defer file.Close()
		reader = file
	} else {
		reader = bytes.NewReader(input.([]byte))
	}

	// 尝试 JPEG
	if jpegImg, err := jpeg.Decode(reader); err == nil {
		return jpegImg, "jpeg", nil
	}

	return nil, "", fmt.Errorf("unsupported image format")
}

// encodeImageWithCompression 使用高压缩编码图片
func encodeImageWithCompression(img image.Image, options ProcessImageOptions) ([]byte, string, error) {
	var buf bytes.Buffer

	switch strings.ToLower(options.OutputFormat) {
	case "jpeg":
		// JPEG 编码
		jpegOptions := &jpeg.Options{Quality: options.Quality}
		err := jpeg.Encode(&buf, img, jpegOptions)
		if err != nil {
			return nil, "", err
		}
		return buf.Bytes(), ".jpg", nil

	case "png":
		// PNG 编码（高压缩）
		err := png.Encode(&buf, img)
		if err != nil {
			return nil, "", err
		}
		return buf.Bytes(), ".png", nil

	default:
		return nil, "", fmt.Errorf("unsupported output format: %s", options.OutputFormat)
	}
}

// calculateScaleFactor 根据像素数量计算缩放因子
func calculateScaleFactor(pixels int) float64 {
	switch {
	case pixels >= 8*1024*1024: // 800万像素以上
		return 0.6
	case pixels >= 4*1024*1024: // 400-800万像素
		return 0.75
	case pixels >= 2*1024*1024: // 200-400万像素
		return 0.85
	default: // 200万像素以下
		return 1.0
	}
}

// calculateUserScaleFactor 根据用户指定的最大尺寸计算缩放因子
func calculateUserScaleFactor(width, height, maxWidth, maxHeight int) float64 {
	if maxWidth <= 0 && maxHeight <= 0 {
		return 1.0
	}

	scaleX := 1.0
	scaleY := 1.0

	if maxWidth > 0 && width > maxWidth {
		scaleX = float64(maxWidth) / float64(width)
	}

	if maxHeight > 0 && height > maxHeight {
		scaleY = float64(maxHeight) / float64(height)
	}

	// 使用较小的缩放比例，确保两个维度都满足要求
	result := math.Min(scaleX, scaleY)

	// 不放大图片
	if result > 1.0 {
		result = 1.0
	}

	return result
}

// isDarktableAvailable 安全地检查 darktable-cli 是否可用
func isDarktableAvailable() bool {
	config := DefaultSecurityConfig()
	_, err := exec.LookPath("darktable-cli")
	return err == nil && config.AllowedCommands["darktable-cli"]
}

// buildDarktableArgs 安全地构建 darktable-cli 命令参数
func buildDarktableArgs(inputPath, outputPath string, options ARWProcessOptions) ([]string, error) {
	// 验证输入参数
	if _, err := validateFilePath(inputPath, DefaultSecurityConfig()); err != nil {
		return nil, NewSecurityError("path_validation", "invalid input path", err)
	}

	if _, err := validateFilePath(outputPath, DefaultSecurityConfig()); err != nil {
		return nil, NewSecurityError("path_validation", "invalid output path", err)
	}

	// 验证 ARW 选项参数
	if options.Bitness != 8 && options.Bitness != 16 {
		return nil, &InputValidationError{
			Field:  "bitness",
			Value:  strconv.Itoa(options.Bitness),
			Reason: "must be 8 or 16",
		}
	}

	if options.Compression < 0 || options.Compression > 9 {
		return nil, &InputValidationError{
			Field:  "compression",
			Value:  strconv.Itoa(options.Compression),
			Reason: "must be between 0 and 9",
		}
	}

	args := []string{
		inputPath,
		outputPath,
	}

	// 位深设置
	bitArgs := []string{
		"--core",
		"--conf",
		"plugins/imageio/format/png/bpp=" + strconv.Itoa(options.Bitness),
	}
	args = append(args, bitArgs...)

	// 压缩级别设置
	compressionArgs := []string{
		"--core",
		"--conf",
		"plugins/imageio/format/png/compression=" + strconv.Itoa(options.Compression),
	}
	args = append(args, compressionArgs...)

	// 色彩空间设置（使用预定义的安全映射）
	colorSpaceMap := map[string]string{
		"sRGB":     "2", // REC.709
		"AdobeRGB": "1", // Adobe RGB
		"ProPhoto": "3", // ProPhoto RGB
	}
	if colorSpaceID, exists := colorSpaceMap[options.ColorSpace]; exists {
		colorSpaceArgs := []string{
			"--core",
			"--conf",
			"plugins/lighttable/export/colorspace=" + colorSpaceID,
		}
		args = append(args, colorSpaceArgs...)
	} else {
		return nil, &InputValidationError{
			Field:  "colorspace",
			Value:  options.ColorSpace,
			Reason: "must be sRGB, AdobeRGB, or ProPhoto",
		}
	}

	// 白平衡设置（使用预定义的安全映射）
	wbMap := map[string]string{
		"camera": "camera",
		"auto":   "auto",
		"manual": "manual",
	}
	if wbMode, exists := wbMap[options.WhiteBalance]; exists {
		wbArgs := []string{
			"--core",
			"--conf",
			"plugins/lighttable/export/wb=" + wbMode,
		}
		args = append(args, wbArgs...)
	} else {
		return nil, &InputValidationError{
			Field:  "whitebalance",
			Value:  options.WhiteBalance,
			Reason: "must be camera, auto, or manual",
		}
	}

	// 高质量设置
	hqArgs := []string{
		"--hq",      // 高质量模式
		"--upscale", // 允许放大（如果需要的话）
	}
	args = append(args, hqArgs...)

	// 禁用自动输出配置，使用我们的设置
	args = append(args, "--conf", "plugins/lighttable/export/overwrite=true")

	return args, nil
}

// safeExecuteDarktableCommand 安全地执行 darktable-cli 命令
func safeExecuteDarktableCommand(inputPath, outputPath string, options ARWProcessOptions) error {
	config := DefaultSecurityConfig()

	// 构建安全的命令参数
	args, err := buildDarktableArgs(inputPath, outputPath, options)
	if err != nil {
		return fmt.Errorf("failed to build command args: %w", err)
	}

	// 创建上下文
	ctx := context.Background()

	// 安全地执行命令
	return safeExecuteCommand(ctx, "darktable-cli", args, config)
}

// extractExt 提取文件扩展名
func extractExt(filename string) string {
	return strings.ToLower(filename[strings.LastIndex(filename, "."):])
}

// hasSuffixIgnoreCase 检查字符串是否有指定的后缀（忽略大小写）
func hasSuffixIgnoreCase(s, suffix string) bool {
	return strings.HasSuffix(strings.ToLower(s), strings.ToLower(suffix))
}
