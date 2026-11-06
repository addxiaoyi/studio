# OneTake 整合与功能对照

上游固定为 `leejersey/OneTake@3a49104e2dfb9f2c7833e0ca7e1adfc4a07826d8`，登记于 `scripts/creative-sources.json`。构建校验 `asr_demo.py` SHA-256 `9b002bd9f3245cd89446dbcd094059e4899d59851316b71186d3dea93f0a9b29`，保留 README 的 MIT 全文与 One Take Team 版权声明。

入口是现有 `/video/` 的“文字剪辑”，复用本站登录、主题、合成、私有素材和聊天。

## 实际功能映射

| 上游能力 | Loomic 接入 |
| --- | --- |
| 上传、faster-whisper 转写、多语言与模型选择 | 上传授权后创建持久任务；固定上游 ASR 生成词级时间戳。支持 tiny/base/small/medium/large-v3，管理员配置开放列表。 |
| 口头禅和静音检测 | 上游检测器生成建议，用户可分别删除或恢复，确认前不导出。 |
| 删词剪辑、批量操作、改词 | 选词删除/恢复、双击改词、Delete/Backspace、撤销重做；服务端复验文本和时间范围。 |
| 波形、播放同步、快捷键 | 波形峰值、当前词高亮、按剪辑预览、倍速、空格播放和左右键跳转；长文本每页 100 词。 |
| SRT、字幕样式与比例适配 | SRT 下载，硬/软字幕或关闭字幕；字体、颜色、位置和手动字号；默认按横竖画幅自动字号与边距。 |
| 导出 | 真实 FFmpeg MP4/MOV/AVI；计划预览、一次性指纹确认，参数或修订变化不得复用审批。 |
| 历史、进度、继续编辑 | PostgreSQL 事实来源、后台 worker 租约及版本隔离、前端轮询；取消、失败重试、刷新恢复。沿用本站任务架构。 |
| 当前合成 | 预览替换当前合成，版本检查和持久动作 ID 防止刷新重复应用。 |
| 交付与回流 | MP4 保存私有素材并幂等发送聊天。MOV/AVI 下载交付，不伪称已写入仅支持 MP4 的素材接口。 |

上游 README 提及“重复内容检测”和“自定义检测规则”，固定版本实际 API/UI 未形成对应功能闭环，本次没有将宣传描述记为已实现能力。音频上传用于转写/SRT，当前视频输出要求视频源。

## 服务运行

```text
HELSTERA_ONETAKE_PYTHON=/absolute/path/to/venv/bin/python
HELSTERA_ONETAKE_MODELS=tiny,base
HF_HOME=/absolute/path/to/model-cache
```

安装 `apps/server/src/features/onetake/requirements.txt`，提供 FFmpeg/ffprobe 和中文字体。硬字幕需要 subtitles/libass filter；不可用时界面仅提供软字幕/无字幕。生产仅开放已经下载并加载验证的 tiny/base，避免大模型耗尽现有内存。

API 前缀 `/api/video/onetake`，Worker 位于 `features/onetake/worker.ts`。上传限 500MB，临时文件保留三天，须在到期前下载或保存私有素材；私有素材 MP4 上限 250MB。没有新增模型扣费，服务器转写/导出仍须明确确认。

安全约束包含用户拥有权、输入边界、上传幂等键、修订锁、精确指纹、租约隔离迟到回执、取消进程树及输出校验。引擎错误显式写入任务，空文件不能标记成功。

验收结果及安装包边界见 [当前合成 AI 编辑验收](video-ai-editor-acceptance-20261106.md)。
