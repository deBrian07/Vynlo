import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Snippets } from '../../src/features/snippets/Snippets';
import type { Snippet } from '../../src/types/model';

beforeAll(() => {
  // jsdom does not implement the native dialog API; browser coverage exercises it.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

const snippet: Snippet = {
  id: 'follow-up',
  title: 'Follow-up',
  content: 'Hi {{first_name}}, about {{company}}.',
  category: 'Outreach',
  createdAt: 1,
  updatedAt: 1,
};

describe('snippets workflow', () => {
  it('protects unsaved snippet edits with an in-app discard confirmation', () => {
    render(<Snippets snippets={[]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    fireEvent.change(screen.getByLabelText('Snippet name'), { target: { value: 'Keep this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByLabelText('Snippet name')).not.toBeInTheDocument();
  });
  it('previews personalized text without interpreting HTML', () => {
    render(<Snippets snippets={[snippet]} onSave={vi.fn()} onInsert={vi.fn()} canInsert />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert snippet' }));
    fireEvent.change(screen.getByLabelText('first_name'), {
      target: { value: '<script>no</script>' },
    });
    expect(screen.getByText('Hi <script>no</script>, about [company].')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
  it('resolves user-provided variables before requesting plain-text insertion', () => {
    const onInsert = vi.fn(()=>{expect(document.querySelector('dialog')?.open).toBe(false);});
    render(<Snippets snippets={[snippet]} onSave={vi.fn()} onInsert={onInsert} canInsert />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert snippet' }));
    fireEvent.change(screen.getByLabelText('first_name'), { target: { value: '<Alex>' } });
    fireEvent.change(screen.getByLabelText('company'), { target: { value: 'Example & Co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert into draft' }));
    expect(onInsert).toHaveBeenCalledWith('Hi <Alex>, about Example & Co.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps resolution open when the captured composer is unavailable', () => {
    render(
      <Snippets
        snippets={[{ ...snippet, content: 'Hello' }]}
        onSave={vi.fn()}
        onInsert={() => {
          throw new Error('Focus the draft again.');
        }}
        canInsert
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Insert snippet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert into draft' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Focus the draft again.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('filters by content and category and explains an empty result', () => {
    render(<Snippets snippets={[snippet]} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search snippets'), { target: { value: 'company' } });
    expect(screen.getByRole('heading', { name: 'Follow-up' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search snippets'), { target: { value: 'unmatched' } });
    expect(screen.getByText('No matching snippets')).toBeInTheDocument();
  });

  it('preserves editor content when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Storage is unavailable.'));
    render(<Snippets snippets={[]} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    fireEvent.change(screen.getByLabelText('Snippet name'), { target: { value: 'Thank you' } });
    fireEvent.change(screen.getByLabelText('Snippet content'), {
      target: { value: 'Thanks for your time.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Storage is unavailable.'),
    );
    expect(screen.getByLabelText('Snippet content')).toHaveValue('Thanks for your time.');
    expect(screen.getByRole('button', { name: 'Save snippet' })).toBeEnabled();
  });
});
