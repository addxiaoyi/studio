# 2026-11-15 OneTake 真实语音与导出补验

本轮补齐此前因 `HELT_ONETAKE_TEST_SOURCE` 与 Python 运行环境缺失而跳过的真实 OneTake 集成测试。没有读取用户语音、调用付费供应商、修改生产环境或部署服务。

## 本机隔离环境

- Python 3.11 独立 venv：`D:/UserCache/Temp/helstera-onetake-verify-20261115`。
- 按仓库 requirements 安装 `faster-whisper==1.2.1`、`numpy==2.2.6`，使用本机已配置的 PyPI 镜像；安装日志记录实际传递依赖版本，没有修改全局 Python。
- 复用 `Systran/faster-whisper-tiny` 本地模型，revision `d90ca5fe260221311c53c58e660288d3deb8d356`，模型 SHA-256 `dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1`。
- 转写设置 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、CPU/int8；没有下载模型或传输音视频。
- Windows `System.Speech` 离线 TTS 直接输出 WAV，再用 FFmpeg 测试画面合成 MP4，没有播放声音或更改 Windows 执行策略。

测试原文：

> Welcome to the video editor. We can edit a video by changing the transcript. Please keep this sentence and export the finished video.

素材长 9.237732 秒，993,988 字节，SHA-256 `deea4b4abc09ef90fe15b7e2c31e9ee9cf26e69ca0cc7c7ea235abaa5388fda7`。ASR 输出 23 个词，与原文一致；输出 1,200 个波形峰值，最大值 0.6045。

## 验证范围

原有真实集成测试通过后，增强 `runner.integration.test.ts`：

- 可用 `HELT_ONETAKE_TEST_TEXT` 传入已知原文，规范大小写、标点和空格后精确比较内容。
- 删除首词、替换下一词并删除静音后导出 MP4、MOV、AVI，文件大小和时长符合编辑计划。
- 每种文件经真实 FFmpeg 完整解码。
- FFprobe 确认 720×1280；MOV 包含 `mov_text` 软字幕，MP4/AVI 使用烧录字幕，无软字幕轨；SRT 保留编辑后的 `EDITED`。

最终 runner 集成与单元测试共 **7/7 通过，零跳过**。新增实际覆盖为原先跳过的 1 项，不能重复计入此前已通过的 6 项。Server 类型检查、该测试文件的 Biome 和 diff 检查通过。未发现需要修改业务 `runner.py` 或固定上游来源的故障。

## 证据与复现

忽略目录 `.creative-test-results/` 中保留：

- `onetake-runtime-install-20261115.log`：隔离依赖安装。
- `onetake-real-verified-20261115.log` 与 `.json`：最终测试。
- `onetake-real-typecheck-20261115.log`：类型检查。
- `onetake-real-20261115/speech.wav`、`speech.mp4`、`transcript.json`、`evidence.json`：合成素材、真实转写及模型/素材摘要。

项目根目录复现：

```powershell
$env:HELSTERA_ONETAKE_PYTHON = 'D:/UserCache/Temp/helstera-onetake-verify-20261115/Scripts/python.exe'
$env:HELT_ONETAKE_TEST_SOURCE = [IO.Path]::GetFullPath('.creative-test-results/onetake-real-20261115/speech.mp4')
$env:HELT_ONETAKE_TEST_TEXT = 'Welcome to the video editor. We can edit a video by changing the transcript. Please keep this sentence and export the finished video.'
$env:HELSTERA_ONETAKE_DEVICE = 'cpu'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
pnpm.cmd --filter @helstera/server exec vitest run src/features/onetake/runner.integration.test.ts src/features/onetake/runner.test.ts --maxWorkers=1
```

所有 ASR、FFmpeg 和测试进程已退出；没有创建数据库或常驻服务。隔离 venv 与合成素材保留供复验。此结果不证明生产配置、长音视频质量、GPU 路径或两小时素材压力验收完成。
