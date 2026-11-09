"use client";
import {productLabel} from "@/lib/product-label";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AgentGoal } from "@helstera/shared";
import { useAuth } from "@/lib/auth-context";
import { fetchAgentGoals } from "@/lib/server-api";
import { StyledSelect } from "./ui/styled-select";
import { useWorkflowRun, WorkflowRunPanel } from "./workflow/run-panel";
const labels: Record<string, string> = {
	draft: "待确认",
	running: "执行中",
	waiting_approval: "等待审批",
	waiting_desktop: "等待执行器",
	paused: "已暂停",
	completed: "已完成",
	failed: "执行失败",
	canceled: "已取消",
};
export function goalCanvasLink(goal: AgentGoal, desktop = false) {
	if (!goal.canvasId) return null;
	const params = new URLSearchParams({ id: goal.canvasId, goalId: goal.id });
	if (goal.chatSessionId) params.set("session", goal.chatSessionId);
	return `${desktop ? "/desktop-app/canvas/" : "/canvas/"}?${params}`;
}
function GoalDetail({ token, id }: { token: string; id: string }) {
	const run = useWorkflowRun(token, id);
	const [refreshError, setRefreshError] = useState("");
	const retry = async () => {
		try {
			await run.refresh();
			setRefreshError("");
		} catch (cause) {
			setRefreshError(
				cause instanceof Error ? cause.message : "读取失败，请重试。",
			);
		}
	};
	const href = run.goal
		? goalCanvasLink(
				run.goal,
				document.documentElement.dataset.helsteraDesktop === "true",
			)
		: null;
	return (
		<section aria-label="画布任务详情">
			{(run.error || refreshError) && (
				<div role="alert" className="desktop-agent-history__error">
					{run.error || refreshError}
					<button type="button" onClick={() => void retry()}>
						重新读取
					</button>
				</div>
			)}
			{run.goal ? (
				<>
					{href && (
						<Link
							className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm"
							href={href}
						>
							打开对应画布与任务
						</Link>
					)}
					<WorkflowRunPanel
						token={token}
						goal={run.goal}
						onRefresh={run.refresh}
					/>
				</>
			) : (
				<p role="status" className="desktop-agent-history__empty">
					正在读取任务步骤与结果…
				</p>
			)}
		</section>
	);
}
export function GoalHistory() {
	const { session } = useAuth();
	const token = session?.access_token;
	const [goals, setGoals] = useState<AgentGoal[]>([]),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[retry, setRetry] = useState(0),
		[query, setQuery] = useState(""),
		[status, setStatus] = useState("all"),
		[selected, setSelected] = useState<string | null>(null);
	useEffect(() => {
		setGoals([]);
		setSelected(null);
	}, [token]);
	useEffect(() => {
		let alive = true;
		setLoading(true);
		setError("");
		if (!token) {
			setGoals([]);
			setLoading(false);
			return;
		}
		void fetchAgentGoals(token)
			.then((rows) => {
				if (alive) setGoals(rows);
			})
			.catch((cause) => {
				if (alive)
					setError(
						cause instanceof Error
							? cause.message
							: "画布任务暂不可用，请重试。",
					);
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [token, retry]);
	const visible = goals.filter(
		(goal) =>
			(status === "all" || goal.status === status) &&
			goal.goal.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
	);
	const current = visible.find((goal) => goal.id === selected) ?? visible[0];
	return (
		<main className="desktop-agent-history">
			<header>
				<div>
					<p>工作区 / 执行记录</p>
					<h1>画布与流程任务</h1>
					<span>查看审批、执行步骤和结果，回到原画布继续</span>
				</div>
				<button
					type="button"
					disabled={loading}
					onClick={() => setRetry((value) => value + 1)}
				>
					{loading ? "正在刷新…" : "刷新记录"}
				</button>
			</header>
			<div className="desktop-agent-history__tools">
				<input
					type="search"
					aria-label="搜索画布任务"
					value={query}
					placeholder="搜索目标或流程名称…"
					onChange={(event) => setQuery(event.target.value)}
				/>
				<StyledSelect
					aria-label="筛选画布任务状态"
					value={status}
					onChange={setStatus}
					options={[
						{ value: "all", label: "全部状态" },
						...Object.entries(labels).map(([value, label]) => ({
							value,
							label,
						})),
					]}
				/>
				<span className="text-xs text-muted-foreground">
					{visible.length} 条记录
				</span>
			</div>
			{error && (
				<div role="alert" className="desktop-agent-history__error">
					{error}
					<button
						type="button"
						disabled={loading}
						onClick={() => setRetry((value) => value + 1)}
					>
						重新加载
					</button>
				</div>
			)}
			<div className="desktop-agent-history__body">
				<nav aria-label="画布任务列表" aria-busy={loading}>
					{!goals.length && loading ? (
						<p role="status" className="desktop-agent-history__empty">
							正在读取任务…
						</p>
					) : !visible.length ? (
						<div className="desktop-agent-history__empty">
							<p>
								{query || status !== "all"
									? "没有符合筛选条件的任务"
									: "尚未发起画布或流程任务"}
							</p>
							{query || status !== "all" ? (
								<button
									type="button"
									onClick={() => {
										setQuery("");
										setStatus("all");
									}}
								>
									清除筛选
								</button>
							) : (
								<Link href="/home/">回到工作台开始</Link>
							)}
						</div>
					) : (
						visible.map((goal) => (
							<button
								type="button"
								key={goal.id}
								aria-current={current?.id === goal.id ? "true" : undefined}
								onClick={() => setSelected(goal.id)}
							>
								<strong>{productLabel(goal.goal)}</strong>
								<small>
									{labels[goal.status]} ·{" "}
									{new Date(goal.updatedAt).toLocaleString()}
								</small>
							</button>
						))
					)}
				</nav>
				{current && token ? (
					<GoalDetail key={current.id} token={token} id={current.id} />
				) : (
					<section aria-label="画布任务详情">
						<p className="desktop-agent-history__empty">
							选择任务查看步骤与结果。
						</p>
					</section>
				)}
			</div>
		</main>
	);
}
