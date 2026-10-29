import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { ToolBlock } from '@helstera/shared';
import { ToolBlockView } from '../src/components/chat/tool-block-view';

const { fetchJob, fetchJobTimeline, syncJob } = vi.hoisted(() => ({ fetchJob: vi.fn(), fetchJobTimeline: vi.fn(), syncJob: vi.fn() }));
vi.mock('../src/lib/server-api', () => ({ fetchJob, fetchJobs: vi.fn(), fetchJobTimeline, cancelJob: vi.fn(), syncJob, exportJob: vi.fn() }));
vi.mock('../src/lib/auth-context', () => ({ useAuth: () => ({ session: { access_token: 'test' } }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

beforeEach(() => {
  fetchJobTimeline.mockResolvedValue({ events: [] });
});

const block: ToolBlock = {
  type: 'tool', toolCallId: 'call', toolName: 'generate_image', status: 'completed',
  output: { jobId: 'accepted', error: 'Job timed out after 240s' },
};
const job = { id: 'accepted', job_type: 'image_generation', status: 'running',
  stage: '图片模型处理中', progress: 25, attempt_count: 1, max_attempts: 1,
  payload: { title: '原图海报' }, updated_at: new Date().toISOString() };

it('uses the running job instead of showing a stale agent timeout', async () => {
  fetchJob.mockResolvedValue({ job });
  render(<ToolBlockView block={block} />);
  expect(await screen.findByText('图片模型处理中')).toBeInTheDocument();
  expect(screen.queryByText('图片生成失败')).not.toBeInTheDocument();
  expect(screen.queryByText('Job timed out after 240s')).not.toBeInTheDocument();
});

it('announces queued jobs separately from running jobs', async () => {
  fetchJob.mockResolvedValue({ job: { ...job, status: 'queued', stage: null, progress: 0 } });
  render(<ToolBlockView block={{ ...block, output: { jobId: 'accepted', pending: true } }} />);
  expect(await screen.findByRole('status')).toHaveTextContent('已进入队列，等待工作线程');
});

it('recovers exactly one image from a persisted late result after remount', async () => {
  fetchJob.mockResolvedValue({ job: { ...job, status: 'succeeded', result: { signed_url: '/api/uploads/image/file', width: 1024, height: 1024 } } });
  const first = render(<ToolBlockView block={block} />);
  expect(await screen.findByRole('img', { name: '原图海报' })).toHaveAttribute('src', '/api/uploads/image/file');
  first.unmount();
  render(<ToolBlockView block={block} />);
  await screen.findByRole('img', { name: '原图海报' });
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.queryByText('视频已生成并同步到画布')).not.toBeInTheDocument();
});

it('replaces pending output with the terminal job error', async () => {
  fetchJob.mockResolvedValue({ job: { ...job, status: 'dead_letter', error_message: '上游结果无法确认，未重试' } });
  render(<ToolBlockView block={{ ...block, output: { jobId: 'accepted', pending: true } }} />);
  expect(await screen.findByText('上游结果无法确认，未重试')).toBeInTheDocument();
  expect(screen.getByText('图片生成失败')).toBeInTheDocument();
});

it('announces running progress and terminal failure as atomic status messages', async () => {
  fetchJob.mockResolvedValue({ job });
  render(<ToolBlockView block={block} />);
  expect(await screen.findByRole('status')).toHaveTextContent('模型正在生成');

  cleanup();
  fetchJob.mockResolvedValue({ job: { ...job, status: 'dead_letter', error_message: '任务已终止' } });
  render(<ToolBlockView block={{ ...block, output: { jobId: 'accepted', pending: true } }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('图片生成失败');
});

it('announces an unknown status without enabling retry after polling failures', async () => {
  vi.useFakeTimers();
  fetchJob.mockRejectedValue(new Error('temporary status outage'));
  render(<ToolBlockView block={{ ...block, output: { jobId: 'accepted', pending: true } }} />);

  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(4_000); await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(8_000); await Promise.resolve(); await Promise.resolve(); });

  expect(screen.getByRole('status')).toHaveTextContent('状态暂时无法确认');
  expect(screen.queryByRole('button', { name: '重新提交任务' })).not.toBeInTheDocument();
});

it('hides upstream model identifiers on successful image results', async () => {
  fetchJob.mockResolvedValue({ job: { ...job, status: 'succeeded',
    payload: { ...job.payload, routing: { selectedModel: 'gpt-image-2-4k', preferredModel: 'gpt-image-2', fallback: true } },
    result: { signed_url: '/api/uploads/image/file' },
  } });
  render(<ToolBlockView block={{ ...block, input: { model: 'gpt-image-2' } }} />);
  await screen.findByRole('img', { name: '原图海报' });
  expect(screen.getAllByText('Helstera AI').length).toBeGreaterThan(0);
  expect(screen.queryByText('Gpt Image 2 4k')).not.toBeInTheDocument();
});

it('restores routing metadata without exposing upstream model identifiers after refresh', async () => {
  fetchJob.mockResolvedValue({ job: { ...job, status: 'succeeded',
    payload: { ...job.payload, model: 'gpt-image-2' },
    result: {
      signed_url: '/api/uploads/image/file',
      model: 'gpt-image-2-4k',
      routing: { selectedModel: 'gpt-image-2-4k', preferredModel: 'gpt-image-2', fallback: true },
    },
  } });
  render(<ToolBlockView block={{ ...block, input: { model: 'gpt-image-2' } }} />);
  await screen.findByRole('img', { name: '原图海报' });
  expect(screen.getAllByText('Helstera AI').length).toBeGreaterThan(0);
  expect(screen.queryByText('Gpt Image 2 4k')).not.toBeInTheDocument();
});

it('shows a non-retryable input error without failover or resubmit controls', async () => {
  render(<ToolBlockView block={{ type: 'tool', toolCallId: 'video-call', toolName: 'generate_video', status: 'completed', output: { error: 'reference-image input is not supported', errorCode: 'invalid_input' } }} />);
  expect(await screen.findByText(/The selected model does not support these inputs/)).toBeInTheDocument();
  expect(screen.queryByText('智能容灾：选择下一个模型')).not.toBeInTheDocument();
  const retry = screen.getByRole('button', { name: '重新提交任务' });
  expect(retry).toBeDisabled();
});

it('enables resubmit only after the server confirms a terminal failure', async () => {
  fetchJob.mockResolvedValue({ job: { ...job, status: 'failed', error_message: '上游明确失败' } });
  render(<ToolBlockView block={{ ...block, input: { prompt: '生成一张商品图' }, output: { jobId: 'accepted', pending: true } }} />);
  const retry = await screen.findByRole('button', { name: '重新提交任务' });
  expect(retry).toBeEnabled();
  expect(retry).toHaveAttribute('aria-describedby', 'generation-retry-policy');
});

it('shows timeline and export recovery controls in the task detail panel', async () => {
  const legacyImageName = String.fromCodePoint(1325, 892, 65533, 65533, 65533, 65533);
  fetchJob.mockResolvedValue({ job: { ...job, payload: { ...job.payload, title: legacyImageName }, status: 'succeeded', result: { signed_url: '/api/uploads/image/file' } } });
  fetchJobTimeline.mockResolvedValue({
    events: [{ key: 'provider', label: 'Provider task', status: 'done', id: 'provider-1' }],
  });
  const user = userEvent.setup();
  render(<ToolBlockView block={block} />);

  await user.click(await screen.findByRole('img', { name: 'ԭͼ����' }));

  const detailPanel = await screen.findByRole('dialog');
  expect(detailPanel).toHaveTextContent('Task timeline');
  expect(within(detailPanel).getByText('Provider task')).toBeInTheDocument();
  expect(within(detailPanel).getByRole('button', { name: 'Export JSON' })).toBeInTheDocument();
});

it('offers checkpoint sync recovery without resubmitting a completed generation', async () => {
  fetchJob.mockResolvedValueOnce({ job: { ...job, status: 'sync_failed', error_code: 'canvas_sync_failed', error_message: 'canvas unavailable' } });
  syncJob.mockResolvedValue({ job: { ...job, status: 'queued' }, sync: { state: 'queued_from_provider_checkpoint' } });
  const user = userEvent.setup();
  render(<ToolBlockView block={{ ...block, output: { jobId: 'accepted', pending: true } }} />);

  expect(await screen.findByText(/画布同步失败/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '打开恢复操作' }));
  const detailPanel = await screen.findByRole('dialog');
  const retrySync = within(detailPanel).getByRole('button', { name: 'Retry sync' });
  await user.click(retrySync);

  expect(syncJob).toHaveBeenCalledWith('test', 'accepted');
  expect(await within(detailPanel).findByText('queued')).toBeInTheDocument();
  expect(within(detailPanel).queryByRole('button', { name: 'Retry sync' })).not.toBeInTheDocument();
});
