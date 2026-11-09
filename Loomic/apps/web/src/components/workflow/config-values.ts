export const workflowFieldNames: Record<string, string> = {
  id:"标识",field:"字段",operator:"比较",value:"值",pageLimit:"页面数量",mediaType:"素材类型",shotCount:"镜头数量",at:"取帧时刻",
  title: "名称",
  note: "备注",
  kind: "节点类型",
  text: "内容",
  json: "JSON 数据",
  model: "模型",
  prompt: "提示词",
  instruction: "创作要求",
  conditions: "条件",
  cases: "分支规则",
  mode: "匹配方式",
  match: "条件组合",
  source: "列表来源",
  path: "字段路径",
  separator: "分隔符",
  maxItems: "项数上限",
  batchSize: "批次大小",
  operations: "逐项动作",
  template: "模板",
  operation: "文字处理",
  search: "查找",
  replacement: "替换",
  seconds: "等待秒数",
  url: "网址",
  record: "录制",
  start: "开始秒数",
  end: "结束秒数",
  duration: "时长",
  aspect: "画幅",
  aspectRatio: "画幅",
  resolution: "分辨率",
  position: "位置",
  pin: "固定结果",
};
export function formatWorkflowValue(value: unknown, field?:string): string {
  if (value === undefined || value === null) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(item=>formatWorkflowValue(item,field)).join("；");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, entry]) => `${workflowFieldNames[key] ?? key}: ${formatWorkflowValue(entry,key)}`)
      .join(" · ");
  const terms:Record<string,string>={first:"首个命中",all:"全部满足",any:"任一满足",uppercase:"转大写",lowercase:"转小写",trim:"移除首尾空白",replace:"替换",extract:"字段提取",transform:"文字处理",template:"文字模板",contains:"包含",equals:"等于",not_equals:"不等于",not_empty:"不为空",greater_than:"大于",less_than:"小于"};
  if(field==="mode"&&value==="all")return "所有命中出口";
  const label=field&&["kind","operator","operation","mode","match"].includes(field)?terms[String(value)]:undefined;
  return label ?? (String(value).replaceAll("\n", " ↵ ").slice(0, 1600) || "空白");
}
