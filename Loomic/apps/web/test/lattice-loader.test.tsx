import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LatticeLoader from '../src/components/ui/LatticeLoader';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('runs a clock, freezes on completion and restarts for a new operation', () => {
  const { container, rerender } = render(<LatticeLoader />);
  const timer = () => container.querySelector('.lattice-loader__timer')?.textContent;
  act(() => vi.advanceTimersByTime(1500));
  expect(timer()).toBe('1.5s');
  rerender(<LatticeLoader status="done" />);
  act(() => vi.advanceTimersByTime(2000));
  expect(timer()).toBe('1.5s');
  expect(screen.getByRole('status')).toHaveTextContent('Done in 1.5 seconds');
  rerender(<LatticeLoader status="working" />);
  expect(timer()).toBe('0.0s');
});

it('accepts controlled elapsed time without running an internal clock', () => {
  const { container, rerender } = render(<LatticeLoader elapsed={65.2} />);
  expect(container.querySelector('.lattice-loader__timer')).toHaveTextContent('1m 5.2s');
  expect(vi.getTimerCount()).toBe(0);
  rerender(<LatticeLoader elapsed={68} status="error" errorLabel="Failed after" />);
  expect(screen.getByRole('status')).toHaveTextContent('Failed after 1 minutes 8.0 seconds');
});

it('keeps announcements stable while the visible timer ticks and cleans up', () => {
  const { container, unmount } = render(<LatticeLoader label="思考中" />);
  act(() => vi.advanceTimersByTime(5000));
  expect(container.querySelector('.lattice-loader__sr')).toHaveTextContent('思考中');
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('renders grid fallbacks, holes and terminal marks with no hidden clock', () => {
  const { container, rerender } = render(<LatticeLoader grid={4} pattern="arrow" showTimer={false} />);
  expect(container.querySelectorAll('.lattice-loader__run .lattice-loader__cell')).toHaveLength(16);
  expect(vi.getTimerCount()).toBe(0);
  rerender(<LatticeLoader pattern={{ cells: [0, null, 2] }} status="error" showTimer={false} />);
  expect(container.querySelectorAll('.lattice-loader__run [data-hole]')).toHaveLength(7);
  expect(container.querySelectorAll('.lattice-loader__mark [data-on]')).toHaveLength(5);
  expect(container.querySelector('.lattice-loader__timer')).toBeNull();
});
