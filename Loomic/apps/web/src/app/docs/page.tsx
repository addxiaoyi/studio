import Link from "next/link";
import { PublicInformationPage } from "@/components/public-information-page";

export default function NewFeaturesGuidePage() {
  return (
    <PublicInformationPage title="使用说明与首发支持范围" summary="首次使用请先用短片和少量素材完成一次保存、预览与导出，再扩大工程规模。">
      <section><h2>浏览器与设备</h2><p>画布与视频编辑建议使用桌面版 Chrome 或 Edge 的当前稳定版本。手机浏览器适合查看项目、资产和账单；复杂画布拖拽、长时间编译和视频导出建议在电脑完成。Safari、Firefox 及手机上的完整编辑体验仍需进一步验证。</p></section>
      <section><h2>视频时长与导出</h2><p>首发建议以 90 秒以内的短视频开始，并先尝试 720p 或 1080p。单次 AI 视频生成的时长、分辨率及格式以所选模型和确认页为准。10–30 分钟 4K 工程尚未完成完整压力验收，请勿将其作为首发交付保证。</p><p className="mt-3">视频的本地预览和导出依赖设备内存、浏览器能力及原素材可用性。请保留源文件，导出完成后检查画面、声音、字幕和总时长。</p></section>
      <section><h2>图片分辨率档位</h2><p>GPT Image 系列按 1K、2K、4K 档位计费，实际像素由画幅决定。1:1 方图对应 1024 × 1024、2048 × 2048、2880 × 2880；16:9 的 4K 档为 3840 × 2160。请根据用途选择画幅与档位，并在生成后核对文件实际尺寸。</p></section>
      <section><h2>文件大小与格式</h2><ul><li>普通素材上传：单文件不超过 25 MiB。</li><li>视频工作区通过云端素材接口取回：单项不超过 250 MiB；桌面导出交接的媒体合计不超过 250 MiB。</li><li>私有视频分片上传通道：单文件不超过 2 GiB，支持 MP4 和 WebM。上传能力不代表所有设备均能顺畅编辑同等大小的工程。</li></ul><p className="mt-3">不同入口的限制独立计算，请以当前入口提示为准。超出限制时保留原文件，并拆分素材或使用本地文件重新关联。</p></section>
      <section><h2>素材保留与工程恢复</h2><p>生成图片、视频的云端副本通常保留 3 天；删除后进入恢复区的资产显示单独的恢复期限。请以资产卡片上的实际时间为准，并提前保存到电脑。工程描述同步不等于原片同步；换设备、清理浏览器数据或素材到期后，可能需要重新关联原文件。</p></section>
      <section><h2>充值与生成计费</h2><p>人民币充值按页面列出的金额兑换积分，自定义充值支持 ¥10 至 ¥50,000 的整数金额。图片和视频按所选模型的次、张或秒计费；Token 模型按实际输入与输出用量计费。具体价格以模型选择器和确认页为准。</p><p className="mt-3">确认生成前检查模型、参考素材与预算。失败、超时或取消后的费用需结合任务及供应商记录处理，详见<Link href="/refund-policy/">退款与充值争议处理</Link>。</p></section>
      <section><h2>遇到问题</h2><p>先保留工程和原始素材，记录页面地址、发生时间、任务或订单编号，再通过<Link href="/contact-sales/">联系与咨询</Link>反馈。出现“结果未知”时先核实任务状态，避免重复生成和扣费。</p><p className="mt-4"><Link href="/home/">进入工作台</Link></p></section>
    </PublicInformationPage>
  );
}
