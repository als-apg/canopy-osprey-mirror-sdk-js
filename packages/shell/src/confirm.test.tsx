import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './confirm.js';
import type { ConfirmFn } from './confirm.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderConfirm() {
  let confirm!: ConfirmFn;
  function Grab() {
    confirm = useConfirm();
    return <button>Launcher</button>;
  }
  const utils = render(
    <ConfirmProvider>
      <Grab />
    </ConfirmProvider>
  );
  return { ...utils, confirm: () => confirm };
}

/** Open a dialog; the answer is wrapped so awaiting `ask` does not await the answer. */
async function ask(
  confirm: ConfirmFn,
  options: Parameters<ConfirmFn>[0]
): Promise<{ answer: Promise<boolean> }> {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = confirm(options);
  });
  return { answer };
}

describe('ConfirmProvider / useConfirm', () => {
  it('renders nothing until asked', () => {
    renderConfirm();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the heading, body and default labels, and resolves true on confirm', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), {
      heading: 'Delete routine?',
      body: 'This cannot be undone.',
    });
    expect(screen.getByText('Delete routine?')).toBeDefined();
    expect(screen.getByText('This cannot be undone.').tagName).toBe('P');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(promise).resolves.toBe(true);
    expect(screen.queryByText('Delete routine?')).toBeNull();
  });

  it('resolves false on cancel, with custom labels', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), {
      heading: 'Stop run?',
      body: <strong>Run 42</strong>,
      confirmLabel: 'Stop',
      cancelLabel: 'Keep running',
    });
    expect(screen.getByText('Run 42').tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Keep running' }));
    await expect(promise).resolves.toBe(false);
  });

  it('resolves false on Escape', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), { heading: 'Sure?', body: 'x' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
    await expect(promise).resolves.toBe(false);
  });

  it('resolves false on the close (X) button', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), { heading: 'Sure?', body: 'x' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await expect(promise).resolves.toBe(false);
  });

  it('focuses the primary button; Enter inside the dialog confirms', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), {
      heading: 'Apply?',
      body: <input aria-label="Note" />,
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
    const note = screen.getByRole('textbox', { name: 'Note' });
    note.focus();
    fireEvent.keyDown(note, { key: 'Enter', code: 'Enter' });
    await expect(promise).resolves.toBe(true);
  });

  it('danger: red primary, focus on Cancel, and Enter does not confirm implicitly', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), {
      heading: 'Delete?',
      body: <input aria-label="Note" />,
      danger: true,
      confirmLabel: 'Delete',
    });
    const primary = screen.getByRole('button', { name: 'Delete' });
    expect(primary.classList.contains('cds--btn--danger')).toBe(true);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    const note = screen.getByRole('textbox', { name: 'Note' });
    note.focus();
    fireEvent.keyDown(note, { key: 'Enter', code: 'Enter' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter', code: 'Enter' });
    await act(async () => {});
    expect(settled).toBe(false);

    fireEvent.click(cancel);
    await expect(promise).resolves.toBe(false);
  });

  it('applies the requested size', async () => {
    const { confirm } = renderConfirm();
    await ask(confirm(), { heading: 'Big', body: 'x', size: 'lg' });
    expect(document.body.querySelector('.cds--modal-container--lg')).not.toBeNull();
  });

  it('queues concurrent requests and answers them in order', async () => {
    const { confirm } = renderConfirm();
    const { answer: first } = await ask(confirm(), { heading: 'First?', body: 'a' });
    const { answer: second } = await ask(confirm(), { heading: 'Second?', body: 'b' });
    expect(screen.getByText('First?')).toBeDefined();
    expect(screen.queryByText('Second?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(first).resolves.toBe(true);
    expect(await screen.findByText('Second?')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(second).resolves.toBe(false);
  });

  it('only the first answer counts', async () => {
    const { confirm } = renderConfirm();
    const { answer: promise } = await ask(confirm(), { heading: 'Once', body: 'x' });
    const primary = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(primary);
    await expect(promise).resolves.toBe(true);
    expect(screen.queryByText('Once')).toBeNull();
  });

  it('returns focus to the element that opened the dialog', async () => {
    const { confirm } = renderConfirm();
    const launcher = screen.getByRole('button', { name: 'Launcher' });
    launcher.focus();
    const { answer: promise } = await ask(confirm(), { heading: 'Focus?', body: 'x' });
    expect(document.activeElement).not.toBe(launcher);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await expect(promise).resolves.toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  it('answers pending requests with false on unmount', async () => {
    const { confirm, unmount } = renderConfirm();
    const { answer: promise } = await ask(confirm(), { heading: 'Gone?', body: 'x' });
    unmount();
    await expect(promise).resolves.toBe(false);
  });

  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useConfirm())).toThrow(/ConfirmProvider/);
  });
});
