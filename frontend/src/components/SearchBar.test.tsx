import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('updates the query and reports the visible match count', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();

    render(
      <SearchBar
        query="cal"
        matchCount={2}
        onQueryChange={onQueryChange}
      />,
    );

    const input = screen.getByLabelText('Search');
    await user.type(input, 'c');

    expect(onQueryChange).toHaveBeenCalled();
    expect(screen.getByText('2 matches')).toBeInTheDocument();
  });

  it('renders as a slim horizontal bar for the top position', () => {
    render(
      <SearchBar
        query=""
        matchCount={0}
        onQueryChange={() => {}}
      />,
    );

    // The container should use flex-row layout for horizontal positioning
    const container = screen.getByTestId('search-bar');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('flex-row');
  });
});
