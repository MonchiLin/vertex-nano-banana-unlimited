package imageprocessing

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// 安全配置
const (
	// 默认超时时间
	DefaultCommandTimeout = 30 * time.Second

	// 最大允许的文件大小 (100MB)
	MaxFileSize = 100 * 1024 * 1024

	// 允许的文件扩展名
	AllowedImageExts = ".png,.jpg,.jpeg,.webp,.tiff,.bmp,.arw,.srf,.sr2"
)

// 危险字符模式
var (
	// 命令注入危险字符
	dangerousCommandChars = regexp.MustCompile(`[;&|` + "`" + `'"(){}[\]$<>]`)

	// 路径遍历危险字符
	dangerousPathChars = regexp.MustCompile(`\.\.[/\\]`)
)

// SecurityConfig 安全配置
type SecurityConfig struct {
	AllowedCommands       map[string]bool
	AllowedTempDir        string
	MaxFileSize           int64
	CommandTimeout        time.Duration
	EnableInputValidation bool
}

// DefaultSecurityConfig 返回默认安全配置
func DefaultSecurityConfig() *SecurityConfig {
	return &SecurityConfig{
		AllowedCommands: map[string]bool{
			"darktable-cli": true,
			"echo":          true, // 为测试添加
		},
		AllowedTempDir:        os.TempDir(),
		MaxFileSize:           MaxFileSize,
		CommandTimeout:        DefaultCommandTimeout,
		EnableInputValidation: true,
	}
}

// validateCommandName 验证命令名称是否安全
func validateCommandName(cmdName string, config *SecurityConfig) error {
	// 检查命令是否在允许列表中
	if !config.AllowedCommands[cmdName] {
		return fmt.Errorf("command not allowed: %s", cmdName)
	}

	// 检查危险字符
	if dangerousCommandChars.MatchString(cmdName) {
		return fmt.Errorf("command contains dangerous characters: %s", cmdName)
	}

	return nil
}

// validateCommandArgs 验证命令参数是否安全
func validateCommandArgs(args []string) error {
	for _, arg := range args {
		// 检查命令注入字符
		if dangerousCommandChars.MatchString(arg) {
			return fmt.Errorf("argument contains dangerous characters: %s", arg)
		}

		// 检查路径遍历
		if dangerousPathChars.MatchString(arg) {
			return fmt.Errorf("argument contains path traversal sequences: %s", arg)
		}

		// 检查参数长度（防止缓冲区溢出）
		if len(arg) > 4096 {
			return fmt.Errorf("argument too long: %s", arg)
		}
	}

	return nil
}

// safeExecuteCommand 安全地执行外部命令
func safeExecuteCommand(ctx context.Context, cmdName string, args []string, config *SecurityConfig) error {
	// 验证命令名称
	if err := validateCommandName(cmdName, config); err != nil {
		return fmt.Errorf("invalid command: %w", err)
	}

	// 验证参数
	if err := validateCommandArgs(args); err != nil {
		return fmt.Errorf("invalid arguments: %w", err)
	}

	// 设置超时上下文
	ctx, cancel := context.WithTimeout(ctx, config.CommandTimeout)
	defer cancel()

	// 创建命令
	cmd := exec.CommandContext(ctx, cmdName, args...)

	// 设置安全的工作目录
	cmd.Dir = config.AllowedTempDir

	// 执行命令
	err := cmd.Run()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("command timed out after %v: %w", config.CommandTimeout, err)
		}
		return fmt.Errorf("command execution failed: %w", err)
	}

	return nil
}

// validateFilePath 安全地验证文件路径
func validateFilePath(filePath string, config *SecurityConfig) (string, error) {
	// 清理路径
	cleanPath := filepath.Clean(filePath)

	// 检查路径遍历攻击
	if strings.Contains(cleanPath, "..") {
		return "", fmt.Errorf("path traversal detected: %s", filePath)
	}

	// 检查绝对路径（根据安全策略决定是否允许）
	if filepath.IsAbs(cleanPath) {
		// 在某些环境中可能需要限制绝对路径
		return "", fmt.Errorf("absolute paths not allowed: %s", filePath)
	}

	// 确保路径不包含危险字符
	if dangerousPathChars.MatchString(cleanPath) {
		return "", fmt.Errorf("path contains dangerous characters: %s", filePath)
	}

	// 检查路径长度
	if len(cleanPath) > 260 { // Windows MAX_PATH
		return "", fmt.Errorf("path too long: %s", filePath)
	}

	return cleanPath, nil
}

// validateFileExtension 验证文件扩展名
func validateFileExtension(filePath string) error {
	ext := strings.ToLower(filepath.Ext(filePath))

	// 检查扩展名是否在允许列表中
	allowedExts := strings.Split(AllowedImageExts, ",")
	for _, allowedExt := range allowedExts {
		if ext == allowedExt {
			return nil
		}
	}

	return fmt.Errorf("file extension not allowed: %s", ext)
}

// validateFileSize 安全地验证文件大小
func validateFileSize(filePath string, maxSize int64) error {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to get file info: %w", err)
	}

	if fileInfo.Size() > maxSize {
		return fmt.Errorf("file too large: %d bytes (max: %d)", fileInfo.Size(), maxSize)
	}

	return nil
}

// secureCreateTempFile 安全地创建临时文件
func secureCreateTempFile(pattern string, config *SecurityConfig) (*os.File, error) {
	// 在允许的临时目录中创建文件
	tempFile, err := os.CreateTemp(config.AllowedTempDir, pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}

	// 设置安全的文件权限
	err = tempFile.Chmod(0600) // 只有所有者可读写
	if err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		return nil, fmt.Errorf("failed to set secure permissions: %w", err)
	}

	return tempFile, nil
}

// secureCleanup 安全地清理资源
func secureCleanup(filePath string, keepTemp bool) error {
	if keepTemp {
		return nil
	}

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to cleanup file %s: %w", filePath, err)
	}

	return nil
}

// SecurityError 安全相关错误
type SecurityError struct {
	Type    string
	Message string
	Cause   error
}

func (e *SecurityError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("security error [%s]: %s: %v", e.Type, e.Message, e.Cause)
	}
	return fmt.Sprintf("security error [%s]: %s", e.Type, e.Message)
}

func (e *SecurityError) Unwrap() error {
	return e.Cause
}

// NewSecurityError 创建安全错误
func NewSecurityError(errorType, message string, cause error) *SecurityError {
	return &SecurityError{
		Type:    errorType,
		Message: message,
		Cause:   cause,
	}
}

// InputValidationError 输入验证错误
type InputValidationError struct {
	Field  string
	Value  string
	Reason string
}

func (e *InputValidationError) Error() string {
	return fmt.Sprintf("input validation failed for field '%s': %s (value: %s)", e.Field, e.Reason, e.Value)
}
