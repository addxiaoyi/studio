import Link from "next/link";
import { OperatorContact } from "@/components/operator-contact";
import { PublicInformationPage } from "@/components/public-information-page";

export default function RefundPolicyPage() {
  return (
    <PublicInformationPage title="退款与充值争议处理" summary="充值到账、生成费用和退款分别核对。处理结果会通过您留下的联系方式告知。">
      <section><h2>充值与到账</h2><p>充值订单以支付渠道实际到账和订单记录为准。已付款未到账、重复扣款或金额不符时，请提供账号邮箱、订单号、支付时间及支付凭证。核实后根据具体情况补发积分或处理退款；请勿为同一问题重复支付。</p></section>
      <section><h2>生成失败与取消</h2><p>任务尚未开始、且没有供应商调用记录时，取消后已预扣的积分按任务记录退回。已经调用供应商、请求超时或结果未知的任务，需要核对执行结果和实际费用；取消操作不等于供应商已停止计费，也不代表现金退款已完成。</p><p className="mt-3">积分扣除与退回可在账单中查询。若页面状态与余额不一致，请同时提供任务编号和扣费记录；在核实前不要重复提交相同生成任务。</p></section>
      <section><h2>现金退款申请</h2><p>已实际消耗的积分通常不支持现金退款；重复付款、系统故障和其他争议会结合订单、使用记录及适用规则处理。退款方式、金额和进度经核实后确认，以支付渠道的最终记录为准。</p></section>
      <section><h2>联系客服</h2><p className="mb-4">邮件标题建议填写“充值／退款 + 订单号”。请勿发送支付密码、验证码或完整银行卡号。</p><OperatorContact /><p className="mt-4">也可通过<Link href="/contact-sales/">站内咨询</Link>提交问题并保留咨询编号。</p></section>
    </PublicInformationPage>
  );
}
