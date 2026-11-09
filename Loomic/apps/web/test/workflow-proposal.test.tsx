import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { websiteWorkflow, type WorkflowProposal } from "@helstera/shared";
import { WorkflowProposalCard } from "@/components/workflow/proposal-card";
const requests = vi.hoisted(() => ({
  getWorkflowProposal: vi.fn(),
  decideWorkflowProposal: vi.fn(),
  notifyWorkflowChanged: vi.fn(),
  openCanvasWorkflow: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token" } }),
}));
vi.mock("@/lib/canvas-workflow-api", () => requests);
const proposal: WorkflowProposal = {
  id: "faf21e6b-6bb4-40ee-98bc-6a29ac8a9abc",
  canvasId: "56f09ba8-947a-47bc-bdd0-c26c67ad5fce",
  workflowId: null,
  revision: null,
  goalId: null,
  prompt: "搭建流程",
  action: "edit",
  summary: "连接网址和截图",
  before: null,
  graph: websiteWorkflow(),
  status: "pending",
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  createdAt: new Date().toISOString(),
  result: null,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows nested batch and Switch rules as readable parameters before confirmation",async()=>{
  const pending={...proposal,graph:{title:"批量",nodes:[{id:"batch",title:"批量整理",position:{x:0,y:0},config:{kind:"batch" as const,maxItems:3,batchSize:1,operations:[{kind:"transform" as const,operation:"uppercase" as const,search:"",replacement:""}]}}],edges:[]}};
  requests.getWorkflowProposal.mockResolvedValue(pending);
  const {container}=render(<WorkflowProposalCard canvasId={pending.canvasId} id={pending.id} initial={pending}/>);
  await waitFor(()=>expect(requests.getWorkflowProposal).toHaveBeenCalled());
  fireEvent.click(screen.getByText("检查节点参数与输入"));
  expect(container).toHaveTextContent("逐项动作");expect(container).toHaveTextContent("转大写");expect(container).not.toHaveTextContent("[object Object]");
  expect(requests.decideWorkflowProposal).not.toHaveBeenCalled();
});
it("shows an inspectable diff and never applies without the explicit button", async () => {
  requests.getWorkflowProposal.mockResolvedValue(proposal);
  requests.decideWorkflowProposal.mockResolvedValue({
    ...proposal,
    status: "applied",
    result: { workflowId: "workflow" },
  });
  render(
    <WorkflowProposalCard
      canvasId={proposal.canvasId}
      id={proposal.id}
      initial={proposal}
    />,
  );
  await waitFor(() => expect(requests.getWorkflowProposal).toHaveBeenCalled());
  expect(requests.decideWorkflowProposal).not.toHaveBeenCalled();
  expect(screen.getByText("目标网址 → 读取网页与截图")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "应用到画布" }));
  await waitFor(() => expect(screen.getByText("已应用")).toBeVisible());
  expect(requests.decideWorkflowProposal).toHaveBeenCalledOnce();
  expect(requests.notifyWorkflowChanged).toHaveBeenCalledWith(
    "workflow",
    undefined,
  );
});
it("keeps expired plans readable while disabling execution", async () => {
  const expired = { ...proposal, expiresAt: new Date(0).toISOString() };
  requests.getWorkflowProposal.mockResolvedValue(expired);
  await act(async () => {
    render(
      <WorkflowProposalCard
        canvasId={proposal.canvasId}
        id={proposal.id}
        initial={expired}
      />,
    );
  });
  expect(screen.getByRole("button", { name: "应用到画布" })).toBeDisabled();
  expect(requests.decideWorkflowProposal).not.toHaveBeenCalled();
});
it("collapses applied changes without hiding the receipt or workflow entry", async () => {
  const applied:WorkflowProposal={...proposal,status:"applied",result:{workflowId:"workflow"}};
  requests.getWorkflowProposal.mockResolvedValue(applied);
  const {container}=render(<WorkflowProposalCard canvasId={applied.canvasId} id={applied.id} initial={applied}/>);
  await waitFor(()=>expect(screen.getByText("已应用")).toBeVisible());
  const details=container.querySelector<HTMLDetailsElement>(".workflow-proposal-details")!;
  expect(details.open).toBe(false);
  expect(screen.queryByRole("button",{name:"应用到画布"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"查看画布流程"}));
  expect(requests.openCanvasWorkflow).toHaveBeenCalledWith("workflow");
  expect(requests.decideWorkflowProposal).not.toHaveBeenCalled();
});
it("shows the exact partial run scope before a user confirms",async()=>{
  const graph=websiteWorkflow(true);graph.nodes[0]!.config={kind:"url",url:"https://example.com"};
  const partial:WorkflowProposal={...proposal,action:"run",before:graph,graph:null,targetNodeId:"capture"};
  requests.getWorkflowProposal.mockResolvedValue(partial);
  await act(async()=>{render(<WorkflowProposalCard canvasId={partial.canvasId} id={partial.id} initial={partial}/>);});
  expect(screen.getByText("执行到：录制网站")).toBeVisible();
  expect(screen.getByText("保存本次节点结果")).toBeVisible();
  expect(screen.getByRole("button",{name:"确认运行流程"})).toBeEnabled();
  expect(requests.decideWorkflowProposal).not.toHaveBeenCalled();
});
