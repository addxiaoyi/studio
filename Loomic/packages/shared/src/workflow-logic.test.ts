import {describe,it,expect} from "vitest";
import {compileWorkflow,validateWorkflow,type WorkflowGraph} from "./canvas-workflow.js";
import {evaluateWorkflowCondition,readWorkflowField} from "./workflow-logic.js";
import {portableWorkflow,instantiateWorkflow} from "./creative-library.js";
const base={position:{x:0,y:0}};
export const logicGraph=():WorkflowGraph=>({title:"条件文字处理",nodes:[
  {...base,id:"source",title:"资料",config:{kind:"text",role:"story",text:"  Hello  "}},
  {...base,id:"check",title:"检查",config:{kind:"condition",conditions:[{field:"text",operator:"contains",value:"Hello"}],match:"all"}},
  {...base,id:"yes",title:"大写",config:{kind:"transform",operation:"uppercase",search:"",replacement:""}},
  {...base,id:"no",title:"否分支",config:{kind:"template",template:"不命中 {{text}}"}},
  {...base,id:"merge",title:"合并",config:{kind:"merge",separator:"\n"}},
  {...base,id:"output",title:"输出",config:{kind:"deliver"}},
],edges:[{id:"a",source:"source",target:"check"},{id:"b",source:"check",target:"yes",branch:"true"},{id:"c",source:"check",target:"no",branch:"false"},{id:"d",source:"yes",target:"merge"},{id:"e",source:"no",target:"merge"},{id:"f",source:"merge",target:"output"}]});
describe("logic workflow contracts",()=>{
  it("validates typed IF branches regardless of edge array ordering",()=>{const graph=logicGraph();graph.edges.reverse();expect(validateWorkflow(graph)).toEqual([]);const plan=compileWorkflow(graph);expect(plan.steps.find(step=>step.id==="yes")?.when).toEqual([{source:"check",branch:"true"}]);delete graph.edges.find(edge=>edge.id==="b")!.branch;expect(()=>compileWorkflow(graph)).toThrow("请选择 IF");});
  it("rejects prototype paths and invalid numeric comparisons",()=>{expect(()=>readWorkflowField({},"__proto__.secret")).toThrow();expect(evaluateWorkflowCondition({json:{score:5}},{field:"json.score",operator:"greater_than",value:"4"})).toBe(true);expect(evaluateWorkflowCondition({},{field:"missing",operator:"not_empty",value:""})).toBe(false);});
  it("prunes generation ancestors of a pinned node and strips pins from reusable templates",()=>{const graph:WorkflowGraph={title:"固定",nodes:[{...base,id:"source",title:"输入",config:{kind:"text",role:"prompt",text:"原文"}},{...base,id:"written",title:"生成文案",config:{kind:"write",mode:"rewrite",instruction:"",shotCount:1},pin:{goalId:"11111111-1111-4111-8111-111111111111",nodeId:"written"}},{...base,id:"output",title:"输出",config:{kind:"deliver"}}],edges:[{id:"a",source:"source",target:"written"},{id:"b",source:"written",target:"output"}],groups:[{id:"group",title:"资料组",nodeIds:["source","written"],collapsed:true}]};expect(compileWorkflow(graph).steps.map(step=>step.command.executor)).toEqual(["result.pinned","result.deliver"]);const portable=portableWorkflow(graph);expect(portable.nodes[1]!.pin).toBeUndefined();expect(instantiateWorkflow(portable,"new").groups?.[0]?.nodeIds).toEqual(["n-new-0","n-new-1"]);});
  it("prevents pinning after a branch from bypassing its condition",()=>{const graph=logicGraph();graph.nodes[2]!.pin={goalId:"11111111-1111-4111-8111-111111111111",nodeId:"yes"};expect(()=>compileWorkflow(graph)).toThrow("条件分支");});
});
