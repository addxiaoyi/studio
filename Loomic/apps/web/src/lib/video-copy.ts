import { useLocale, type Locale } from "./i18n";

const english: Record<string, string> = {
  "本次修改已全部撤销": "All edits in this plan were undone", "已撤销": "Undone", "撤销动作": "Undo action", "撤销此字幕": "Undo caption", "撤销此配乐": "Undo music", "撤销剪辑": "Undo cut", "导出当前版本": "Export current version",
  "该动作已撤销，其他动作保留。已导出的文件不受影响。": "Action undone. Other actions and existing exports are preserved.",
  "撤销记录不可用或视频已有后续编辑，请先使用时间线撤销。": "Undo history is unavailable or there are later edits. Undo later changes in the timeline first.",
  "AI 修改": "AI edit", "修改流程": "Edit workflow", "描述要求": "Describe", "确认方案": "Review", "预览与导出": "Preview and export",
  "请先同步上一视频的修改记录，再继续编辑。": "Sync the previous video's edit history before continuing.",
  "音乐起播时间必须在当前视频时长内。": "Music must start within the current video duration.",
  "方案包含未选择的音乐，请先选择配乐后重新预览。": "The plan includes unselected music. Choose music and preview again.",
  "已恢复保存的修改，可继续预览和导出；本次打开没有可用的撤销记录。": "Saved edits restored. You can preview and export; undo history is unavailable after reopening.",
  "修改对象": "Editing", "当前视频": "Current video", "正在读取当前视频…": "Reading the current video…", "秒": "s", "横屏": "Landscape", "竖屏": "Portrait", "参考选中内容": "Selected reference",
  "想怎样修改？": "What would you like to change?", "例如：保留当前画面，在前两秒加上标题“新品上市”。": "For example: keep the visuals and add a New Arrivals title for the first two seconds.",
  "添加标题": "Add title", "添加字幕": "Add captions", "添加配乐": "Add music", "剪辑素材": "Edit clips",
  "在视频开头添加简短标题，保留现有画面。": "Add a short opening title while keeping the existing visuals.",
  "根据当前画面添加简短说明字幕，保留现有画面。": "Add short descriptive captions while keeping the existing visuals.",
  "用已导入的视频素材整理剪辑节奏，先给出剪辑方案。": "Propose a cut using the imported video clips.",
  "先预览修改方案，确认后才改变时间线。字幕文案由模型生成。": "Review the plan before changing the timeline. Caption text is model-written.",
  "背景音乐（可选）": "Background music (optional)", "导入背景音乐": "Import background music", "导入音乐": "Import music", "不添加音乐": "No music",
  "当前工程还没有音乐，导入后即可设置起播时间和音量。": "Import music to choose its start time and volume.",
  "预览修改方案": "Preview edit plan", "输入修改要求，或选择上方的常用操作。": "Describe an edit or choose a suggested action above.",
  "修改已应用": "Edits applied", "确认这些修改": "Review these edits", "已确认": "Reviewed", "确认并应用修改": "Confirm and apply edits", "放弃方案，继续编辑要求": "Discard plan and revise request",
  "查看时间线": "View timeline", "导出视频": "Export video", "撤销本次修改": "Undo these edits", "重试同步记录": "Retry history sync",
  "当前视频或素材已改变，请重新预览方案。": "The video or media changed. Preview a new plan.",
  "已切换视频，请为当前视频重新预览方案。": "Video changed. Preview a new plan for this video.",
  "修改已应用。可在时间线预览，满意后导出视频。": "Edits applied. Preview the timeline, then export when ready.",
  "请在导出窗口确认格式和文件名，完成后可在下方预览并保存成片。": "Choose the format and filename. The finished export will appear below for preview and saving.",
  "已撤销本次修改，可以调整要求后重新预览方案。": "Edits undone. Revise the request and preview another plan.",
  "方案已放弃，视频没有修改。": "Plan discarded. The video was not changed.",
  "已恢复修改记录，时间线未重复修改。": "Edit history restored without repeating the changes.",
  "修改记录已同步，没有重复修改视频。": "Edit history synced without repeating the changes.",
  "请选择不超过250MB的MP3、WAV、OGG或M4A音乐文件。": "Choose an MP3, WAV, OGG or M4A file up to 250 MB.",
  "音乐没有加入当前工程，请重新导入。": "Music was not added to the project. Import it again.",
  "音乐已导入，请确认音量后预览方案。": "Music imported. Check its volume, then preview the plan.",
  "正在处理当前修改，请完成后再切换修改对象。": "Finish the current edit before changing its target.",
  "编辑要求已达到字数上限，请缩短后再添加。": "The edit request is too long. Shorten it before adding more.",
  "旧方案清理失败，请刷新前保留当前要求。": "Could not clear the old plan. Keep your request before refreshing.",
  "来自编辑器的上下文": "Context from editor", "合成": "Composition", "移除": "Remove", "查看选中内容": "View selected context",
  "已连接本站 AI。补充编辑要求，生成计划后逐项确认。": "Connected to Loomic AI. Describe the edit, then review each planned action.",
  "请先保存或放弃文字剪辑修改，再打开 AI 编辑。": "Save or discard transcript edits before opening AI editing.",
  "当前合成已切换，请重新从该合成发送上下文。": "The composition changed. Send context from that composition again.",
  "编辑要求与上下文合计过长，请缩短要求或移除上下文后重试。": "The request and context are too long. Shorten the request or remove the context.",
  "视频创作": "Video studio", "视频创作工作台": "Video workspace", "导入素材，在同一工程里剪辑、预览和导出": "Import, edit, preview and export in one project",
  "AI 编辑": "AI editor", "关闭 AI 编辑": "Close AI editor", "成片与导出": "Finished videos and exports", "本机导出记录": "Local exports",
  "正在加载视频创作工作台…": "Loading video workspace…", "正在加载视频工程…": "Loading project…", "编辑器已就绪": "Editor ready", "工程已保存在本机": "Project saved locally", "正在编译工程…": "Compiling project…", "编辑器暂不可用": "Editor unavailable", "重新打开编辑器": "Reopen editor",
  "导入本机素材": "Import local media", "从 Loomic 素材库导入": "Import from Loomic library", "选择素材": "Choose media", "选择图片或视频": "Choose an image or video", "素材库暂无可用素材": "No media in the library", "导入编辑器": "Import into editor", "正在处理…": "Working…", "前往素材库": "Open asset library",
  "AI 编辑当前合成": "AI editor for this composition", "模型生成计划，逐项确认后修改当前时间线。": "Review each model-generated action before changing the timeline.", "描述视频编辑目标": "Describe your video edit", "例如：剪成 30 秒竖屏视频，加标题字幕和已导入的音乐": "For example: make a 30-second portrait video with a title and imported music",
  "背景音乐素材": "Background music", "由计划选择现有素材": "Let the plan select existing media", "音乐音量": "Music volume", "音乐起播（秒）": "Music starts at (seconds)", "导入 MP3、WAV、OGG 或 M4A 后可选配乐。使用已有素材：0 积分。": "Import MP3, WAV, OGG or M4A to select music. Existing media: 0 credits.",
  "正在恢复编辑记录…": "Restoring edit history…", "生成 AI 编辑计划": "Generate edit plan", "正在等待编辑器连接。": "Waiting for the editor.", "计划预览 · 模型生成": "Plan preview · Generated by model", "已应用到当前合成": "Applied to this composition", "确认并修改当前合成": "Confirm and edit composition", "重试同步回执": "Retry receipt sync", "成片已保存": "Video saved", "导出已确认的合成": "Export approved composition", "素材列表版本": "Media list version",
  "剪辑已保存在当前合成，导出尚未执行。": "Edits saved to the composition. Export has not started.", "计划已应用并保存在当前合成，可使用撤销恢复。": "Plan applied and saved. Use Undo to restore.", "已取消导出，没有生成文件。": "Export canceled. No file was generated.", "服务端已收到回执，未重复修改时间线或导出。": "Receipt synced. No edit or export was repeated.", "已恢复编辑记录并补回服务端回执，未重复修改时间线。": "History restored and receipt synced without repeating edits.",
  "下载文件": "Download file", "正在保存…": "Saving…", "保存到私有素材库（三天临时副本）": "Save privately (three-day cloud copy)", "发送到聊天": "Send to chat", "正在加载会话": "Loading chats", "聊天会话": "Chat", "选择会话": "Choose a chat", "没有可用会话": "No chats available", "发送": "Send", "已发送。": "Sent. ", "打开聊天": "Open chat",
  "编辑记录恢复失败，请重试。": "Could not restore edit history. Retry.", "视频编辑失败，请重试。": "Video editing failed. Retry.", "当前合成或素材已改变，请重新生成计划。": "Composition or media changed. Generate a new plan.", "合成已改变，请重新预览导出计划。": "Composition changed. Preview the export again.",
  "请在桌面客户端执行本机 FFmpeg 导出，或使用编辑器的渲染功能。": "Use the desktop app for local FFmpeg export, or render in the editor.", "成片已保存，但预览记录尚不可用。请从本地素材目录恢复。": "Video saved, but its preview is unavailable. Restore it from your local asset folder.",
  "素材保存失败，本机导出文件仍保留，可重试上传。": "Upload failed. Your local export is preserved; retry uploading.", "素材保存响应无效，请重试原上传。": "Invalid save response. Retry the same upload.", "保存失败，请重试。": "Save failed. Retry.", "无法加载素材库，请重试。": "Could not load the library. Retry.", "本机素材导入失败。": "Local media import failed.", "导入失败，请重试。": "Import failed. Retry.", "素材缺少文件标识，请刷新素材库后重试。": "File identity is missing. Refresh the library and retry.", "请选择非空图片、音频或视频，每个文件不超过 250 MB。": "Choose nonempty image, audio or video files, up to 250 MB each.",
  "无法加载聊天会话，请重试。": "Could not load chats. Retry.", "聊天会话数据无效。": "Invalid chat response.", "无法加载聊天会话。": "Could not load chats.", "发送失败，素材或会话可能已不可用，请重试。": "Media or chat is unavailable. Refresh and retry.", "发送失败，请重试。": "Sending failed. Retry.",
};
export function videoText(locale: Locale, text: string): string {
  if (locale !== "en-US") return text;
  if (english[text]) return english[text];
  if (text.startsWith("成片已保存：")) return "Video saved: " + text.slice(6);
  if (text.startsWith("无法读取本机导出记录：")) return "Could not load local exports: " + text.slice(11);
  if (text.startsWith("工程保存失败：")) return "Project save failed: " + text.slice(7);
  return text;
}
export function useVideoText() { const locale = useLocale(); return (text: string) => videoText(locale, text); }
