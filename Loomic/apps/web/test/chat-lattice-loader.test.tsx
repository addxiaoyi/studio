import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChatMessage } from '../src/components/chat-message';

afterEach(cleanup);

it('shows the lattice only while an empty assistant response is pending', () => {
  const { rerender } = render(<ChatMessage role="assistant" contentBlocks={[]} isStreaming />);
  expect(screen.getByRole('status')).toHaveAttribute('data-status', 'working');
  expect(screen.getByRole('status')).toHaveTextContent('思考中');
  rerender(<ChatMessage role="assistant" contentBlocks={[{ type: 'text', text: '已回复' }]} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('已回复')).toBeInTheDocument();
});

it('uses the same loader for streamed thinking and removes it when settled', () => {
  const blocks = [{ type: 'thinking' as const, thinking: '正在整理需求' }];
  const { rerender } = render(<ChatMessage role="assistant" contentBlocks={blocks} isStreaming />);
  expect(screen.getByRole('status')).toHaveTextContent('思考中');
  rerender(<ChatMessage role="assistant" contentBlocks={blocks} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Toggle thinking content' })).not.toBeInTheDocument();
});

it('disables the retry action while a retry is being submitted', () => {
  render(<ChatMessage role="assistant" contentBlocks={[{ type: 'text', text: 'failed' }]} isRetrying onRetry={() => {}} />);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
});
