import type { ReactNode } from 'react';
import './HelpDetails.css';

export default function HelpDetails({
  title = 'Help',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="app-help">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
