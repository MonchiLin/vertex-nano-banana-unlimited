package imageprocessing

import (
	"bytes"
	"fmt"
	"os"

	"github.com/disintegration/imaging"
)

// ProcessImageOptions 通用图片优化选项
type ProcessImageOptions struct {
	MaxSizeBytes int64  // 最大文件大小（字节），默认 7MB
	MaxWidth     int    // 最大宽度，默认不限制
	MaxHeight    int    // 最大高度，默认不限制
	Quality      int    // JPEG 质量（1-100），仅对 JPEG 输出有效
	OutputFormat string // 输出格式："png" 或 "jpeg"
	TempDir      string // 临时目录，默认使用系统临时目录
}

// ARWProcessOptions ARW 处理选项
type ARWProcessOptions struct {
	Bitness      int     // 输出位深：8 或 16，默认 16
	Compression  int     // PNG 压缩级别 0-9，默认 6
	ColorSpace   string  // 色彩空间："sRGB", "AdobeRGB", "ProPhoto"，默认 "sRGB"
	WhiteBalance string  // 白平衡："camera", "auto", "manual"，默认 "camera"
	Exposure     float64 // 曝光补偿，默认 0.0
	Contrast     float64 // 对比度，默认 0.0
	Saturation   float64 // 饱和度，默认 0.0
	TempDir      string  // 临时目录，默认使用系统临时目录
	KeepTemp     bool    // 是否保留临时文件，默认 false
}

// DefaultProcessImageOptions 返回默认的处理选项
func DefaultProcessImageOptions() ProcessImageOptions {
	return ProcessImageOptions{
		MaxSizeBytes: 7 * 1024 * 1024, // 7MB
		MaxWidth:     0,               // 不限制
		MaxHeight:    0,               // 不限制
		Quality:      85,              // 默认质量
		OutputFormat: "png",           // 默认输出 PNG
		TempDir:      "",              // 使用系统临时目录
	}
}

// DefaultARWProcessOptions 返回默认的 ARW 处理选项
func DefaultARWProcessOptions() ARWProcessOptions {
	return ARWProcessOptions{
		Bitness:      16,       // 16bit 输出
		Compression:  6,        // 中等压缩
		ColorSpace:   "sRGB",   // sRGB 色彩空间
		WhiteBalance: "camera", // 相机白平衡
		Exposure:     0.0,      // 无曝光补偿
		Contrast:     0.0,      // 无对比度调整
		Saturation:   0.0,      // 无饱和度调整
		TempDir:      "",       // 使用系统临时目录
		KeepTemp:     false,    // 不保留临时文件
	}
}

// ProcessImage 通用图片优化器 - 将任意图片转换为 PNG 或 JPEG，限制文件大小
func ProcessImage(input interface{}, options ProcessImageOptions) ([]byte, string, error) {
	// 设置默认选项
	if options.MaxSizeBytes <= 0 {
		options.MaxSizeBytes = DefaultProcessImageOptions().MaxSizeBytes
	}
	if options.Quality <= 0 {
		options.Quality = DefaultProcessImageOptions().Quality
	}
	if options.OutputFormat == "" {
		options.OutputFormat = DefaultProcessImageOptions().OutputFormat
	}
	if options.TempDir == "" {
		options.TempDir = os.TempDir()
	}

	// 读取输入图片
	img, _, err := decodeImage(input)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode image: %w", err)
	}

	// 获取原始尺寸
	originalBounds := img.Bounds()
	originalWidth := originalBounds.Dx()
	originalHeight := originalBounds.Dy()
	originalPixels := originalWidth * originalHeight

	// 步骤 1: 原尺寸 + 高压缩导出
	result, ext, err := encodeImageWithCompression(img, options)
	if err != nil {
		return nil, "", fmt.Errorf("failed to encode image: %w", err)
	}

	// 检查文件大小
	if int64(len(result)) <= options.MaxSizeBytes {
		return result, ext, nil
	}

	// 步骤 2: 根据像素数量智能缩小
	scaleFactor := calculateScaleFactor(originalPixels)

	// 检查用户指定的最大尺寸限制
	if options.MaxWidth > 0 || options.MaxHeight > 0 {
		userScaleFactor := calculateUserScaleFactor(originalWidth, originalHeight, options.MaxWidth, options.MaxHeight)
		if userScaleFactor < scaleFactor {
			scaleFactor = userScaleFactor
		}
	}

	// 逐步缩小直到满足大小要求或达到最小缩放比例
	currentFactor := 1.0
	minFactor := 0.1 // 最小缩放到 10%

	for currentFactor >= minFactor {
		targetFactor := currentFactor * scaleFactor

		// 确保不放大图片
		if targetFactor > 1.0 {
			targetFactor = 1.0
		}

		// 缩放图片
		newWidth := int(float64(originalWidth) * targetFactor)
		newHeight := int(float64(originalHeight) * targetFactor)

		// 使用高质量缩放
		scaledImg := imaging.Resize(img, newWidth, newHeight, imaging.Lanczos)

		// 编码并检查大小
		result, ext, err = encodeImageWithCompression(scaledImg, options)
		if err != nil {
			return nil, "", fmt.Errorf("failed to encode scaled image: %w", err)
		}

		if int64(len(result)) <= options.MaxSizeBytes {
			return result, ext, nil
		}

		// 如果还不够小，继续缩小
		currentFactor = targetFactor * 0.8 // 每次再缩小 20%
	}

	// 如果还是太大，使用最后一个结果
	return result, ext, nil
}

// ProcessImageToFile 处理图片并保存到文件
func ProcessImageToFile(input interface{}, outputPath string, options ProcessImageOptions) error {
	data, ext, err := ProcessImage(input, options)
	if err != nil {
		return err
	}

	// 确保输出路径有正确的扩展名
	if !hasSuffixIgnoreCase(outputPath, ext) {
		outputPath += ext
	}

	return os.WriteFile(outputPath, data, 0644)
}

// ProcessImageToTempFile 安全地处理图片并保存到临时文件
func ProcessImageToTempFile(input interface{}, options ProcessImageOptions) (string, error) {
	data, _, err := ProcessImage(input, options)
	if err != nil {
		return "", err
	}

	// 设置默认临时目录
	if options.TempDir == "" {
		options.TempDir = os.TempDir()
	}

	// 获取安全配置
	config := DefaultSecurityConfig()
	config.AllowedTempDir = options.TempDir

	// 安全地创建临时文件
	tempFile, err := secureCreateTempFile("processed_*.png", config)
	if err != nil {
		return "", fmt.Errorf("failed to create secure temp file: %w", err)
	}

	tempPath := tempFile.Name()

	// 确保资源清理
	defer func() {
		if closeErr := tempFile.Close(); closeErr != nil {
			fmt.Printf("warning: failed to close temp file %s: %v\n", tempPath, closeErr)
		}
	}()

	// 写入数据
	if _, err := tempFile.Write(data); err != nil {
		// 清理失败的临时文件
		if cleanupErr := secureCleanup(tempPath, false); cleanupErr != nil {
			fmt.Printf("warning: failed to cleanup temp file %s: %v\n", tempPath, cleanupErr)
		}
		return "", fmt.Errorf("failed to write temp file: %w", err)
	}

	// 确保数据写入磁盘
	if err := tempFile.Sync(); err != nil {
		if cleanupErr := secureCleanup(tempPath, false); cleanupErr != nil {
			fmt.Printf("warning: failed to cleanup temp file %s: %v\n", tempPath, cleanupErr)
		}
		return "", fmt.Errorf("failed to sync temp file: %w", err)
	}

	return tempPath, nil
}

// ProcessARWToPNG 安全地将 ARW 文件转换为高质量 PNG
func ProcessARWToPNG(arwPath string, options ARWProcessOptions) ([]byte, error) {
	// 设置默认选项
	if options.TempDir == "" {
		options.TempDir = os.TempDir()
	}

	// 获取安全配置
	config := DefaultSecurityConfig()
	config.AllowedTempDir = options.TempDir

	// 安全验证输入文件路径
	cleanPath, err := validateFilePath(arwPath, config)
	if err != nil {
		return nil, NewSecurityError("path_validation", "invalid ARW file path", err)
	}

	// 验证文件扩展名
	if err := validateFileExtension(cleanPath); err != nil {
		return nil, NewSecurityError("extension_validation", "invalid file extension for ARW", err)
	}

	// 验证文件大小
	if err := validateFileSize(cleanPath, MaxFileSize); err != nil {
		return nil, NewSecurityError("size_validation", "ARW file too large", err)
	}

	// 检查文件是否存在
	if _, err := os.Stat(cleanPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("ARW file does not exist: %s", cleanPath)
	}

	// 安全检查 darktable-cli 是否可用
	if !isDarktableAvailable() {
		return nil, fmt.Errorf("darktable-cli is not available. Please install darktable-cli")
	}

	// 安全地创建临时输出文件
	tempOutput, err := secureCreateTempFile("arw_output_*.png", config)
	if err != nil {
		return nil, fmt.Errorf("failed to create secure temp output file: %w", err)
	}
	tempOutputPath := tempOutput.Name()

	// 确保资源清理
	defer func() {
		if closeErr := tempOutput.Close(); closeErr != nil {
			fmt.Printf("warning: failed to close temp output file %s: %v\n", tempOutputPath, closeErr)
		}

		if cleanupErr := secureCleanup(tempOutputPath, options.KeepTemp); cleanupErr != nil {
			fmt.Printf("warning: failed to cleanup temp output file %s: %v\n", tempOutputPath, cleanupErr)
		}
	}()

	// 使用安全的命令执行
	if err := safeExecuteDarktableCommand(cleanPath, tempOutputPath, options); err != nil {
		return nil, fmt.Errorf("darktable-cli execution failed: %w", err)
	}

	// 安全地读取生成的 PNG 文件
	pngData, err := os.ReadFile(tempOutputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read output PNG file: %w", err)
	}

	// 验证输出文件大小
	if len(pngData) > MaxFileSize {
		return nil, NewSecurityError("size_validation", "output PNG file too large", nil)
	}

	return pngData, nil
}

// ValidateARWFile 安全地验证 ARW 文件是否有效
func ValidateARWFile(arwPath string) error {
	// 获取安全配置
	config := DefaultSecurityConfig()

	// 安全验证文件路径
	cleanPath, err := validateFilePath(arwPath, config)
	if err != nil {
		return NewSecurityError("path_validation", "invalid ARW file path", err)
	}

	// 验证文件扩展名
	if err := validateFileExtension(cleanPath); err != nil {
		return NewSecurityError("extension_validation", "invalid file extension for ARW", err)
	}

	// 验证文件大小
	if err := validateFileSize(cleanPath, MaxFileSize); err != nil {
		return NewSecurityError("size_validation", "ARW file size validation failed", err)
	}

	// 获取文件信息
	fileInfo, err := os.Stat(cleanPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("file does not exist: %s", cleanPath)
	}
	if err != nil {
		return fmt.Errorf("failed to access file: %w", err)
	}

	// 检查文件大小
	if fileInfo.Size() == 0 {
		return fmt.Errorf("file is empty: %s", cleanPath)
	}

	// 检查文件扩展名（双重验证）
	ext := extractExt(cleanPath)
	if ext != ".arw" && ext != ".srf" && ext != ".sr2" {
		return fmt.Errorf("unsupported file extension: %s (expected .arw, .srf, or .sr2)", ext)
	}

	// 安全地打开文件进行头部验证
	file, err := os.Open(cleanPath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			fmt.Printf("warning: failed to close ARW file %s: %v\n", cleanPath, closeErr)
		}
	}()

	// 读取文件头验证 ARW 格式（限制读取大小）
	buffer := make([]byte, 512) // 限制头部读取大小
	n, err := file.Read(buffer)
	if err != nil && n == 0 {
		return fmt.Errorf("failed to read file header: %w", err)
	}
	buffer = buffer[:n] // 只使用实际读取的字节

	// 简单的 ARW 文件头验证
	isValidARW := bytes.Contains(buffer, []byte("ARW")) ||
		bytes.Contains(buffer, []byte("SONY")) ||
		bytes.Contains(buffer, []byte("\x00\x00\x00\x18FTYP")) // 某些 ARW 的魔数

	if !isValidARW {
		return fmt.Errorf("file does not appear to be a valid ARW file: %s", cleanPath)
	}

	return nil
}
