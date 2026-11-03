import { useEffect, useState } from 'react';
import { api } from './api';
import type { JoinedMachine } from './desktop';
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
  cloud = false,
}: {
  selected: string;
  onSelect: (id: string) => void;
  cloud?: boolean;
}) {
  const [machines, setMachines] = useState<Machine[]>([]),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(''),
    [pairing, setPairing] = useState(false),
    [machineKind, setMachineKind] = useState('computer'),
    [joining, setJoining] = useState(false),
    [joined, setJoined] = useState<JoinedMachine[]>([]);
  useEffect(() => {
    const refresh = () =>
      api<Machine[]>('/runners')
        .then(setMachines)
        .catch((error) => setError(error.message));
    void refresh();
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!window.relayDesktop) return;
    let current = true;
    const refresh = () =>
      window
        .relayDesktop!.getStatus()
        .then((status) => {
          if (current) setJoined(status.machines || []);
        })
        .catch((cause) => {
          if (current) setError(cause.message);
        });
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      current = false;
      clearInterval(timer);
    };
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
          <option value="">{cloud ? 'Cloud' : 'This computer'}</option>
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
      {window.relayDesktop && (
        <button
          className="button compact"
          disabled={joining}
          onClick={async () => {
            setJoining(true);
            setError('');
            try {
              const machine = await window.relayDesktop!.joinMachine();
              if (machine)
                setJoined((previous) => [
                  ...previous.filter((item) => item.id !== machine.id),
                  machine,
                ]);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setJoining(false);
            }
          }}
        >
          {joining ? 'Connecting…' : 'Join as machine'}
        </button>
      )}
      {joined.length > 0 && (
        <div className="joined-machines" aria-label="Connections running on this computer">
          {joined.map((machine) => (
            <div className="joined-machine" key={machine.id}>
              <span>{machine.name}</span>
              <span
                className={`status-dot ${machine.status === 'running' ? 'ready' : 'offline'}`}
              />
              <span>
                {machine.status === 'running'
                  ? 'Running'
                  : machine.status === 'recovery'
                    ? 'Needs recovery'
                    : 'Stopped'}
              </span>
              {machine.status === 'running' && (
                <button
                  className="button compact"
                  disabled={joining}
                  onClick={async () => {
                    setJoining(true);
                    setError('');
                    try {
                      await window.relayDesktop!.stopMachine(machine.id);
                      setJoined((previous) =>
                        previous.map((item) =>
                          item.id === machine.id ? { ...item, status: 'stopped' } : item,
                        ),
                      );
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setJoining(false);
                    }
                  }}
                >
                  Stop connection
                </button>
              )}
              {machine.error && (
                <span className="error-text" role="status">
                  {machine.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
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
              const result = await api<{
                id: string;
                token: string;
                connection?: { origin: string; exchangeUrl: string; bridgeKey: string };
              }>('/runners', {
                name: data.get('name'),
                kind,
              });
              const config = {
                origin: result.connection?.origin || location.origin,
                ...(result.connection
                  ? {
                      exchangeUrl: result.connection.exchangeUrl,
                      bridgeKey: result.connection.bridgeKey,
                    }
                  : {}),
                id: result.id,
                token: result.token,
                dataDir: String(data.get('dataDir')),
                slots: kind === 'ssh' ? 1 : 2,
                maxLoad: kind === 'ssh' ? 3 : 8,
                minFreeMB: 2048,
              };
              if (!result.connection && !cloud)
                throw new Error(
                  'Connect this desktop to the web relay before pairing another machine.',
                );
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
          <select
            name="kind"
            aria-label="Machine type"
            value={machineKind}
            onChange={(event) => setMachineKind(event.target.value)}
          >
            <option value="computer">Computer</option>
            <option value="ssh">SSH / training machine</option>
          </select>
          {machineKind === 'ssh' && (
            <input
              name="dataDir"
              aria-label="Private data directory"
              placeholder="Private directory for a headless machine"
              required
            />
          )}
          <button className="button" disabled={pairing}>
            Download private configuration
          </button>
          <details>
            <summary>Connect the other machine</summary>
            <p>
              In RELAY on that computer, choose Join as machine and open this private configuration.
            </p>
            <p>
              For a headless SSH machine, enter an absolute private data directory above, then run:
            </p>
            <code>
              node --import tsx server/runner-agent.ts /path/to/relay-machine.private.json
            </code>
          </details>
        </form>
      )}
      {error && <span role="alert">{error}</span>}
    </section>
  );
}
