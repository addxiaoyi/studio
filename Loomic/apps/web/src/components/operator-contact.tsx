import { siteOperator } from "@/lib/site-operator";

export function OperatorContact() {
  return (
    <address className="space-y-2 break-words text-sm not-italic leading-7 text-muted-foreground">
      <p>运营者：{siteOperator.name}</p>
      <p>客服邮箱：<a className="rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" href={siteOperator.emailHref}>{siteOperator.email}</a></p>
      <p>联系电话：<a className="rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" href={siteOperator.phoneHref}>{siteOperator.phone}</a></p>
      <p>联系地址：{siteOperator.address}</p>
    </address>
  );
}
