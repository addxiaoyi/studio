import Link from "next/link";
import { OperatorContact } from "@/components/operator-contact";
import { PublicInformationPage } from "@/components/public-information-page";

export default function SecurityPage() {
  return (
    <PublicInformationPage title="安全与数据使用说明" summary="了解账号、私有素材、供应商调用与问题反馈的处理方式。">
      <section><h2>账号与访问</h2><p>网站使用 HTTPS。私有项目、资产和账单需要登录并核验相应权限；公开发布的作品按公开页面规则访问。请勿共享登录凭据，使用完公共设备后及时退出。</p></section>
      <section><h2>任务与费用确认</h2><p>生成任务的模型、参数及费用按确认记录处理。页面显示失败、等待核验或取消时，请保留任务编号；实际费用处理见<Link href="/refund-policy/">退款说明</Link>。</p></section>
      <section><h2>文件与保存</h2><p>云端生成素材有保留期限，本地副本由设备保存。请在到期前下载重要内容，并独立备份工程与原始媒体。当前支持范围见<Link href="/docs/">使用说明</Link>，信息处理方式见<Link href="/privacy/">隐私政策</Link>。</p></section>
      <section><h2>安全问题反馈</h2><p className="mb-4">请提供出现问题的页面、时间、操作步骤和请求编号。请勿发送密码、验证码或其他用户的私有素材。</p><OperatorContact /></section>
    </PublicInformationPage>
  );
}
