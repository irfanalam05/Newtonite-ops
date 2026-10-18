import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriorityBadge, StatusBadge } from './ui.jsx';

describe('badges', () => {
  it('always render a readable text label (never colour alone)', () => {
    render(<><StatusBadge status="awaiting_approval" /><PriorityBadge priority="urgent" /></>);
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });
});
