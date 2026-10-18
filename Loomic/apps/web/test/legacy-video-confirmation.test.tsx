import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolBlockView } from '../src/components/chat/tool-block-view';

vi.mock('../src/lib/server-api', () => ({ fetchJob: vi.fn(), fetchJobs: vi.fn() }));
vi.mock('../src/lib/auth-context', () => ({ useAuth: () => ({ session: { access_token: 'test' } }) }));
afterEach(() => cleanup());

it('marks historical video confirmations without an approval id as expired', () => {
  render(<ToolBlockView block={{
    type: 'tool',
    toolCallId: 'legacy-video-confirmation',
    toolName: 'generate_video',
    status: 'completed',
    output: {},
    outputSummary: 'Confirmation required before credits are charged.',
  }} />);

  expect(screen.getByText(/\u5386\u53f2\u786e\u8ba4\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0/)).toBeInTheDocument();
  expect(screen.queryByText('Confirmation required before credits are charged.')).not.toBeInTheDocument();
});
