import { useEffect, useState } from 'react';
import { api } from './api';
type Machine = {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
  busy: boolean;
  slots: number;
};
export default function Machines({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [machines, setMachines] = useState<Machine[]>([]),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(''),
    [pairing, setPairing] = useState(false);
  useEffect(() => {
    const refresh = () =>
      api<Machine[]>('/runners')
        .then(setMachines)
        .catch((error) => setError(error.message));
    void refresh();
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="panel machine-panel" aria-label="Execution machines">
      <label>
        Machine{' '}
        <select
          aria-label="Execution machine"
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">Cloud</option>
          {machines.map((machine) => (
            <option
              key={machine.id}
              value={machine.id}
              disabled={!machine.online || !machine.ready}
            >
              {machine.name} ·{' '}
              {!machine.online ? 'offline' : machine.busy ? 'busy' : `${machine.slots} slots`}
            </option>
          ))}
        </select>
      </label>
      <button className="button compact" onClick={() => setExpanded(!expanded)}>
        Pair machine
      </button>
      {expanded && (
        <form
          className="machine-pair"
          onSubmit={async (event) => {
            event.preventDefault();
            setPairing(true);
            setError('');
            const data = new FormData(event.currentTarget);
            try {
              const kind = String(data.get('kind'));
              const result = await api<{ id: string; token: string }>('/runners', {
                name: data.get('name'),
                kind,
              });
              const config = {
                origin: location.origin,
                id: result.id,
                token: result.token,
                dataDir: String(data.get('dataDir')),
                slots: kind === 'ssh' ? 1 : 2,
                maxLoad: kind === 'ssh' ? 3 : 8,
                minFreeMB: 2048,
              };
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'relay-machine.private.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setExpanded(false);
              setMachines(await api<Machine[]>('/runners'));
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setPairing(false);
            }
          }}
        >
          <input
            name="name"
            placeholder="Machine name"
            aria-label="Machine name"
            required
            maxLength={200}
          />
          <select name="kind" aria-label="Machine type">
            <option value="computer">Computer</option>
            <option value="ssh">SSH / training machine</option>
          </select>
          <input
            name="dataDir"
            aria-label="Private data directory"
            placeholder="Absolute private data directory"
            required
          />
          <button className="button" disabled={pairing}>
            Download private configuration
          </button>
          <code>node --import tsx server/runner-agent.ts /path/to/relay-machine.private.json</code>
        </form>
      )}
      {error && <span role="alert">{error}</span>}
    </section>
  );
}
