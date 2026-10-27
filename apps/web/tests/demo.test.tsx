import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoApp } from '../src/demo/DemoApp';

describe('GitHub Pages Demo Mode', () => {
  it('labels sample content, links to source, and makes no network requests', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<DemoApp repositoryUrl="https://github.com/example/api-watchtower" />);

    expect(screen.getByText(/Demo Mode\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View source on GitHub' })).toHaveAttribute('href', 'https://github.com/example/api-watchtower');
    const endpointTable = screen.getByRole('table', { name: 'Illustrative endpoints and example monitoring results' });
    expect(within(endpointTable).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText(/No endpoint is contacted and no result is stored/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets visitors inspect sample checks, schema changes, schedules, and notifications', async () => {
    const user = userEvent.setup();
    render(<DemoApp repositoryUrl="https://github.com/example/api-watchtower" />);

    await user.click(screen.getAllByRole('button', { name: 'User profile' })[0]!);
    expect(await screen.findByRole('heading', { name: 'User profile' })).toBeInTheDocument();
    expect(screen.getByText('$.address.geo.lat')).toBeInTheDocument();
    expect(screen.getByText('Example monitoring settings')).toBeInTheDocument();
    expect(screen.getByText('Example incidents and notifications')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View sample' }));
    expect(screen.getByText('No sample differences recorded')).toBeInTheDocument();
    expect(screen.getByText(/This static hosted demo sends no email/)).toBeInTheDocument();
  });

  it('keeps login and real check controls out of the hosted demo', () => {
    render(<DemoApp repositoryUrl="https://github.com/example/api-watchtower" />);
    expect(screen.queryByRole('button', { name: /sign in|register|run check|capture baseline/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View source on GitHub' })).toHaveAttribute('target', '_blank');
  });
});
