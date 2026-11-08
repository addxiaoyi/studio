import "@testing-library/jest-dom/vitest";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {CanvasWorkflowDocument} from "@/components/canvas/workflow-document";
import type {SceneElement,WorkflowCanvasApi} from "@/components/workflow/scene";
afterEach(cleanup);
it("renders Markdown headings and emphasis, then saves editable source without changing the receipt",()=>{
  const element:SceneElement={id:"doc",type:"embeddable",x:10,y:20,width:600,height:500,customData:{jobId:"workflow-text:step",workflowDocument:{title:"分镜",markdown:"# 片名\n\n## 开场\n**机器人**出发。"}}};
  const api={getSceneElementsIncludingDeleted:()=>[element],updateScene:vi.fn()} as unknown as WorkflowCanvasApi;
  render(<CanvasWorkflowDocument element={element} api={api}/>);
  expect(screen.getByRole("heading",{name:"片名"})).toBeInTheDocument();expect(screen.queryByText(/^# 片名$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"编辑画布文稿"}));
  fireEvent.change(screen.getByRole("textbox",{name:"文稿内容"}),{target:{value:"# 新片名\n\n修改内容"}});
  fireEvent.click(screen.getByRole("button",{name:"保存文稿"}));
  expect(api.updateScene).toHaveBeenCalledWith(expect.objectContaining({captureUpdate:"IMMEDIATELY",elements:[expect.objectContaining({id:"doc",customData:expect.objectContaining({jobId:"workflow-text:step",workflowDocument:{title:"分镜",markdown:"# 新片名\n\n修改内容"}})})]}));
});
