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

    const input = screen.getByLabelText('Search graph');
    await user.type(input, 'c');

    expect(onQueryChange).toHaveBeenCalled();
    expect(screen.getByText('2 matches')).toBeInTheDocument();
  });
});

