import type { WorkflowGraph } from "@helstera/shared";

export function workflowGraphKey(graph: WorkflowGraph) {
  return JSON.stringify({
    title: graph.title,
    nodes: [...graph.nodes].sort((a,b)=>a.id.localeCompare(b.id)).map(node=>({
      id:node.id,title:node.title,x:node.position.x,y:node.position.y,
      note:node.note,pin:node.pin,
      config:Object.fromEntries(Object.entries(node.config).sort(([a],[b])=>a.localeCompare(b))),
    })),
    // Input order determines the order of composed clips.
    edges:graph.edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,branch:edge.branch})),
    groups:graph.groups?.map(group=>({...group,nodeIds:[...group.nodeIds].sort()})).sort((a,b)=>a.id.localeCompare(b.id)),
  });
}

export function nextNodePosition(anchor:{x:number;y:number},occupied:readonly {x:number;y:number;width:number;height:number}[],height:number){
  const x=Math.min(990600,anchor.x+390);
  let y=anchor.y;
  for(let row=0;row<=occupied.length;row++){
    if(!occupied.some(box=>x<box.x+box.width+30&&x+300+30>box.x&&y<box.y+box.height+30&&y+height+30>box.y))return {x,y};
    y+=height+70;
  }
  return {x,y};
}
