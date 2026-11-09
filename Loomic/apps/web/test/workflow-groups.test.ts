import {it,expect} from "vitest";
import {websiteWorkflow} from "@helstera/shared";
import {projectWorkflow,readSceneWorkflow} from "@/components/workflow/scene";
it("collapses and moves a group without deleting nodes, notes or connections",()=>{
  const graph={...websiteWorkflow(),groups:[{id:"group",title:"网站",nodeIds:["site","capture"],collapsed:true}]};graph.nodes[0]!.note="目标站点";
  const id="11111111-1111-4111-8111-111111111111",scene=projectWorkflow([],id,graph,{},false);
  const group=scene.find(el=>el.customData?.workflowGroup)!;
  expect(scene.find(el=>el.id===`wf:${id}:site`)?.isDeleted).toBe(true);
  const moved=scene.map(el=>el.id===group.id?{...el,x:el.x+50,y:el.y+25}:el);
  const read=readSceneWorkflow(moved,id,graph).graph;
  expect(read.nodes).toHaveLength(3);expect(read.edges).toEqual(graph.edges);expect(read.nodes[0]).toMatchObject({note:"目标站点",position:{x:graph.nodes[0]!.position.x+50,y:graph.nodes[0]!.position.y+25}});
  const expanded=projectWorkflow(moved,id,{...read,groups:[{...graph.groups[0]!,collapsed:false}]},{},false);
  expect(expanded.find(el=>el.id===`wf:${id}:site`)?.isDeleted).toBe(false);
});
