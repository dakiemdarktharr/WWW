import { useEffect, useState } from 'react';
import type { SharedSadeRun } from '../shared/collaboration';
import type { SadeProjectArtifact, SadeProjectView } from '../shared/sade-project';

const stages = {
  preparation: 'Preparation',
  roadmap: 'Roadmap',
  delivery: 'In progress',
  audit: 'Independent audit',
  complete: 'Complete',
} satisfies Record<SadeProjectView['stage'], string>;

type LocalSession = { id: string; title: string };
export default function SharedSadeProject({
  run,
  localSessions,
  requestStatus,
}: {
  run: SharedSadeRun;
  localSessions: LocalSession[];
  requestStatus: () => Promise<void>;
}) {
  const project = run.project!;
  const [selection, setSelection] = useState('');
  const [preview, setPreview] = useState<{ path: string; html: string }>();
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [narrow, setNarrow] = useState(false);
  const active = project.sessions.find(({ taskKey }) => taskKey === selection);
  const activeTask = run.jobs.find(({ task }) => task?.key === selection);
  const local = localSessions.find(({ id }) => id === active?.id);
  const auditReady = run.state === 'done' && project.stage === 'complete';
  const canDownload = !!window.relayDesktop?.projectDeliverable;
  useEffect(() => {
    setPreview(undefined);
    setError('');
  }, [run.id, auditReady]);
  const fetchFile = async (file: SadeProjectArtifact, show: boolean) => {
    if (loading || !canDownload) return;
    setLoading(file.id);
    setError('');
    try {
      const input = { groupId: run.groupId, runId: run.id, fileId: file.id };
      if (show && window.relayDesktop?.projectPreview) {
        await window.relayDesktop.projectPreview(input);
        return;
      }
      const base64 = await window.relayDesktop!.projectDeliverable(input);
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      if (show) {
        setPreview({
          path: file.path,
          html:
            "<meta charset=\"UTF-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'\">" +
            new TextDecoder().decode(bytes),
        });
      } else {
        const blob = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const link = document.createElement('a');
        link.href = blob;
        link.download = file.path.split('/').at(-1) || 'deliverable';
        link.click();
        setTimeout(() => URL.revokeObjectURL(blob), 1000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open this deliverable.');
    } finally {
      setLoading('');
    }
  };
  return (
    <aside
      className="sade-project-sidebar"
      aria-label="Sade project sidebar"
      data-sade-run={run.id}
      data-sade-project={project.kind}
    >
      <header>
        <small>
          {run.state === 'blocked'
            ? 'Blocked'
            : run.state === 'cancelled'
              ? 'Cancelled'
              : stages[project.stage]}
        </small>
        <h3>{project.title}</h3>
        <p role="status">{project.summary}</p>
        <button className="text-button" onClick={() => void requestStatus()}>
          Ask for project status
        </button>
      </header>
      <section aria-label="Project roadmap">
        <h4>Roadmap</h4>
        <ol className="sade-project-roadmap">
          {run.jobs
            .filter(({ task }) => task)
            .map(({ id, task, state }) => (
              <li key={id}>
                <button
                  className="sade-project-session-button"
                  type="button"
                  aria-pressed={selection === task!.key}
                  onClick={() => setSelection(task!.key)}
                >
                  <span>{task!.title}</span>
                  <small>{state}</small>
                </button>
              </li>
            ))}
        </ol>
      </section>
      {activeTask?.task && (
        <section aria-label="Harness session">
          <h4>{activeTask.task.title}</h4>
          {active ? (
            <>
              <small>
                {active.provider} · {active.status} · {active.id.slice(0, 8)}
              </small>
              {local && (
                <button
                  className="text-button"
                  onClick={() => {
                    window.location.hash = `session=${encodeURIComponent(local.id)}`;
                  }}
                >
                  Open session
                </button>
              )}
              <ol className="sade-project-session-events">
                {active.activity.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.at}>
                      {new Date(event.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <p>{event.text}</p>
                  </li>
                ))}
              </ol>
              {!active.activity.length && <p>Waiting for the harness’s first reply.</p>}
            </>
          ) : (
            <p>No session has reported yet.</p>
          )}
        </section>
      )}
      {project.messages.length > 0 && (
        <section aria-label="Project messages">
          <h4>Project messages</h4>
          <ol className="sade-project-messages">
            {project.messages.map((message) => (
              <li key={message.id}>
                <span>
                  <strong>{message.author}</strong>
                  {message.to &&
                    ' → ' +
                      (run.jobs.find(({ task }) => task?.key === message.to)?.task?.title ||
                        message.to)}
                </span>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {auditReady && project.artifacts.length > 0 && (
        <section aria-label="Verified deliverables">
          <h4>Deliverables</h4>
          <ul className="sade-project-files">
            {project.artifacts.map((file) => (
              <li key={file.id}>
                <span>{file.path.split('/').at(-1)}</span>
                {file.path.endsWith('.html') && (
                  <button
                    className="text-button"
                    disabled={!!loading || !canDownload}
                    onClick={() => void fetchFile(file, true)}
                  >
                    Preview
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={!!loading || !canDownload}
                  onClick={() => void fetchFile(file, false)}
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
          {loading && <p role="status">Opening deliverable…</p>}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {preview && (
        <dialog className="sade-project-preview" open aria-label="Deliverable preview">
          <header>
            <strong>{preview.path.split('/').at(-1)}</strong>
            <button
              className="text-button"
              aria-pressed={narrow}
              onClick={() => setNarrow((current) => !current)}
            >
              Mobile viewport
            </button>
            <button className="text-button" onClick={() => setPreview(undefined)}>
              Close preview
            </button>
          </header>
          <iframe
            title="Audited HTML preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={preview.html}
            className={narrow ? 'mobile' : ''}
          />
        </dialog>
      )}
    </aside>
  );
}
