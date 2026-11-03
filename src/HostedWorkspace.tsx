import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Code2, Terminal } from 'lucide-react';
import './hosted.css';
import UsageGuide from './UsageGuide';

const repository = 'https://github.com/dakiemdarktharr/WWW';
const commands = `git clone ${repository}.git\ncd WWW\nnpm ci\nnpm run build\nnpm start`;

/** Hosted entry point. Account access and Codex execution stay on the local runner. */
export default function HostedWorkspace() {
  const [port, setPort] = useState('4317');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const number = Number(port);
  const valid = /^\d{4,5}$/.test(port) && number >= 1024 && number <= 65535;

  async function copy() {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="hosted-workspace">
      <header className="hosted-header">
        <a href="/" className="hosted-brand" aria-label="WWW home">
          <img src="/relay.svg" alt="" width="28" height="28" />
          <strong>WWW</strong>
          <span>RELAY + MESH</span>
        </a>
        <div className="hosted-header-actions">
          <UsageGuide stage="hosted" />
          <a href={repository} target="_blank" rel="noopener noreferrer" className="hosted-link">
            <Code2 size={16} /> Private repository <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main className="hosted-main">
        <div className="hosted-title">
          <Terminal size={22} />
          <h1>Open your workspace</h1>
        </div>
        <p className="hosted-explanation">
          Codex sessions, accounts and project files run on your computer. Start the local runner,
          then open MESH or Sessions.
        </p>
        <section className="hosted-panel" aria-labelledby="runner-heading">
          <div className="hosted-panel-heading">
            <h2 id="runner-heading">Local runner</h2>
            <span className="hosted-label">Node 24.22.1+ · Git · Codex CLI</span>
          </div>
          <div className="hosted-command" data-usage="setup">
            <pre>
              <code>{commands}</code>
            </pre>
            <button
              onClick={() => void copy()}
              aria-label="Copy setup commands"
              title="Copy setup commands"
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
          </div>
          {copyError && (
            <p className="hosted-note" role="status">
              Select the commands above to copy them.
            </p>
          )}
          <div className="hosted-actions">
            <label htmlFor="runner-port">
              Port
              <input
                id="runner-port"
                data-usage="port"
                inputMode="numeric"
                pattern="[0-9]*"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                aria-invalid={!valid}
                maxLength={5}
              />
            </label>
            <a
              className="button primary"
              data-usage="open-mesh"
              href={valid ? `http://127.0.0.1:${number}/#mesh` : undefined}
              aria-disabled={!valid}
              tabIndex={valid ? 0 : -1}
            >
              Open MESH <ArrowUpRight size={15} />
            </a>
            <a
              className="button"
              data-usage="open-sessions"
              href={valid ? `http://127.0.0.1:${number}/#sessions` : undefined}
              aria-disabled={!valid}
              tabIndex={valid ? 0 : -1}
            >
              Sessions <ArrowUpRight size={15} />
            </a>
          </div>
        </section>
        <div className="hosted-footer">
          <span>First run: sign in to each Codex account in Team.</span>
          <a
            className="hosted-link"
            href={`${repository}/blob/main/docs/FOUNDATION.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Setup guide <ArrowUpRight size={14} />
          </a>
        </div>
      </main>
    </div>
  );
}
