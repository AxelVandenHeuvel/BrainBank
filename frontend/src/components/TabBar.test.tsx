import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { OpenTab } from '../types/notes';
import { TabBar } from './TabBar';

const makeTabs = (overrides: Partial<OpenTab>[] = []): OpenTab[] =>
  overrides.map((o, i) => ({
    id: `tab-${i}`,
    title: `Tab ${i}`,
    content: `Content ${i}`,
    isNew: false,
    ...o,
  }));

const noop = () => {};

describe('TabBar', () => {
  it('renders nothing when tabs array is empty', () => {
    const { container } = render(
      <TabBar tabs={[]} activeTabId={null} onSelectTab={noop} onCloseTab={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders tab titles', () => {
    const tabs = makeTabs([{ title: 'Physics' }, { title: 'Calculus' }]);
    render(
      <TabBar tabs={tabs} activeTabId={null} onSelectTab={noop} onCloseTab={noop} />,
    );
    expect(screen.getByText('Physics')).toBeInTheDocument();
    expect(screen.getByText('Calculus')).toBeInTheDocument();
  });

  it('active tab has distinct styling', () => {
    const tabs = makeTabs([{ id: 'a', title: 'Active' }, { id: 'b', title: 'Inactive' }]);
    render(
      <TabBar tabs={tabs} activeTabId="a" onSelectTab={noop} onCloseTab={noop} />,
    );
    const activeTab = screen.getByText('Active').closest('[data-testid="tab-a"]')!;
    const inactiveTab = screen.getByText('Inactive').closest('[data-testid="tab-b"]')!;
    expect(activeTab.className).toContain('border-pink');
    expect(inactiveTab.className).not.toContain('border-pink');
  });

  it('clicking tab calls onSelectTab with the tab id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const tabs = makeTabs([{ id: 'x', title: 'Click Me' }]);
    render(
      <TabBar tabs={tabs} activeTabId={null} onSelectTab={onSelect} onCloseTab={noop} />,
    );
    await user.click(screen.getByText('Click Me'));
    expect(onSelect).toHaveBeenCalledWith('x');
  });

  it('clicking close calls onCloseTab without selecting', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const tabs = makeTabs([{ id: 'z', title: 'Close Me' }]);
    render(
      <TabBar tabs={tabs} activeTabId={null} onSelectTab={onSelect} onCloseTab={onClose} />,
    );
    await user.click(screen.getByLabelText('Close tab'));
    expect(onClose).toHaveBeenCalledWith('z');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('new tabs show an unsaved indicator', () => {
    const tabs = makeTabs([{ id: 'new1', title: 'Draft', isNew: true }]);
    render(
      <TabBar tabs={tabs} activeTabId={null} onSelectTab={noop} onCloseTab={noop} />,
    );
    const tab = screen.getByTestId('tab-new1');
    // New tabs should have italic styling on the title
    const titleSpan = screen.getByText('Draft');
    expect(titleSpan.className).toContain('italic');
  });
});
