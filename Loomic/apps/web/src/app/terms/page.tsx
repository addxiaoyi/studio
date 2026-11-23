import Link from "next/link";
import { OperatorContact } from "@/components/operator-contact";
import { PublicInformationPage } from "@/components/public-information-page";

export default function TermsPage() {
  return (
    <PublicInformationPage title="服务条款" summary="使用 Helstera 前，请了解创作、计费、保存和问题处理规则。">
      <section><h2>1. 服务范围</h2><p>Helstera 提供画布、工作流及图片、视频创作工具。具体功能、可选模型和限制以当前页面与<Link href="/docs/">使用说明</Link>为准；企业定制、服务等级和其他特殊安排需另行确认。</p></section>
      <section><h2>2. 账号与内容</h2><p>请妥善保管账号，确保上传素材和提示词具有使用授权，不使用服务从事违法、侵权或损害他人权益的活动。您保留原有内容的权利；AI 生成结果的使用需遵守适用法律及相应模型的使用条件，发布前请自行检查内容质量与权利。</p></section>
      <section><h2>3. 积分与费用</h2><p>积分用于支付平台内的创作服务。充值兑换、模型价格和计费单位以支付及确认页面为准；按次、按秒和按实际 Token 用量的计费方式不同。付费生成在确认后执行，费用变化可能需要重新确认。任务取消或失败不必然意味着供应商未产生费用，争议按<Link href="/refund-policy/">退款与充值争议规则</Link>处理。</p></section>
      <section><h2>4. 素材保存与恢复</h2><p>请在页面显示的保留期限内下载重要素材。云端生成素材通常保留 3 天；本机副本与云端副本分别管理。工程恢复可能需要原始媒体文件，无法访问或已到期的素材不会因恢复工程描述而自动恢复。</p></section>
      <section><h2>5. 服务变化与故障</h2><p>模型能力和可用性可能受供应商及设备条件影响。遇到故障时请保留工程、订单或任务编号并联系客服。价格或功能调整以更新后的页面说明为准，已确认任务按对应记录核对处理。</p></section>
      <section><h2>6. 联系与反馈</h2><OperatorContact /><p className="mt-4">个人信息处理方式见<Link href="/privacy/">隐私政策</Link>。</p></section>
    </PublicInformationPage>
  );
}
