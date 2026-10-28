import { html } from './html.ts';
import { layout } from './layout.ts';
import type { Html } from './html.ts';

export function errorPage(input: {
  status: number;
  title: string;
  message: string;
  requestId: string;
}): Html {
  const body = html`
    <article class="card stack">
      <p class="muted mono">Status ${String(input.status)} · Request ${input.requestId}</p>
      <h1>${input.title}</h1>
      <p>${input.message}</p>
      <p><a href="/">Return to projects</a></p>
      <p class="small muted">
        If this is unexpected, check the terminal log using the request ID. Internal details and
        stack traces are not shown in the browser.
      </p>
    </article>
  `;
  return layout({ title: `${String(input.status)} ${input.title}`, body });
}
