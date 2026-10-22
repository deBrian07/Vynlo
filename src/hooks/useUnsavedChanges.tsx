import { useState } from 'react';
import { Confirm } from '../components/ui';

export function useUnsavedChanges(dirty: boolean, onClose: () => void, busy = false) {
  const [confirming, setConfirming] = useState(false);
  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirming(true);
    else onClose();
  };
  return {
    requestClose,
    confirmation: confirming ? (
      <Confirm
        title="Discard unsaved changes?"
        label="Discard changes"
        onClose={() => setConfirming(false)}
        onConfirm={onClose}
      >
        Your changes haven’t been saved. Keep editing, or discard them and close this editor.
      </Confirm>
    ) : null,
  };
}
