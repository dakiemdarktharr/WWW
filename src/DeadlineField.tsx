import { useId, useState } from 'react';
import GlassSelect from './GlassSelect';
import { deadlineToLocalInput, localDeadlineToIso } from './deadline';
import './DeadlineField.css';

export default function DeadlineField({ initialValue = null }: { initialValue?: string | null }) {
  const id = useId();
  const [mode, setMode] = useState(initialValue ? 'scheduled' : 'none');
  const [local, setLocal] = useState(() => deadlineToLocalInput(initialValue));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="deadline-field">
      <span>Deadline</span>
      <input type="hidden" name="deadlineMode" value={mode} />
      <input type="hidden" name="deadlineOriginal" value={initialValue || ''} />
      <GlassSelect
        label="Deadline"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'none', label: 'No deadline' },
          { value: 'scheduled', label: 'Set deadline' },
        ]}
      />
      {mode === 'scheduled' && (
        <label htmlFor={id}>
          Date and time · {timezone}
          <input
            id={id}
            aria-label="Deadline date and time"
            name="deadlineLocal"
            type="datetime-local"
            step="1"
            required
            value={local}
            ref={(element) => {
              if (!element) return;
              try {
                localDeadlineToIso(element.value);
                element.setCustomValidity('');
              } catch (error) {
                element.setCustomValidity((error as Error).message);
              }
            }}
            onChange={(event) => {
              setLocal(event.target.value);
              try {
                localDeadlineToIso(event.target.value);
                event.target.setCustomValidity('');
              } catch (error) {
                event.target.setCustomValidity((error as Error).message);
              }
            }}
          />
        </label>
      )}
    </div>
  );
}
