import './ConnectionProgress.css';

export default function ConnectionProgress({
  step,
  labels,
  error,
}: {
  step: number;
  labels: string[];
  error?: string;
}) {
  const done = step >= labels.length;
  return (
    <div className="connection-progress" role="status" aria-live="polite">
      <progress aria-label="Connection progress" max={labels.length} value={step} />
      <strong>{error || (done ? 'Connected · You can close this window' : labels[step])}</strong>
      <ol>
        {labels.map((label, index) => (
          <li
            key={label}
            data-complete={index < step}
            aria-current={index === step ? 'step' : undefined}
          >
            {index < step ? '✓' : index + 1} {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
